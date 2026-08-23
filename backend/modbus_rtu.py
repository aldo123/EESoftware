"""
modbus_rtu.py - Modbus RTU communication layer over serial (RS232/RS485) for PLCs.

Same Modbus address model as tcp_ip.py (coil / discrete input / holding register /
input register, FC01-FC06), just framed as RTU (slave id + PDU + CRC16) over a
serial port instead of MBAP + PDU over a TCP socket. The read/validate/decode
helpers are transport-agnostic and are imported straight from tcp_ip.py rather
than re-implemented here, since both clients expose the same
`.request(function_code, payload) -> response_pdu` interface.

Devices are loaded from setting.json -> Communication Devices -> _table -> Type == "Modbus RTU".
This is a separate device list from rs232.py's "COM" (scanner) devices and tcp_ip.py's
"TCP" devices, so a PLC on RS485 and a barcode scanner can both be configured without
colliding, even if they happen to share a port table.
"""

import json
import os
import struct
import sys
import threading
import time
import serial
from flask import Blueprint, request, jsonify

from tcp_ip import (
    AREA_MAP,
    _normalize_area,
    _validate_address,
    _validate_count,
    _read_bits,
    _read_registers,
)

modbus_rtu_bp = Blueprint("modbus_rtu", __name__)


# ============================================================
# SETTINGS
# ============================================================

def _settings_path():
    if getattr(sys, "frozen", False):
        return os.path.join(os.path.dirname(sys.executable), "_internal", "data", "setting.json")

    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "setting.json")
    if not os.path.exists(p):
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "setting.json")
    return p


def _parity_from_str(s):
    return {
        "NONE": serial.PARITY_NONE,
        "EVEN": serial.PARITY_EVEN,
        "ODD": serial.PARITY_ODD,
        "MARK": serial.PARITY_MARK,
        "SPACE": serial.PARITY_SPACE,
    }.get(str(s).upper(), serial.PARITY_NONE)


def _stopbits_from_str(s):
    return {
        "2": serial.STOPBITS_TWO,
        "1.5": serial.STOPBITS_ONE_POINT_FIVE,
    }.get(str(s), serial.STOPBITS_ONE)


def _load_rtu_devices():
    path = _settings_path()

    if not os.path.exists(path):
        print(f"[MODBUS RTU] Setting file not found: {path}")
        return []

    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)

        rows = data.get("Communication Devices", {}).get("_table", [])
        result = []

        for row in rows:
            if not isinstance(row, dict):
                continue
            if str(row.get("Type", "")).strip().upper() != "MODBUS RTU":
                continue

            name = str(row.get("Device Name", "")).strip()
            if not name:
                continue

            try:
                slave_id = int(row.get("Device ID") or row.get("Slave ID") or 1)
            except (TypeError, ValueError):
                slave_id = 1

            try:
                timeout = float(row.get("Timeout", 1) or 1)
            except (TypeError, ValueError):
                timeout = 1.0

            item = dict(row)
            item.update({
                "Device Name": name,
                "Type": "Modbus RTU",
                "COM Port": row.get("COM Port", "COM1"),
                "Baudrate": int(row.get("Baudrate", 9600) or 9600),
                "Data Bits": int(row.get("Data Bits", 8) or 8),
                "Parity": row.get("Parity", "None"),
                "Stop Bits": row.get("Stop Bits", "1"),
                "Device ID": slave_id,
                "Timeout": timeout,
            })
            result.append(item)

        print(f"[MODBUS RTU] Loaded {len(result)} device(s)")
        return result

    except Exception as e:
        print(f"[MODBUS RTU] Setting load error: {e}")
        return []


# ============================================================
# CRC16 (Modbus)
# ============================================================

def _crc16(data: bytes) -> bytes:
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return struct.pack("<H", crc)


# ============================================================
# MODBUS RTU CLIENT
# ============================================================

