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


class RawTCPClient:
    """Persistent raw TCP socket for instruments/scanners with proprietary protocols."""

    protocol = "raw_tcp"

    def __init__(self, device):
        self.name = str(device.get("Device Name", ""))
        self.ip = ""
        self.port = 3000
        self.unit_id = 1
        self.timeout = DEFAULT_TIMEOUT
        self.sock = None
        self.running = False
        self.lock = threading.RLock()
        self.last_attempt = 0.0
        self.configure(device)

    def configure(self, device):
        self.ip = str(device.get("IP Address") or device.get("IP") or device.get("Host") or "").strip()
        try:
            self.port = int(device.get("Port", 3000) or 3000)
        except (TypeError, ValueError):
            self.port = 3000
        try:
            self.timeout = float(device.get("Timeout", DEFAULT_TIMEOUT) or DEFAULT_TIMEOUT)
        except (TypeError, ValueError):
            self.timeout = DEFAULT_TIMEOUT
        self.timeout = max(0.10, min(self.timeout, 5.0))

    def is_connected(self):
        if self.sock is None or not self.running:
            return False
        if not _tcp_socket_alive(self.sock):
            self.disconnect()
            return False
        return True

    def connect(self):
        with self.lock:
            if self.is_connected():
                return True
            if not self.ip or not self.port:
                return False
            s = None
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                s.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
                s.settimeout(self.timeout)
                print(f"[RAW TCP] Connecting {self.name} -> {self.ip}:{self.port}")
                s.connect((self.ip, self.port))
                self.sock = s
                self.running = True
                print(f"[RAW TCP] Connected: {self.name}")
                return True
            except Exception as exc:
                print(f"[RAW TCP] Connect error [{self.name}]: {exc}")
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
                    s.shutdown(socket.SHUT_RDWR)
                except Exception:
                    pass
                try:
                    s.close()
                except Exception:
                    pass

    @staticmethod
    def _to_bytes(data=None, data_hex=None, encoding="utf-8"):
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
        return str(data).encode(encoding or "utf-8")

    @staticmethod
    def _decode_response(payload, response_mode="hex", encoding="utf-8"):
        mode = str(response_mode or "hex").strip().lower()
        if mode == "text":
            return payload.decode(encoding or "utf-8", errors="replace")
        if mode == "json":
            text_value = payload.decode(encoding or "utf-8", errors="replace")
            try:
                return json.loads(text_value)
            except Exception:
                return text_value
        if mode == "bytes":
            return list(payload)
        return payload.hex().upper()

    def request_raw(self, payload=b"", read_size=0, delimiter=None, response_timeout=None, wait_response=True):
        with self.lock:
            if not self.is_connected() and not self.connect():
                raise ConnectionError(f"Unable to connect to {self.ip}:{self.port}")

            payload = bytes(payload or b"")
            if payload:
                self.sock.sendall(payload)

            if not wait_response:
                return b""

            timeout_value = self.timeout if response_timeout is None else max(0.01, float(response_timeout))
            old_timeout = self.sock.gettimeout()
            self.sock.settimeout(timeout_value)
            try:
                chunks = []
                if delimiter:
                    delimiter = bytes(delimiter)
                    data = b""
                    while len(data) < 1024 * 1024:
                        part = self.sock.recv(4096)
                        if not part:
                            break
                        data += part
                        if delimiter in data:
                            break
                    chunks.append(data)
                elif int(read_size or 0) > 0:
                    remaining = int(read_size)
                    while remaining > 0:
                        part = self.sock.recv(min(4096, remaining))
                        if not part:
                            break
                        chunks.append(part)
                        remaining -= len(part)
                else:
                    # Read until the socket times out. This is useful for line/status
                    # based scanners that answer immediately without a fixed frame size.
                    while True:
                        try:
                            part = self.sock.recv(4096)
                        except socket.timeout:
                            break
                        if not part:
                            break
                        chunks.append(part)
                        if len(part) < 4096:
                            break
                return b"".join(chunks)
            except (ConnectionError, OSError, TimeoutError):
                self.disconnect()
                raise
            finally:
                if self.sock:
                    try:
                        self.sock.settimeout(old_timeout)
                    except Exception:
                        pass



# ============================================================
# UDP / SERIAL-OVER-UDP CLIENT
# ============================================================



# ============================================================
# RAW TCP/IP MANAGER
# ============================================================

tcp_raw_bp = Blueprint("tcp-raw", __name__)
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
        raise KeyError(f"Device '{name}' not found or not configured for Raw TCP/IP.")
    return client


