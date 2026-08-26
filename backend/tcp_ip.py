"""
tcp_ip.py - Modbus TCP communication layer for EE Interlock.

Supported Modbus areas:
    Coil             FC01 Read / FC05 Write Single / FC15 Write Multiple
    Discrete Input   FC02 Read
    Holding Register FC03 Read / FC06 Write Single / FC16 Write Multiple
    Input Register   FC04 Read

Address convention:
    Addresses sent to this module are ZERO-BASED Modbus addresses.
    Example:
        Discrete Input 0  -> FC02 address 0
        Coil 3            -> FC01/FC05 address 3
        Holding Register 30 -> FC03 address 30

TCP devices are loaded automatically from:
    setting.json
    -> Communication Devices
    -> _table
    -> Type == TCP
"""

import json
import os
import socket
import struct
import sys
import threading
import time
from flask import Blueprint, request, jsonify


# ============================================================
# SETTINGS
# ============================================================

def _settings_path():
    if getattr(sys, "frozen", False):
        return os.path.join(
            os.path.dirname(sys.executable),
            "_internal",
            "data",
            "setting.json",
        )

    p = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "data",
        "setting.json",
    )

    if not os.path.exists(p):
        p = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "data",
            "setting.json",
        )

    return p


def _load_tcp_devices():
    path = _settings_path()

    if not os.path.exists(path):
        print(f"[MODBUS] Setting file not found: {path}")
        return []

    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)

        rows = (
            data.get("Communication Devices", {})
            .get("_table", [])
        )

        result = []

        for row in rows:
            if not isinstance(row, dict):
                continue

            if str(row.get("Type", "")).strip().upper() != "TCP":
                continue

            name = str(row.get("Device Name", "")).strip()

            if not name:
                continue

            ip = str(
                row.get("IP Address")
                or row.get("IP")
                or row.get("Host")
                or ""
            ).strip()

            try:
                port = int(row.get("Port", 502) or 502)
            except (TypeError, ValueError):
                port = 502

            try:
                unit_id = int(
                    row.get("Device ID")
                    or row.get("Unit ID")
                    or row.get("UnitId")
                    or 1
                )
            except (TypeError, ValueError):
                unit_id = 1

            try:
                timeout = float(row.get("Timeout", 1) or 1)
            except (TypeError, ValueError):
                timeout = 1.0

            item = dict(row)
            item.update({
                "Device Name": name,
                "Type": "TCP",
                "IP Address": ip,
                "Port": port,
                "Device ID": unit_id,
                "Timeout": timeout,
            })

            result.append(item)

        print(f"[MODBUS] Loaded {len(result)} TCP device(s)")

        for d in result:
            print(
                f"[MODBUS] {d['Device Name']} -> "
                f"{d['IP Address']}:{d['Port']} "
                f"Unit={d['Device ID']}"
            )

        return result

    except Exception as e:
        print(f"[MODBUS] Setting load error: {e}")
        return []


_load_devices = _load_tcp_devices


# ============================================================
# MODBUS TCP CLIENT
# ============================================================