class ModbusRTUClient:
    def __init__(self, device):
        self.name = str(device.get("Device Name", ""))
        self.port = "COM1"
        self.baudrate = 9600
        self.bytesize = 8
        self.parity = serial.PARITY_NONE
        self.stopbits = serial.STOPBITS_ONE
        self.slave_id = 1
        self.timeout = 1.0

        self.ser = None
        self.lock = threading.RLock()
        self.last_attempt = 0.0

        self.configure(device)

    def configure(self, device):
        self.port = device.get("COM Port", "COM1")
        self.baudrate = int(device.get("Baudrate", 9600) or 9600)
        self.bytesize = int(device.get("Data Bits", 8) or 8)
        self.parity = _parity_from_str(device.get("Parity", "None"))
        self.stopbits = _stopbits_from_str(device.get("Stop Bits", "1"))

        try:
            self.slave_id = max(1, min(247, int(device.get("Device ID", 1) or 1)))
        except (TypeError, ValueError):
            self.slave_id = 1

        try:
            self.timeout = float(device.get("Timeout", 1) or 1)
        except (TypeError, ValueError):
            self.timeout = 1.0

    def is_connected(self):
        return self.ser is not None and self.ser.is_open

    def connect(self):
        with self.lock:
            if self.is_connected():
                return True
            try:
                self.ser = serial.Serial(
                    port=self.port, baudrate=self.baudrate, bytesize=self.bytesize,
                    parity=self.parity, stopbits=self.stopbits,
                    timeout=self.timeout, write_timeout=self.timeout,
                )
                print(f"[MODBUS RTU] Connected: {self.name} -> {self.port} @ {self.baudrate} (slave {self.slave_id})")
                return True
            except Exception as e:
                print(f"[MODBUS RTU] Connect error [{self.name}]: {e}")
                self.ser = None
                return False

    def disconnect(self):
        with self.lock:
            if self.ser:
                try:
                    self.ser.close()
                except Exception:
                    pass
            self.ser = None

    def _read_exact(self, size):
        data = self.ser.read(size)
        if len(data) != size:
            raise TimeoutError(f"Modbus RTU read timeout on {self.name} (expected {size} bytes, got {len(data)})")
        return data

    def request(self, function_code, payload=b""):
        """Same contract as ModbusTCPClient.request: returns the response PDU
        with the function-code byte stripped off, or raises."""
        with self.lock:
            if not self.is_connected():
                if not self.connect():
                    raise ConnectionError(f"Device {self.name} is not connected")

            frame = bytes([self.slave_id, function_code]) + payload
            frame += _crc16(frame)

            try:
                self.ser.reset_input_buffer()
                self.ser.write(frame)

                header = self._read_exact(2)  # slave id, function code
                rx_fc = header[1]

                if rx_fc == (function_code | 0x80):
                    rest = self._read_exact(3)  # exception code + CRC
                    raise RuntimeError(f"Modbus RTU exception FC={function_code}, code={rest[0]}")

                if rx_fc != function_code:
                    raise RuntimeError(f"Unexpected function code: {rx_fc}, expected {function_code}")

                if function_code in (1, 2, 3, 4):
                    byte_count = self._read_exact(1)[0]
                    data = self._read_exact(byte_count)
                    crc = self._read_exact(2)
                    if _crc16(header + bytes([byte_count]) + data) != crc:
                        raise ValueError(f"Modbus RTU CRC mismatch on {self.name}")
                    return bytes([byte_count]) + data

                if function_code in (5, 6):
                    body = self._read_exact(4)  # address(2) + value(2)
                    crc = self._read_exact(2)
                    if _crc16(header + body) != crc:
                        raise ValueError(f"Modbus RTU CRC mismatch on {self.name}")
                    return body

                raise ValueError(f"Unsupported function code {function_code}")

            except Exception:
                self.disconnect()
                raise


# ============================================================
# CLIENT MANAGER
# ============================================================

_clients = {}
_clients_lock = threading.RLock()


def sync_devices():
    devices = {d["Device Name"]: d for d in _load_rtu_devices()}

    with _clients_lock:
        for name in list(_clients):
            if name not in devices:
                _clients[name].disconnect()
                del _clients[name]

        for name, device in devices.items():
            if name not in _clients:
                _clients[name] = ModbusRTUClient(device)
                continue

            client = _clients[name]
            old_config = (client.port, client.baudrate, client.slave_id)
            client.configure(device)
            new_config = (client.port, client.baudrate, client.slave_id)
            if old_config != new_config:
                client.disconnect()


def reconnect_loop():
    while True:
        try:
            sync_devices()
            with _clients_lock:
                clients = list(_clients.items())
            for name, client in clients:
                if not client.is_connected() and time.time() - client.last_attempt >= 3:
                    client.last_attempt = time.time()
                    client.connect()
        except Exception as e:
            print(f"[MODBUS RTU] reconnect loop error: {e}")
        time.sleep(1)


threading.Thread(target=reconnect_loop, daemon=True, name="ModbusRTU-AutoReconnect").start()


