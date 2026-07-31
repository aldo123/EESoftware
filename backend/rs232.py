import json
import os
import sys
import threading
import time
from collections import deque
from flask import Blueprint, request, jsonify
import serial
import serial.tools.list_ports

# ═══════════════════════════════════════════════════════════════
# BAGIAN 0: PERBAIKAN PATH UNTUK ELECTRON/PYINSTALLER (SEDERHANA)
# ═══════════════════════════════════════════════════════════════

def _get_settings_path():
    """
    Mencari file setting.json.
    - Mode Electron (.exe): path sudah pasti di _internal/data
    - Mode Development: fallback di folder routes/data atau parent/data
    """
    if getattr(sys, 'frozen', False):
        # Mode Electron / PyInstaller (executable sudah dipack)
        base_exe = os.path.dirname(sys.executable)
        return os.path.join(base_exe, "_internal", "data", "setting.json")
    else:
        # Mode development (python langsung)
        current_dir = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(current_dir, "data", "setting.json")
        
        # Fallback jika file ada di folder induk (karena rs232.py berada di routes/)
        if not os.path.exists(path):
            path = os.path.join(os.path.dirname(current_dir), "data", "setting.json")
        return path


# ═══════════════════════════════════════════════════════════════
# BAGIAN 1: CLASS RS232READER
# ═══════════════════════════════════════════════════════════════

class RS232Reader:
    def __init__(self):
        self.ser              = None
        self.running          = False
        self.callback         = None
        self.port             = "COM1"
        self.baudrate         = 9600
        self.bytesize         = 8
        self.parity           = serial.PARITY_NONE
        self.stopbits         = serial.STOPBITS_ONE
        self.last_connect_attempt = 0

    @staticmethod
    def get_available_ports():
        try:
            return [p.device for p in serial.tools.list_ports.comports()]
        except:
            return []

    def port_available(self):
        try:
            return any(p.device == self.port for p in serial.tools.list_ports.comports())
        except:
            return False

    def connect(self):
        if self.is_connected():
            return True
        try:
            if not self.port_available():
                print(f"[RS232] {self.port} not found")
                return False
            if self.ser:
                try: self.ser.close()
                except: pass
                self.ser = None
            self.ser = serial.Serial(
                port=self.port, baudrate=self.baudrate,
                bytesize=self.bytesize, parity=self.parity,
                stopbits=self.stopbits, timeout=0.2, write_timeout=0.2
            )
            print(f"[RS232] Connected: {self.port}")
            return True
        except Exception as e:
            try:
                if self.ser: self.ser.close()
            except: pass
            self.ser = None
            print(f"[RS232] Connect Error {self.port}:", e)
            return False

    def disconnect(self):
        self.running = False
        try:
            if self.ser and self.ser.is_open:
                self.ser.close()
        except: pass
        self.ser = None

    def send(self, data):
        try:
            if self.ser and self.ser.is_open:
                if isinstance(data, str):
                    data = data.encode()
                self.ser.write(data)
        except Exception as e:
            print("Send Error:", e)

    def start(self, callback=None):
        self.callback = callback
        if not self.is_connected():
            return
        self.running = True
        threading.Thread(target=self._listen, daemon=True).start()

    def _listen(self):
        buffer = ""
        while self.running:
            try:
                if self.ser and self.ser.in_waiting:
                    char = self.ser.read(1).decode(errors="ignore")
                    if char in ["\r", "\n"]:
                        if buffer.strip():
                            data = buffer.strip()
                            if self.callback:
                                self.callback(data)
                            buffer = ""
                    else:
                        buffer += char
                else:
                    time.sleep(0.01)
            except Exception as e:
                print(f"[RS232] Read Error {self.port}:", e)
                self.disconnect()
                break

    def is_connected(self):
        try:
            if self.ser is None or not self.ser.is_open:
                return False
            if not self.port_available():
                self.disconnect()
                return False
            return True
        except:
            return False

    def validate_connection(self):
        try:
            if self.ser is None:
                return False
            if not self.ser.is_open:
                self.disconnect()
                return False
            if not self.port_available():
                print(f"[RS232] {self.port} removed")
                self.disconnect()
                return False
            return True
        except Exception as e:
            print("Validate Error:", e)
            self.disconnect()
            return False

    def get_port(self):
        return self.port


# ═══════════════════════════════════════════════════════════════
# BAGIAN 2: MULTI-DEVICE MANAGER (BERSIH)
# ═══════════════════════════════════════════════════════════════

