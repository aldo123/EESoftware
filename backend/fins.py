"""Omron FINS communication backend (FINS/UDP and FINS/TCP)."""
import json
import os
import re
import socket
import struct
import sys
import threading
import time
from flask import Blueprint, request, jsonify

DEFAULT_TIMEOUT = 1.0
DEFAULT_PORT = 9600
DEFAULT_RECONNECT_INTERVAL = 1.0
KEEPALIVE_INTERVAL = 2.0
CONFIG_SYNC_INTERVAL = 1.0
MAX_WORDS_PER_REQUEST = 500
MAX_BITS_PER_REQUEST = 500

FINS_PROTOCOLS = ("fins_udp", "fins_tcp")

# name -> (word area code, bit area code)
AREA_CODES = {
    "CIO": (0xB0, 0x30),
    "WR": (0xB1, 0x31),
    "HR": (0xB2, 0x32),
    "AR": (0xB3, 0x33),
    "DM": (0x82, 0x02),
    "EM": (0x98, 0x18),
}
AREA_ALIASES = {
    "C": "CIO", "CIO": "CIO",
    "W": "WR", "WR": "WR",
    "H": "HR", "HR": "HR",
    "A": "AR", "AR": "AR",
    "D": "DM", "DM": "DM",
    "E": "EM", "EM": "EM",
}

# data type -> (words per item, struct format, python kind)
DATA_TYPES = {
    "BOOL": (0, None, "bool"),
    "WORD": (1, ">H", "int"), "UINT": (1, ">H", "int"), "UINT16": (1, ">H", "int"),
    "INT": (1, ">h", "int"), "INT16": (1, ">h", "int"),
    "DWORD": (2, ">I", "int"), "UDINT": (2, ">I", "int"), "UINT32": (2, ">I", "int"),
    "DINT": (2, ">i", "int"), "INT32": (2, ">i", "int"),
    "REAL": (2, ">f", "float"), "FLOAT": (2, ">f", "float"), "FLOAT32": (2, ">f", "float"),
    "LWORD": (4, ">Q", "int"), "ULINT": (4, ">Q", "int"), "UINT64": (4, ">Q", "int"),
    "LINT": (4, ">q", "int"), "INT64": (4, ">q", "int"),
    "LREAL": (4, ">d", "float"), "FLOAT64": (4, ">d", "float"),
    "STRING": (1, None, "string"),
}

END_CODES = {
    (0x00, 0x01): "Service canceled",
    (0x01, 0x01): "Local node not in network",
    (0x01, 0x02): "Token timeout",
    (0x01, 0x03): "Retries failed",
    (0x01, 0x04): "Too many send frames",
    (0x01, 0x05): "Node address range error",
    (0x01, 0x06): "Node address duplication",
    (0x02, 0x01): "Destination node not in network",
    (0x02, 0x02): "Unit missing",
    (0x02, 0x03): "Third node missing",
    (0x02, 0x05): "Response timeout",
    (0x04, 0x01): "Undefined command",
    (0x04, 0x02): "Not supported by model/version",
    (0x05, 0x01): "Destination address setting error",
    (0x10, 0x01): "Command too long",
    (0x10, 0x02): "Command too short",
    (0x10, 0x03): "Elements/data don't match",
    (0x10, 0x04): "Command format error",
    (0x10, 0x05): "Header error",
    (0x11, 0x01): "Area classification missing",
    (0x11, 0x02): "Access size error",
    (0x11, 0x03): "Address range error",
    (0x11, 0x04): "Address range exceeded",
    (0x11, 0x06): "Program missing",
    (0x11, 0x09): "Relational error",
    (0x11, 0x0A): "Duplicate data access",
    (0x11, 0x0B): "Response too long",
    (0x11, 0x0C): "Parameter error",
    (0x20, 0x02): "Protected",
    (0x20, 0x03): "Table missing",
    (0x20, 0x04): "Data missing",
    (0x20, 0x05): "Program missing",
    (0x21, 0x07): "Data exists (write not possible)",
    (0x21, 0x08): "Write not possible while running",
    (0x22, 0x01): "Not possible during execution",
    (0x22, 0x02): "Not possible while running",
    (0x22, 0x03): "Wrong PLC mode (PROGRAM)",
    (0x22, 0x04): "Wrong PLC mode (DEBUG)",
    (0x22, 0x05): "Wrong PLC mode (MONITOR)",
    (0x22, 0x06): "Wrong PLC mode (RUN)",
    (0x23, 0x01): "Cannot access (write protected)",
    (0x24, 0x01): "Error log full",
    (0x25, 0x02): "Memory error",
    (0x26, 0x01): "I/O table cannot be created",
    (0x30, 0x01): "No access right",
}