class ModbusTCPClient:
    def __init__(self, device):
        self.name = str(device.get("Device Name", ""))
        self.ip = ""
        self.port = 502
        self.unit_id = 1
        self.timeout = 1.0

        self.sock = None
        self.running = False
        self.lock = threading.RLock()
        self.last_attempt = 0.0
        self.transaction_id = 0

        self.configure(device)

    def configure(self, device):
        self.ip = str(
            device.get("IP Address")
            or device.get("IP")
            or device.get("Host")
            or ""
        ).strip()

        try:
            self.port = int(device.get("Port", 502) or 502)
        except (TypeError, ValueError):
            self.port = 502

        try:
            self.unit_id = int(
                device.get("Device ID")
                or device.get("Unit ID")
                or device.get("UnitId")
                or 1
            )
        except (TypeError, ValueError):
            self.unit_id = 1

        try:
            self.timeout = float(device.get("Timeout", 1) or 1)
        except (TypeError, ValueError):
            self.timeout = 1.0

        self.unit_id = max(0, min(255, self.unit_id))

    def is_connected(self):
        return self.sock is not None and self.running

    def connect(self):
        with self.lock:
            if self.is_connected():
                return True

            if not self.ip or not self.port:
                return False

            s = None

            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(self.timeout)

                print(
                    f"[MODBUS] Connecting {self.name} "
                    f"-> {self.ip}:{self.port} "
                    f"Unit={self.unit_id}"
                )

                s.connect((self.ip, self.port))

                self.sock = s
                self.running = True

                print(f"[MODBUS] Connected: {self.name}")
                return True

            except Exception as e:
                print(
                    f"[MODBUS] Connect error "
                    f"[{self.name}]: {e}"
                )

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

    def _next_transaction_id(self):
        self.transaction_id = (
            self.transaction_id + 1
        ) & 0xFFFF

        if self.transaction_id == 0:
            self.transaction_id = 1

        return self.transaction_id

    @staticmethod
    def _recv_exact(sock, size):
        chunks = []
        remaining = size

        while remaining > 0:
            chunk = sock.recv(remaining)

            if not chunk:
                raise ConnectionError(
                    "Modbus TCP connection closed"
                )

            chunks.append(chunk)
            remaining -= len(chunk)

        return b"".join(chunks)

    def request(self, function_code, payload=b""):
        with self.lock:
            if not self.is_connected():
                if not self.connect():
                    raise ConnectionError(
                        f"Device {self.name} is not connected"
                    )

            transaction_id = self._next_transaction_id()

            # MBAP:
            # Transaction ID (2)
            # Protocol ID    (2)
            # Length         (2)
            # Unit ID        (1)
            pdu = bytes([function_code]) + payload
            mbap = struct.pack(
                ">HHHB",
                transaction_id,
                0,
                len(pdu) + 1,
                self.unit_id,
            )

            try:
                self.sock.sendall(mbap + pdu)

                # First read MBAP header.
                header = self._recv_exact(
                    self.sock,
                    7,
                )

                rx_tid, protocol_id, length, rx_unit = (
                    struct.unpack(">HHHB", header)
                )

                if rx_tid != transaction_id:
                    raise ValueError(
                        f"Transaction ID mismatch: "
                        f"{rx_tid} != {transaction_id}"
                    )

                if protocol_id != 0:
                    raise ValueError(
                        f"Invalid Modbus protocol ID: "
                        f"{protocol_id}"
                    )

                if length < 2:
                    raise ValueError(
                        f"Invalid Modbus length: {length}"
                    )

                # Length includes Unit ID, which is already in header.
                pdu_length = length - 1
                rx_pdu = self._recv_exact(
                    self.sock,
                    pdu_length,
                )

                rx_fc = rx_pdu[0]

                # Modbus exception response.
                if rx_fc == (function_code | 0x80):
                    exception_code = (
                        rx_pdu[1]
                        if len(rx_pdu) > 1
                        else 0
                    )

                    raise RuntimeError(
                        f"Modbus exception "
                        f"FC={function_code}, "
                        f"code={exception_code}"
                    )

                if rx_fc != function_code:
                    raise RuntimeError(
                        f"Unexpected function code: "
                        f"{rx_fc}, expected {function_code}"
                    )

                return rx_pdu[1:]

            except Exception as exc:
                # Keep the socket alive for PLC-level Modbus exceptions.
                # Reconnect only when the underlying transport is broken.
                transport_error = isinstance(
                    exc,
                    (
                        ConnectionError,
                        BrokenPipeError,
                        TimeoutError,
                        OSError,
                    ),
                )

                if transport_error:
                    self.disconnect()

                raise


# ============================================================
# CLIENT MANAGER
# ============================================================

_clients = {}
_clients_lock = threading.RLock()


def sync_devices():
    devices = {
        d["Device Name"]: d
        for d in _load_tcp_devices()
    }

    with _clients_lock:
        # Remove devices deleted from Setting.
        for name in list(_clients):
            if name not in devices:
                _clients[name].disconnect()
                del _clients[name]

        # Add/update devices.
        for name, device in devices.items():
            if name not in _clients:
                _clients[name] = ModbusTCPClient(device)
                continue

            client = _clients[name]

            old_config = (
                client.ip,
                client.port,
                client.unit_id,
                client.timeout,
            )

            client.configure(device)

            new_config = (
                client.ip,
                client.port,
                client.unit_id,
                client.timeout,
            )

            if old_config != new_config:
                client.disconnect()


def reconnect_loop():
    while True:
        try:
            sync_devices()

            with _clients_lock:
                clients = list(_clients.items())

            for name, client in clients:
                if (
                    not client.is_connected()
                    and time.time() - client.last_attempt >= 3
                ):
                    client.last_attempt = time.time()
                    client.connect()

        except Exception as e:
            print(f"[MODBUS] reconnect loop error: {e}")

        time.sleep(1)


threading.Thread(
    target=reconnect_loop,
    daemon=True,
    name="ModbusTCP-AutoReconnect",
).start()


# ============================================================
# MODBUS HELPERS
# ============================================================

