"""Protocol-specific EE Interlock communication backend."""
import json
import os
import queue
import re
import select
import socket
import struct
import sys
import threading
import time
from flask import Blueprint, request, jsonify

DEFAULT_TIMEOUT = 0.35
DEFAULT_RECONNECT_INTERVAL = 1.0
CONFIG_SYNC_INTERVAL = 1.0


def _settings_path():
    if getattr(sys, "frozen", False):
        return os.path.join(os.path.dirname(sys.executable), "_internal", "data", "setting.json")
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "setting.json")
    if not os.path.exists(p):
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "setting.json")
    return p


def _normalize_protocol(value):
    p = str(value or "").strip().lower()
    aliases = {
        "modbus": "modbus_tcp", "modbus tcp": "modbus_tcp", "modbus_tcp": "modbus_tcp",
        "raw": "raw_tcp", "raw tcp": "raw_tcp", "raw tcp/ip": "raw_tcp", "raw_tcp": "raw_tcp",
        "tcp socket": "raw_tcp", "tcp socket/ip": "raw_tcp", "tcp/ip": "raw_tcp",
        "ethernet/ip": "ethernet_ip", "ethernet ip": "ethernet_ip", "ethernetip": "ethernet_ip", "ethernet_ip": "ethernet_ip", "cip": "ethernet_ip", "enip": "ethernet_ip",
        "udp": "udp_serial", "udp/ip": "udp_serial", "udp serial": "udp_serial", "udp_serial": "udp_serial", "serial over udp": "udp_serial", "serial-over-udp": "udp_serial",
    }
    return aliases.get(p, "modbus_tcp")


_LAST_GOOD_DEVICES = {}

def _load_devices_for(protocol_key):
    path = _settings_path()
    if not os.path.exists(path):
        return list(_LAST_GOOD_DEVICES.get(protocol_key, []))
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data=json.load(f)
        rows=data.get("Communication Devices", {}).get("_table", [])
        result=[]
        for row in rows:
            if not isinstance(row,dict):
                continue
            raw_type=str(row.get("Type","")).strip().lower()
            raw_protocol=(row.get("Protocol") or row.get("protocol") or row.get("Communication Protocol") or row.get("Mode") or "")
            protocol=_normalize_protocol(raw_protocol or raw_type)
            if raw_type == "tcp" and not raw_protocol:
                protocol="modbus_tcp"
            if protocol != protocol_key:
                continue
            name=str(row.get("Device Name","")).strip()
            if not name:
                continue
            item=dict(row)
            item["Device Name"]=name
            item["Protocol"]=protocol_key
            item["Type"]="UDP" if protocol_key=="udp_serial" else "TCP"
            if protocol_key=="udp_serial":
                local_ip=str(row.get("Local IP Address") or row.get("Local IP") or "").strip()
                remote_ip=str(row.get("Remote IP Address") or row.get("Remote IP") or row.get("IP Address") or row.get("IP") or row.get("Host") or "").strip()
                try: local_port=int(row.get("Local Port") or 0)
                except (TypeError,ValueError): local_port=0
                try: remote_port=int(row.get("Remote Port") or row.get("Port") or 0)
                except (TypeError,ValueError): remote_port=0
                item.update({"Local IP":local_ip,"Local IP Address":local_ip,"Local Port":local_port,"Remote IP":remote_ip,"Remote IP Address":remote_ip,"Remote Port":remote_port,"IP Address":remote_ip,"Port":remote_port})
            else:
                item["IP Address"]=str(row.get("IP Address") or row.get("IP") or row.get("Host") or "").strip()
                default_port=44818 if protocol_key=="ethernet_ip" else 3000
                try: item["Port"]=int(row.get("Port") or default_port)
                except (TypeError,ValueError): item["Port"]=default_port
            try: item["Timeout"]=max(0.10,min(float(row.get("Timeout",DEFAULT_TIMEOUT) or DEFAULT_TIMEOUT),5.0))
            except (TypeError,ValueError): item["Timeout"]=DEFAULT_TIMEOUT
            result.append(item)
        _LAST_GOOD_DEVICES[protocol_key] = list(result)
        return result
    except Exception as exc:
        print(f"[{protocol_key.upper()}] Setting load error: {exc} — keeping last valid device list")
        return list(_LAST_GOOD_DEVICES.get(protocol_key, []))