def _get_client(device_name):
    if not device_name:
        raise ValueError("device_name is required")

    with _clients_lock:
        client = _clients.get(device_name)

    if not client:
        sync_devices()
        with _clients_lock:
            client = _clients.get(device_name)

    if not client:
        raise ValueError(f"Modbus RTU device '{device_name}' not found")

    return client


# ============================================================
# FLASK BLUEPRINT
# ============================================================

@modbus_rtu_bp.get("/api/rtu/devices")
def devices():
    result = []
    with _clients_lock:
        clients = dict(_clients)

    for d in _load_rtu_devices():
        name = d["Device Name"]
        client = clients.get(name)
        result.append({
            "name": name,
            "type": "Modbus RTU",
            "port": d["COM Port"],
            "baudrate": d["Baudrate"],
            "unit_id": d["Device ID"],
            "connected": client.is_connected() if client else False,
        })

    return jsonify({"success": True, "devices": result})


@modbus_rtu_bp.get("/api/rtu/status")
def status():
    with _clients_lock:
        clients = dict(_clients)
    return jsonify({
        name: {
            "connected": client.is_connected(),
            "port": client.port,
            "baudrate": client.baudrate,
            "unit_id": client.slave_id,
            "protocol": "Modbus RTU",
        }
        for name, client in clients.items()
    })


@modbus_rtu_bp.post("/api/rtu/connect")
def connect():
    body = request.get_json() or {}
    name = body.get("device_name")

    if name:
        try:
            client = _get_client(name)
            ok = client.connect()
            return jsonify({"success": ok, "results": {name: "connected" if ok else "failed"}})
        except Exception as e:
            return jsonify({"success": False, "message": str(e)}), 400

    with _clients_lock:
        clients = dict(_clients)
    result = {name: ("connected" if client.connect() else "failed") for name, client in clients.items()}
    return jsonify({"success": True, "results": result})


@modbus_rtu_bp.post("/api/rtu/disconnect")
def disconnect():
    body = request.get_json() or {}
    name = body.get("device_name")

    if name:
        try:
            _get_client(name).disconnect()
            return jsonify({"success": True})
        except Exception as e:
            return jsonify({"success": False, "message": str(e)}), 400

    with _clients_lock:
        clients = list(_clients.values())
    for client in clients:
        client.disconnect()
    return jsonify({"success": True})


@modbus_rtu_bp.post("/api/rtu/read")
def read_address():
    body = request.get_json() or {}
    try:
        device_name = body.get("device_name")
        area = _normalize_area(body.get("address_type"))
        address = _validate_address(body.get("address"))
        count = _validate_count(body.get("count", 1), 2000 if area in ("coil", "discrete_input") else 125)

        client = _get_client(device_name)
        function_code = AREA_MAP[area]

        if function_code in (1, 2):
            values = _read_bits(client, function_code, address, count)
        else:
            values = _read_registers(client, function_code, address, count)

        return jsonify({
            "success": True, "device_name": device_name, "address_type": area,
            "address": address, "count": count, "values": values,
            "value": values[0] if count == 1 else values, "function_code": function_code,
        })
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 400


@modbus_rtu_bp.post("/api/rtu/write")
def write_address():
    body = request.get_json() or {}
    try:
        device_name = body.get("device_name")
        area = _normalize_area(body.get("address_type"))
        address = _validate_address(body.get("address"))
        value = body.get("value")
        client = _get_client(device_name)

        if area == "coil":
            bit_value = bool(value)
            payload = struct.pack(">HH", address, 0xFF00 if bit_value else 0x0000)
            response = client.request(5, payload)
            if len(response) != 4:
                raise RuntimeError("Invalid FC05 response")
            response_address, response_value = struct.unpack(">HH", response)
            return jsonify({"success": True, "device_name": device_name, "address_type": area,
                             "address": response_address, "value": bool(response_value), "function_code": 5})

        if area == "holding_register":
            register_value = int(value)
            if register_value < 0 or register_value > 65535:
                raise ValueError("Holding Register value must be 0..65535")
            payload = struct.pack(">HH", address, register_value)
            response = client.request(6, payload)
            if len(response) != 4:
                raise RuntimeError("Invalid FC06 response")
            response_address, response_value = struct.unpack(">HH", response)
            return jsonify({"success": True, "device_name": device_name, "address_type": area,
                             "address": response_address, "value": response_value, "function_code": 6})

        raise ValueError(f"{area} is read-only")
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 400
