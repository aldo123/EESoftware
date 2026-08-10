import json, os, sys, socket, threading, time
from collections import deque
from flask import Blueprint, request, jsonify

def _settings_path():
    if getattr(sys, "frozen", False):
        return os.path.join(os.path.dirname(sys.executable), "_internal", "data", "setting.json")
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "setting.json")
    if not os.path.exists(p):
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "setting.json")
    return p

def _load_tcp_devices():
    """
    Load TCP devices from the SAME structure used by rs232.py:

    setting.json
      -> Communication Devices
      -> _table
      -> Type == TCP

    Every TCP device in Setting will be loaded automatically.
    """
    path = _settings_path()

    if not os.path.exists(path):
        print(f"[TCP] [ERROR] File tidak ditemukan: {path}")
        return []

    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)

        communication_devices = data.get(
            "Communication Devices", {}
        )

        devices = communication_devices.get(
            "_table", []
        )

        if not isinstance(devices, list):
            print(
                "[TCP] [ERROR] "
                "Communication Devices._table bukan list"
            )
            return []

        result = []

        for dev in devices:
            if not isinstance(dev, dict):
                continue

            device_type = str(
                dev.get("Type", "")
            ).strip().upper()

            device_name = str(
                dev.get("Device Name", "")
            ).strip()

            # Hanya ambil device TCP
            if device_type != "TCP":
                continue

            if not device_name:
                continue

            ip = str(
                dev.get("IP Address")
                or dev.get("IP")
                or dev.get("Host")
                or ""
            ).strip()

            try:
                port = int(
                    dev.get("Port", 0) or 0
                )
            except (TypeError, ValueError):
                port = 0

            # Simpan semua parameter setting,
            # lalu normalisasi field utama TCP.
            normalized = dict(dev)

            normalized["Device Name"] = device_name
            normalized["Type"] = "TCP"
            normalized["IP Address"] = ip
            normalized["Port"] = port

            result.append(normalized)

        print(
            f"[TCP] Berhasil memuat "
            f"{len(result)} perangkat TCP dari setting.json"
        )

        for dev in result:
            print(
                f"[TCP] Device: "
                f"{dev['Device Name']} "
                f"-> {dev['IP Address']}:{dev['Port']}"
            )

        return result

    except json.JSONDecodeError as e:
        print(
            "[TCP] [ERROR] setting.json rusak: "
            f"{e}"
        )
        return []

    except UnicodeDecodeError as e:
        print(
            "[TCP] [ERROR] Encoding setting.json salah: "
            f"{e}"
        )
        return []

    except Exception as e:
        print(
            "[TCP] [ERROR] Gagal membaca setting.json: "
            f"{e}"
        )
        return []


# Alias agar mudah dipakai internal.
_load_devices = _load_tcp_devices


class TCPPLCClient:
    def __init__(self, device):
        self.name = device.get("Device Name", "")
        self.ip = str(device.get("IP Address") or device.get("IP") or device.get("Host") or "").strip()
        self.port = int(device.get("Port", 0) or 0)
        self.timeout = float(device.get("Timeout", 1) or 1)
        self.sock = None
        self.running = False
        self.lock = threading.RLock()
        self.last_attempt = 0

    def configure(self, d):
        self.ip = str(d.get("IP Address") or d.get("IP") or d.get("Host") or "").strip()
        self.port = int(d.get("Port", 0) or 0)
        self.timeout = float(d.get("Timeout", 1) or 1)

    def is_connected(self):
        return self.sock is not None and self.running

    def connect(self):
        with self.lock:
            if self.is_connected(): return True
            if not self.ip or not self.port: return False
            try:
                self.disconnect()
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(self.timeout)
                print(f"[TCP] Connecting {self.name} -> {self.ip}:{self.port}")
                s.connect((self.ip, self.port))
                s.settimeout(0.2)
                self.sock = s
                self.running = True
                print(f"[TCP] Connected: {self.name}")
                return True
            except Exception as e:
                print(f"[TCP] Connect Error [{self.name}]: {e}")
                try: s.close()
                except: pass
                self.sock = None
                return False

    def disconnect(self):
        self.running = False
        s, self.sock = self.sock, None
        if s:
            try: s.shutdown(socket.SHUT_RDWR)
            except: pass
            try: s.close()
            except: pass

    def send(self, data):
        if not self.is_connected(): return False
        try:
            if isinstance(data, list): data = bytes(data)
            elif isinstance(data, bytearray): data = bytes(data)
            elif isinstance(data, str): data = data.encode()
            self.sock.sendall(data)
            print(f"[TCP TX] [{self.name}] {data!r}")
            return True
        except Exception as e:
            print(f"[TCP TX] [{self.name}] {e}")
            self.disconnect()
            return False

    def listen(self):
        while self.running:
            try:
                data = self.sock.recv(4096)
                if not data:
                    self.disconnect()
                    break
                with _buffers_lock:
                    _buffers.setdefault(self.name, deque(maxlen=100)).append(data)
                print(f"[TCP RX] [{self.name}] {data!r}")
            except socket.timeout:
                continue
            except Exception as e:
                if self.running: print(f"[TCP RX] [{self.name}] {e}")
                self.disconnect()
                break