AREA_MAP = {
    "coil": 1,
    "coils": 1,
    "discrete_input": 2,
    "discrete_inputs": 2,
    "input": 2,
    "holding_register": 3,
    "holding_registers": 3,
    "input_register": 4,
    "input_registers": 4,
}


def _normalize_area(value):
    area = str(value or "").strip().lower()

    aliases = {
        "coil": "coil",
        "coils": "coil",

        "discrete input": "discrete_input",
        "discrete_input": "discrete_input",
        "discrete inputs": "discrete_input",
        "discrete_inputs": "discrete_input",

        "holding register": "holding_register",
        "holding_register": "holding_register",
        "holding registers": "holding_register",
        "holding_registers": "holding_register",

        "input register": "input_register",
        "input_register": "input_register",
        "input registers": "input_register",
        "input_registers": "input_register",
    }

    if area not in aliases:
        raise ValueError(
            "Invalid address_type. Use: "
            "coil, discrete_input, "
            "holding_register, input_register"
        )

    return aliases[area]


def _validate_address(address):
    try:
        address = int(address)
    except (TypeError, ValueError):
        raise ValueError(
            "Address must be an integer"
        )

    if address < 0 or address > 65535:
        raise ValueError(
            "Address must be between 0 and 65535"
        )

    return address


def _validate_count(count, max_count):
    try:
        count = int(count)
    except (TypeError, ValueError):
        raise ValueError(
            "Count must be an integer"
        )

    if count < 1 or count > max_count:
        raise ValueError(
            f"Count must be between 1 and {max_count}"
        )

    return count


def _get_client(device_name):
    if not device_name:
        raise ValueError(
            "device_name is required"
        )

    with _clients_lock:
        client = _clients.get(device_name)

    if not client:
        # Refresh once in case Setting was just changed.
        sync_devices()

        with _clients_lock:
            client = _clients.get(device_name)

    if not client:
        raise ValueError(
            f"TCP device '{device_name}' not found"
        )

    return client


def _read_bits(client, function_code, address, count):
    payload = struct.pack(
        ">HH",
        address,
        count,
    )

    data = client.request(
        function_code,
        payload,
    )

    if not data:
        raise RuntimeError(
            "Empty Modbus response"
        )

    byte_count = data[0]
    raw = data[1:1 + byte_count]

    values = []

    for i in range(count):
        byte_index = i // 8
        bit_index = i % 8

        values.append(
            bool(
                raw[byte_index]
                & (1 << bit_index)
            )
        )

    return values


def _read_registers(client, function_code, address, count):
    payload = struct.pack(
        ">HH",
        address,
        count,
    )

    data = client.request(
        function_code,
        payload,
    )

    if not data:
        raise RuntimeError(
            "Empty Modbus response"
        )

    byte_count = data[0]

    if byte_count != count * 2:
        raise RuntimeError(
            f"Invalid register byte count: "
            f"{byte_count}"
        )

    raw = data[1:]

    return [
        struct.unpack(
            ">H",
            raw[i:i + 2],
        )[0]
        for i in range(
            0,
            byte_count,
            2,
        )
    ]


# ============================================================
# BATCH READ HELPERS
# ============================================================

def _max_count_for_area(area):
    return 2000 if area in ("coil", "discrete_input") else 125


def _read_batch_ranges(client, area, requests_list):
    """Read requested addresses using contiguous Modbus ranges."""
    if not requests_list:
        return []

    function_code = AREA_MAP[area]

    by_address = {}
    for item in requests_list:
        address = int(item["address"])
        by_address.setdefault(address, []).append(item)

    addresses = sorted(by_address)
    max_count = _max_count_for_area(area)

    ranges = []
    start = addresses[0]
    previous = addresses[0]

    for address in addresses[1:]:
        contiguous = address == previous + 1
        within_limit = (address - start + 1) <= max_count

        if contiguous and within_limit:
            previous = address
            continue

        ranges.append((start, previous))
        start = address
        previous = address

    ranges.append((start, previous))

    result_by_address = {}

    for start_address, end_address in ranges:
        count = end_address - start_address + 1

        if function_code in (1, 2):
            values = _read_bits(
                client,
                function_code,
                start_address,
                count,
            )
        else:
            values = _read_registers(
                client,
                function_code,
                start_address,
                count,
            )

        for offset, value in enumerate(values):
            result_by_address[start_address + offset] = value

    results = []

    for address, items in by_address.items():
        value = result_by_address.get(address)

        for item in items:
            results.append({
                "id": item["id"],
                "address": address,
                "value": value,
                "success": address in result_by_address,
            })

    return results



# ============================================================
# FLASK BLUEPRINT
# ============================================================