_readers: dict[str, RS232Reader] = {}
_readers_lock = threading.Lock()
_buffers: dict[str, deque] = {}
_buffers_lock = threading.Lock()


def _load_com_devices():
    path = _get_settings_path()
    if not os.path.exists(path):
        print(f"[RS232] [ERROR] File tidak ditemukan di: {path}")
        return []
    
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
            
        devices = data.get("Communication Devices", {}).get("_table", [])
        
        if not devices:
            print(f"[RS232] [WARNING] Tidak ada device ditemukan di setting.json.")
            return []
            
        result = [d for d in devices if str(d.get("Type", "")).upper() == "COM"]
        print(f"[RS232] Berhasil memuat {len(result)} perangkat COM dari setting.json.")
        return result
        
    except json.JSONDecodeError as e:
        print(f"\n[RS232] [ERROR] GAGAL MEMBACA JSON! file setting.json rusak.")
        print(f"[RS232] Detail Error JSON: {e}")
        return []
        
    except UnicodeDecodeError as e:
        print(f"\n[RS232] [ERROR] ENCODING SALAH! setting.json harus berformat 'UTF-8 tanpa BOM'.")
        return []
        
    except Exception as e:
        print(f"\n[RS232] CRITICAL UNKNOWN ERROR reading setting.json: {e}\n")
        return []


def _parity_from_str(s):
    return {
        "NONE": serial.PARITY_NONE,
        "EVEN": serial.PARITY_EVEN,
        "ODD":  serial.PARITY_ODD,
        "MARK": serial.PARITY_MARK,
        "SPACE":serial.PARITY_SPACE,
    }.get(str(s).upper(), serial.PARITY_NONE)


def _stopbits_from_str(s):
    return {
        "2":   serial.STOPBITS_TWO,
        "1.5": serial.STOPBITS_ONE_POINT_FIVE,
    }.get(str(s), serial.STOPBITS_ONE)


def _apply_config_to_reader(reader: RS232Reader, dev: dict):
    reader.port      = dev.get("COM Port",   "COM1")
    reader.baudrate  = int(dev.get("Baudrate",  9600))
    reader.bytesize  = int(dev.get("Data Bits", 8))
    reader.parity    = _parity_from_str(dev.get("Parity",    "None"))
    reader.stopbits  = _stopbits_from_str(dev.get("Stop Bits", "1"))


def _make_callback(device_name: str):
    def cb(data):
        with _buffers_lock:
            if device_name not in _buffers:
                _buffers[device_name] = deque(maxlen=100)
            _buffers[device_name].append(data)
        print(f"[RS232 RX] [{device_name}] {data}")
    return cb


def sync_readers():
    devices = _load_com_devices()
    dev_map = {d["Device Name"]: d for d in devices if "Device Name" in d}

    with _readers_lock:
        for name in list(_readers.keys()):
            if name not in dev_map:
                print(f"[RS232] Removing reader for '{name}'")
                _readers[name].disconnect()
                del _readers[name]

        for name, dev in dev_map.items():
            desired_port = dev.get("COM Port", "")

            if name not in _readers:
                r = RS232Reader()
                _apply_config_to_reader(r, dev)
                _readers[name] = r
                print(f"[RS232] New reader '{name}' -> {desired_port}")
            else:
                r = _readers[name]
                if r.port != desired_port:
                    print(f"[RS232] Port changed '{name}': {r.port} -> {desired_port}")
                    r.disconnect()
                    _apply_config_to_reader(r, dev)


def _auto_reconnect_loop():
    while True:
        try:
            sync_readers()

            with _readers_lock:
                readers_copy = dict(_readers)

            for name, reader in readers_copy.items():
                if not reader.is_connected() and reader.port_available():
                    print(f"[RS232] Auto-reconnect '{name}' on {reader.port}...")
                    if reader.connect():
                        reader.start(callback=_make_callback(name))
                        print(f"[RS232] [OK] '{name}' connected on {reader.port}")

        except Exception as e:
            print(f"[RS232] Auto-reconnect loop error:", e)

        time.sleep(3)


_reconnect_thread = threading.Thread(target=_auto_reconnect_loop, daemon=True)
_reconnect_thread.start()
print("[INIT] RS232 Multi-Device Auto-Reconnect started")


# ═══════════════════════════════════════════════════════════════
# BAGIAN 3: FLASK BLUEPRINT
# ═══════════════════════════════════════════════════════════════