def _settings_path():
    if getattr(sys, "frozen", False):
        return os.path.join(os.path.dirname(sys.executable), "_internal", "data", "setting.json")
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "setting.json")
    if not os.path.exists(p):
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "setting.json")
    return p


def _normalize_fins_protocol(value):
    p = re.sub(r"[\s/_\-]+", " ", str(value or "").strip().lower()).strip()
    aliases = {
        "fins udp": "fins_udp", "omron fins udp": "fins_udp", "fins over udp": "fins_udp",
        "fins tcp": "fins_tcp", "omron fins tcp": "fins_tcp", "fins over tcp": "fins_tcp",
    }
    return aliases.get(p, "")


def _to_int(value, default, low=None, high=None):
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        number = default
    if low is not None:
        number = max(low, number)
    if high is not None:
        number = min(high, number)
    return number


_LAST_GOOD_DEVICES = {}


def _load_devices_for(protocol_key):
    path = _settings_path()
    if not os.path.exists(path):
        return list(_LAST_GOOD_DEVICES.get(protocol_key, []))
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
        rows = data.get("Communication Devices", {}).get("_table", [])
        result = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            raw_protocol = (row.get("Protocol") or row.get("protocol")
                            or row.get("Communication Protocol") or row.get("Mode") or "")
            if _normalize_fins_protocol(raw_protocol) != protocol_key:
                continue
            name = str(row.get("Device Name", "")).strip()
            if not name:
                continue
            item = dict(row)
            item["Device Name"] = name
            item["Protocol"] = protocol_key
            item["Type"] = "UDP" if protocol_key == "fins_udp" else "TCP"
            item["IP Address"] = str(row.get("IP Address") or row.get("IP") or row.get("Host") or "").strip()
            item["Port"] = _to_int(row.get("Port"), DEFAULT_PORT, 1, 65535)
            item["Client Node"] = _to_int(row.get("Client Node"), 0, 0, 254)
            item["PLC Node"] = _to_int(row.get("PLC Node"), 0, 0, 254)
            item["PLC Network"] = _to_int(row.get("PLC Network"), 0, 0, 127)
            item["PLC Unit"] = _to_int(row.get("PLC Unit"), 0, 0, 255)
            try:
                item["Timeout"] = max(0.20, min(float(row.get("Timeout", DEFAULT_TIMEOUT) or DEFAULT_TIMEOUT), 5.0))
            except (TypeError, ValueError):
                item["Timeout"] = DEFAULT_TIMEOUT
            result.append(item)
        _LAST_GOOD_DEVICES[protocol_key] = list(result)
        return result
    except Exception as exc:
        print(f"[{protocol_key.upper()}] Setting load error: {exc} — keeping last valid device list")
        return list(_LAST_GOOD_DEVICES.get(protocol_key, []))


# ============================================================
# ADDRESS / VALUE HELPERS
# ============================================================

_ADDRESS_RE = re.compile(r"^([A-Za-z]*)\s*(\d+)(?:\.(\d+))?$")


def normalize_area(value):
    key = str(value or "").strip().upper()
    if key in AREA_ALIASES:
        return AREA_ALIASES[key]
    raise ValueError(f"Unsupported FINS memory area: {value!r} (use DM, CIO, WR, HR, AR or EM)")


def parse_address(address, area=None, bit=None):
    """Accepts 'D100', 'DM100', 'CIO10.03', or a plain '100' / '100.3' together
    with an explicit `area`. Returns (area, word_address, bit_or_None)."""
    match = _ADDRESS_RE.match(str(address if address is not None else "").strip())
    if not match:
        raise ValueError(f"Invalid FINS address: {address!r} (example: D100, CIO10.03)")
    prefix, word, dot_bit = match.groups()
    if prefix:
        resolved = normalize_area(prefix)
    elif area:
        resolved = normalize_area(area)
    else:
        raise ValueError(f"FINS address {address!r} has no memory area")
    word_address = int(word)
    if not 0 <= word_address <= 0xFFFF:
        raise ValueError("FINS word address must be 0..65535")
    bit_value = dot_bit if dot_bit is not None else bit
    if bit_value in (None, ""):
        return resolved, word_address, None
    bit_value = int(bit_value)
    if not 0 <= bit_value <= 15:
        raise ValueError("FINS bit must be 0..15")
    return resolved, word_address, bit_value