tcp_ip_bp = Blueprint(
    "tcp_ip",
    __name__,
)


@tcp_ip_bp.get("/api/tcp/devices")
def devices():
    result = []

    with _clients_lock:
        clients = dict(_clients)

    for d in _load_tcp_devices():
        name = d["Device Name"]
        client = clients.get(name)

        result.append({
            "name": name,
            "type": "TCP",
            "ip": d["IP Address"],
            "port": d["Port"],
            "unit_id": d["Device ID"],
            "timeout": d["Timeout"],
            "connected": (
                client.is_connected()
                if client
                else False
            ),
        })

    return jsonify({
        "success": True,
        "devices": result,
    })


@tcp_ip_bp.get("/api/tcp/status")
def status():
    with _clients_lock:
        clients = dict(_clients)

    return jsonify({
        name: {
            "connected": client.is_connected(),
            "ip": client.ip,
            "port": client.port,
            "unit_id": client.unit_id,
            "protocol": "Modbus TCP",
        }
        for name, client in clients.items()
    })


@tcp_ip_bp.get("/api/tcp/types")
def address_types():
    return jsonify({
        "success": True,
        "types": [
            {
                "value": "coil",
                "label": "Coil",
                "function_read": 1,
                "function_write": 5,
                "read_only": False,
                "data_type": "BOOL",
            },
            {
                "value": "discrete_input",
                "label": "Discrete Input",
                "function_read": 2,
                "function_write": None,
                "read_only": True,
                "data_type": "BOOL",
            },
            {
                "value": "holding_register",
                "label": "Holding Register",
                "function_read": 3,
                "function_write": 6,
                "read_only": False,
                "data_type": "UINT16",
            },
            {
                "value": "input_register",
                "label": "Input Register",
                "function_read": 4,
                "function_write": None,
                "read_only": True,
                "data_type": "UINT16",
            },
        ],
    })


@tcp_ip_bp.post("/api/tcp/connect")
def connect():
    body = request.get_json() or {}
    name = body.get("device_name")

    if name:
        try:
            client = _get_client(name)
            ok = client.connect()

            return jsonify({
                "success": ok,
                "results": {
                    name: (
                        "connected"
                        if ok
                        else "failed"
                    )
                },
            })
        except Exception as e:
            return jsonify({
                "success": False,
                "message": str(e),
            }), 400

    with _clients_lock:
        clients = dict(_clients)

    result = {}

    for device_name, client in clients.items():
        result[device_name] = (
            "connected"
            if client.connect()
            else "failed"
        )

    return jsonify({
        "success": True,
        "results": result,
    })


@tcp_ip_bp.post("/api/tcp/disconnect")
def disconnect():
    body = request.get_json() or {}
    name = body.get("device_name")

    with _clients_lock:
        clients = dict(_clients)

    if name:
        client = clients.get(name)

        if not client:
            return jsonify({
                "success": False,
                "message": f"Device '{name}' not found",
            }), 404

        client.disconnect()

        return jsonify({
            "success": True,
            "device_name": name,
        })

    for client in clients.values():
        client.disconnect()

    return jsonify({
        "success": True,
    })



@tcp_ip_bp.post("/api/tcp/read-batch")
def read_batch():
    """
    High-performance batch Modbus read.

    The backend groups addresses by area and combines contiguous
    addresses into one Modbus transaction.
    """
    body = request.get_json() or {}

    try:
        device_name = body.get("device_name")
        if not device_name:
            raise ValueError("device_name is required")

        raw_requests = body.get("requests")
        if not isinstance(raw_requests, list) or not raw_requests:
            raise ValueError("requests must be a non-empty list")

        client = _get_client(device_name)
        grouped = {}

        for index, item in enumerate(raw_requests):
            if not isinstance(item, dict):
                raise ValueError(
                    f"requests[{index}] must be an object"
                )

            request_id = str(item.get("id", index))

            area = _normalize_area(
                item.get("address_type")
            )

            address = _validate_address(
                item.get("address")
            )

            grouped.setdefault(area, []).append({
                "id": request_id,
                "address": address,
            })

        all_results = []

        for area, area_requests in grouped.items():
            all_results.extend(
                _read_batch_ranges(
                    client,
                    area,
                    area_requests,
                )
            )

        by_id = {
            str(item["id"]): item
            for item in all_results
        }

        ordered_results = []

        for index, item in enumerate(raw_requests):
            request_id = str(item.get("id", index))

            result = by_id.get(request_id)

            if result is None:
                result = {
                    "id": request_id,
                    "success": False,
                    "value": None,
                    "address": item.get("address"),
                    "message": "No value returned",
                }

            ordered_results.append(result)

        return jsonify({
            "success": True,
            "device_name": device_name,
            "results": ordered_results,
        })

    except Exception as e:
        print(
            f"[MODBUS BATCH READ ERROR] "
            f"{body.get('device_name')}: {e}"
        )

        return jsonify({
            "success": False,
            "message": str(e),
        }), 400