rs232_bp = Blueprint("rs232", __name__)


@rs232_bp.get("/api/rs232/ports")
def get_ports():
    return jsonify({"ports": RS232Reader.get_available_ports()})


@rs232_bp.get("/api/rs232/status")
def get_status():
    try:
        with _readers_lock:
            readers_copy = dict(_readers)
        with _buffers_lock:
            buffers_copy = dict(_buffers)

        result = {}
        for name, reader in readers_copy.items():
            result[name] = {
                "connected": reader.is_connected(),
                "port":      reader.port,
                "messages":  list(buffers_copy.get(name, [])),
            }
        return jsonify(result)
    except Exception as e:
        print(f"[RS232] GET /status error: {e}")
        return jsonify({"error": str(e)}), 500


@rs232_bp.post("/api/rs232/connect")
def connect_rs232():
    body        = request.get_json() or {}
    device_name = body.get("device_name")

    with _readers_lock:
        if device_name:
            targets = {device_name: _readers[device_name]} if device_name in _readers else {}
        else:
            targets = dict(_readers)

    if not targets:
        return jsonify({"success": False, "message": f"Device '{device_name}' not found"}), 404

    results = {}
    for name, reader in targets.items():
        if reader.is_connected():
            results[name] = "already connected"
        elif reader.connect():
            reader.start(callback=_make_callback(name))
            results[name] = f"connected to {reader.port}"
        else:
            results[name] = f"failed ({reader.port} not available)"

    return jsonify({"success": True, "results": results})


@rs232_bp.post("/api/rs232/disconnect")
def disconnect_rs232():
    body        = request.get_json() or {}
    device_name = body.get("device_name")

    with _readers_lock:
        if device_name:
            targets = {device_name: _readers[device_name]} if device_name in _readers else {}
        else:
            targets = dict(_readers)

    for name, reader in targets.items():
        reader.disconnect()
        print(f"[RS232] Disconnected '{name}'")

    return jsonify({"success": True})


@rs232_bp.post("/api/rs232/send")
def send_rs232_data():
    body        = request.get_json() or {}
    device_name = body.get("device_name")
    data        = body.get("data")

    if data is None:
        return jsonify({"success": False, "message": "'data' required"}), 400

    with _readers_lock:
        if device_name and device_name in _readers:
            _readers[device_name].send(data)
        elif not device_name:
            for r in _readers.values():
                r.send(data)

    return jsonify({"success": True})


# ═══════════════════════════════════════════════════════════════
# BAGIAN 4: ENDPOINT COMM-STATUS
# ═══════════════════════════════════════════════════════════════

@rs232_bp.get("/api/comm-status")
def get_comm_status():
    try:
        devices = _load_com_devices()
        result  = []

        with _readers_lock:
            readers_copy = dict(_readers)

        for dev in devices:
            name      = dev.get("Device Name", "Unknown")
            port      = dev.get("COM Port", "")
            reader    = readers_copy.get(name)
            connected = reader.is_connected() if reader else False
            result.append({"name": name, "connected": connected, "port": port})

        return jsonify({"devices": result})
    except Exception as e:
        print(f"[RS232] CRITICAL ERROR in /api/comm-status: {e}")
        return jsonify({"devices": []}), 200


@rs232_bp.get("/api/rs232/devices")
def get_rs232_devices():
    devices = _load_com_devices()
    result = [{"name": d.get("Device Name"), "port": d.get("COM Port")} for d in devices]
    return jsonify({"devices": result})


@rs232_bp.get("/api/rs232/latest")
def get_latest():
    try:
        with _buffers_lock:
            result = {}
            for name, buf in _buffers.items():
                if buf:
                    result[name] = buf[-1]
        return jsonify(result)
    except Exception as e:
        print(f"[RS232] GET /latest error: {e}")
        return jsonify({}), 500


@rs232_bp.post("/api/rs232/pop")
def pop_message():
    body = request.get_json() or {}
    name = body.get("device_name")
    if not name:
        return jsonify({"error": "device_name required"}), 400
    try:
        with _buffers_lock:
            buf = _buffers.get(name)
            if buf and len(buf) > 0:
                msg = buf.pop()
                return jsonify({"success": True, "message": msg})
        return jsonify({"success": False, "message": None})
    except Exception as e:
        print(f"[RS232] POST /pop error: {e}")
        return jsonify({"error": str(e)}), 500