def _normalize_data_type(value, default="WORD"):
    dtype = str(value or default).strip().upper()
    if dtype not in DATA_TYPES:
        raise ValueError(f"Unsupported FINS data type: {dtype}")
    return dtype


def _to_bool(value):
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "on", "yes")
    return bool(value)


def _item_words(dtype, count):
    size = DATA_TYPES[dtype][0]
    return max(1, int(count)) * size


def _decode(words, dtype, count, low_word_first=True):
    size, fmt, kind = DATA_TYPES[dtype]
    if kind == "string":
        raw = b"".join(struct.pack(">H", w) for w in words)
        return raw.split(b"\x00", 1)[0].decode("latin-1")
    values = []
    for i in range(int(count)):
        chunk = words[i * size:(i + 1) * size]
        if low_word_first:
            chunk = list(reversed(chunk))
        raw = b"".join(struct.pack(">H", w) for w in chunk)
        values.append(struct.unpack(fmt, raw)[0])
    return values


def _encode(values, dtype, low_word_first=True):
    size, fmt, kind = DATA_TYPES[dtype]
    if kind == "string":
        raw = str(values[0] if values else "").encode("latin-1", errors="replace")
        if len(raw) % 2:
            raw += b"\x00"
        return [struct.unpack_from(">H", raw, i)[0] for i in range(0, len(raw), 2)] or [0]
    words = []
    for item in values:
        number = float(item) if kind == "float" else int(float(item))
        raw = struct.pack(fmt, number)
        chunk = [struct.unpack_from(">H", raw, i)[0] for i in range(0, len(raw), 2)]
        if low_word_first:
            chunk.reverse()
        words.extend(chunk)
    return words


# ============================================================
# CLIENTS
# ============================================================

