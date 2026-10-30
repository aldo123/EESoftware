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
_last_values = {}   # trigger_key -> last read value, for rising-edge detection


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


# Flow files change only when Logic Builder saves a CP configuration. The
# poller runs every 50 ms, so re-opening and JSON-decoding every cp*.json on
# every cycle is unnecessary filesystem/CPU work. Keep parsed trigger sources
# per file and invalidate them when the file's size or nanosecond mtime changes.
_FLOW_CACHE_LOCK = threading.RLock()
_FLOW_SOURCE_CACHE = {}  # path -> (mtime_ns, size, tuple[source_config, ...])
_POLLED_CONNECTION_TYPES = frozenset((
    "modbus_tcp", "modbus_rtu", "fins", "ethernet_ip", "internal",
))


def _flow_file_signature(path):
    try:
        stat = os.stat(path)
        return (stat.st_mtime_ns, stat.st_size)
    except OSError:
        return None


def _parse_polled_sources(path):
    """Read one flow file and return only Device Trigger sources we poll."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            flow = json.load(f)
    except Exception:
        return ()

    sources = []
    nodes = flow.get("nodes", []) if isinstance(flow, dict) else []
    if not isinstance(nodes, list):
        return ()

    for node in nodes:
        if not isinstance(node, dict) or node.get("type") != "device_trigger":
            continue
        cfg = node.get("config", {})
        if not isinstance(cfg, dict):
            continue
        for source in node_sources(cfg):
            if (
                isinstance(source, dict)
                and source.get("connection_type") in _POLLED_CONNECTION_TYPES
            ):
                sources.append(source)
    return tuple(sources)


def _iter_polled_trigger_nodes():
    """Yield polled sources, re-parsing a flow only when its file changes.

    The 50 ms hardware/register polling cadence is intentionally unchanged.
    New, edited, deleted, or temporarily malformed flow files are reflected
    through the directory listing and file signature checks.
    """
    if not os.path.isdir(FLOWS_DIR):
        with _FLOW_CACHE_LOCK:
            _FLOW_SOURCE_CACHE.clear()
        return

    paths = glob.glob(os.path.join(FLOWS_DIR, "cp*.json"))
    active_paths = set(paths)

    collected_sources = []
    with _FLOW_CACHE_LOCK:
        # Drop deleted CP files so the cache cannot retain obsolete triggers.
        for stale_path in tuple(_FLOW_SOURCE_CACHE):
            if stale_path not in active_paths:
                _FLOW_SOURCE_CACHE.pop(stale_path, None)

        for path in paths:
            signature = _flow_file_signature(path)
            if signature is None:
                _FLOW_SOURCE_CACHE.pop(path, None)
                continue

            cached = _FLOW_SOURCE_CACHE.get(path)
            if cached and cached[0] == signature:
                sources = cached[1]
            else:
                sources = _parse_polled_sources(path)
                final_signature = _flow_file_signature(path)
                if final_signature is None:
                    _FLOW_SOURCE_CACHE.pop(path, None)
                    continue
                if final_signature == signature:
                    # Cache only a read that happened while the file signature
                    # remained stable. If Logic Builder was saving concurrently,
                    # retry on the next 50 ms cycle instead of caching a partial file.
                    _FLOW_SOURCE_CACHE[path] = (signature, sources)
                else:
                    _FLOW_SOURCE_CACHE.pop(path, None)

            collected_sources.extend(sources)

    # Never hold the cache lock while the caller performs register/DB reads.
    yield from collected_sources


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
print("[INIT] Device Trigger poller started (Modbus + Internal Variable)")


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