def _tcp_socket_alive(sock):
    if sock is None:
        return False
    try:
        readable, _, _ = select.select([sock], [], [], 0)
        if not readable:
            return True
        data=sock.recv(1, socket.MSG_PEEK)
        return bool(data)
    except (BlockingIOError, InterruptedError):
        return True
    except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError, OSError):
        return False


class EtherNetIPClient:
    """EtherNet/IP explicit messaging client for Allen-Bradley/CIP devices.

    Supported operations intentionally focus on common symbolic tag access:
    BOOL, SINT, USINT, INT, UINT, DINT, UDINT, LINT, ULINT, REAL, LREAL and
    fixed-size byte arrays. This is explicit messaging over TCP/44818; no I/O
    (implicit) connection is opened here.
    """

    protocol = "ethernet_ip"
    ENCAP_REGISTER_SESSION = 0x0065
    ENCAP_UNREGISTER_SESSION = 0x0066
    ENCAP_SEND_RR_DATA = 0x006F
    CIP_READ_TAG = 0x4C
    CIP_WRITE_TAG = 0x4D

    CIP_TYPES = {
        "BOOL": (0x00C1, 1, "bool"),
        "SINT": (0x00C2, 1, "int8"),
        "INT": (0x00C3, 2, "int16"),
        "DINT": (0x00C4, 4, "int32"),
        "LINT": (0x00C5, 8, "int64"),
        "USINT": (0x00C6, 1, "uint8"),
        "UINT": (0x00C7, 2, "uint16"),
        "UDINT": (0x00C8, 4, "uint32"),
        "ULINT": (0x00C9, 8, "uint64"),
        "REAL": (0x00CA, 4, "float32"),
        "LREAL": (0x00CB, 8, "float64"),
        "BYTE": (0x00D1, 1, "uint8"),
        "WORD": (0x00D2, 2, "uint16"),
        "DWORD": (0x00D3, 4, "uint32"),
    }

    def __init__(self, device):
        self.name = str(device.get("Device Name", ""))
        self.ip = ""
        self.port = 44818
        self.timeout = 1.0
        self.sock = None
        self.running = False
        self.lock = threading.RLock()
        self.session_handle = 0
        self.sender_context = os.urandom(8)
        self.sequence = 0
        self.last_attempt = 0.0
        self.configure(device)

    def configure(self, device):
        self.ip = str(device.get("IP Address") or device.get("IP") or device.get("Host") or "").strip()
        try:
            self.port = int(device.get("Port", 44818) or 44818)
        except (TypeError, ValueError):
            self.port = 44818
        try:
            self.timeout = float(device.get("Timeout", 1.0) or 1.0)
        except (TypeError, ValueError):
            self.timeout = 1.0
        self.timeout = max(0.20, min(self.timeout, 5.0))

    def is_connected(self):
        if self.sock is None or not self.running or not self.session_handle:
            return False
        if not _tcp_socket_alive(self.sock):
            self.disconnect()
            return False
        return True

    @staticmethod
    def _pack_encap(command, payload=b"", session_handle=0, sender_context=b"\x00" * 8, options=0):
        return struct.pack(
            "<HHII8sI",
            int(command) & 0xFFFF,
            len(payload),
            int(session_handle) & 0xFFFFFFFF,
            0,
            bytes(sender_context[:8]).ljust(8, b"\x00"),
            int(options) & 0xFFFFFFFF,
        ) + bytes(payload)

    @staticmethod
    def _recv_exact(sock, size):
        chunks = []
        remaining = int(size)
        while remaining > 0:
            chunk = sock.recv(remaining)
            if not chunk:
                raise ConnectionError("EtherNet/IP connection closed")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _recv_encap(self):
        header = self._recv_exact(self.sock, 24)
        command, length, session, status, context, options = struct.unpack("<HHII8sI", header)
        payload = self._recv_exact(self.sock, length) if length else b""
        return command, payload, session, status, context, options

    def connect(self):
        with self.lock:
            if self.is_connected():
                return True
            self.disconnect()
            if not self.ip or not self.port:
                return False
            s = None
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                s.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
                s.settimeout(self.timeout)
                print(f"[ETHERNET/IP] Connecting {self.name} -> {self.ip}:{self.port}")
                s.connect((self.ip, self.port))
                self.sock = s
                self.running = True
                self.session_handle = 0

                register_payload = struct.pack("<HH", 1, 0)
                self.sock.sendall(self._pack_encap(self.ENCAP_REGISTER_SESSION, register_payload, 0, self.sender_context))
                command, payload, session, status, _ctx, _opts = self._recv_encap()
                if command != self.ENCAP_REGISTER_SESSION or status != 0 or len(payload) < 4:
                    raise ConnectionError(f"EtherNet/IP RegisterSession failed: command=0x{command:04X}, status={status}")
                self.session_handle = session
                print(f"[ETHERNET/IP] Connected: {self.name}, session=0x{session:08X}")
                return True
            except Exception as exc:
                print(f"[ETHERNET/IP] Connect error [{self.name}]: {exc}")
                try:
                    if s:
                        s.close()
                except Exception:
                    pass
                self.sock = None
                self.running = False
                self.session_handle = 0
                return False

    def disconnect(self):
        with self.lock:
            sock = self.sock
            session = self.session_handle
            self.running = False
            self.sock = None
            self.session_handle = 0
            if sock:
                try:
                    if session:
                        payload = b""
                        packet = self._pack_encap(self.ENCAP_UNREGISTER_SESSION, payload, session, self.sender_context)
                        sock.sendall(packet)
                except Exception:
                    pass
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except Exception:
                    pass
                try:
                    sock.close()
                except Exception:
                    pass

    @staticmethod
    def _symbolic_path(tag):
        tag = str(tag or "").strip()
        if not tag:
            raise ValueError("EtherNet/IP tag is empty")
        raw = tag.encode("ascii", errors="strict")
        if len(raw) > 255:
            raise ValueError("EtherNet/IP symbolic tag is too long")
        segment = bytes([0x91, len(raw)]) + raw
        if len(raw) % 2:
            segment += b"\x00"
        # Request Path Size is measured in 16-bit words.
        return bytes([len(segment) // 2, 0x00]) + segment

    def _send_rr_data(self, cip_message):
        # Encapsulation SendRRData -> two items: Null Address + Unconnected Data (0xB2).
        interface_handle = 0
        timeout = 0
        address_item = struct.pack("<HH", 0x0000, 0)
        data_item = struct.pack("<HH", 0x00B2, len(cip_message)) + cip_message
        payload = struct.pack("<IH", interface_handle, timeout) + address_item + data_item
        packet = self._pack_encap(self.ENCAP_SEND_RR_DATA, payload, self.session_handle, self.sender_context)
        with self.lock:
            if not self.is_connected() and not self.connect():
                raise ConnectionError(f"Unable to connect to EtherNet/IP device {self.ip}:{self.port}")
            try:
                self.sender_context = struct.pack("<Q", time.time_ns() & 0xFFFFFFFFFFFFFFFF)
                packet = self._pack_encap(self.ENCAP_SEND_RR_DATA, payload, self.session_handle, self.sender_context)
                self.sock.sendall(packet)
                command, response_payload, _session, status, _ctx, _opts = self._recv_encap()
                if command != self.ENCAP_SEND_RR_DATA:
                    raise RuntimeError(f"Unexpected EtherNet/IP command: 0x{command:04X}")
                if status != 0:
                    raise RuntimeError(f"EtherNet/IP encapsulation status: 0x{status:08X}")
                return response_payload
            except (ConnectionError, BrokenPipeError, TimeoutError, OSError) as exc:
                self.disconnect()
                raise exc

    @staticmethod
    def _extract_cip_from_rr(response_payload):
        # SendRRData response:
        # interface handle (4), timeout (2), item count (2), then item list.
        if len(response_payload) < 8:
            raise RuntimeError("Invalid SendRRData response")
        _iface, _timeout, item_count = struct.unpack("<IHH", response_payload[:8])
        offset = 8
        for _ in range(item_count):
            if offset + 4 > len(response_payload):
                raise RuntimeError("Invalid EtherNet/IP item list")
            item_type, item_len = struct.unpack("<HH", response_payload[offset:offset + 4])
            offset += 4
            if offset + item_len > len(response_payload):
                raise RuntimeError("Invalid EtherNet/IP item length")
            item_data = response_payload[offset:offset + item_len]
            offset += item_len
            if item_type == 0x00B2:
                return item_data
        raise RuntimeError("EtherNet/IP response contains no unconnected data item")

    @staticmethod
    def _check_cip_response(cip):
        if len(cip) < 4:
            raise RuntimeError("Invalid CIP response")
        service = cip[0]
        if service & 0x80 == 0:
            raise RuntimeError(f"CIP service 0x{service:02X} did not return a response")
        general_status = cip[2]
        additional_status_size = cip[3]
        data_offset = 4 + (additional_status_size * 2)
        if general_status != 0:
            additional = cip[4:data_offset].hex().upper()
            raise RuntimeError(f"CIP error: GeneralStatus=0x{general_status:02X}, AdditionalStatus={additional}")
        return cip[data_offset:]

    def read_tag(self, tag, data_type=None, count=1):
        path = self._symbolic_path(tag)
        request = bytes([self.CIP_READ_TAG]) + path + struct.pack("<H", int(count or 1))
        response = self._extract_cip_from_rr(self._send_rr_data(request))
        data = self._check_cip_response(response)
        if len(data) < 2:
            raise RuntimeError("CIP Read Tag response has no type information")
        cip_type = struct.unpack("<H", data[:2])[0]
        raw = data[2:]
        requested = str(data_type or "").strip().upper()
        if requested in self.CIP_TYPES:
            type_code, size, py_kind = self.CIP_TYPES[requested]
            # Some vendors/firmware return an alias/UDT type code; when the caller
            # supplied a type, decode according to the configured type.
            if count == 1:
                return self._decode_values(raw, py_kind, size, 1)
            return self._decode_values(raw, py_kind, size, int(count))
        kind_info = next((v for v in self.CIP_TYPES.values() if v[0] == cip_type), None)
        if kind_info:
            _code, size, py_kind = kind_info
            if count == 1:
                values = self._decode_values(raw, py_kind, size, 1)
                return values[0]
            return self._decode_values(raw, py_kind, size, int(count))
        # Unknown/UDT: expose the raw bytes rather than corrupting the value.
        return raw.hex().upper()

    @staticmethod
    def _decode_values(raw, py_kind, size, count):
        count = max(1, int(count))
        fmt_map = {
            "bool": "<?",
            "int8": "<b",
            "uint8": "<B",
            "int16": "<h",
            "uint16": "<H",
            "int32": "<i",
            "uint32": "<I",
            "int64": "<q",
            "uint64": "<Q",
            "float32": "<f",
            "float64": "<d",
        }
        fmt = fmt_map.get(py_kind)
        if not fmt:
            return raw.hex().upper()
        need = struct.calcsize(fmt) * count
        if len(raw) < need:
            raise RuntimeError(f"CIP value payload too short: {len(raw)} < {need}")
        values = [struct.unpack_from(fmt, raw, i * size)[0] for i in range(count)]
        return values

    def write_tag(self, tag, value, data_type="DINT"):
        dtype = str(data_type or "DINT").strip().upper()
        info = self.CIP_TYPES.get(dtype)
        if not info:
            raise ValueError(f"Unsupported EtherNet/IP data type: {dtype}")
        type_code, size, py_kind = info
        if isinstance(value, (list, tuple)):
            values = list(value)
        else:
            values = [value]
        fmt_map = {
            "bool": "<?",
            "int8": "<b",
            "uint8": "<B",
            "int16": "<h",
            "uint16": "<H",
            "int32": "<i",
            "uint32": "<I",
            "int64": "<q",
            "uint64": "<Q",
            "float32": "<f",
            "float64": "<d",
        }
        fmt = fmt_map.get(py_kind)
        if not fmt:
            raise ValueError(f"Unsupported EtherNet/IP encoder type: {dtype}")
        encoded = bytearray()
        for item in values:
            if py_kind == "bool":
                v = bool(item)
            elif py_kind.startswith("float"):
                v = float(item)
            else:
                v = int(item)
            encoded.extend(struct.pack(fmt, v))
        path = self._symbolic_path(tag)
        request = bytes([self.CIP_WRITE_TAG]) + path + struct.pack("<HH", len(values), type_code) + bytes(encoded)
        response = self._extract_cip_from_rr(self._send_rr_data(request))
        self._check_cip_response(response)
        return True


# ============================================================
# CLIENT MANAGER
# ============================================================

_clients = {}
_clients_lock = threading.RLock()




# ============================================================
# ETHERNET/IP MANAGER
# ============================================================

tcp_ethernet_bp = Blueprint("tcp-ethernet", __name__)
_clients = {}
_clients_lock = threading.RLock()


def get_client(name):
    with _clients_lock:
        client=_clients.get(str(name))
    if client:
        return client
    sync_devices()
    with _clients_lock:
        client=_clients.get(str(name))
    if not client:
        raise KeyError(f"Device '{name}' not found or not configured for EtherNet/IP.")
    return client


def sync_devices():
    devices={d["Device Name"]:d for d in _load_devices_for("ethernet_ip")}
    with _clients_lock:
        for name in list(_clients):
            if name not in devices:
                _clients[name].disconnect()
                del _clients[name]
        for name,device in devices.items():
            if name not in _clients:
                _clients[name]=EtherNetIPClient(device)
                continue
            client=_clients[name]
            keys=("ip","port","timeout")
            old=tuple(vars(client).get(k) for k in keys)
            client.configure(device)
            new=tuple(vars(client).get(k) for k in keys)
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
                clients=list(_clients.values())
            wall_now = time.time()
            for client in clients:
                if not client.is_connected() and wall_now-client.last_attempt >= DEFAULT_RECONNECT_INTERVAL:
                    client.last_attempt=wall_now
                    client.connect()
        except Exception as exc:
            print(f"[ETHERNET/IP] reconnect loop error: {exc}")
        time.sleep(0.10)

threading.Thread(target=reconnect_loop,daemon=True,name="tcp-ethernet-AutoReconnect").start()


def connect_device(name):
    client=get_client(name)
    ok=client.connect()
    return jsonify({"success":bool(ok),"device_name":str(name),"protocol":"ethernet_ip","connected":bool(client.is_connected())})


def disconnect_device(name=None):
    sync_devices()
    with _clients_lock:
        clients=dict(_clients)
    if name:
        client=clients.get(str(name))
        if not client:
            return jsonify({"success":False,"message":f"Device '{name}' not found"}),404
        client.disconnect()
        return jsonify({"success":True,"device_name":str(name),"connected":False})
    for client in clients.values(): client.disconnect()
    return jsonify({"success":True})


def get_devices():
    sync_devices()
    with _clients_lock:
        clients=dict(_clients)
    result=[]
    for d in _load_devices_for("ethernet_ip"):
        name=d["Device Name"]; c=clients.get(name); item=dict(d); item["name"]=name; item["connected"]=bool(c.is_connected()) if c else False
        if c is not None:
            if hasattr(c,"ip"): item["ip"]=c.ip
            if hasattr(c,"port"): item["port"]=c.port
        result.append(item)
    return result


def get_status():
    sync_devices()
    with _clients_lock:
        clients=dict(_clients)
    result={}
    for name,client in clients.items():
        item={"connected":bool(client.is_connected()),"protocol":"EtherNet/IP","type":"TCP"}
        for attr in ("ip","port","local_ip","local_port","remote_ip","remote_port","timeout"):
            if hasattr(client,attr): item[attr]=getattr(client,attr)
        result[name]=item
    return result


def read_config(body):
    name=str(body.get("device_name") or "").strip(); client=get_client(name); tag=str(body.get("tag") or body.get("address") or "").strip()
    if not tag: raise ValueError("EtherNet/IP requires 'tag'")
    dtype=str(body.get("data_type") or body.get("cip_data_type") or "").strip().upper() or None; count=max(1,int(body.get("count",1) or 1))
    value=client.read_tag(tag,data_type=dtype,count=count)
    return {"success":True,"device_name":name,"protocol":"ethernet_ip","tag":tag,"address":tag,"data_type":dtype,"count":count,"value":value,"values":value if isinstance(value,list) else [value],"connected":bool(client.is_connected())}

def write_config(body):
    name=str(body.get("device_name") or "").strip(); client=get_client(name); tag=str(body.get("tag") or body.get("address") or "").strip()
    if not tag: raise ValueError("EtherNet/IP requires 'tag'")
    dtype=str(body.get("data_type") or body.get("cip_data_type") or "DINT").strip().upper(); client.write_tag(tag,body.get("value"),dtype)
    return {"success":True,"device_name":name,"protocol":"ethernet_ip","tag":tag,"data_type":dtype,"value":body.get("value"),"connected":bool(client.is_connected())}

@tcp_ethernet_bp.get("/api/tcp-ethernet/devices")
def devices_route(): return jsonify({"success":True,"devices":get_devices()})
@tcp_ethernet_bp.get("/api/tcp-ethernet/status")
def status_route(): return jsonify(get_status())
@tcp_ethernet_bp.post("/api/tcp-ethernet/test-connection")
def test_route():
    try:
        name=str((request.get_json() or {}).get("device_name") or "").strip(); client=get_client(name); ok=client.connect(); return jsonify({"success":bool(ok and client.is_connected()),"device_name":name,"protocol":"ethernet_ip","connected":bool(client.is_connected()),"message":"Connected" if client.is_connected() else "Connection failed"})
    except Exception as exc: return jsonify({"success":False,"message":str(exc)}),400
@tcp_ethernet_bp.post("/api/tcp-ethernet/connect")
def connect_route():
    try: return connect_device((request.get_json() or {}).get("device_name"))
    except Exception as exc: return jsonify({"success":False,"message":str(exc)}),400
@tcp_ethernet_bp.post("/api/tcp-ethernet/disconnect")
def disconnect_route(): return disconnect_device((request.get_json() or {}).get("device_name"))
@tcp_ethernet_bp.post("/api/tcp-ethernet/read")
def read_route():
    try: return jsonify(read_config(request.get_json() or {}))
    except Exception as exc: return jsonify({"success":False,"message":str(exc)}),400
@tcp_ethernet_bp.post("/api/tcp-ethernet/write")
def write_route():
    try: return jsonify(write_config(request.get_json() or {}))
    except Exception as exc: return jsonify({"success":False,"message":str(exc)}),400



# ============================================================
# LOGIC BUILDER HELPERS
# ============================================================
# Logic Builder nodes store one device pick as flat keys (optionally namespaced by a
# prefix): device_name, address (the tag), data_type. These helpers keep logic_engine.py /
# device_poller.py free of EtherNet/IP details (same idea as fins.read_for_logic).

def read_for_logic(cfg, prefix=""):
    """Live-read one EtherNet/IP tag from a Logic Builder node config, returned as text.
    BOOL tags come back as "1"/"0" so they compare against a trigger/compare value of 1/0."""
    client = get_client(cfg.get(f"{prefix}device_name", ""))
    tag = str(cfg.get(f"{prefix}address", "") or "").strip()
    if not tag:
        raise ValueError("EtherNet/IP requires a tag")
    dtype = str(cfg.get(f"{prefix}data_type") or "").strip().upper() or None
    value = client.read_tag(tag, data_type=dtype, count=1)
    if isinstance(value, list):
        value = value[0] if value else ""
    return ("1" if value else "0") if isinstance(value, bool) else str(value)


def write_for_logic(cfg, value, prefix=""):
    """Write one value to an EtherNet/IP tag from a Logic Builder node config."""
    client = get_client(cfg.get(f"{prefix}device_name", ""))
    tag = str(cfg.get(f"{prefix}address", "") or "").strip()
    if not tag:
        raise ValueError("EtherNet/IP requires a tag")
    dtype = str(cfg.get(f"{prefix}data_type") or "").strip().upper() or "DINT"
    if dtype == "BOOL":
        value = str(value).strip().lower() in ("1", "true", "on", "yes")
    client.write_tag(tag, value, dtype)
    return True