_clients = {}
_buffers = {}
_clients_lock = threading.RLock()
_buffers_lock = threading.RLock()

def sync_devices():
    devices = {d["Device Name"]: d for d in _load_tcp_devices()}
    with _clients_lock:
        for name in list(_clients):
            if name not in devices:
                _clients[name].disconnect()
                del _clients[name]
        for name, d in devices.items():
            if name not in _clients:
                _clients[name] = TCPPLCClient(d)
            else:
                c = _clients[name]
                new_ip = str(d.get("IP Address") or d.get("IP") or d.get("Host") or "").strip()
                new_port = int(d.get("Port", 0) or 0)
                if c.ip != new_ip or c.port != new_port:
                    c.disconnect()
                    c.configure(d)

def reconnect_loop():
    while True:
        try:
            sync_devices()
            with _clients_lock: clients = list(_clients.items())
            for name, c in clients:
                if not c.is_connected() and time.time() - c.last_attempt >= 3:
                    c.last_attempt = time.time()
                    if c.connect():
                        threading.Thread(target=c.listen, daemon=True, name=f"TCP-RX-{name}").start()
        except Exception as e:
            print("[TCP] reconnect error:", e)
        time.sleep(1)

threading.Thread(target=reconnect_loop, daemon=True, name="TCP-AutoReconnect").start()

tcp_ip_bp = Blueprint("tcp_ip", __name__)

@tcp_ip_bp.get("/api/tcp/config")
def get_tcp_config():
    """
    Return ALL TCP devices loaded from setting.json.
    This endpoint proves whether Setting -> TCP devices
    are being detected, even before connection succeeds.
    """
    devices = _load_tcp_devices()

    result = []

    with _clients_lock:
        clients = dict(_clients)

    for dev in devices:
        name = dev.get("Device Name", "")
        client = clients.get(name)

        result.append({
            "name": name,
            "type": "TCP",
            "ip": dev.get("IP Address", ""),
            "port": dev.get("Port", 0),
            "connected": (
                client.is_connected()
                if client else False
            ),
        })

    return jsonify({
        "success": True,
        "devices": result,
    })


@tcp_ip_bp.get("/api/tcp/status")
def status():
    with _clients_lock: clients = dict(_clients)
    return jsonify({
        n: {"connected": c.is_connected(), "ip": c.ip, "port": c.port}
        for n, c in clients.items()
    })

@tcp_ip_bp.get("/api/tcp/devices")
def devices():
    return jsonify({"devices": [
        {"name": d.get("Device Name"), "ip": d.get("IP Address") or d.get("IP") or d.get("Host") or "", "port": d.get("Port", "")}
        for d in _load_tcp_devices()
    ]})

@tcp_ip_bp.post("/api/tcp/connect")
def connect():
    name = (request.get_json() or {}).get("device_name")
    with _clients_lock:
        targets = {name: _clients[name]} if name and name in _clients else dict(_clients) if not name else {}
    if not targets:
        return jsonify({"success": False, "message": f"Device '{name}' not found"}), 404
    result = {}
    for n, c in targets.items():
        ok = c.connect()
        if ok and not any(t.name == n for t in threading.enumerate()):
            threading.Thread(target=c.listen, daemon=True, name=f"TCP-RX-{n}").start()
        result[n] = "connected" if ok else "failed"
    return jsonify({"success": True, "results": result})

@tcp_ip_bp.post("/api/tcp/disconnect")
def disconnect():
    name = (request.get_json() or {}).get("device_name")
    with _clients_lock: targets = {name: _clients[name]} if name and name in _clients else dict(_clients)
    for c in targets.values(): c.disconnect()
    return jsonify({"success": True})

@tcp_ip_bp.post("/api/tcp/send")
def send():
    body = request.get_json() or {}
    name, data = body.get("device_name"), body.get("data")
    if data is None: return jsonify({"success": False, "message": "data required"}), 400
    with _clients_lock:
        if name:
            if name not in _clients: return jsonify({"success": False, "message": "device not found"}), 404
            return jsonify({"success": _clients[name].send(data)})
        return jsonify({"success": True, "results": {n: c.send(data) for n, c in _clients.items()}})

@tcp_ip_bp.get("/api/tcp/latest")
def latest():
    with _buffers_lock:
        return jsonify({
            n: (b[-1].decode(errors="replace") if isinstance(b[-1], bytes) else b[-1])
            for n, b in _buffers.items() if b
        })

@tcp_ip_bp.post("/api/tcp/pop")
def pop():
    name = (request.get_json() or {}).get("device_name")
    if not name: return jsonify({"error": "device_name required"}), 400
    with _buffers_lock:
        b = _buffers.get(name)
        if b:
            x = b.pop()
            return jsonify({"success": True, "message": x.decode(errors="replace") if isinstance(x, bytes) else x})
    return jsonify({"success": False, "message": None})