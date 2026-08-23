"""
device_poller.py — Background poller for Modbus-based "Device Trigger" nodes
(connection_type "modbus_tcp" / "modbus_rtu"). RS232 triggers are already
push-based (see rs232.py — the scanner sends bytes, no polling needed) and don't
touch this file at all; this exists purely for the pull-based Modbus case, where
nothing tells us a register changed — we have to keep reading it.

Mirrors rs232.py's buffer/`/latest`/`/pop` pattern exactly, so the frontend poller
hook and FlowExecutor need zero awareness of whether a trigger came from a
scanner or a PLC register — see trigger_key() below and its use in
logic_engine.py's run()/`_execute_node`.
"""
import glob
import json
import os
import threading
import time
from collections import deque
from flask import Blueprint, request, jsonify

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
FLOWS_DIR = os.path.join(BASE_DIR, "data", "logic_flows")

POLL_INTERVAL = 0.3  # seconds

_buffers = {}       # trigger_key -> deque of fired values
_buffers_lock = threading.Lock()
_last_values = {}   # trigger_key -> last read value, for rising-edge detection


def trigger_key(cfg: dict) -> str:
    """The identity a Device Trigger node is matched against in FlowExecutor.run().
    RS232 nodes just use the device name (unchanged from the old scan_input
    behavior). Modbus nodes don't have a natural single-string identity, so one
    is derived from the register address — same formula used here and in
    logic_engine.py, so a node's config always matches its own poller entry."""
    conn = cfg.get("connection_type", "rs232")
    if conn == "rs232":
        return cfg.get("device", "")
    return f"{conn}:{cfg.get('device_name', '')}:{cfg.get('address_type', 'holding_register')}:{cfg.get('address', '0')}"


def _iter_modbus_trigger_nodes():
    if not os.path.isdir(FLOWS_DIR):
        return
    for path in glob.glob(os.path.join(FLOWS_DIR, "cp*.json")):
        try:
            with open(path, "r", encoding="utf-8") as f:
                flow = json.load(f)
        except Exception:
            continue
        for node in flow.get("nodes", []):
            if node.get("type") != "device_trigger":
                continue
            cfg = node.get("config", {})
            if cfg.get("connection_type") in ("modbus_tcp", "modbus_rtu"):
                yield cfg


def _read_register(cfg: dict):
    protocol = cfg.get("connection_type")
    mod = __import__("modbus_rtu") if protocol == "modbus_rtu" else __import__("tcp_ip")
    client = mod._get_client(cfg.get("device_name", ""))
    area = mod._normalize_area(cfg.get("address_type", "holding_register"))
    function_code = mod.AREA_MAP[area]
    address = int(cfg.get("address", 0))
    if function_code in (1, 2):
        values = mod._read_bits(client, function_code, address, 1)
        # Coils/discrete inputs come back as Python bool (True/False) — normalize
        # to "1"/"0" so a trigger_value of "1" actually matches. str(True) would
        # otherwise be "True", which never equals the string "1".
        return "1" if values[0] else "0"
    values = mod._read_registers(client, function_code, address, 1)
    return str(values[0])


_poll_count = 0
_last_errors = {}  # trigger_key -> last exception string (debug visibility)


def _poll_once():
    global _poll_count
    _poll_count += 1
    seen_any = False
    for cfg in _iter_modbus_trigger_nodes():
        seen_any = True
        key = trigger_key(cfg)
        try:
            value = _read_register(cfg)
            _last_errors.pop(key, None)
        except Exception as e:
            _last_errors[key] = str(e)
            continue  # device not connected / read failed — retry next cycle

        trigger_value = str(cfg.get("trigger_value", "1"))
        previous = _last_values.get(key)
        _last_values[key] = value

        # Rising edge only — fire once when the value first reaches trigger_value,
        # not on every poll while it stays there (same idea as a PLC pulse input).
        if previous != trigger_value and value == trigger_value:
            with _buffers_lock:
                _buffers.setdefault(key, deque(maxlen=20)).append(value)
            print(f"[DEVICE TRIGGER] '{key}' fired -> {value}")
    if _poll_count <= 3 or _poll_count % 50 == 0:
        print(f"[DEVICE TRIGGER] poll #{_poll_count}, nodes found: {seen_any}, values: {_last_values}, errors: {_last_errors}")


def _poll_loop():
    while True:
        try:
            _poll_once()
        except Exception as e:
            print("[DEVICE TRIGGER] Poll loop error:", e)
        time.sleep(POLL_INTERVAL)


_poll_thread = threading.Thread(target=_poll_loop, daemon=True)
_poll_thread.start()
print("[INIT] Device Trigger Modbus poller started")


device_trigger_bp = Blueprint("device_trigger", __name__)


@device_trigger_bp.get("/api/device-trigger/debug")
def debug_status():
    return jsonify({
        "poll_count": _poll_count,
        "thread_alive": _poll_thread.is_alive(),
        "last_values": dict(_last_values),
        "last_errors": dict(_last_errors),
        "flows_dir": FLOWS_DIR,
        "flows_dir_exists": os.path.isdir(FLOWS_DIR),
        "monitored_keys": [trigger_key(cfg) for cfg in _iter_modbus_trigger_nodes()],
    })


@device_trigger_bp.get("/api/device-trigger/latest")
def get_latest():
    with _buffers_lock:
        result = {}
        for key, buf in _buffers.items():
            if buf:
                result[key] = buf[-1]
    return jsonify(result)


@device_trigger_bp.post("/api/device-trigger/pop")
def pop_event():
    body = request.get_json() or {}
    key = body.get("device")
    if not key:
        return jsonify({"error": "device required"}), 400
    with _buffers_lock:
        buf = _buffers.get(key)
        if buf and len(buf) > 0:
            value = buf.pop()
            return jsonify({"success": True, "message": value})
    return jsonify({"success": False, "message": None})