class FinsClient:
    """Base FINS client. Subclasses supply the transport (_open/_close/_exchange)."""

    protocol = ""
    type_label = ""
    label = ""

    def __init__(self, device):
        self.name = str(device.get("Device Name", ""))
        self.ip = ""
        self.port = DEFAULT_PORT
        self.timeout = DEFAULT_TIMEOUT
        self.client_node = 0
        self.plc_node = 0
        self.plc_network = 0
        self.plc_unit = 0
        self.sa1 = 0
        self.da1 = 0
        self.sock = None
        self.running = False
        self.lock = threading.RLock()
        self.sid = 0
        self.last_attempt = 0.0
        self.last_ok = 0.0
        self.last_error = ""
        self.configure(device)

    def configure(self, device):
        self.ip = str(device.get("IP Address") or device.get("IP") or device.get("Host") or "").strip()
        self.port = _to_int(device.get("Port"), DEFAULT_PORT, 1, 65535)
        self.client_node = _to_int(device.get("Client Node"), 0, 0, 254)
        self.plc_node = _to_int(device.get("PLC Node"), 0, 0, 254)
        self.plc_network = _to_int(device.get("PLC Network"), 0, 0, 127)
        self.plc_unit = _to_int(device.get("PLC Unit"), 0, 0, 255)
        try:
            self.timeout = float(device.get("Timeout", DEFAULT_TIMEOUT) or DEFAULT_TIMEOUT)
        except (TypeError, ValueError):
            self.timeout = DEFAULT_TIMEOUT
        self.timeout = max(0.20, min(self.timeout, 5.0))

    # ── transport hooks ───────────────────────────────────────
    def _open(self):
        raise NotImplementedError

    def _exchange(self, frame, sid):
        raise NotImplementedError

    # ── connection ────────────────────────────────────────────
    def is_connected(self):
        return bool(self.running and self.sock is not None)

    def connect(self):
        with self.lock:
            if self.is_connected():
                return True
            self.disconnect()
            if not self.ip or not self.port:
                self.last_error = "IP address / port is not configured"
                return False
            try:
                print(f"[{self.label}] Connecting {self.name} -> {self.ip}:{self.port}")
                self._open()
                self.running = True
                self.request(0x0501)  # Controller Data Read — confirms the PLC really answers
                self.last_error = ""
                print(f"[{self.label}] Connected: {self.name} (SA1={self.sa1}, DA1={self.da1})")
                return True
            except Exception as exc:
                self.last_error = str(exc)
                print(f"[{self.label}] Connect error [{self.name}]: {exc}")
                self.disconnect()
                return False

    def disconnect(self):
        with self.lock:
            sock = self.sock
            self.running = False
            self.sock = None
            if sock:
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except Exception:
                    pass
                try:
                    sock.close()
                except Exception:
                    pass

    def keepalive(self):
        """Probe the PLC so status reflects reality even when nothing is reading."""
        if not self.is_connected() or time.monotonic() - self.last_ok < KEEPALIVE_INTERVAL:
            return
        if self.lock.acquire(blocking=False):
            try:
                self.request(0x0501)
            except Exception:
                pass
            finally:
                self.lock.release()

    # ── FINS frame ────────────────────────────────────────────
    def _next_sid(self):
        self.sid = (self.sid % 255) + 1
        return self.sid

    def _header(self, sid):
        return bytes([0x80, 0x00, 0x02, self.plc_network, self.da1, self.plc_unit,
                      0x00, self.sa1, 0x00, sid])

    def request(self, command, params=b""):
        """Send one FINS command, return the response data after the end code."""
        with self.lock:
            if not self.is_connected() and not self.connect():
                raise ConnectionError(f"Unable to connect to FINS device {self.ip}:{self.port}"
                                      + (f" ({self.last_error})" if self.last_error else ""))
            sid = self._next_sid()
            frame = self._header(sid) + struct.pack(">H", command) + bytes(params)
            try:
                response = self._exchange(frame, sid)
            except (OSError, ConnectionError) as exc:
                self.last_error = str(exc)
                self.disconnect()
                raise ConnectionError(f"FINS communication error [{self.name}]: {exc}") from exc
            if len(response) < 14:
                self.disconnect()
                raise ConnectionError("FINS response too short")
            self.last_ok = time.monotonic()
            mres, sres = response[12], response[13]
            if (mres & 0x7F) or (sres & 0x3F):
                text = END_CODES.get((mres & 0x7F, sres & 0x3F), "FINS error")
                raise RuntimeError(f"FINS end code 0x{mres:02X}{sres:02X}: {text}")
            return response[14:]

    # ── memory access ─────────────────────────────────────────
    @staticmethod
    def _area_params(area, address, bit, count, bit_access):
        word_code, bit_code = AREA_CODES[area]
        return struct.pack(">BHBH", bit_code if bit_access else word_code, address, bit or 0, count)

    def read_words(self, area, address, count):
        area = normalize_area(area)
        words = []
        remaining = int(count)
        if remaining < 1:
            raise ValueError("FINS read count must be >= 1")
        offset = int(address)
        while remaining > 0:
            chunk = min(remaining, MAX_WORDS_PER_REQUEST)
            data = self.request(0x0101, self._area_params(area, offset, 0, chunk, False))
            if len(data) < chunk * 2:
                raise RuntimeError(f"FINS read returned {len(data)} bytes, expected {chunk * 2}")
            words.extend(struct.unpack_from(">H", data, i * 2)[0] for i in range(chunk))
            offset += chunk
            remaining -= chunk
        return words

    def write_words(self, area, address, words):
        area = normalize_area(area)
        words = [int(w) & 0xFFFF for w in words]
        offset = int(address)
        for start in range(0, len(words), MAX_WORDS_PER_REQUEST):
            chunk = words[start:start + MAX_WORDS_PER_REQUEST]
            payload = b"".join(struct.pack(">H", w) for w in chunk)
            self.request(0x0102, self._area_params(area, offset, 0, len(chunk), False) + payload)
            offset += len(chunk)
        return True

    def read_bits(self, area, address, bit, count):
        area = normalize_area(area)
        count = int(count)
        if not 1 <= count <= MAX_BITS_PER_REQUEST:
            raise ValueError(f"FINS bit read count must be 1..{MAX_BITS_PER_REQUEST}")
        data = self.request(0x0101, self._area_params(area, int(address), int(bit or 0), count, True))
        if len(data) < count:
            raise RuntimeError(f"FINS bit read returned {len(data)} bytes, expected {count}")
        return [bool(b) for b in data[:count]]

    def write_bits(self, area, address, bit, values):
        area = normalize_area(area)
        if not 1 <= len(values) <= MAX_BITS_PER_REQUEST:
            raise ValueError(f"FINS bit write count must be 1..{MAX_BITS_PER_REQUEST}")
        payload = bytes(1 if _to_bool(v) else 0 for v in values)
        self.request(0x0102, self._area_params(area, int(address), int(bit or 0), len(values), True) + payload)
        return True

    # ── typed access (what routes / logic engine call) ────────
    def read_value(self, address, area=None, bit=None, data_type=None, count=1, low_word_first=True):
        area, word_address, bit_index = parse_address(address, area, bit)
        dtype = _normalize_data_type(data_type, "BOOL" if bit_index is not None else "WORD")
        count = max(1, int(count or 1))
        if dtype == "BOOL":
            return self.read_bits(area, word_address, bit_index or 0, count)
        words = self.read_words(area, word_address, _item_words(dtype, count))
        return _decode(words, dtype, count, low_word_first)

    def write_value(self, address, value, area=None, bit=None, data_type=None, low_word_first=True):
        area, word_address, bit_index = parse_address(address, area, bit)
        dtype = _normalize_data_type(data_type, "BOOL" if bit_index is not None else "WORD")
        values = list(value) if isinstance(value, (list, tuple)) else [value]
        if dtype == "BOOL":
            return self.write_bits(area, word_address, bit_index or 0, values)
        return self.write_words(area, word_address, _encode(values, dtype, low_word_first))


