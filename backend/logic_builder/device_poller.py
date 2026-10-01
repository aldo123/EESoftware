"""
device_poller.py — Background poller for pull-based "Device Trigger" nodes
(connection_type "modbus_tcp" / "modbus_rtu" / "fins" / "ethernet_ip" / "internal"). RS232 triggers are
already push-based (see rs232.py — the scanner sends bytes, no polling needed)
and don't touch this file at all; this exists for the pull-based cases, where
nothing tells us a register/variable changed — we have to keep reading it.

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

POLL_INTERVAL = 0.05  # seconds

_buffers = {}       # trigger_key -> deque of fired values
_buffers_lock = threading.Lock()
_last_values = {}   # trigger_key -> last read value
_last_modes = {}    # trigger_key -> last configured trigger mode


def trigger_key(cfg: dict) -> str:
    """The identity a Device Trigger node is matched against in FlowExecutor.run().
    RS232 nodes just use the device name (unchanged from the old scan_input
    behavior). Modbus/Internal Variable nodes don't have a natural single-string
    identity, so one is derived from their config — same formula used here and
    in logic_engine.py, so a node's config always matches its own poller entry."""
    conn = cfg.get("connection_type", "rs232")
    if conn == "rs232":
        return cfg.get("device", "")
    if conn == "internal":
        return f"internal:{cfg.get('variable_name', '')}"
    return f"{conn}:{cfg.get('device_name', '')}:{cfg.get('address_type', 'holding_register')}:{cfg.get('address', '0')}"


def node_sources(cfg: dict) -> list:
    """A Device Trigger node's list of alternative sources — any one of them
    reaching its trigger value fires the same flow (OR-trigger). Older flows
    saved before multi-source support have no "sources" list; their own config
    dict IS the single source, so it's returned wrapped in a list for a
    uniform iteration API everywhere else."""
    sources = cfg.get("sources")
    if isinstance(sources, list) and sources:
        return sources
    return [cfg]


def _iter_polled_trigger_nodes():
    """Yield the config of every individual source (across every Device Trigger
    node, and every alternative source within a multi-source node) that must be
    polled (Modbus registers and Internal Variables) — RS232 is push-based and
    never appears here."""
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
            for source in node_sources(cfg):
                if source.get("connection_type") in ("modbus_tcp", "modbus_rtu", "fins", "ethernet_ip", "internal"):
                    yield source


def _read_register(cfg: dict):
    protocol = cfg.get("connection_type")
    if protocol == "fins":
        return __import__("fins").read_for_logic(cfg)
    if protocol == "ethernet_ip":
        return __import__("tcp_ethernet").read_for_logic(cfg)
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


def _read_internal_variable_raw(cfg: dict):
    from routes.internal_variable import _connect, _row
    name = cfg.get("variable_name", "")
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, name, data_type, value FROM internal_variables WHERE name = ? COLLATE NOCASE",
            (name,),
        ).fetchone()
    parsed = _row(row)
    if parsed is None:
        raise ValueError(f"Internal variable '{name}' not found")
    return str(parsed["value"])


def _read_trigger_source(cfg: dict):
    if cfg.get("connection_type") == "internal":
        return _read_internal_variable_raw(cfg)
    return _read_register(cfg)


_poll_count = 0
_last_errors = {}  # trigger_key -> last exception string (debug visibility)


def _poll_once():
    global _poll_count
    _poll_count += 1
    seen_any = False
    for cfg in _iter_polled_trigger_nodes():
        seen_any = True
        key = trigger_key(cfg)
        try:
            value = _read_trigger_source(cfg)
            _last_errors.pop(key, None)
        except Exception as e:
            _last_errors[key] = str(e)
            continue  # device not connected / read failed — retry next cycle

        # Normalize equivalent PLC values before comparing the trigger.
        # 1, 1.0, True and "1" are treated as the same value.
        def _norm(v):
            s = "" if v is None else str(v).strip()
            low = s.lower()
            if low in ("true", "on", "high"):
                return "1"
            if low in ("false", "off", "low"):
                return "0"
            try:
                f = float(s)
                if f.is_integer():
                    return str(int(f))
            except (TypeError, ValueError):
                pass
            return s

        trigger_value = _norm(cfg.get("trigger_value", "1"))
        current_value = _norm(value)

        previous = _last_values.get(key)
        previous_norm = None if previous is None else _norm(previous)

        mode = str(cfg.get("trigger_mode", "level") or "level").strip().lower()
        if mode not in ("level", "rising_edge"):
            mode = "level"

        previous_mode = _last_modes.get(key)
        _last_modes[key] = mode
        _last_values[key] = value

        is_match = current_value == trigger_value
        was_match = previous_norm is not None and previous_norm == trigger_value

        should_fire = False

        if mode == "level":
            # LEVEL:
            # Keep processing while the trigger remains satisfied, but allow
            # only ONE outstanding event at a time. After the frontend consumes
            # the event with /pop, the next poll can create the next event.
            should_fire = is_match
        else:
            # RISING EDGE:
            # Only a real non-trigger -> trigger transition fires.
            should_fire = (
                is_match
                and previous is not None
                and not was_match
            )

        if should_fire:
            with _buffers_lock:
                # Only one event may be outstanding for a trigger.
                # This prevents a 50 ms poll loop from flooding the queue.
                buf = _buffers.setdefault(key, deque(maxlen=1))
                if not buf:
                    buf.append(value)
                    print(f"[DEVICE TRIGGER] '{key}' fired ({mode}) -> {value}")
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
print("[INIT] Device Trigger poller started (Modbus + Internal Variable)")


device_trigger_bp = Blueprint("device_trigger", __name__)


@device_trigger_bp.get("/api/device-trigger/debug")
def debug_status():
    return jsonify({
        "poll_count": _poll_count,
        "thread_alive": _poll_thread.is_alive(),
        "last_values": dict(_last_values),
        "last_modes": dict(_last_modes),
        "last_errors": dict(_last_errors),
        "flows_dir": FLOWS_DIR,
        "flows_dir_exists": os.path.isdir(FLOWS_DIR),
        "monitored_keys": [trigger_key(cfg) for cfg in _iter_polled_trigger_nodes()],
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