@tcp_ip_bp.post("/api/tcp/read")
def read_address():
    """
    Read one or multiple Modbus addresses.

    Request:
    {
        "device_name": "PLC Simulator",
        "address_type": "discrete_input",
        "address": 0,
        "count": 1
    }

    Response:
    {
        "success": true,
        "device_name": "PLC Simulator",
        "address_type": "discrete_input",
        "address": 0,
        "count": 1,
        "values": [false],
        "value": false,
        "function_code": 2
    }
    """
    body = request.get_json() or {}

    try:
        device_name = body.get("device_name")
        area = _normalize_area(
            body.get("address_type")
        )
        address = _validate_address(
            body.get("address")
        )

        default_count = 1
        count = _validate_count(
            body.get("count", default_count),
            2000 if area in (
                "coil",
                "discrete_input",
            )
            else 125,
        )

        client = _get_client(device_name)

        function_code = AREA_MAP[area]

        if function_code in (1, 2):
            values = _read_bits(
                client,
                function_code,
                address,
                count,
            )
        else:
            values = _read_registers(
                client,
                function_code,
                address,
                count,
            )

        return jsonify({
            "success": True,
            "device_name": device_name,
            "address_type": area,
            "address": address,
            "count": count,
            "values": values,
            "value": values[0] if count == 1 else values,
            "function_code": function_code,
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e),
        }), 400


@tcp_ip_bp.post("/api/tcp/write")
def write_address():
    """
    Write Modbus Coil or Holding Register.

    Coil:
        FC05, value true/false or 1/0

    Holding Register:
        FC06, value 0..65535

    Request:
    {
        "device_name": "PLC Simulator",
        "address_type": "coil",
        "address": 0,
        "value": true
    }
    """
    body = request.get_json() or {}

    try:
        device_name = body.get("device_name")
        area = _normalize_area(
            body.get("address_type")
        )
        address = _validate_address(
            body.get("address")
        )
        value = body.get("value")

        client = _get_client(device_name)

        if area == "coil":
            bit_value = bool(value)

            payload = struct.pack(
                ">HH",
                address,
                0xFF00 if bit_value else 0x0000,
            )

            response = client.request(
                5,
                payload,
            )

            if len(response) != 4:
                raise RuntimeError(
                    "Invalid FC05 response"
                )

            response_address, response_value = (
                struct.unpack(">HH", response)
            )

            return jsonify({
                "success": True,
                "device_name": device_name,
                "address_type": area,
                "address": response_address,
                "value": bool(response_value),
                "function_code": 5,
            })

        if area == "holding_register":
            register_value = int(value)

            if register_value < 0 or register_value > 65535:
                raise ValueError(
                    "Holding Register value must be "
                    "0..65535"
                )

            payload = struct.pack(
                ">HH",
                address,
                register_value,
            )

            response = client.request(
                6,
                payload,
            )

            if len(response) != 4:
                raise RuntimeError(
                    "Invalid FC06 response"
                )

            response_address, response_value = (
                struct.unpack(">HH", response)
            )

            return jsonify({
                "success": True,
                "device_name": device_name,
                "address_type": area,
                "address": response_address,
                "value": response_value,
                "function_code": 6,
            })

        raise ValueError(
            f"{area} is read-only"
        )

    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e),
        }), 400


# Compatibility endpoint for the previous raw TCP implementation.
# It remains available but should NOT be used for Modbus address access.
@tcp_ip_bp.post("/api/tcp/send")
def raw_send():
    body = request.get_json() or {}

    name = body.get("device_name")
    data = body.get("data")

    if data is None:
        return jsonify({
            "success": False,
            "message": "data required",
        }), 400

    try:
        client = _get_client(name)

        if isinstance(data, list):
            payload = bytes(data)
        elif isinstance(data, bytearray):
            payload = bytes(data)
        elif isinstance(data, str):
            payload = data.encode()
        else:
            raise ValueError(
                "data must be string, list, or bytearray"
            )

        with client.lock:
            if not client.is_connected():
                if not client.connect():
                    raise ConnectionError(
                        "Unable to connect"
                    )

            client.sock.sendall(payload)

        return jsonify({
            "success": True,
            "device_name": name,
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e),
        }), 400