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
    # Normalize separators first so values such as UDP_SERIAL, UDP-SERIAL
    # and "Serial Over UDP" are treated consistently.
    p = re.sub(r"\s+", " ", p)
    p = p.replace("_", " ").replace("-", " ").strip()
    aliases = {
        "modbus": "modbus_tcp", "modbus tcp": "modbus_tcp",
        "raw": "raw_tcp", "raw tcp": "raw_tcp", "raw tcp/ip": "raw_tcp",
        "tcp socket": "raw_tcp", "tcp socket/ip": "raw_tcp", "tcp/ip": "raw_tcp",
        "ethernet/ip": "ethernet_ip", "ethernet ip": "ethernet_ip",
        "ethernetip": "ethernet_ip", "cip": "ethernet_ip", "enip": "ethernet_ip",
        "udp": "udp_serial", "udp/ip": "udp_serial", "udp serial": "udp_serial",
        "udp serial over": "udp_serial", "serial over udp": "udp_serial",
        "serial udp": "udp_serial",
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
            raw_type = str(row.get("Type", "")).strip().lower()
            raw_protocol = (
                row.get("Protocol")
                or row.get("protocol")
                or row.get("Communication Protocol")
                or row.get("Mode")
                or ""
            )

            # Type is authoritative for transport. This prevents a UDP row
            # with an empty/legacy/incorrect Protocol field from being silently
            # classified as Modbus TCP and disappearing from /api/udp/devices.
            normalized_type = re.sub(r"[-_]+", " ", raw_type).strip()
            # FINS/UDP rows are also Type=UDP but belong to fins.py.
            if re.sub(r"[\s/_\-]+", " ", str(raw_protocol).strip().lower()).startswith("fins"):
                continue
            if normalized_type in {"udp", "udp ip", "udp/ip", "udp serial", "serial over udp", "serial udp"}:
                protocol = "udp_serial"
            elif normalized_type in {"tcp", "tcp ip", "tcp/ip"} and not raw_protocol:
                protocol = "modbus_tcp"
            else:
                protocol = _normalize_protocol(raw_protocol or raw_type)
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


class UdpSerialClient:
    """UDP transport modeled after the supplied C# SerialOverUdp class.

    The C# program uses two IPEndPoint values:
      - local endpoint on the PC (IP + local port)
      - remote endpoint on the scanner/converter (IP + remote port)

    Data is ASCII by default. The socket is bound to the local endpoint and
    sends datagrams to the remote endpoint. Incoming datagrams are also kept
    in a small queue so passive receive and request/response are both possible.
    """

    protocol = "udp_serial"
    transport = "udp"

    def __init__(self, device):
        self.name = str(device.get("Device Name", ""))
        self.local_ip = ""
        self.local_port = 0
        self.remote_ip = ""
        self.remote_port = 0
        self.timeout = DEFAULT_TIMEOUT
        self.sock = None
        self.running = False
        self.lock = threading.RLock()
        # Serialize request/response transactions because the terminal and
        # Logic Builder share the same UDP client and RX queue.
        self.request_lock = threading.RLock()
        self.last_attempt = 0.0
        self.rx_queue = queue.Queue(maxsize=256)
        self.last_data = ""
        self._listener_thread = None
        self.configure(device)

    @staticmethod
    def _coerce_port(value, default=0):
        try:
            return max(0, min(65535, int(value)))
        except (TypeError, ValueError):
            return default

    def configure(self, device):
        self.local_ip = str(
            device.get("Local IP Address")
            or device.get("Local IP")
            or ""
        ).strip()
        self.local_port = self._coerce_port(device.get("Local Port"), 0)
        self.remote_ip = str(
            device.get("Remote IP Address")
            or device.get("Remote IP")
            or device.get("IP Address")
            or device.get("IP")
            or device.get("Host")
            or ""
        ).strip()
        self.remote_port = self._coerce_port(
            device.get("Remote Port") or device.get("Port"), 0
        )
        try:
            self.timeout = float(device.get("Timeout", DEFAULT_TIMEOUT) or DEFAULT_TIMEOUT)
        except (TypeError, ValueError):
            self.timeout = DEFAULT_TIMEOUT
        self.timeout = max(0.01, min(self.timeout, 10.0))

    @property
    def ip(self):
        return self.remote_ip

    @property
    def port(self):
        return self.remote_port

    @property
    def write_queue(self):
        # Compatibility with MainPage/status consumers.
        return self.rx_queue

    def is_connected(self):
        # Mirrors the supplied C# semantics: Connected means local UDP listener/socket exists.
        return self.sock is not None and self.running

    @staticmethod
    def _to_bytes(data=None, data_hex=None, encoding="ascii"):
        if data_hex is not None and str(data_hex).strip() != "":
            cleaned = re.sub(r"[^0-9A-Fa-f]", "", str(data_hex))
            if len(cleaned) % 2:
                raise ValueError("data_hex must contain an even number of hex digits")
            return bytes.fromhex(cleaned)
        if isinstance(data, list):
            return bytes(int(x) & 0xFF for x in data)
        if isinstance(data, (bytes, bytearray)):
            return bytes(data)
        if data is None:
            return b""
        return str(data).encode(encoding or "ascii", errors="replace")

    @staticmethod
    def _decode_response(payload, response_mode="text", encoding="ascii"):
        mode = str(response_mode or "text").strip().lower()
        if mode == "bytes":
            return list(payload)
        if mode == "hex":
            return payload.hex().upper()
        if mode == "json":
            text_value = payload.decode(encoding or "ascii", errors="replace")
            try:
                return json.loads(text_value)
            except Exception:
                return text_value
        return payload.decode(encoding or "ascii", errors="replace")

    def _listener_loop(self):
        while self.running:
            try:
                if not self.sock:
                    break
                packet, _addr = self.sock.recvfrom(65535)
                if not packet:
                    continue
                self.last_data = packet.decode("ascii", errors="replace")
                try:
                    self.rx_queue.put_nowait(packet)
                except queue.Full:
                    try:
                        self.rx_queue.get_nowait()
                    except queue.Empty:
                        pass
                    try:
                        self.rx_queue.put_nowait(packet)
                    except queue.Full:
                        pass
            except socket.timeout:
                continue
            except OSError:
                break
            except Exception as exc:
                print(f"[UDP RECEIVE] {self.name}: {exc}")
                time.sleep(0.01)

    def connect(self):
        with self.lock:
            if self.is_connected():
                return True
            if not self.remote_ip or not self.remote_port:
                return False
            s = None
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                bind_ip = self.local_ip or "0.0.0.0"
                if self.local_port:
                    s.bind((bind_ip, self.local_port))
                else:
                    s.bind((bind_ip, 0))
                actual_ip, actual_port = s.getsockname()[:2]
                self.local_ip = self.local_ip or actual_ip
                self.local_port = int(actual_port)
                s.settimeout(0.20)
                self.sock = s
                self.running = True
                self._listener_thread = threading.Thread(
                    target=self._listener_loop,
                    daemon=True,
                    name=f"UDPListener-{self.name}",
                )
                self._listener_thread.start()
                print(
                    f"[UDP] Connected {self.name}: "
                    f"{self.local_ip}:{self.local_port} -> "
                    f"{self.remote_ip}:{self.remote_port}"
                )
                return True
            except Exception as exc:
                print(f"[UDP] Connect error [{self.name}]: {exc}")
                try:
                    if s:
                        s.close()
                except Exception:
                    pass
                self.sock = None
                self.running = False
                return False

    def disconnect(self):
        with self.lock:
            self.running = False
            s = self.sock
            self.sock = None
            if s:
                try:
                    s.close()
                except Exception:
                    pass

    def send(self, payload):
        payload = bytes(payload or b"")
        if not payload:
            raise ValueError("UDP payload is empty")
        with self.lock:
            if not self.is_connected() and not self.connect():
                raise ConnectionError(
                    f"Unable to open UDP endpoint {self.local_ip}:{self.local_port} "
                    f"-> {self.remote_ip}:{self.remote_port}"
                )
            self.sock.sendto(payload, (self.remote_ip, self.remote_port))
        return len(payload)

    def receive(self, timeout=None, interval_ms=20):
        timeout_value = self.timeout if timeout is None else max(0.01, float(timeout))
        try:
            interval_value = max(1.0, float(interval_ms or 20)) / 1000.0
        except (TypeError, ValueError):
            interval_value = 0.020

        deadline = time.monotonic() + timeout_value
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("UDP receive timeout")
            try:
                packet = self.rx_queue.get(timeout=min(interval_value, remaining))
                self.last_data = packet.decode("ascii", errors="replace")
                return packet
            except queue.Empty:
                continue

    def request(self, payload, timeout=None, interval_ms=20, clear_before=True):
        with self.request_lock:
            if clear_before:
                self.clear_rx()
            self.send(payload)
            return self.receive(timeout=timeout, interval_ms=interval_ms)

    def clear_rx(self):
        while True:
            try:
                self.rx_queue.get_nowait()
            except queue.Empty:
                break


# ============================================================
# ETHERNET/IP CLIENT - CIP EXPLICIT MESSAGING
# ============================================================



# ============================================================
# SERIAL OVER UDP MANAGER
# ============================================================

udp_bp = Blueprint("udp", __name__)
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
        raise KeyError(f"Device '{name}' not found or not configured for Serial over UDP.")
    return client


def sync_devices():
    devices={d["Device Name"]:d for d in _load_devices_for("udp_serial")}
    with _clients_lock:
        for name in list(_clients):
            if name not in devices:
                _clients[name].disconnect()
                del _clients[name]
        for name,device in devices.items():
            if name not in _clients:
                _clients[name]=UdpSerialClient(device)
                continue
            client=_clients[name]
            keys=("local_ip","local_port","remote_ip","remote_port","timeout")
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
            print(f"[SERIAL OVER UDP] reconnect loop error: {exc}")
        time.sleep(0.10)

threading.Thread(target=reconnect_loop,daemon=True,name="udp-AutoReconnect").start()


def connect_device(name):
    client=get_client(name)
    ok=client.connect()
    return jsonify({"success":bool(ok),"device_name":str(name),"protocol":"udp_serial","connected":bool(client.is_connected())})


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
    for d in _load_devices_for("udp_serial"):
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
        item={"connected":bool(client.is_connected()),"protocol":"Serial over UDP","type":"UDP"}
        for attr in ("ip","port","local_ip","local_port","remote_ip","remote_port","timeout"):
            if hasattr(client,attr): item[attr]=getattr(client,attr)
        result[name]=item
    return result


def send_config(body):
    name=str(body.get("device_name") or "").strip(); client=get_client(name); data_hex=body.get("data_hex") or body.get("request_hex"); data_text=body.get("data_text") if body.get("data_text") is not None else body.get("data")
    payload=UdpSerialClient._to_bytes(data_text,data_hex,body.get("encoding","ascii"))
    if not payload: raise ValueError("Serial over UDP requires data_text/data_hex/data")
    sent=client.send(payload); out={"success":True,"device_name":name,"protocol":"udp_serial","sent":sent,"sent_hex":payload.hex().upper(),"connected":bool(client.is_connected())}
    if bool(body.get("wait_response", False)):
        response = client.receive(
            timeout=body.get("response_timeout"),
            interval_ms=body.get("response_interval_ms", 20),
        )
        out.update({
            "response_hex": response.hex().upper(),
            "response": UdpSerialClient._decode_response(
                response, body.get("response_mode", "text"), body.get("encoding", "ascii")
            ),
        })
    return out

def receive_config(body):
    name = str(body.get("device_name") or "").strip()
    client = get_client(name)
    response = client.receive(
        timeout=body.get("response_timeout"),
        interval_ms=body.get("response_interval_ms", 20),
    )
    decoded = UdpSerialClient._decode_response(
        response, body.get("response_mode", "text"), body.get("encoding", "ascii")
    )
    return {
        "success": True,
        "device_name": name,
        "protocol": "udp_serial",
        "response": decoded,
        "value": decoded,
        "response_hex": response.hex().upper(),
        "bytes": list(response),
        "connected": bool(client.is_connected()),
    }

def request_config(body):
    name = str(body.get("device_name") or "").strip()
    client = get_client(name)
    request_mode = str(body.get("request_mode", "text") or "text").strip().lower()
    request_hex = body.get("request_hex")
    request_text = body.get("request_text")
    encoding = body.get("encoding", "ascii") or "ascii"

    if request_hex is None and request_text is None and body.get("data") is not None:
        data = body.get("data")
        request_hex = data if isinstance(data, str) and body.get("data_is_hex") else None
        request_text = None if request_hex is not None else data

    append_cr = bool(body.get("append_cr", False))
    append_lf = bool(body.get("append_lf", False))

    # Respect the node's Request Mode. Do not accidentally reuse a stale
    # request_hex/request_text left in the saved node config.
    if request_mode == "hex":
        request_text = None
    else:
        request_hex = None

    if request_mode == "hex" and request_hex is not None and str(request_hex).strip() != "":
        clean = re.sub(r"[^0-9A-Fa-f]", "", str(request_hex))
        if len(clean) % 2:
            raise ValueError("request_hex must contain an even number of hex digits")
        if append_cr:
            clean += "0D"
        if append_lf:
            clean += "0A"
        payload = UdpSerialClient._to_bytes(None, clean, encoding)
    else:
        text_value = "" if request_text is None else str(request_text)
        if append_cr:
            text_value += "\r"
        if append_lf:
            text_value += "\n"
        payload = UdpSerialClient._to_bytes(text_value, None, encoding)

    if not payload:
        raise ValueError("Serial over UDP requires request_text/request_hex/data")

    response = client.request(
        payload,
        timeout=body.get("response_timeout"),
        interval_ms=body.get("response_interval_ms", 20),
        clear_before=bool(body.get("clear_before_request", True)),
    )
    decoded = UdpSerialClient._decode_response(response, body.get("response_mode", "text"), encoding)
    return {
        "success": True,
        "device_name": name,
        "protocol": "udp_serial",
        "value": decoded,
        "response": decoded,
        "response_hex": response.hex().upper(),
        "bytes": list(response),
        "request_hex": payload.hex().upper(),
        "connected": bool(client.is_connected()),
    }

@udp_bp.get("/api/udp/devices")
def devices_route():
    devices = get_devices()
    return jsonify({
        "success": True,
        "protocol": "udp_serial",
        "protocol_label": "Serial over UDP",
        "transport": "UDP",
        "devices": devices,
        "count": len(devices),
    })
@udp_bp.get("/api/udp/status")
def status_route(): return jsonify(get_status())
@udp_bp.post("/api/udp/test-connection")
def test_route():
    try:
        name=str((request.get_json() or {}).get("device_name") or "").strip(); client=get_client(name); ok=client.connect(); return jsonify({"success":bool(ok and client.is_connected()),"device_name":name,"protocol":"udp_serial","connected":bool(client.is_connected()),"message":"UDP socket ready" if client.is_connected() else "UDP bind failed"})
    except Exception as exc: return jsonify({"success":False,"message":str(exc)}),400
@udp_bp.post("/api/udp/connect")
def connect_route():
    try: return connect_device((request.get_json() or {}).get("device_name"))
    except Exception as exc: return jsonify({"success":False,"message":str(exc)}),400
@udp_bp.post("/api/udp/disconnect")
def disconnect_route(): return disconnect_device((request.get_json() or {}).get("device_name"))
@udp_bp.post("/api/udp/send")
def send_route():
    try: return jsonify(send_config(request.get_json() or {}))
    except Exception as exc: return jsonify({"success":False,"message":str(exc)}),400
@udp_bp.post("/api/udp/receive")
def receive_route():
    try: return jsonify(receive_config(request.get_json() or {}))
    except Exception as exc: return jsonify({"success":False,"message":str(exc)}),400
@udp_bp.post("/api/udp/request")
def request_route():
    try: return jsonify(request_config(request.get_json() or {}))
    except Exception as exc: return jsonify({"success":False,"message":str(exc)}),400