def sync_devices():
    devices={d["Device Name"]:d for d in _load_devices_for("raw_tcp")}
    with _clients_lock:
        for name in list(_clients):
            if name not in devices:
                _clients[name].disconnect()
                del _clients[name]
        for name,device in devices.items():
            if name not in _clients:
                _clients[name]=RawTCPClient(device)
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
            print(f"[RAW TCP/IP] reconnect loop error: {exc}")
        time.sleep(0.10)

threading.Thread(target=reconnect_loop,daemon=True,name="tcp-raw-AutoReconnect").start()


def connect_device(name):
    client=get_client(name)
    ok=client.connect()
    return jsonify({"success":bool(ok),"device_name":str(name),"protocol":"raw_tcp","connected":bool(client.is_connected())})


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
    for d in _load_devices_for("raw_tcp"):
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
        item={"connected":bool(client.is_connected()),"protocol":"Raw TCP/IP","type":"TCP"}
        for attr in ("ip","port","local_ip","local_port","remote_ip","remote_port","timeout"):
            if hasattr(client,attr): item[attr]=getattr(client,attr)
        result[name]=item
    return result


def request_config(body):
    name=str(body.get("device_name") or "").strip(); client=get_client(name)
    request_hex=body.get("request_hex"); request_text=body.get("request_text")
    if request_hex is None and request_text is None and body.get("data") is not None:
        data=body.get("data"); request_hex=data if isinstance(data,str) and body.get("data_is_hex") else None; request_text=None if request_hex is not None else data
    payload=RawTCPClient._to_bytes(request_text,request_hex,body.get("encoding","utf-8"))
    delimiter_hex=str(body.get("delimiter_hex","") or "").strip(); delimiter=RawTCPClient._to_bytes(data_hex=delimiter_hex) if delimiter_hex else None
    response=client.request_raw(payload,read_size=int(body.get("read_size",0) or 0),delimiter=delimiter,response_timeout=body.get("response_timeout"),wait_response=bool(body.get("wait_response",True)))
    decoded=RawTCPClient._decode_response(response,body.get("response_mode","text"),body.get("encoding","utf-8"))
    return {"success":True,"device_name":name,"protocol":"raw_tcp","value":decoded,"response":decoded,"raw_hex":response.hex().upper(),"bytes":list(response),"connected":bool(client.is_connected())}

def send_config(body):
    name=str(body.get("device_name") or "").strip(); client=get_client(name)
    data_hex=body.get("data_hex") or body.get("request_hex"); data_text=body.get("data_text") if body.get("data_text") is not None else body.get("data")
    payload=RawTCPClient._to_bytes(data_text,data_hex,body.get("encoding","utf-8"))
    if not payload: raise ValueError("Raw TCP/IP requires data, data_text, or data_hex")
    response=client.request_raw(payload,read_size=int(body.get("read_size",0) or 0),response_timeout=body.get("response_timeout"),wait_response=bool(body.get("wait_response",False)))
    out={"success":True,"device_name":name,"protocol":"raw_tcp","sent":len(payload),"sent_hex":payload.hex().upper(),"connected":bool(client.is_connected())}
    if response: out.update({"response":RawTCPClient._decode_response(response,body.get("response_mode","text"),body.get("encoding","utf-8")),"response_hex":response.hex().upper()})
    return out

@tcp_raw_bp.get("/api/tcp-raw/devices")
def devices_route(): return jsonify({"success":True,"devices":get_devices()})
@tcp_raw_bp.get("/api/tcp-raw/status")
def status_route(): return jsonify(get_status())
@tcp_raw_bp.post("/api/tcp-raw/test-connection")
def test_route():
    try:
        name=str((request.get_json() or {}).get("device_name") or "").strip(); client=get_client(name); ok=client.connect(); return jsonify({"success":bool(ok and client.is_connected()),"device_name":name,"protocol":"raw_tcp","connected":bool(client.is_connected()),"message":"Connected" if client.is_connected() else "Connection failed"})
    except Exception as exc: return jsonify({"success":False,"message":str(exc)}),400
@tcp_raw_bp.post("/api/tcp-raw/connect")
def connect_route():
    try: return connect_device((request.get_json() or {}).get("device_name"))
    except Exception as exc: return jsonify({"success":False,"message":str(exc)}),400
@tcp_raw_bp.post("/api/tcp-raw/disconnect")
def disconnect_route(): return disconnect_device((request.get_json() or {}).get("device_name"))
@tcp_raw_bp.post("/api/tcp-raw/request")
def request_route():
    try: return jsonify(request_config(request.get_json() or {}))
    except Exception as exc: return jsonify({"success":False,"message":str(exc)}),400
@tcp_raw_bp.post("/api/tcp-raw/send")
def send_route():
    try: return jsonify(send_config(request.get_json() or {}))
    except Exception as exc: return jsonify({"success":False,"message":str(exc)}),400