class FinsUdpClient(FinsClient):
    protocol = "fins_udp"
    type_label = "UDP"
    label = "FINS/UDP"

    def _open(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.settimeout(self.timeout)
            s.connect((self.ip, self.port))  # no traffic yet; just fixes the peer + local address
            local_ip = s.getsockname()[0]
        except Exception:
            s.close()
            raise
        self.sock = s
        self.sa1 = self.client_node or int(local_ip.split(".")[-1])
        self.da1 = self.plc_node or int(self.ip.split(".")[-1])

    def _exchange(self, frame, sid):
        self.sock.setblocking(False)
        try:
            while True:  # drop stale datagrams from earlier timed-out requests
                self.sock.recv(4096)
        except (BlockingIOError, InterruptedError):
            pass
        self.sock.settimeout(self.timeout)
        self.sock.send(frame)
        deadline = time.monotonic() + self.timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise socket.timeout("FINS/UDP response timeout")
            self.sock.settimeout(remaining)
            response = self.sock.recv(4096)
            if len(response) >= 14 and response[9] == sid:
                return response


class FinsTcpClient(FinsClient):
    protocol = "fins_tcp"
    type_label = "TCP"
    label = "FINS/TCP"

    MAGIC = b"FINS"
    CMD_NODE_REQUEST = 0
    CMD_NODE_ACK = 1
    CMD_FRAME = 2

    def _recv_exact(self, size):
        chunks = []
        remaining = int(size)
        while remaining > 0:
            chunk = self.sock.recv(remaining)
            if not chunk:
                raise ConnectionError("FINS/TCP connection closed")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _recv_packet(self):
        head = self._recv_exact(8)
        if head[:4] != self.MAGIC:
            raise ConnectionError("Invalid FINS/TCP header")
        length = struct.unpack(">I", head[4:8])[0]
        body = self._recv_exact(length) if length else b""
        if len(body) < 8:
            raise ConnectionError("FINS/TCP packet too short")
        command, error = struct.unpack(">II", body[:8])
        return command, error, body[8:]

    def _open(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
            s.settimeout(self.timeout)
            s.connect((self.ip, self.port))
            self.sock = s
            # Node address exchange: the PLC answers with our (client) and its (server) node numbers.
            s.sendall(self.MAGIC + struct.pack(">III", 12, self.CMD_NODE_REQUEST, 0)
                      + struct.pack(">I", self.client_node))
            command, error, payload = self._recv_packet()
            if command != self.CMD_NODE_ACK or error != 0 or len(payload) < 8:
                raise ConnectionError(f"FINS/TCP node handshake failed: command={command}, error=0x{error:08X}")
            client_node, server_node = struct.unpack(">II", payload[:8])
            self.sa1 = client_node & 0xFF
            self.da1 = self.plc_node or (server_node & 0xFF)
        except Exception:
            self.sock = None
            s.close()
            raise

    def _exchange(self, frame, sid):
        self.sock.settimeout(self.timeout)
        self.sock.sendall(self.MAGIC + struct.pack(">III", 8 + len(frame), self.CMD_FRAME, 0) + frame)
        deadline = time.monotonic() + self.timeout
        while True:
            if time.monotonic() > deadline:
                raise socket.timeout("FINS/TCP response timeout")
            command, error, payload = self._recv_packet()
            if error != 0:
                raise ConnectionError(f"FINS/TCP error 0x{error:08X}")
            if command == self.CMD_FRAME and len(payload) >= 14 and payload[9] == sid:
                return payload


CLIENT_CLASSES = {"fins_udp": FinsUdpClient, "fins_tcp": FinsTcpClient}


# ============================================================
# MANAGER
# ============================================================

fins_bp = Blueprint("fins", __name__)
_clients = {}
_clients_lock = threading.RLock()


def get_client(name):
    with _clients_lock:
        client = _clients.get(str(name))
    if client:
        return client
    sync_devices()
    with _clients_lock:
        client = _clients.get(str(name))
    if not client:
        raise KeyError(f"Device '{name}' not found or not configured for FINS.")
    return client


_get_client = get_client  # same accessor name the other protocol modules expose


def sync_devices():
    devices = {}
    for protocol_key in FINS_PROTOCOLS:
        for device in _load_devices_for(protocol_key):
            devices[device["Device Name"]] = device
    with _clients_lock:
        for name in list(_clients):
            if name not in devices or type(_clients[name]) is not CLIENT_CLASSES[devices[name]["Protocol"]]:
                _clients[name].disconnect()
                del _clients[name]
        for name, device in devices.items():
            if name not in _clients:
                _clients[name] = CLIENT_CLASSES[device["Protocol"]](device)
                continue
            client = _clients[name]
            keys = ("ip", "port", "timeout", "client_node", "plc_node", "plc_network", "plc_unit")
            old = tuple(vars(client).get(k) for k in keys)
            client.configure(device)
            new = tuple(vars(client).get(k) for k in keys)
            if old != new:
                client.disconnect()


def reconnect_loop():
    last_sync = 0.0
    while True:
        try:
            now = time.monotonic()
            if now - last_sync >= CONFIG_SYNC_INTERVAL:
                sync_devices()
                last_sync = now
            with _clients_lock:
                clients = list(_clients.values())
            wall_now = time.time()
            for client in clients:
                if client.is_connected():
                    client.keepalive()
                elif wall_now - client.last_attempt >= DEFAULT_RECONNECT_INTERVAL:
                    client.last_attempt = wall_now
                    client.connect()
        except Exception as exc:
            print(f"[FINS] reconnect loop error: {exc}")
        time.sleep(0.10)


threading.Thread(target=reconnect_loop, daemon=True, name="fins-AutoReconnect").start()


def connect_device(name):
    client = get_client(name)
    ok = client.connect()
    return jsonify({"success": bool(ok), "device_name": str(name), "protocol": client.protocol,
                    "connected": bool(client.is_connected()),
                    **({"message": client.last_error} if not ok and client.last_error else {})})


def disconnect_device(name=None):
    sync_devices()
    with _clients_lock:
        clients = dict(_clients)
    if name:
        client = clients.get(str(name))
        if not client:
            return jsonify({"success": False, "message": f"Device '{name}' not found"}), 404
        client.disconnect()
        return jsonify({"success": True, "device_name": str(name), "connected": False})
    for client in clients.values():
        client.disconnect()
    return jsonify({"success": True})


def get_devices():
    sync_devices()
    with _clients_lock:
        clients = dict(_clients)
    result = []
    for protocol_key in FINS_PROTOCOLS:
        for d in _load_devices_for(protocol_key):
            name = d["Device Name"]
            c = clients.get(name)
            item = dict(d)
            item["name"] = name
            item["connected"] = bool(c.is_connected()) if c else False
            if c is not None:
                item["ip"] = c.ip
                item["port"] = c.port
            result.append(item)
    return result


def get_status():
    sync_devices()
    with _clients_lock:
        clients = dict(_clients)
    result = {}
    for name, client in clients.items():
        result[name] = {
            "connected": bool(client.is_connected()),
            "protocol": client.label,
            "type": client.type_label,
            "ip": client.ip,
            "port": client.port,
            "timeout": client.timeout,
            "client_node": client.sa1,
            "plc_node": client.da1,
            "error": client.last_error,
        }
    return result


def _body_address(body):
    address = body.get("address")
    if address in (None, ""):
        address = body.get("tag")
    if address in (None, ""):
        raise ValueError("FINS requires 'address' (example: D100, CIO10.03)")
    return address


def _body_area(body):
    return body.get("area") or body.get("address_type")


def _low_word_first(body):
    return str(body.get("word_order") or "low_first").strip().lower() != "high_first"


def read_config(body):
    name = str(body.get("device_name") or "").strip()
    client = get_client(name)
    address = _body_address(body)
    value = client.read_value(address, area=_body_area(body), bit=body.get("bit"),
                              data_type=body.get("data_type"), count=body.get("count", 1),
                              low_word_first=_low_word_first(body))
    scalar = value[0] if isinstance(value, list) and len(value) == 1 else value
    return {"success": True, "device_name": name, "protocol": client.protocol, "address": address,
            "data_type": body.get("data_type"), "value": scalar,
            "values": value if isinstance(value, list) else [value],
            "connected": bool(client.is_connected())}


def write_config(body):
    name = str(body.get("device_name") or "").strip()
    client = get_client(name)
    address = _body_address(body)
    client.write_value(address, body.get("value"), area=_body_area(body), bit=body.get("bit"),
                       data_type=body.get("data_type"), low_word_first=_low_word_first(body))
    return {"success": True, "device_name": name, "protocol": client.protocol, "address": address,
            "data_type": body.get("data_type"), "value": body.get("value"),
            "connected": bool(client.is_connected())}


@fins_bp.get("/api/fins/devices")
def devices_route(): return jsonify({"success": True, "devices": get_devices()})
@fins_bp.get("/api/fins/status")
def status_route(): return jsonify(get_status())
@fins_bp.post("/api/fins/test-connection")
def test_route():
    try:
        name = str((request.get_json() or {}).get("device_name") or "").strip()
        client = get_client(name)
        ok = client.connect()
        return jsonify({"success": bool(ok and client.is_connected()), "device_name": name,
                        "protocol": client.protocol, "connected": bool(client.is_connected()),
                        "message": "Connected" if client.is_connected() else (client.last_error or "Connection failed")})
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 400
@fins_bp.post("/api/fins/connect")
def connect_route():
    try: return connect_device((request.get_json() or {}).get("device_name"))
    except Exception as exc: return jsonify({"success": False, "message": str(exc)}), 400
@fins_bp.post("/api/fins/disconnect")
def disconnect_route(): return disconnect_device((request.get_json() or {}).get("device_name"))
@fins_bp.post("/api/fins/read")
def read_route():
    try: return jsonify(read_config(request.get_json() or {}))
    except Exception as exc: return jsonify({"success": False, "message": str(exc)}), 400
@fins_bp.post("/api/fins/write")
def write_route():
    try: return jsonify(write_config(request.get_json() or {}))
    except Exception as exc: return jsonify({"success": False, "message": str(exc)}), 400


# ============================================================
# LOGIC BUILDER HELPERS
# ============================================================
# Logic Builder nodes store one device pick as flat keys (optionally namespaced by a
# prefix): device_name, address_type, address, data_type, count. These two helpers
# keep logic_engine.py / device_poller.py free of FINS details.

def read_for_logic(cfg, prefix=""):
    """Live-read one FINS value from a Logic Builder node config, returned as text.
    Bits come back as "1"/"0" so they compare against a trigger/compare value of 1/0."""
    client = get_client(cfg.get(f"{prefix}device_name", ""))
    data_type = cfg.get(f"{prefix}data_type") or None
    count = cfg.get(f"{prefix}count") or (10 if str(data_type or "").upper() == "STRING" else 1)
    value = client.read_value(cfg.get(f"{prefix}address", "0"), area=cfg.get(f"{prefix}address_type"),
                              data_type=data_type, count=count)
    if isinstance(value, str):
        return value
    value = value[0]
    return ("1" if value else "0") if isinstance(value, bool) else str(value)


def write_for_logic(cfg, value, prefix=""):
    """Write one value to FINS memory from a Logic Builder node config."""
    client = get_client(cfg.get(f"{prefix}device_name", ""))
    client.write_value(cfg.get(f"{prefix}address", "0"), value, area=cfg.get(f"{prefix}address_type"),
                       data_type=cfg.get(f"{prefix}data_type") or None)
    return True
