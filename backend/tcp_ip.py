"""
tcp_ip.py - High-performance Modbus TCP communication layer.

Design:
- Persistent TCP connection per PLC.
- One write queue/worker per PLC.
- Single writes are ACKed by the local API immediately; PLC I/O happens
  asynchronously in the background.
- Batch writes automatically use FC15/FC16 for contiguous addresses.
- Reads remain synchronous so realtime polling can obtain current PLC state.
- Existing /api/tcp/read, /api/tcp/read-batch, /api/tcp/write and
  /api/tcp/write-batch endpoints are kept compatible.
- Addresses are ZERO-BASED Modbus addresses.
"""

import json
import os
import queue
import socket
import struct
import sys
import threading
import time
from flask import Blueprint, request, jsonify


# ============================================================
# CONFIG
# ============================================================

DEFAULT_TIMEOUT = 0.35
DEFAULT_RECONNECT_INTERVAL = 1.0
MAX_WRITE_QUEUE = 4096
MAX_COILS_PER_WRITE = 1968
MAX_REGISTERS_PER_WRITE = 123


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
                timeout = float(
                    row.get("Timeout", DEFAULT_TIMEOUT)
                    or DEFAULT_TIMEOUT
                )
            except (TypeError, ValueError):
                timeout = DEFAULT_TIMEOUT

            # Very large timeouts make an HMI feel frozen.
            timeout = max(0.10, min(timeout, 5.0))

            item = dict(row)
            item.update({
                "Device Name": name,
                "Type": "TCP",
                "IP Address": ip,
                "Port": port,
                "Device ID": max(0, min(255, unit_id)),
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
    """
    Persistent Modbus TCP client.

    The socket is reused for all requests. A single socket is serialized
    with self.lock because normal Modbus TCP request/response traffic must
    remain ordered on one connection.

    Writes have a separate queue so HTTP requests do not wait for the PLC.
    """

    def __init__(self, device):
        self.name = str(device.get("Device Name", ""))

        self.ip = ""
        self.port = 502
        self.unit_id = 1
        self.timeout = DEFAULT_TIMEOUT

        self.sock = None
        self.running = False
        self.lock = threading.RLock()

        self.last_attempt = 0.0
        self.transaction_id = 0

        self.write_queue = queue.Queue(maxsize=MAX_WRITE_QUEUE)
        self.write_thread = threading.Thread(
            target=self._write_worker,
            daemon=True,
            name=f"ModbusWrite-{self.name}",
        )
        self.write_thread.start()

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
            self.timeout = float(
                device.get("Timeout", DEFAULT_TIMEOUT)
                or DEFAULT_TIMEOUT
            )
        except (TypeError, ValueError):
            self.timeout = DEFAULT_TIMEOUT

        self.timeout = max(0.10, min(self.timeout, 5.0))
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
                s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                s.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
                # Reduce delayed ACK latency on Linux when the platform exposes it.
                # Safe fallback on Windows/other platforms.
                try:
                    if hasattr(socket, "TCP_QUICKACK"):
                        s.setsockopt(socket.IPPROTO_TCP, socket.TCP_QUICKACK, 1)
                except OSError:
                    pass
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
        """
        Execute one Modbus request synchronously.

        Used by reads and by the background write worker.
        """
        with self.lock:
            if not self.is_connected():
                if not self.connect():
                    raise ConnectionError(
                        f"Device {self.name} is not connected"
                    )

            transaction_id = self._next_transaction_id()

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

                header = self._recv_exact(
                    self.sock,
                    7,
                )

                (
                    rx_tid,
                    protocol_id,
                    length,
                    rx_unit,
                ) = struct.unpack(
                    ">HHHB",
                    header,
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

                if rx_unit != self.unit_id:
                    raise ValueError(
                        f"Unexpected Unit ID: "
                        f"{rx_unit} != {self.unit_id}"
                    )

                if length < 2:
                    raise ValueError(
                        f"Invalid Modbus length: {length}"
                    )

                pdu_length = length - 1

                rx_pdu = self._recv_exact(
                    self.sock,
                    pdu_length,
                )

                if not rx_pdu:
                    raise RuntimeError(
                        "Empty Modbus PDU"
                    )

                rx_fc = rx_pdu[0]

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

    # --------------------------------------------------------
    # WRITE QUEUE
    # --------------------------------------------------------

    def enqueue_write(self, job):
        """
        Put a write job in the persistent per-device queue.

        This method intentionally does NOT wait for the PLC.
        """
        self.write_queue.put_nowait(job)

    def _write_worker(self):
        while True:
            job = self.write_queue.get()

            try:
                self._execute_write_job(job)
            except Exception as e:
                print(
                    f"[MODBUS WRITE WORKER] "
                    f"{self.name}: {e}"
                )
            finally:
                self.write_queue.task_done()

    def _execute_write_job(self, job):
        mode = job.get("mode", "single")

        if mode == "batch":
            self._execute_batch_write(job.get("writes", []))
            return

        self._execute_single_write(
            job.get("address_type"),
            job.get("address"),
            job.get("value"),
        )

    def _execute_single_write(
        self,
        area,
        address,
        value,
    ):
        area = _normalize_area(area)
        address = _validate_address(address)

        if area == "coil":
            bit_value = bool(value)

            payload = struct.pack(
                ">HH",
                address,
                0xFF00 if bit_value else 0x0000,
            )

            response = self.request(5, payload)

            if len(response) != 4:
                raise RuntimeError(
                    "Invalid FC05 response"
                )

            return

        if area == "holding_register":
            register_value = int(value)

            if not 0 <= register_value <= 65535:
                raise ValueError(
                    "Holding Register value must be 0..65535"
                )

            payload = struct.pack(
                ">HH",
                address,
                register_value,
            )

            response = self.request(6, payload)

            if len(response) != 4:
                raise RuntimeError(
                    "Invalid FC06 response"
                )

            return

        raise ValueError(
            f"{area} is read-only"
        )

    def _execute_batch_write(self, writes):
        """
        Group contiguous writes and use FC15/FC16 where possible.
        Non-contiguous targets are sent individually.

        All groups are executed sequentially on this PLC connection.
        """
        if not writes:
            return

        normalized = []

        for item in writes:
            if not isinstance(item, dict):
                continue

            area = _normalize_area(
                item.get("address_type")
            )
            address = _validate_address(
                item.get("address")
            )

            if area not in (
                "coil",
                "holding_register",
            ):
                raise ValueError(
                    f"{area} is read-only"
                )

            value = item.get("value")

            if area == "coil":
                value = bool(value)
            else:
                value = int(value)
                if not 0 <= value <= 65535:
                    raise ValueError(
                        "Holding Register value must be 0..65535"
                    )

            normalized.append({
                "area": area,
                "address": address,
                "value": value,
            })

        # Preserve first-seen order, but remove duplicate physical targets.
        unique = {}
        for item in normalized:
            key = (
                item["area"],
                item["address"],
            )
            unique[key] = item

        items = list(unique.values())

        # Sort by area/address so contiguous ranges can be combined.
        items.sort(
            key=lambda x: (
                x["area"],
                x["address"],
            )
        )

        groups = []
        current = []

        for item in items:
            if not current:
                current = [item]
                continue

            previous = current[-1]

            same_area = (
                previous["area"] == item["area"]
            )

            contiguous = (
                previous["address"] + 1
                == item["address"]
            )

            limit = (
                MAX_COILS_PER_WRITE
                if item["area"] == "coil"
                else MAX_REGISTERS_PER_WRITE
            )

            within_limit = (
                len(current) < limit
            )

            if (
                same_area
                and contiguous
                and within_limit
            ):
                current.append(item)
            else:
                groups.append(current)
                current = [item]

        if current:
            groups.append(current)

        for group in groups:
            area = group[0]["area"]

            if area == "coil":
                if len(group) == 1:
                    self._execute_single_write(
                        area,
                        group[0]["address"],
                        group[0]["value"],
                    )
                else:
                    self._write_multiple_coils(group)

            elif area == "holding_register":
                if len(group) == 1:
                    self._execute_single_write(
                        area,
                        group[0]["address"],
                        group[0]["value"],
                    )
                else:
                    self._write_multiple_registers(group)

    def _write_multiple_coils(self, group):
        start = group[0]["address"]
        values = [
            bool(item["value"])
            for item in group
        ]

        count = len(values)
        byte_count = (count + 7) // 8
        packed = bytearray(byte_count)

        for i, value in enumerate(values):
            if value:
                packed[i // 8] |= 1 << (i % 8)

        payload = struct.pack(
            ">HHB",
            start,
            count,
            byte_count,
        ) + bytes(packed)

        response = self.request(
            15,
            payload,
        )

        if len(response) != 4:
            raise RuntimeError(
                "Invalid FC15 response"
            )

    def _write_multiple_registers(self, group):
        start = group[0]["address"]
        values = [
            int(item["value"])
            for item in group
        ]

        count = len(values)

        payload = struct.pack(
            ">HHB",
            start,
            count,
            count * 2,
        )

        payload += b"".join(
            struct.pack(">H", value)
            for value in values
        )

        response = self.request(
            16,
            payload,
        )

        if len(response) != 4:
            raise RuntimeError(
                "Invalid FC16 response"
            )


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
        # Remove deleted devices.
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

            now = time.time()

            for name, client in clients:
                if (
                    not client.is_connected()
                    and now - client.last_attempt
                    >= DEFAULT_RECONNECT_INTERVAL
                ):
                    client.last_attempt = now
                    client.connect()

        except Exception as e:
            print(
                f"[MODBUS] reconnect loop error: {e}"
            )

        time.sleep(0.25)


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
        "digital input": "discrete_input",
        "digital_input": "discrete_input",

        "holding register": "holding_register",
        "holding_register": "holding_register",
        "holding registers": "holding_register",
        "holding_registers": "holding_register",
        "holding": "holding_register",

        "input register": "input_register",
        "input_register": "input_register",
        "input registers": "input_register",
        "input_registers": "input_register",
        "analog input": "input_register",
        "analog_input": "input_register",
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
        sync_devices()

        with _clients_lock:
            client = _clients.get(device_name)

    if not client:
        raise ValueError(
            f"TCP device '{device_name}' not found"
        )

    return client


def _read_bits(
    client,
    function_code,
    address,
    count,
):
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

    if len(raw) < byte_count:
        raise RuntimeError(
            "Incomplete Modbus bit response"
        )

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


def _read_registers(
    client,
    function_code,
    address,
    count,
):
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
# BATCH READ
# ============================================================

def _max_count_for_area(area):
    return (
        2000
        if area in (
            "coil",
            "discrete_input",
        )
        else 125
    )


def _read_batch_ranges(
    client,
    area,
    requests_list,
):
    if not requests_list:
        return []

    function_code = AREA_MAP[area]

    by_address = {}

    for item in requests_list:
        address = int(item["address"])
        by_address.setdefault(
            address,
            [],
        ).append(item)

    addresses = sorted(
        by_address
    )

    max_count = _max_count_for_area(area)

    ranges = []

    start = addresses[0]
    previous = addresses[0]

    for address in addresses[1:]:
        contiguous = (
            address == previous + 1
        )

        within_limit = (
            address - start + 1
        ) <= max_count

        if contiguous and within_limit:
            previous = address
            continue

        ranges.append(
            (start, previous)
        )

        start = address
        previous = address

    ranges.append(
        (start, previous)
    )

    result_by_address = {}

    for start_address, end_address in ranges:
        count = (
            end_address
            - start_address
            + 1
        )

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
            result_by_address[
                start_address + offset
            ] = value

    results = []

    for address, items in by_address.items():
        value = result_by_address.get(
            address
        )

        for item in items:
            results.append({
                "id": item["id"],
                "address": address,
                "value": value,
                "success": (
                    address
                    in result_by_address
                ),
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
            "write_queue": (
                client.write_queue.qsize()
                if client
                else 0
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
            "write_queue": client.write_queue.qsize(),
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
                "function_write_multiple": 15,
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
                "function_write_multiple": 16,
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
                "message": (
                    f"Device '{name}' not found"
                ),
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
    body = request.get_json() or {}

    try:
        device_name = body.get(
            "device_name"
        )

        if not device_name:
            raise ValueError(
                "device_name is required"
            )

        raw_requests = body.get(
            "requests"
        )

        if (
            not isinstance(
                raw_requests,
                list,
            )
            or not raw_requests
        ):
            raise ValueError(
                "requests must be a non-empty list"
            )

        client = _get_client(
            device_name
        )

        grouped = {}

        for index, item in enumerate(
            raw_requests
        ):
            if not isinstance(item, dict):
                raise ValueError(
                    f"requests[{index}] "
                    f"must be an object"
                )

            request_id = str(
                item.get(
                    "id",
                    index,
                )
            )

            area = _normalize_area(
                item.get(
                    "address_type"
                )
            )

            address = _validate_address(
                item.get("address")
            )

            grouped.setdefault(
                area,
                [],
            ).append({
                "id": request_id,
                "address": address,
            })

        all_results = []

        # Different Modbus areas are separate function-code
        # transactions. The same socket remains persistent.
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

        for index, item in enumerate(
            raw_requests
        ):
            request_id = str(
                item.get(
                    "id",
                    index,
                )
            )

            result = by_id.get(
                request_id
            )

            if result is None:
                result = {
                    "id": request_id,
                    "success": False,
                    "value": None,
                    "address": item.get(
                        "address"
                    ),
                    "message": (
                        "No value returned"
                    ),
                }

            ordered_results.append(
                result
            )

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
    body = request.get_json() or {}

    try:
        device_name = body.get(
            "device_name"
        )

        area = _normalize_area(
            body.get("address_type")
        )

        address = _validate_address(
            body.get("address")
        )

        default_count = 1

        count = _validate_count(
            body.get(
                "count",
                default_count,
            ),
            (
                2000
                if area in (
                    "coil",
                    "discrete_input",
                )
                else 125
            ),
        )

        client = _get_client(
            device_name
        )

        function_code = AREA_MAP[
            area
        ]

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
            "value": (
                values[0]
                if count == 1
                else values
            ),
            "function_code": function_code,
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e),
        }), 400


# ============================================================
# ASYNC SINGLE WRITE
# ============================================================

@tcp_ip_bp.post("/api/tcp/write")
def write_address():
    """
    FAST WRITE ENDPOINT.

    Important:
    The HTTP request returns after validation and queue insertion.
    It does NOT wait for the PLC response.

    Response:
        202 Accepted
        {
            "success": true,
            "queued": true,
            ...
        }

    The background per-device worker performs the actual Modbus FC05/FC06.
    """

    body = request.get_json() or {}

    try:
        device_name = str(
            body.get(
                "device_name",
                "",
            )
        ).strip()

        if not device_name:
            raise ValueError(
                "device_name is required"
            )

        area = _normalize_area(
            body.get("address_type")
        )

        if area not in (
            "coil",
            "holding_register",
        ):
            raise ValueError(
                f"{area} is read-only"
            )

        address = _validate_address(
            body.get("address")
        )

        value = body.get("value")

        if area == "coil":
            value = (
                value is True
                or str(value).lower() in (
                    "1",
                    "true",
                    "on",
                )
            )
        else:
            value = int(value)

            if not 0 <= value <= 65535:
                raise ValueError(
                    "Holding Register value "
                    "must be 0..65535"
                )

        client = _get_client(
            device_name
        )

        client.enqueue_write({
            "mode": "single",
            "address_type": area,
            "address": address,
            "value": value,
        })

        return jsonify({
            "success": True,
            "queued": True,
            "device_name": device_name,
            "address_type": area,
            "address": address,
            "value": value,
            "queue_size": (
                client.write_queue.qsize()
            ),
        }), 202

    except queue.Full:
        return jsonify({
            "success": False,
            "queued": False,
            "message": (
                "PLC write queue is full"
            ),
        }), 503

    except Exception as e:
        return jsonify({
            "success": False,
            "queued": False,
            "message": str(e),
        }), 400


# ============================================================
# ASYNC BATCH WRITE
# ============================================================

@tcp_ip_bp.post("/api/tcp/write-batch")
def write_batch():
    """
    FAST BATCH WRITE.

    The entire list is inserted into the appropriate PLC queues and the
    HTTP request returns immediately.

    For each PLC:
      contiguous Coil targets -> FC15
      contiguous Holding Register targets -> FC16
      isolated targets -> FC05 / FC06

    This endpoint is therefore suitable for RESET operations containing
    many targets.
    """

    body = request.get_json() or {}
    writes = body.get("writes", [])

    if (
        not isinstance(writes, list)
        or not writes
    ):
        return jsonify({
            "success": False,
            "queued": False,
            "message": (
                "writes must be a non-empty list"
            ),
            "results": [],
        }), 400

    grouped_by_device = {}

    try:
        for index, item in enumerate(writes):
            if not isinstance(item, dict):
                raise ValueError(
                    f"writes[{index}] "
                    f"must be an object"
                )

            item_id = str(
                item.get(
                    "id",
                    index,
                )
            )

            device_name = str(
                item.get(
                    "device_name",
                    "",
                )
            ).strip()

            if not device_name:
                raise ValueError(
                    f"writes[{index}].device_name "
                    f"is required"
                )

            area = _normalize_area(
                item.get(
                    "address_type"
                )
            )

            if area not in (
                "coil",
                "holding_register",
            ):
                raise ValueError(
                    f"{area} is read-only"
                )

            address = _validate_address(
                item.get("address")
            )

            value = item.get("value")

            if area == "coil":
                value = (
                    value is True
                    or str(value).lower()
                    in (
                        "1",
                        "true",
                        "on",
                    )
                )
            else:
                value = int(value)

                if not 0 <= value <= 65535:
                    raise ValueError(
                        "Holding Register value "
                        "must be 0..65535"
                    )

            grouped_by_device.setdefault(
                device_name,
                [],
            ).append({
                "id": item_id,
                "address_type": area,
                "address": address,
                "value": value,
            })

        queued = []
        clients = {}

        for device_name, device_writes in (
            grouped_by_device.items()
        ):
            client = _get_client(
                device_name
            )

            clients[device_name] = client

            client.enqueue_write({
                "mode": "batch",
                "writes": device_writes,
            })

            queued.extend(
                {
                    "id": item["id"],
                    "device_name": device_name,
                    "address_type": item[
                        "address_type"
                    ],
                    "address": item[
                        "address"
                    ],
                    "value": item["value"],
                    "queued": True,
                }
                for item in device_writes
            )

        return jsonify({
            "success": True,
            "queued": True,
            "count": len(queued),
            "results": queued,
            "devices": {
                name: {
                    "queue_size": (
                        client.write_queue.qsize()
                    )
                }
                for name, client
                in clients.items()
            },
        }), 202

    except queue.Full:
        return jsonify({
            "success": False,
            "queued": False,
            "message": (
                "PLC write queue is full"
            ),
            "results": [],
        }), 503

    except Exception as e:
        return jsonify({
            "success": False,
            "queued": False,
            "message": str(e),
            "results": [],
        }), 400


# ============================================================
# COMPATIBILITY RAW TCP ENDPOINT
# ============================================================

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
                "data must be string, list, "
                "or bytearray"
            )

        with client.lock:
            if not client.is_connected():
                if not client.connect():
                    raise ConnectionError(
                        "Unable to connect"
                    )

            client.sock.sendall(
                payload
            )

        return jsonify({
            "success": True,
            "device_name": name,
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e),
        }), 400


# ============================================================
# INITIAL DEVICE SYNC
# ============================================================

try:
    sync_devices()
except Exception as e:
    print(
        f"[MODBUS] Initial device sync failed: {e}"
    )
