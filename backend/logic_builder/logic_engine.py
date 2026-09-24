import os
import json
import re
import sqlite3
import threading
import time
import uuid
from flask import Blueprint, request, jsonify

logic_engine_bp = Blueprint("logic_engine", __name__)

BASE_DIR      = os.path.dirname(os.path.dirname(__file__))
DATA_DIR      = os.path.join(BASE_DIR, "data")
PAGES_DIR     = os.path.join(BASE_DIR, "pages")
TEMPLATES_DIR = os.path.join(DATA_DIR, "logic_templates")

# Node types with true/false branch outputs, used when flattening Group (subflow_call)
# nodes. Add a type here whenever a new check-style node is built.
CHECK_NODE_TYPES = {"zone_inspect", "count_over_time", "custom_script", "multi_condition_gate"}
MAX_SUBFLOW_DEPTH = 8

# ─── Runtime State per CP ──────────────────────────────────────────
RUNTIME_STATES = {}  # { cp: {"waiting_scan": node_id or None} }


class _RS232ReaderManager:
    """Lazy, persistent RS232 readers used by Parse Data nodes.

    Each unique serial configuration gets one background reader so a parse node
    can consume the latest bytes without opening/closing the COM port on every
    flow cycle. pyserial remains optional: when it is unavailable the node logs
    a clear error instead of crashing the whole flow.
    """

    def __init__(self):
        self._lock = threading.RLock()
        self._readers = {}

    @staticmethod
    def _key(port, baudrate, encoding):
        return (str(port or "").strip().upper(), int(baudrate or 9600), str(encoding or "utf-8").strip() or "utf-8")

    def _start(self, port, baudrate, encoding):
        try:
            import serial
        except Exception as exc:
            raise RuntimeError(f"pyserial is not available: {exc}")

        port = str(port or "").strip()
        if not port:
            raise ValueError("RS232 COM Port is empty")
        baudrate = int(baudrate or 9600)
        encoding = str(encoding or "utf-8").strip() or "utf-8"

        ser = serial.Serial(port=port, baudrate=baudrate, timeout=0.05)
        state = {
            "serial": ser,
            "buffer": "",
            "latest_line": "",
            "stop": threading.Event(),
            "lock": threading.RLock(),
        }

        def reader_loop():
            while not state["stop"].is_set():
                try:
                    waiting = int(getattr(ser, "in_waiting", 0) or 0)
                    if waiting > 0:
                        raw = ser.read(waiting)
                        if raw:
                            text = raw.decode(encoding, errors="replace")
                            with state["lock"]:
                                state["buffer"] = (state["buffer"] + text)[-65536:]
                                parts = state["buffer"].splitlines()
                                if parts:
                                    # Keep the most recent complete line only.
                                    if state["buffer"].endswith(("\n", "\r")):
                                        state["latest_line"] = parts[-1]
                    else:
                        time.sleep(0.01)
                except Exception:
                    # The next parse call will validate the reader again.
                    time.sleep(0.05)

        thread = threading.Thread(target=reader_loop, daemon=True, name=f"logic-rs232-{port}")
        state["thread"] = thread
        thread.start()
        return state

    def _ensure(self, port, baudrate, encoding):
        key = self._key(port, baudrate, encoding)
        with self._lock:
            state = self._readers.get(key)
            if state:
                ser = state.get("serial")
                thread = state.get("thread")
                try:
                    is_open = bool(ser and ser.is_open)
                except Exception:
                    is_open = False
                if is_open and thread and thread.is_alive():
                    return state

            state = self._start(port, baudrate, encoding)
            self._readers[key] = state
            return state

    def read(self, cfg):
        port = cfg.get("rs232_port", "")
        baudrate = cfg.get("rs232_baudrate", "9600")
        encoding = cfg.get("rs232_encoding", "utf-8")
        read_mode = str(cfg.get("rs232_read_mode", "buffer") or "buffer").strip().lower()
        consume = bool(cfg.get("rs232_consume", True))

        state = self._ensure(port, baudrate, encoding)
        with state["lock"]:
            value = state["latest_line"] if read_mode == "latest_line" else state["buffer"]
            if consume and read_mode == "buffer":
                state["buffer"] = ""
            elif consume and read_mode == "latest_line":
                state["latest_line"] = ""
        return value


RS232_READERS = _RS232ReaderManager()


# ─── HELPERS ──────────────────────────────────────────────────────

def _load_settings() -> dict:
    path = os.path.join(DATA_DIR, "setting.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _load_flow(cp: str) -> dict:
    path = os.path.join(DATA_DIR, "logic_flows", f"cp{cp}.json")
    if not os.path.exists(path):
        return {"nodes": [], "connections": []}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _template_path(template_id: str) -> str:
    safe_id = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(template_id))
    return os.path.join(TEMPLATES_DIR, f"{safe_id}.json")


def _load_template(template_id: str) -> dict:
    if not template_id:
        return {"nodes": [], "connections": []}
    path = _template_path(template_id)
    if not os.path.exists(path):
        return {"nodes": [], "connections": []}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[LOGIC ENGINE] Template load error '{template_id}':", e)
        return {"nodes": [], "connections": []}


def _node_output_ports(node: dict) -> list:
    ntype = node.get("type")
    if ntype in CHECK_NODE_TYPES:
        return ["true", "false"]
    if ntype == "switch":
        cases = node.get("config", {}).get("cases", [])
        return [f"case_{i}" for i in range(len(cases))] + ["default"]
    if ntype == "subflow_call" and node.get("config", {}).get("expose_check"):
        return ["true", "false"]
    if ntype == "group_output":
        return [node.get("config", {}).get("port", "next")]
    return ["next"]


def _flatten_flow(nodes: list, connections: list, depth: int = 0) -> tuple[dict, list]:
    """Inline every 'subflow_call' (Group) node with the contents of the template it
    references, so the executor never needs to know Groups exist. A template's entry
    point is whichever of its nodes has no incoming connection (several independent
    root chains are all wired up, not just one). Any of the template's inner output
    ports left unconnected bridges out to whatever the Group node's SAME-NAMED outer
    port connects to (e.g. a dangling inner "true" bridges to the Group's outer
    "true") — falling back to the outer "next" port for any port name the Group
    doesn't itself expose (e.g. a plain-action node left dangling inside a
    next-only Group). This lets a Group act as a full subroutine: as much internal
    logic as you like, with the same true/false-branching interface to the outside
    as any other check node when its "Expose as Check" option is on. Recurses so
    Groups can contain Groups, bounded by MAX_SUBFLOW_DEPTH."""
    node_map = {n["id"]: dict(n) for n in nodes}
    conns = [dict(c) for c in connections]

    if depth >= MAX_SUBFLOW_DEPTH:
        return node_map, conns

    call_ids = [nid for nid, n in node_map.items() if n.get("type") == "subflow_call"]
    if not call_ids:
        return node_map, conns

    for call_id in call_ids:
        if call_id not in node_map:
            continue
        call_node = node_map[call_id]
        template_id = call_node.get("config", {}).get("template_id", "")
        template = _load_template(template_id)
        t_nodes, t_conns = _flatten_flow(template.get("nodes", []) or [], template.get("connections", []) or [], depth + 1)

        outer_incoming = [c for c in conns if c.get("toId") == call_id]
        # A Group's outer ports (typically just "next", or "true"/"false" when
        # "Expose as Check" is on) can each fan out to several downstream nodes.
        outer_bridge_by_port = {}
        for c in conns:
            if c.get("fromId") == call_id:
                outer_bridge_by_port.setdefault(c.get("fromPort"), []).append(c["toId"])

        def bridge_targets_for(port):
            return outer_bridge_by_port.get(port) or outer_bridge_by_port.get("next") or []

        del node_map[call_id]
        conns = [c for c in conns if c.get("fromId") != call_id and c.get("toId") != call_id]

        if not t_nodes:
            for c in outer_incoming:
                for i, target in enumerate(bridge_targets_for("next")):
                    conns.append({**c, "id": f"{c.get('id', 'c')}__empty{i}", "toId": target})
            continue

        prefix = f"{call_id}::"
        remapped_nodes = {}
        for nid, n in t_nodes.items():
            new_id = prefix + nid
            nn = dict(n)
            nn["id"] = new_id
            remapped_nodes[new_id] = nn
        remapped_conns = [{**c, "fromId": prefix + c["fromId"], "toId": prefix + c["toId"]} for c in t_conns]

        # A template can have several independent root chains (nodes with no incoming
        # connection) — run all of them rather than arbitrarily picking one and orphaning
        # the rest. A "group_output" node is excluded even when unconnected: it's a
        # receiver by definition (things flow INTO it), never a legitimate trigger
        # origin — an unwired one (e.g. a "false" exit nothing reached yet) must stay
        # dead, not misfire as though the Group's outer input reached it directly.
        connected_ids = {c["toId"] for c in remapped_conns}
        entry_ids = sorted(
            nid for nid, n in remapped_nodes.items()
            if n.get("type") != "group_output" and nid not in connected_ids
        ) or [next(iter(remapped_nodes))]
        for c in outer_incoming:
            for i, eid in enumerate(entry_ids):
                conns.append({**c, "id": f"{c.get('id', 'c')}__entry{i}", "toId": eid})

        used_out_ports = {(c["fromId"], c["fromPort"]) for c in remapped_conns}
        for nid, n in remapped_nodes.items():
            for port in _node_output_ports(n):
                if (nid, port) not in used_out_ports:
                    for i, target in enumerate(bridge_targets_for(port)):
                        conns.append({"id": f"{nid}__{port}__auto{i}", "fromId": nid, "fromPort": port, "toId": target})

        node_map.update(remapped_nodes)
        conns.extend(remapped_conns)

    return node_map, conns


# ─── FLOW EXECUTOR ────────────────────────────────────────────────

class FlowExecutor:
    def __init__(self, cp: str, field_values: dict, trigger_device: str, scan_value: str):
        self.cp = cp
        self.fields = dict(field_values)
        self.trigger_device = trigger_device
        self.scan_value = scan_value
        self.settings = _load_settings()
        self.flow = _load_flow(cp)
        self.nodes, self.connections = _flatten_flow(self.flow.get("nodes", []), self.flow.get("connections", []))
        self.commands = []
        # Per-executor locks keep shared runtime state deterministic when Race
        # candidates are evaluated in parallel. They do not change normal
        # sequential execution.
        self._commands_lock = threading.RLock()
        self._fields_lock = threading.RLock()
        self._db_gate_lock = threading.RLock()
        self._db_schema_cache = {}
        # Build the connection adjacency once. The old implementation scanned
        # every connection every time a node executed; that becomes expensive
        # when Race/On-Change causes many evaluations.
        self._outputs_cache = {}
        for _conn in self.connections:
            self._outputs_cache.setdefault(_conn["fromId"], {}).setdefault(_conn["fromPort"], []).append(_conn["toId"])

        # Race execution is opt-in per Multi-Condition Gate.
        # Normal flow execution remains sequential. Only sibling gates that
        # explicitly share the same non-empty race_group are evaluated in parallel.
        self._race_local = threading.local()
        self._race_states = {}
        self._race_states_lock = threading.RLock()

        if self.cp not in RUNTIME_STATES:
            RUNTIME_STATES[self.cp] = {"waiting_scan": None}

    def _node_outputs(self, node_id: str) -> dict:
        """Return cached port -> target ids adjacency for a node."""
        return self._outputs_cache.get(node_id, {})

    def _follow(self, outputs: dict, port: str, db=None):
        """Execute downstream nodes. Normal fan-out stays sequential.

        Multi-Condition Gates that explicitly share a non-empty ``race_group``
        are treated as a race: all sibling gates start together and the first
        gate whose complete condition set becomes TRUE wins. Other waiting race
        candidates are cancelled. If every candidate finishes FALSE, the FALSE
        branch of the race is executed once.
        """
        targets = list(outputs.get(port, []))
        if not targets:
            return

        race_groups = {}
        normal_targets = []
        for next_id in targets:
            next_node = self.nodes.get(next_id) or {}
            if next_node.get("type") != "multi_condition_gate":
                normal_targets.append(next_id)
                continue
            cfg = next_node.get("config", {}) or {}
            race_group = str(cfg.get("race_group", "") or "").strip()
            if race_group:
                race_groups.setdefault(race_group, []).append(next_id)
            else:
                normal_targets.append(next_id)

        # Preserve the original sequential behavior for all normal nodes.
        for next_id in normal_targets:
            self._execute_node(next_id, db)

        for race_group, group_targets in race_groups.items():
            if len(group_targets) < 2:
                self._execute_node(group_targets[0], db)
                continue

            # A race group name is a configuration label, not a global runtime
            # identifier. Multiple executions of the same CP can overlap, so a
            # unique runtime key prevents one race from cancelling another.
            race_key = f"{race_group}:{uuid.uuid4().hex}"
            state = {
                "event": threading.Event(),
                "active": set(group_targets),
                "winner": None,
                "all_failed": False,
                "lock": threading.RLock(),
            }
            with self._race_states_lock:
                self._race_states[race_key] = state

            def _run_race_candidate(candidate_id):
                self._race_local.group = race_key
                self._race_local.node_id = candidate_id
                try:
                    self._execute_node(candidate_id, db)
                except Exception as exc:
                    # A worker exception must not leave the race permanently
                    # active. Treat that candidate as failed and let the other
                    # candidates continue normally.
                    self._log(f"Multi-Condition Race candidate '{candidate_id}' error: {exc}", "#EF4444")
                    with state["lock"]:
                        state["active"].discard(candidate_id)
                        if not state["active"] and state.get("winner") is None:
                            state["all_failed"] = True
                            state["event"].set()
                            self._follow(outputs, "false", db)
                finally:
                    self._race_local.group = None
                    self._race_local.node_id = None

            threads = [
                threading.Thread(
                    target=_run_race_candidate,
                    args=(candidate_id,),
                    daemon=True,
                    name=f"logic-race-{race_group}-{candidate_id}",
                )
                for candidate_id in group_targets
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()

            with self._race_states_lock:
                self._race_states.pop(race_key, None)

    def _race_state_for(self, node_id: str):
        """Return the active race state only when this node is a race candidate."""
        group = getattr(self._race_local, "group", None)
        local_node = getattr(self._race_local, "node_id", None)
        if not group or local_node != node_id:
            return None
        with self._race_states_lock:
            return self._race_states.get(group)

    def _race_cancelled(self, node_id: str) -> bool:
        state = self._race_state_for(node_id)
        return bool(state and state["event"].is_set() and state.get("winner") != node_id)

    def _get_field(self, key: str) -> str:
        return str(self.fields.get(key, ""))

    def _resolve_device_value(self, cfg: dict, prefix: str = "") -> str:
        """Live-read one Modbus register/coil (TCP or RTU) and return it as a string.
        `prefix` namespaces the four config keys so several device pickers can coexist
        on one node (e.g. 'field_' for the left side of a comparison, 'value_' for the right)."""
        protocol = cfg.get(f"{prefix}protocol", "tcp")
        device_name = cfg.get(f"{prefix}device_name", "")
        address_type = cfg.get(f"{prefix}address_type", "holding_register")
        address = cfg.get(f"{prefix}address", "0")
        try:
            addr = int(address)
            mod = __import__("modbus_rtu") if protocol == "rtu" else __import__("tcp_ip")
            client = mod._get_client(device_name)
            area = mod._normalize_area(address_type)
            function_code = mod.AREA_MAP[area]
            if function_code in (1, 2):
                values = mod._read_bits(client, function_code, addr, 1)
                # Coils/discrete inputs come back as Python bool — normalize to
                # "1"/"0" (str(True) would be "True", never equal to "1").
                return "1" if values[0] else "0"
            values = mod._read_registers(client, function_code, addr, 1)
            return str(values[0])
        except Exception as e:
            self._log(f"Device register read error ({device_name or '?'} {address_type}@{address}): {e}", "#EF4444")
            return ""

    def _resolve_source(self, source: str, cfg: dict, static_value: str = "", field_key: str = "", device_prefix: str = "") -> str:
        """Resolve a configured source value.

        Supported sources:
          - static: use the configured fixed value
          - field_key: use a value already stored in the flow fields
          - device: read a live Modbus value
          - internal_variable: read the CURRENT Internal Variable value

        Internal Variable must never fall back to the static/default value.
        The UI stores its selected source in `value_variable_name`.
        """
        if source == "field_key":
            return self._get_field(field_key)

        if source == "device":
            return self._resolve_device_value(cfg, device_prefix)

        if source == "internal_variable":
            variable_name = str(cfg.get("value_variable_name", "") or "").strip()
            if not variable_name:
                raise ValueError("Internal Variable source is selected but no source variable is configured")

            value = self._read_internal_variable(variable_name)
            if value is None:
                raise ValueError(f"Internal Variable '{variable_name}' not found")

            self._log(
                f"Write Output source: Internal Variable '{variable_name}' = {value}",
                "#06B6D4",
            )
            return str(value)

        return static_value

    def _set_field(self, key: str, value: str):
        with self._fields_lock, self._commands_lock:
            self.fields[key] = value
            self.commands.append({"cmd": "set_field", "key": key, "value": value})

    def _log(self, message: str, color: str = "#22C55E"):
        with self._commands_lock:
            self.commands.append({"cmd": "log", "message": message, "color": color})

    def _instruction(self, text: str, color: str = "blue", widget: str = ""):
        with self._commands_lock:
            self.commands.append({"cmd": "set_instruction", "widget": widget, "text": text, "color": color})

    def _reject(self, reason: str):
        with self._commands_lock:
            self.commands.append({"cmd": "reject", "reason": reason})

    @staticmethod
    def _compare_values(left, operator: str, right, right2=None) -> bool:
        """Generic left-op-right(-right2) comparator, shared by any check/gate node."""
        try:
            if operator in ("greater_than", "less_than", "greater_equal", "less_equal", "between"):
                l_num = float(left)
                if operator == "between":
                    lo, hi = float(right), float(right2)
                    return min(lo, hi) <= l_num <= max(lo, hi)
                r_num = float(right)
                if operator == "greater_than":
                    return l_num > r_num
                if operator == "less_than":
                    return l_num < r_num
                if operator == "greater_equal":
                    return l_num >= r_num
                return l_num <= r_num
            # Normalize comparison values without treating empty string as
            # "missing". Fixed Value = "" is a valid value and must work for
            # both Equals and Not Equals.
            left_s = "" if left is None else str(left).strip().lower()
            right_s = "" if right is None else str(right).strip().lower()

            if operator == "equals":
                return left_s == right_s
            if operator == "not_equals":
                return left_s != right_s
            if operator == "contains":
                return right_s in left_s
            if operator == "not_contains":
                return right_s not in left_s
        except (ValueError, TypeError):
            return False
        return False

    def _evaluate_condition(self, cond: dict) -> bool:
        """Generic left-op-right evaluator, shared by any future check/gate node."""
        operator = cond.get("operator", "equals")
        field_source = cond.get("field_source", "field_key")
        left = self._resolve_device_value(cond, "field_") if field_source == "device" else self._get_field(cond.get("field", ""))
        right = self._resolve_source(cond.get("compare_source", "static"), cond, static_value=cond.get("value", ""), field_key=cond.get("value_source", ""), device_prefix="value_")
        return self._compare_values(left, operator, right)

    def _read_internal_variable(self, name: str):
        """Read one Internal Variable's current value straight from its SQLite store."""
        from routes.internal_variable import _connect, _row
        try:
            with _connect() as conn:
                row = conn.execute(
                    """SELECT id, name, data_type, value, system_key
                       FROM internal_variables
                       WHERE name = ? COLLATE NOCASE""",
                    (name,),
                ).fetchone()
            parsed = _row(row)
            return parsed["value"] if parsed else None
        except Exception as e:
            self._log(f"Internal variable read error '{name}': {e}", "#EF4444")
            return None

    def _write_internal_variable(self, name: str, value) -> bool:
        from routes.internal_variable import _connect, _normalize_value
        try:
            with _connect() as conn:
                row = conn.execute(
                    "SELECT id, data_type FROM internal_variables WHERE name = ? COLLATE NOCASE", (name,)
                ).fetchone()
                if row is None:
                    self._log(f"Internal variable write error: '{name}' not found", "#EF4444")
                    return False
                normalized = _normalize_value(value, row["data_type"])
                conn.execute(
                    "UPDATE internal_variables SET value=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                    (normalized, row["id"]),
                )
                conn.commit()
            return True
        except Exception as e:
            self._log(f"Internal variable write error '{name}': {e}", "#EF4444")
            return False

    def _reset_internal_variable(self, name: str) -> bool:
        """Reset one Internal Variable back to its data type's default (string ->
        "", number -> 0, boolean -> false) — e.g. a trigger flag a Write Output
        node set to fire a test, ready to fire again next cycle."""
        from routes.internal_variable import _connect

        defaults = {"number": "0", "boolean": "false", "string": ""}
        try:
            with _connect() as conn:
                row = conn.execute(
                    "SELECT id, data_type FROM internal_variables WHERE name = ? COLLATE NOCASE", (name,)
                ).fetchone()
                if row is None:
                    self._log(f"Reset error: '{name}' not found", "#EF4444")
                    return False
                conn.execute(
                    "UPDATE internal_variables SET value=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                    (defaults.get(row["data_type"], ""), row["id"]),
                )
                conn.commit()
            return True
        except Exception as e:
            self._log(f"Reset error '{name}': {e}", "#EF4444")
            return False

    def _collect_group_internal_variables(self, group_name: str, depth: int = 0) -> set:
        """Collect Internal Variable names referenced by a Logic Builder Group.

        Logic Builder Groups are saved templates, not a `group_name` column in
        the Internal Variable table. Resolve the selected template and inspect
        its node configurations instead.
        """
        if depth >= MAX_SUBFLOW_DEPTH:
            return set()

        wanted = str(group_name or "").strip()
        if not wanted:
            return set()

        template = _load_template(wanted)

        # Also accept the Group display name, not only its template id.
        if not template.get("nodes"):
            try:
                filenames = os.listdir(TEMPLATES_DIR)
            except Exception:
                filenames = []

            for fname in filenames:
                if not fname.endswith(".json"):
                    continue
                try:
                    with open(os.path.join(TEMPLATES_DIR, fname), "r", encoding="utf-8") as f:
                        candidate = json.load(f)
                    if (
                        str(candidate.get("id", "")).strip().lower() == wanted.lower()
                        or str(candidate.get("name", "")).strip().lower() == wanted.lower()
                    ):
                        template = candidate
                        break
                except Exception:
                    continue

        names = set()

        def collect(value):
            if isinstance(value, dict):
                for key in (
                    "variable_name",
                    "variableName",
                    "internal_variable",
                    "internalVariable",
                    "source_variable_name",
                    "destination_variable_name",
                    "source_variable",
                    "destination_variable",
                ):
                    value_ref = value.get(key)
                    if isinstance(value_ref, str) and value_ref.strip():
                        names.add(value_ref.strip())

                for child in value.values():
                    collect(child)
            elif isinstance(value, list):
                for child in value:
                    collect(child)

        collect(template.get("nodes", []))

        # Include variables referenced by nested Logic Builder Groups.
        for node in template.get("nodes", []) or []:
            if node.get("type") != "subflow_call":
                continue
            cfg = node.get("config", {}) or {}
            nested_id = cfg.get("template_id", "")
            if nested_id:
                names.update(
                    self._collect_group_internal_variables(nested_id, depth + 1)
                )

        return names

    def _reset_internal_variables_by_group(self, group_name: str) -> int:
        """Reset Internal Variables used by the selected Logic Builder Group.

        number -> 0
        boolean -> false
        string -> empty
        """
        from routes.internal_variable import _connect

        names = self._collect_group_internal_variables(group_name)

        if not names:
            self._log(
                f"Reset Group '{group_name}': no Internal Variable reference found in this Logic Builder Group",
                "#F59E0B",
            )
            return 0

        defaults = {
            "number": "0",
            "boolean": "false",
            "string": "",
        }
        count = 0

        try:
            with _connect() as conn:
                for name in sorted(names):
                    row = conn.execute(
                        "SELECT id, data_type FROM internal_variables "
                        "WHERE name = ? COLLATE NOCASE",
                        (name,),
                    ).fetchone()

                    if row is None:
                        self._log(
                            f"Reset Group '{group_name}': Internal Variable '{name}' not found",
                            "#EF4444",
                        )
                        continue

                    data_type = str(row["data_type"] or "string").strip().lower()
                    default_value = defaults.get(data_type, "")

                    conn.execute(
                        "UPDATE internal_variables "
                        "SET value=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                        (default_value, row["id"]),
                    )
                    count += 1

                conn.commit()
            return count

        except Exception as e:
            self._log(f"Reset Group '{group_name}' error: {e}", "#EF4444")
            return 0

    def _reset_all_internal_variables(self) -> int:
        """Reset every Internal Variable to its data type's default. Returns how
        many rows were touched, for the log line."""
        from routes.internal_variable import _connect

        defaults = {"number": "0", "boolean": "false", "string": ""}
        try:
            with _connect() as conn:
                rows = conn.execute("SELECT id, data_type FROM internal_variables").fetchall()
                for row in rows:
                    conn.execute(
                        "UPDATE internal_variables SET value=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                        (defaults.get(row["data_type"], ""), row["id"]),
                    )
                conn.commit()
            return len(rows)
        except Exception as e:
            self._log(f"Reset All error: {e}", "#EF4444")
            return 0

    def _write_device_value(self, cfg: dict, value, prefix: str = "") -> bool:
        """Write one value to a Modbus TCP or RTU coil/holding register."""
        protocol = cfg.get(f"{prefix}protocol", "tcp")
        device_name = cfg.get(f"{prefix}device_name", "")
        address_type = cfg.get(f"{prefix}address_type", "holding_register")
        address = cfg.get(f"{prefix}address", "0")
        try:
            addr = int(address)
            is_coil = address_type == "coil"
            bit_value = str(value).strip().lower() in ("1", "true", "on", "yes")
            reg_value = None if is_coil else int(float(value))
            if reg_value is not None and not 0 <= reg_value <= 65535:
                raise ValueError("Holding Register value must be 0..65535")

            if protocol == "rtu":
                import struct
                mod = __import__("modbus_rtu")
                client = mod._get_client(device_name)
                if is_coil:
                    payload = struct.pack(">HH", addr, 0xFF00 if bit_value else 0x0000)
                    client.request(5, payload)
                else:
                    payload = struct.pack(">HH", addr, reg_value)
                    client.request(6, payload)
            else:
                mod = __import__("tcp_ip")
                client = mod._get_client(device_name)
                client.enqueue_write({
                    "mode": "single",
                    "address_type": address_type,
                    "address": addr,
                    "value": bit_value if is_coil else reg_value,
                })
            return True
        except Exception as e:
            self._log(f"Device write error ({device_name or '?'} {address_type}@{address}): {e}", "#EF4444")
            return False

    def _resolve_parse_tcp_value(self, cfg: dict) -> str:
        """Read one or more Modbus TCP values and convert them to parseable text."""
        protocol = "tcp"
        device_name = str(cfg.get("device_name", "") or "").strip()
        address_type = str(cfg.get("address_type", "holding_register") or "holding_register").strip()
        address = cfg.get("address", "0")
        try:
            count = max(1, min(int(cfg.get("read_length", 1) or 1), 256))
            addr = int(address)
            if addr < 0 or addr > 65535:
                raise ValueError("Address must be 0..65535")
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid TCP Parse Data address/length: {exc}")

        if not device_name:
            raise ValueError("TCP Parse Data has no device selected")

        try:
            mod = __import__("tcp_ip")
            client = mod._get_client(device_name)
            area = mod._normalize_area(address_type)
            function_code = mod.AREA_MAP[area]
            if function_code in (1, 2):
                values = mod._read_bits(client, function_code, addr, count)
            else:
                values = mod._read_registers(client, function_code, addr, count)
        except Exception as exc:
            raise RuntimeError(
                f"TCP Parse Data read error ({device_name} {address_type}@{addr} x{count}): {exc}"
            ) from exc

        decode_mode = str(cfg.get("decode_mode", "value") or "value").strip().lower()

        if function_code in (1, 2):
            return "".join("1" if bool(v) else "0" for v in values)

        numbers = [int(v) & 0xFFFF for v in values]

        if decode_mode == "ascii_be":
            raw = b"".join(bytes([(v >> 8) & 0xFF, v & 0xFF]) for v in numbers)
            return raw.decode("latin-1").rstrip("\x00")
        if decode_mode == "ascii_le":
            raw = b"".join(bytes([v & 0xFF, (v >> 8) & 0xFF]) for v in numbers)
            return raw.decode("latin-1").rstrip("\x00")
        if decode_mode == "decimal_join":
            return "".join(str(v) for v in numbers)

        # "value": one register is the most intuitive/default case. When more
        # than one register is requested, concatenate their decimal text.
        return str(numbers[0]) if len(numbers) == 1 else "".join(str(v) for v in numbers)

    def _resolve_parse_source(self, cfg: dict) -> str:
        source_type = str(cfg.get("source_type", "internal_variable") or "internal_variable").strip().lower()

        if source_type == "internal_variable":
            name = str(cfg.get("source_variable_name", "") or "").strip()
            if not name:
                raise ValueError("Parse Data: source Internal Variable is not configured")
            value = self._read_internal_variable(name)
            if value is None:
                raise ValueError(f"Parse Data: Internal Variable '{name}' not found")
            return str(value)

        if source_type == "tcpip":
            return self._resolve_parse_tcp_value(cfg)

        if source_type == "rs232":
            return str(RS232_READERS.read(cfg) or "")

        raise ValueError(f"Parse Data: unsupported source type '{source_type}'")

    @staticmethod
    def _slice_text(value, start_index, end_index):
        text = "" if value is None else str(value)
        try:
            start = max(0, int(start_index if start_index not in (None, "") else 0))
        except (TypeError, ValueError):
            start = 0

        if end_index in (None, ""):
            end = None
        else:
            try:
                end = max(start, int(end_index))
            except (TypeError, ValueError):
                end = None

        return text[start:end]

    def _execute_parse_data(self, cfg: dict) -> list[dict]:
        """Execute one or many parse mappings and write each result to its destination IV.

        New format: cfg["mappings"] = [{...}, {...}, ...].
        Legacy format (single mapping fields directly on cfg) remains supported.
        """
        mappings = cfg.get("mappings")
        if not isinstance(mappings, list) or not mappings:
            mappings = [cfg]

        results = []
        for index, mapping in enumerate(mappings):
            if not isinstance(mapping, dict):
                raise ValueError(f"Parse Data #{index + 1}: invalid mapping")

            destination = str(mapping.get("destination_variable_name", "") or "").strip()
            if not destination:
                raise ValueError(f"Parse Data #{index + 1}: destination Internal Variable is not configured")

            source_value = self._resolve_parse_source(mapping)
            parsed = self._slice_text(
                source_value,
                mapping.get("start_index", "0"),
                mapping.get("end_index", ""),
            )

            if not self._write_internal_variable(destination, parsed):
                raise ValueError(
                    f"Parse Data #{index + 1}: failed to write Internal Variable '{destination}'"
                )

            results.append({
                "index": index + 1,
                "source_type": str(mapping.get("source_type", "internal_variable")),
                "source_value": source_value,
                "parsed": parsed,
                "start_index": mapping.get("start_index", "0"),
                "end_index": mapping.get("end_index", ""),
                "destination": destination,
            })

        return results

    def _db_query(self, table: str, key_col: str, key_val: str, fields: list, db) -> bool:
        """Generic single-row lookup, shared by any future DB-reading node."""
        try:
            cols = ", ".join(f["col"] for f in fields)
            sql = f"SELECT {cols} FROM {table} WHERE {key_col} = %s LIMIT 1"
            row = db.fetch_one(sql, (key_val,))
            if not row:
                return False
            for f in fields:
                val = str(row.get(f["col"], "") or "")
                self._set_field(f["target"], val)
            return True
        except Exception as e:
            print(f"[LOGIC ENGINE] DB query error: {e}")
            return False

    def run(self, db=None) -> list:
        from logic_builder.device_poller import node_sources, trigger_key

        def node_matches(cfg: dict) -> bool:
            """True if ANY of this node's alternative sources matches the device
            that fired — a Device Trigger node with several sources listed fires
            the same flow no matter which one of them triggered."""
            return any(trigger_key(source) == self.trigger_device for source in node_sources(cfg))

        state = RUNTIME_STATES[self.cp]
        waiting = state["waiting_scan"]

        # ─── Jika ada waiting_scan, coba proses ──────────────────
        if waiting:
            node = self.nodes.get(waiting)
            if node and node["type"] == "device_trigger":
                cfg = node.get("config", {})
                if node_matches(cfg):
                    # Device cocok → isi field dan lanjut
                    field_key = cfg.get("fieldKey", "")
                    if field_key:
                        self._set_field(field_key, self.scan_value)

                    state["waiting_scan"] = None

                    self._follow(self._node_outputs(waiting), "next", db)
                    return self.commands
                else:
                    # Device tidak cocok → reset waiting_scan dan mulai dari awal
                    state["waiting_scan"] = None
                    # Lanjut ke logika pencarian device_trigger pertama
            else:
                # waiting_scan tidak valid → reset
                state["waiting_scan"] = None

        # ─── Tidak ada waiting_scan (atau sudah di-reset) ────────
        start_node = None
        for node in self.nodes.values():
            if node["type"] == "device_trigger":
                cfg = node.get("config", {})
                if node_matches(cfg):
                    start_node = node
                    break

        if not start_node:
            self._log(f"No device_trigger node configured for device '{self.trigger_device}' — ignored", "#64748B")
            return self.commands

        # Isi field untuk device_trigger pertama
        field_key = start_node.get("config", {}).get("fieldKey", "")
        if field_key:
            self._set_field(field_key, self.scan_value)

        # Lanjutkan dari node berikutnya
        self._follow(self._node_outputs(start_node["id"]), "next", db)
        return self.commands

    def _execute_node(self, node_id: str, db=None):
        node = self.nodes.get(node_id)
        if not node:
            return

        ntype = node["type"]
        outputs = self._node_outputs(node_id)

        # ─── DEVICE TRIGGER: berhenti dan simpan sebagai waiting_scan ──
        if ntype == "device_trigger":
            state = RUNTIME_STATES[self.cp]
            state["waiting_scan"] = node_id
            return

        # ─── ZONE INSPECT: crop an ROI from a running camera's latest frame and
        #     run one of the vision engine's stateless inspection methods on it ──
        if ntype == "zone_inspect":
            cfg = node.get("config", {})
            camera_id = cfg.get("camera_id", "")
            method = cfg.get("method", "color_ratio")
            try:
                from vision.camera_engine import get_raw_frame
                from vision.inspection_methods import METHOD_FUNCS
            except Exception as e:
                self._log(f"Zone Inspect: vision engine unavailable ({e})", "#EF4444")
                self._follow(outputs, "false", db)
                return

            frame = get_raw_frame(camera_id)
            if frame is None:
                self._log(f"Zone Inspect: no frame for camera '{camera_id}' (not started / no frame yet)", "#EF4444")
                self._follow(outputs, "false", db)
                return

            try:
                x, y = int(cfg.get("roi_x", 0)), int(cfg.get("roi_y", 0))
                w, h = int(cfg.get("roi_w", 100)), int(cfg.get("roi_h", 100))
            except (TypeError, ValueError):
                x = y = 0
                w = h = 100
            roi = frame[max(0, y):y + h, max(0, x):x + w]

            method_func = METHOD_FUNCS.get(method)
            if not method_func:
                self._log(f"Zone Inspect: unknown method '{method}'", "#EF4444")
                self._follow(outputs, "false", db)
                return

            ok, value = method_func(roi, cfg.get("method_params", {}) or {})

            target_field = cfg.get("target_field", "")
            if target_field:
                self._set_field(target_field, str(value))
            self._log(f"Zone Inspect [{method}] camera={camera_id}: value={value} -> {'OK' if ok else 'NG'}", "#22C55E" if ok else "#EF4444")
            self._follow(outputs, "true" if ok else "false", db)
            return

        # ─── COUNT OVER TIME: sample a camera ROI for N seconds and count how many
        #     times something was detected — "Contour Blob" tracks bubbles/blobs
        #     frame-to-frame; the other methods count OK/NG transitions ──
        if ntype == "count_over_time":
            cfg = node.get("config", {})
            camera_id = cfg.get("camera_id", "")
            method = cfg.get("method", "contour_blob")
            try:
                duration = min(max(float(cfg.get("duration", 3)), 0.5), 15)
            except (TypeError, ValueError):
                duration = 3.0
            try:
                max_count = int(cfg.get("max_count", 999999))
            except (TypeError, ValueError):
                max_count = 999999

            try:
                from vision.camera_engine import get_raw_frame
            except Exception as e:
                self._log(f"Count Over Time: vision engine unavailable ({e})", "#EF4444")
                self._follow(outputs, "false", db)
                return

            if get_raw_frame(camera_id) is None:
                self._log(f"Count Over Time: no frame for camera '{camera_id}' (not started / no frame yet)", "#EF4444")
                self._follow(outputs, "false", db)
                return

            try:
                x, y = int(cfg.get("roi_x", 0)), int(cfg.get("roi_y", 0))
                w, h = int(cfg.get("roi_w", 100)), int(cfg.get("roi_h", 100))
            except (TypeError, ValueError):
                x = y = 0
                w = h = 100
            params = cfg.get("method_params", {}) or {}

            get_frame = lambda: get_raw_frame(camera_id)  # noqa: E731

            if method == "contour_blob":
                from vision.blob_counter import count_blobs_over_time
                count = count_blobs_over_time(get_frame, x, y, w, h, params, duration, camera_id=camera_id)
            else:
                from vision.inspection_methods import METHOD_FUNCS
                from vision.window_counter import count_events_over_time
                method_func = METHOD_FUNCS.get(method)
                if not method_func:
                    self._log(f"Count Over Time: unknown method '{method}'", "#EF4444")
                    self._follow(outputs, "false", db)
                    return
                count = count_events_over_time(get_frame, x, y, w, h, method_func, params, duration, camera_id=camera_id)

            target_field = cfg.get("target_field", "")
            if target_field:
                self._set_field(target_field, str(count))
            ok = count <= max_count
            self._log(f"Count Over Time [{method}] camera={camera_id}: count={count} (max {max_count}) -> {'OK' if ok else 'NG'}", "#22C55E" if ok else "#EF4444")
            self._follow(outputs, "true" if ok else "false", db)
            return

        # ─── CUSTOM SCRIPT: escape hatch for logic that doesn't fit any common node —
        #     runs user code in a restricted sandbox (see custom_script.py) ──
        if ntype == "custom_script":
            cfg = node.get("config", {})
            code = cfg.get("code", "")
            from logic_builder.custom_script import run_custom_script
            res = run_custom_script(code, self.fields, cp=self.cp)

            if not res["success"]:
                self._log(f"Custom Script error: {res['error']}", "#EF4444")
                self._follow(outputs, "false", db)
                return

            for k, v in res["fields"].items():
                self._set_field(k, str(v))
            for msg in res["logs"]:
                self._log(f"Custom Script: {msg}", "#3B82F6")

            ok = bool(res["result"])
            self._log(f"Custom Script -> {'OK' if ok else 'NG'}", "#22C55E" if ok else "#EF4444")
            self._follow(outputs, "true" if ok else "false", db)
            return

        # ─── MULTI-CONDITION GATE: AND-check several data sources.
        #     Sources supported by this node:
        #       internal_variable -> current Internal Variable value
        #       tcpip             -> live Modbus TCP value
        #       sn_list           -> value/row for a selected SN in this CP's SN List
        #       database          -> value/row for a selected SN in a MySQL table
        #
        #     Legacy conditions without source_type are treated as Internal Variable,
        #     so existing flows keep their original behavior.
        #
        #     Exists / Not Exists / Duplicate / Not Duplicate are row-level checks
        #     and therefore do not require a comparison Value.
        if ntype == "multi_condition_gate":
            cfg = node.get("config", {}) or {}
            conditions = cfg.get("conditions", []) or []

            if not conditions:
                self._log("Multi-Condition Gate: no conditions configured", "#EF4444")
                self._follow(outputs, "false", db)
                return

            race_group = str(cfg.get("race_group", "") or "").strip()
            race_state = self._race_state_for(node_id)
            if race_state and self._race_cancelled(node_id):
                return

            def _safe_identifier(value, label):
                value = str(value or "").strip()
                if not re.fullmatch(r"[A-Za-z0-9_]+", value):
                    raise ValueError(f"invalid {label} '{value}'")
                return value

            def _sn_list_lookup(cond):
                from routes.snlist import get_snlist_conn, ensure_table_exists, get_columns_from_table, get_table_name

                ensure_table_exists(self.cp)
                table = get_table_name(self.cp)
                columns = list(get_columns_from_table(self.cp) or [])
                lookup_col = "sn"
                value_col = str(cond.get("data_column", cond.get("column", "")) or "").strip()
                if lookup_col not in columns:
                    actual = next((c for c in columns if str(c).lower() == lookup_col), None)
                    if actual:
                        lookup_col = actual
                    else:
                        raise ValueError(f"SN List CP{self.cp} has no 'sn' column")
                if value_col:
                    actual_value_col = next((c for c in columns if str(c).lower() == value_col.lower()), None)
                    if not actual_value_col:
                        raise ValueError(f"SN List column '{value_col}' does not exist")
                    value_col = actual_value_col

                sn_variable = str(cond.get("sn_variable_name", "") or "").strip()
                sn_value = self._read_internal_variable(sn_variable)
                if sn_value is None:
                    raise ValueError(f"SN source Internal Variable '{sn_variable}' not found")

                qtable = '"' + str(table).replace('"', '""') + '"'
                qlookup = '"' + str(lookup_col).replace('"', '""') + '"'
                operator = str(cond.get("operator", "equals") or "equals").strip().lower()

                with get_snlist_conn() as conn:
                    if operator in ("exists", "not_exists", "duplicate", "not_duplicate"):
                        row = conn.execute(
                            f"SELECT COUNT(*) AS cnt FROM {qtable} WHERE {qlookup} = ?",
                            (str(sn_value),),
                        ).fetchone()
                        count = int(row["cnt"] if row is not None and "cnt" in row.keys() else row[0])
                        return {
                            "exists": count > 0,
                            "count": count,
                            "value": count,
                            "display": f"SN={sn_value}, count={count}",
                        }

                    if not value_col:
                        raise ValueError("SN List data column is required for this operator")

                    qvalue = '"' + str(value_col).replace('"', '""') + '"'
                    date_col = next((c for c in columns if str(c).lower() == "date_time"), None)
                    sql = f"SELECT {qvalue} AS gate_value FROM {qtable} WHERE {qlookup} = ?"
                    if date_col:
                        qdate = '"' + str(date_col).replace('"', '""') + '"'
                        sql += f" ORDER BY {qdate} DESC"
                    sql += " LIMIT 1"
                    row = conn.execute(sql, (str(sn_value),)).fetchone()
                    if not row:
                        return {"exists": False, "count": 0, "value": None, "display": f"SN={sn_value}, no row"}
                    return {
                        "exists": True,
                        "count": 1,
                        "value": row["gate_value"] if "gate_value" in row.keys() else row[0],
                        "display": f"SN={sn_value}, {value_col}",
                    }

            def _database_lookup(cond):
                if db is None:
                    raise ValueError("database is disconnected")

                table = _safe_identifier(cond.get("table_name", cond.get("source_table", "")), "database table")
                key_col = _safe_identifier(cond.get("sn_column", cond.get("target_database_column", "sn")), "database SN column")
                value_col = str(cond.get("data_column", cond.get("column", "")) or "").strip()
                operator = str(cond.get("operator", "equals") or "equals").strip().lower()

                # The DB manager/connection may be shared by concurrent Race
                # candidates and is not guaranteed to be thread-safe. Serialize
                # only the short database read; other source types can still run
                # concurrently.
                with self._db_gate_lock:
                    available = self._db_schema_cache.get(table)
                    if available is None:
                        meta = db.fetch_all(f"SHOW COLUMNS FROM `{table}`")
                        if not meta:
                            raise ValueError(f"database table '{table}' not found")
                        available = [str(r.get("Field", "")) for r in meta if isinstance(r, dict) and r.get("Field")]
                        self._db_schema_cache[table] = tuple(available)
                    else:
                        available = list(available)
                key_actual = next((c for c in available if c.lower() == key_col.lower()), None)
                if not key_actual:
                    raise ValueError(f"database SN column '{key_col}' does not exist in '{table}'")

                sn_variable = str(cond.get("sn_variable_name", "") or "").strip()
                sn_value = self._read_internal_variable(sn_variable)
                if sn_value is None:
                    raise ValueError(f"SN source Internal Variable '{sn_variable}' not found")

                if operator in ("exists", "not_exists", "duplicate", "not_duplicate"):
                    qtable = "`" + table.replace("`", "``") + "`"
                    qkey = "`" + key_actual.replace("`", "``") + "`"
                    with self._db_gate_lock:
                        row = db.fetch_one(
                            f"SELECT COUNT(*) AS cnt FROM {qtable} WHERE {qkey} = %s",
                            (str(sn_value),),
                        )
                    count = int((row or {}).get("cnt", 0))
                    return {
                        "exists": count > 0,
                        "count": count,
                        "value": count,
                        "display": f"SN={sn_value}, count={count}",
                    }

                if not value_col:
                    raise ValueError("Database data column is required for this operator")
                value_actual = next((c for c in available if c.lower() == value_col.lower()), None)
                if not value_actual:
                    raise ValueError(f"database data column '{value_col}' does not exist in '{table}'")

                qtable = "`" + table.replace("`", "``") + "`"
                qkey = "`" + key_actual.replace("`", "``") + "`"
                qvalue = "`" + value_actual.replace("`", "``") + "`"
                date_col = next((c for c in available if c.lower() == "date_time"), None)
                sql = f"SELECT {qvalue} AS gate_value FROM {qtable} WHERE {qkey} = %s"
                if date_col:
                    qdate = "`" + date_col.replace("`", "``") + "`"
                    sql += f" ORDER BY {qdate} DESC"
                sql += " LIMIT 1"
                with self._db_gate_lock:
                    row = db.fetch_one(sql, (str(sn_value),))
                if not row:
                    return {"exists": False, "count": 0, "value": None, "display": f"SN={sn_value}, no row"}
                return {
                    "exists": True,
                    "count": 1,
                    "value": row.get("gate_value"),
                    "display": f"SN={sn_value}, {value_actual}",
                }

            def _resolve_gate_condition(cond):
                source = str(cond.get("source_type", "internal_variable") or "internal_variable").strip().lower()
                operator = str(cond.get("operator", "equals") or "equals").strip().lower()

                if source == "internal_variable":
                    name = str(cond.get("variable_name", "") or "").strip()
                    value = self._read_internal_variable(name)
                    if value is None:
                        raise ValueError(f"Internal Variable '{name}' not found")
                    return {"exists": True, "count": 1, "value": value, "display": name}

                if source == "tcpip":
                    value = self._resolve_device_value({
                        "protocol": "tcp",
                        "device_name": cond.get("device_name", ""),
                        "address_type": cond.get("address_type", "holding_register"),
                        "address": cond.get("address", "0"),
                    })
                    if value == "" and operator not in ("exists", "not_exists", "duplicate", "not_duplicate"):
                        raise ValueError("TCP/IP value could not be read")
                    return {"exists": value != "", "count": 1 if value != "" else 0, "value": value,
                            "display": f"{cond.get('device_name', '?')} {cond.get('address_type', '?')}@{cond.get('address', '?')}"}

                if source == "sn_list":
                    return _sn_list_lookup(cond)

                if source == "database":
                    return _database_lookup(cond)

                raise ValueError(f"unsupported source '{source}'")

            def _condition_ok(cond, result):
                operator = str(cond.get("operator", "equals") or "equals").strip().lower()
                if operator == "exists":
                    return bool(result["exists"])
                if operator == "not_exists":
                    return not bool(result["exists"])
                if operator == "duplicate":
                    return int(result.get("count", 0)) >= 1
                if operator == "not_duplicate":
                    return int(result.get("count", 0)) == 0

                # A missing SN/database row is NG for value comparisons.
                if not result.get("exists"):
                    return False
                return self._compare_values(
                    result.get("value"),
                    operator,
                    cond.get("value", ""),
                    cond.get("value2", ""),
                )

            def check_once(log_each: bool) -> bool:
                ok_all = True
                for cond in conditions:
                    try:
                        result = _resolve_gate_condition(cond)
                        ok = _condition_ok(cond, result)
                        if log_each:
                            source = str(cond.get("source_type", "internal_variable") or "internal_variable")
                            operator = str(cond.get("operator", "equals") or "equals")
                            self._log(
                                f"Multi-Condition Gate: [{source}] {result.get('display', '')} "
                                f"({result.get('value', '')}) {operator} "
                                f"{cond.get('value', '')} -> {'OK' if ok else 'NG'}",
                                "#22C55E" if ok else "#EF4444",
                            )
                    except Exception as e:
                        ok = False
                        if log_each:
                            self._log(f"Multi-Condition Gate: {e}", "#EF4444")
                    if not ok:
                        ok_all = False
                return ok_all

            def any_condition_failed() -> bool:
                # Keep the old fail-fast behavior for Internal Variable conditions.
                # Other sources are re-evaluated normally so their state can settle.
                for cond in conditions:
                    source = str(cond.get("source_type", "internal_variable") or "internal_variable").strip().lower()
                    if source != "internal_variable":
                        continue
                    if str(self._read_internal_variable(cond.get("variable_name", "")) or "").strip().lower() == "fail":
                        return True
                return False

            wait_mode = str(cfg.get("wait_mode", "instant") or "instant").strip().lower()

            if wait_mode == "poll":
                import time
                try:
                    timeout = min(max(float(cfg.get("timeout_seconds", 10)), 0.5), 120)
                except (TypeError, ValueError):
                    timeout = 10.0
                deadline = time.monotonic() + timeout
                all_ok = False
                timed_out = False
                while True:
                    if self._race_cancelled(node_id):
                        return
                    if any_condition_failed():
                        break
                    all_ok = check_once(log_each=False)
                    if all_ok:
                        break
                    if time.monotonic() >= deadline:
                        timed_out = True
                        break
                    time.sleep(0.2)
                if not self._race_cancelled(node_id):
                    # Final read after the polling loop preserves the original
                    # behavior while avoiding a read after another Race winner
                    # has already cancelled this candidate.
                    final_ok = check_once(log_each=True)
                    all_ok = bool(all_ok or final_ok)
                if not all_ok:
                    self._log(
                        f"Multi-Condition Gate: timed out after {timeout}s waiting for all conditions"
                        if timed_out
                        else "Multi-Condition Gate: stopped early — a condition reported FAIL",
                        "#EF4444",
                    )
            elif wait_mode == "on_change":
                # ON DATA CHANGE semantics:
                #   ANY one condition/source changes -> evaluate ALL conditions.
                # The gate must NOT wait for every condition to change.
                # A condition is allowed to remain unchanged while another
                # condition changes. This is especially important for mixed
                # sources (Internal Variable + TCP/IP + SN List + Database).
                #
                # Empty string is a valid data value. It must participate in
                # the snapshot and in comparisons such as: String != Fixed Value
                # with Fixed Value = "".
                import time
                try:
                    timeout = max(float(cfg.get("change_timeout_seconds", 0)), 0.0)
                except (TypeError, ValueError):
                    timeout = 0.0

                def _snapshot():
                    snapshot = []
                    for cond in conditions:
                        try:
                            result = _resolve_gate_condition(cond)
                            # Keep type/value distinctions stable. In particular,
                            # do not turn a legitimate empty string into a
                            # missing value.
                            value = result.get("value")
                            if value is None:
                                value_key = None
                            else:
                                value_key = str(value)
                            snapshot.append((
                                bool(result.get("exists")),
                                int(result.get("count", 0) or 0),
                                value_key,
                                str(result.get("display", "")),
                            ))
                        except Exception as e:
                            snapshot.append(("error", str(e)))
                    return tuple(snapshot)

                # IMPORTANT: evaluate the current state immediately.
                # Data Change is an event mode, but a node must never wait for
                # a future change when all conditions are already satisfied at
                # the moment the node starts.
                if self._race_cancelled(node_id):
                    return
                initial_ok = check_once(log_each=True)
                if initial_ok:
                    all_ok = True
                    changed = False
                    self._log(
                        "Multi-Condition Gate: Data Change initial state MATCH -> process immediately",
                        "#22C55E",
                    )
                else:
                    baseline = _snapshot()
                    deadline = time.monotonic() + timeout if timeout > 0 else None
                    all_ok = False
                    changed = False

                    while True:
                        if self._race_cancelled(node_id):
                            return

                        # IMPORTANT: do not use any_condition_failed() here.
                        # A condition can change from FAIL -> PASS. On Data Change
                        # must detect that transition and then evaluate ALL rows.
                        current = _snapshot()

                        # ANY changed condition is enough to trigger a complete
                        # Multi-Condition evaluation. Unchanged conditions are still
                        # included by check_once().
                        if current != baseline:
                            baseline = current
                            changed = True
                            all_ok = check_once(log_each=True)
                            if all_ok:
                                break
                            # Keep waiting if this change did not make ALL
                            # conditions true. The next source change is evaluated
                            # against the newest snapshot, preventing repeated
                            # evaluation of the same change.

                        if deadline is not None and time.monotonic() >= deadline:
                            break

                        # Detector cadence only; this is NOT a decision timer.
                        time.sleep(0.02)

                if not changed and not all_ok:
                    self._log(
                        "Multi-Condition Gate: no source data change detected before timeout",
                        "#F59E0B",
                    )
            else:
                if self._race_cancelled(node_id):
                    return
                all_ok = check_once(log_each=True)

            if race_state:
                race_won = False
                race_all_failed = False
                with race_state["lock"]:
                    # Another candidate may have won while this candidate was
                    # performing its final read. Do not execute a losing branch.
                    if race_state["event"].is_set() and race_state.get("winner") != node_id:
                        return
                    race_state["active"].discard(node_id)
                    if all_ok and race_state.get("winner") is None:
                        race_state["winner"] = node_id
                        race_state["event"].set()
                        race_won = True
                    elif not all_ok and not race_state["active"] and race_state.get("winner") is None:
                        race_state["all_failed"] = True
                        race_state["event"].set()
                        race_all_failed = True

                if race_won:
                    self._log(f"Multi-Condition Race: '{node_id}' won group '{race_group}'", "#22C55E")
                    self._follow(outputs, "true", db)
                elif race_all_failed:
                    self._log(f"Multi-Condition Race: no condition matched in group '{race_group}'", "#EF4444")
                    self._follow(outputs, "false", db)
                return

            self._follow(outputs, "true" if all_ok else "false", db)
            return

        # ─── WRITE SN LIST: write one or more Internal Variables into one
        #     SN List row for this CP. date_time is generated here at execution.
        if ntype == "write_sn_list":
            cfg = node.get("config", {}) or {}
            mappings = cfg.get("mappings")
            if not isinstance(mappings, list):
                mappings = []
            mappings = [m for m in mappings if isinstance(m, dict)]

            # Backward compatibility for a single-mapping config.
            if not mappings and (cfg.get("variable_name") or cfg.get("column_key")):
                mappings = [{
                    "variable_name": cfg.get("variable_name", ""),
                    "column_key": cfg.get("column_key", ""),
                }]

            mappings = [
                m for m in mappings
                if str(m.get("variable_name", "")).strip()
                and str(m.get("column_key", "")).strip()
            ]
            if not mappings:
                self._log("Write SN List: no valid Variable → Column mapping configured", "#EF4444")
                self._follow(outputs, "next", db)
                return

            try:
                from routes.snlist import get_snlist_conn, ensure_table_exists, get_columns_from_table, get_table_name
                from datetime import datetime

                ensure_table_exists(self.cp)
                existing_cols = set(get_columns_from_table(self.cp))
                row = {}
                seen = set()

                for m in mappings:
                    variable_name = str(m.get("variable_name", "")).strip()
                    column_key = str(m.get("column_key", "")).strip()

                    if column_key in ("id", "date_time"):
                        raise ValueError(f"protected column '{column_key}' cannot be written")
                    if column_key not in existing_cols:
                        raise ValueError(f"column '{column_key}' does not exist in CP{self.cp}")
                    if column_key in seen:
                        raise ValueError(f"duplicate target column '{column_key}'")

                    value = self._read_internal_variable(variable_name)
                    if value is None:
                        raise ValueError(f"Internal Variable '{variable_name}' not found")

                    seen.add(column_key)
                    row[column_key] = str(value)

                # Always create the timestamp at the exact moment this node writes.
                row["date_time"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

                # Put date_time first; remaining fields retain the node mapping order.
                insert_cols = ["date_time"] + [c for c in row.keys() if c != "date_time"]
                table = get_table_name(self.cp)
                qtable = '"' + str(table).replace('"', '""') + '"'
                qcols = ", ".join('"' + c.replace('"', '""') + '"' for c in insert_cols)
                placeholders = ", ".join("?" for _ in insert_cols)

                with get_snlist_conn() as conn:
                    cur = conn.execute(
                        f"INSERT INTO {qtable} ({qcols}) VALUES ({placeholders})",
                        [row[c] for c in insert_cols],
                    )
                    conn.commit()
                    row_id = cur.lastrowid

                details = ", ".join(f"{m.get('variable_name')} → {m.get('column_key')}" for m in mappings)
                self._log(f"Write SN List CP{self.cp}: row {row_id} written ({details})", "#06B6D4")
            except Exception as e:
                self._log(f"Write SN List error CP{self.cp}: {e}", "#EF4444")

            self._follow(outputs, "next", db)
            return

        # ─── PARSE DATA: read TCP/IP, Internal Variable, or RS232 text, slice
        #     by character index, then save the parsed result into one Internal Variable.
        if ntype == "parse_data":
            cfg = node.get("config", {}) or {}
            try:
                results = self._execute_parse_data(cfg)
                for item in results:
                    self._log(
                        f"Parse Data #{item['index']} [{item['source_type']}]: "
                        f"'{item['source_value']}'[{item['start_index']}:{item['end_index'] or ''}] "
                        f"→ '{item['parsed']}' → Internal Variable '{item['destination']}'",
                        "#EC4899",
                    )
            except Exception as exc:
                self._log(f"Parse Data error: {exc}", "#EF4444")
            self._follow(outputs, "next", db)
            return

        # ─── WRITE OUTPUT: write resolved values to one or several targets — PLC
        #     coil/register (TCP or RTU) and/or Internal Variables — in a single
        #     node, typically chained after a check/gate node's true port. Flows
        #     saved before multi-write support have their single write's fields
        #     flattened directly onto the node config (no "writes" list); that's
        #     wrapped into a one-item list here for a uniform execution path. ──
        if ntype == "write_output":
            cfg = node.get("config", {})
            writes = cfg.get("writes")
            if not isinstance(writes, list) or not writes:
                writes = [cfg] if cfg.get("target") else []

            if not writes:
                self._log("Write Output: no writes configured", "#EF4444")
                self._follow(outputs, "next", db)
                return

            for w in writes:
                target = w.get("target", "device")
                value = self._resolve_source(
                    w.get("value_source", "static"), w,
                    static_value=w.get("value", ""), field_key=w.get("value_field_key", ""),
                )

                if target == "internal":
                    var_name = w.get("variable_name", "")
                    ok = self._write_internal_variable(var_name, value)
                    self._log(f"Write Output: internal variable '{var_name}' = {value}" if ok else f"Write Output failed: '{var_name}'", "#22C55E" if ok else "#EF4444")
                else:
                    ok = self._write_device_value(w, value)
                    self._log(f"Write Output: {w.get('device_name', '?')} {w.get('address_type', '?')}@{w.get('address', '?')} = {value}" if ok else "Write Output failed", "#22C55E" if ok else "#EF4444")

            self._follow(outputs, "next", db)
            return

        # ─── READ REFERENCE: lookup one row in the local reference.db and
        #     read one or several columns from that same row into Internal Variables.
        #     Legacy single-read fields remain supported.
        if ntype == "read_reference":
            cfg = node.get("config", {}) or {}
            source_database = str(cfg.get("source_database", "reference") or "reference").strip().lower()
            target_database_column = str(cfg.get("target_database_column", "") or "").strip()
            target_data_variable = str(cfg.get("target_data_variable", "") or "").strip()
            mappings = cfg.get("mappings")

            if isinstance(mappings, list):
                mappings = [
                    m for m in mappings
                    if isinstance(m, dict)
                    and str(m.get("source_column", "") or "").strip()
                    and str(m.get("variable_name", "") or "").strip()
                ]
            else:
                mappings = []

            # Backward compatibility with original single-read configuration.
            if not mappings:
                legacy_read_column = str(cfg.get("read_table_column", "") or "").strip()
                legacy_destination = str(cfg.get("destination_internal_variable", "") or "").strip()
                if legacy_read_column and legacy_destination:
                    mappings = [{
                        "source_column": legacy_read_column,
                        "variable_name": legacy_destination,
                    }]

            if source_database != "reference":
                self._log("Read Reference: source database must be 'reference'", "#EF4444")
                self._follow(outputs, "next", db)
                return

            if not target_database_column or not target_data_variable or not mappings:
                self._log(
                    "Read Reference: Target Column, Target Data, and at least one READ mapping must be configured",
                    "#EF4444",
                )
                self._follow(outputs, "next", db)
                return

            if not re.fullmatch(r"[A-Za-z0-9_]+", target_database_column):
                self._log("Read Reference: invalid Reference DB target column name", "#EF4444")
                self._follow(outputs, "next", db)
                return

            seen_columns = set()
            seen_destinations = set()
            for m in mappings:
                source_column = str(m["source_column"]).strip()
                destination = str(m["variable_name"]).strip()
                if not re.fullmatch(r"[A-Za-z0-9_]+", source_column):
                    self._log(f"Read Reference: invalid READ column '{source_column}'", "#EF4444")
                    self._follow(outputs, "next", db)
                    return
                if source_column.lower() in seen_columns:
                    self._log(f"Read Reference: duplicate READ column '{source_column}'", "#EF4444")
                    self._follow(outputs, "next", db)
                    return
                if destination.lower() in seen_destinations:
                    self._log(f"Read Reference: duplicate destination Internal Variable '{destination}'", "#EF4444")
                    self._follow(outputs, "next", db)
                    return
                seen_columns.add(source_column.lower())
                seen_destinations.add(destination.lower())

            lookup_value = self._read_internal_variable(target_data_variable)
            if lookup_value is None:
                self._log(f"Read Reference: Internal Variable '{target_data_variable}' not found", "#EF4444")
                self._follow(outputs, "next", db)
                return

            reference_db_path = os.path.join(DATA_DIR, "reference.db")
            try:
                with sqlite3.connect(reference_db_path) as refdb:
                    refdb.row_factory = sqlite3.Row
                    table_row = refdb.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                        ("reference_master",),
                    ).fetchone()
                    if not table_row:
                        raise ValueError("reference_master table does not exist in reference.db")

                    meta = refdb.execute("PRAGMA table_info(reference_master)").fetchall()
                    available_columns = {str(r[1]) for r in meta if len(r) > 1}
                    target_column = next(
                        (c for c in available_columns if c.lower() == target_database_column.lower()),
                        None,
                    )
                    if not target_column:
                        raise ValueError(
                            f"target column '{target_database_column}' does not exist in reference_master"
                        )

                    read_columns = []
                    for m in mappings:
                        requested = str(m["source_column"]).strip()
                        actual = next(
                            (c for c in available_columns if c.lower() == requested.lower()),
                            None,
                        )
                        if not actual:
                            raise ValueError(
                                f"read column '{requested}' does not exist in reference_master"
                            )
                        read_columns.append((actual, str(m["variable_name"]).strip()))

                    q_target = '"' + target_column.replace('"', '""') + '"'
                    select_parts = []
                    for idx, (actual, _) in enumerate(read_columns):
                        q_read = '"' + actual.replace('"', '""') + '"'
                        select_parts.append(f"{q_read} AS _read_{idx}")

                    row = refdb.execute(
                        f"SELECT {', '.join(select_parts)} FROM reference_master "
                        f"WHERE CAST({q_target} AS TEXT) = CAST(? AS TEXT) COLLATE NOCASE LIMIT 1",
                        (str(lookup_value),),
                    ).fetchone()

                    if row is None:
                        raise ValueError(
                            f"no reference row found where {target_column}='{lookup_value}'"
                        )

                    results = []
                    for idx, (actual, destination) in enumerate(read_columns):
                        result_value = row[f"_read_{idx}"]
                        if result_value is None:
                            result_value = ""
                        results.append((actual, destination, result_value))

                # Write only after the lookup and all requested columns have succeeded.
                for actual, destination, result_value in results:
                    if not self._write_internal_variable(destination, result_value):
                        raise ValueError(
                            f"failed to write Internal Variable '{destination}'"
                        )

                summary = "; ".join(
                    f"{actual}='{value}' → {destination}"
                    for actual, destination, value in results
                )
                self._log(
                    f"Read Reference: reference.{target_column}='{lookup_value}' → {summary}",
                    "#A855F7",
                )
            except Exception as e:
                self._log(f"Read Reference error: {e}", "#EF4444")

            self._follow(outputs, "next", db)
            return

        # ─── READ SN DATABASE: read one MySQL row by `sn` and write selected
        #     database columns into Internal Variables. This node is deliberately
        #     separate from Write SN Database.
        if ntype == "read_sn_database":
            cfg = node.get("config", {}) or {}
            source_table = str(cfg.get("source_table", "") or "").strip()
            target_database_column = str(
                cfg.get("target_database_column", "sn") or "sn"
            ).strip()
            target_data_source = str(
                cfg.get("target_data_source", "internal_variable") or "internal_variable"
            ).strip().lower()
            target_internal_variable = str(
                cfg.get("target_internal_variable", "") or ""
            ).strip()
            mappings = cfg.get("mappings")

            if not source_table:
                self._log("Read SN Database: source database table is not configured", "#EF4444")
                self._follow(outputs, "next", db)
                return

            if not target_database_column:
                self._log("Read SN Database: target database column is not configured", "#EF4444")
                self._follow(outputs, "next", db)
                return

            if target_data_source != "internal_variable":
                self._log(
                    "Read SN Database: TARGET DATA must be Internal Variable",
                    "#EF4444",
                )
                self._follow(outputs, "next", db)
                return

            if not target_internal_variable:
                self._log(
                    "Read SN Database: target Internal Variable is not configured",
                    "#EF4444",
                )
                self._follow(outputs, "next", db)
                return

            if not isinstance(mappings, list):
                mappings = []

            mappings = [
                m for m in mappings
                if isinstance(m, dict)
                and str(m.get("source_column", "")).strip()
                and str(m.get("variable_name", "")).strip()
            ]

            if not mappings:
                self._log(
                    "Read SN Database: no valid Database Column → Internal Variable mapping configured",
                    "#EF4444",
                )
                self._follow(outputs, "next", db)
                return

            try:
                if db is None:
                    raise ValueError("database is disconnected")

                # Table/column identifiers cannot be bound as SQL parameters,
                # so validate them strictly before interpolation.
                if not re.fullmatch(r"[A-Za-z0-9_]+", source_table):
                    raise ValueError(f"invalid source database table name '{source_table}'")

                source_columns = []
                destination_variables = []
                seen_columns = set()
                seen_variables = set()

                for m in mappings:
                    source_column = str(m.get("source_column", "")).strip()
                    variable_name = str(m.get("variable_name", "")).strip()

                    if not re.fullmatch(r"[A-Za-z0-9_]+", source_column):
                        raise ValueError(f"invalid source database column '{source_column}'")

                    if source_column.lower() == "sn":
                        raise ValueError("source column 'sn' is the lookup key; choose another column to read")

                    if source_column.lower() in seen_columns:
                        raise ValueError(f"duplicate source database column '{source_column}'")

                    if variable_name.lower() in seen_variables:
                        raise ValueError(f"duplicate destination Internal Variable '{variable_name}'")

                    seen_columns.add(source_column.lower())
                    seen_variables.add(variable_name.lower())
                    source_columns.append(source_column)
                    destination_variables.append(variable_name)

                # Validate that the configured table and source columns exist.
                meta = db.fetch_all(f"SHOW COLUMNS FROM `{source_table}`")
                if not meta:
                    raise ValueError(
                        f"source MySQL table '{source_table}' not found or database is disconnected"
                    )

                available_columns = {
                    str(row.get("Field", ""))
                    for row in meta
                    if isinstance(row, dict) and row.get("Field")
                }

                # Target Database Column is configurable (e.g. sn, carrier, etc.).
                # Resolve its actual spelling case-insensitively.
                target_column = next(
                    (
                        c for c in available_columns
                        if c.lower() == target_database_column.lower()
                    ),
                    None,
                )
                if not target_column:
                    raise ValueError(
                        f"target database column '{target_database_column}' does not exist in '{source_table}'"
                    )

                for source_column in source_columns:
                    if source_column not in available_columns:
                        raise ValueError(
                            f"source database column '{source_column}' does not exist in '{source_table}'"
                        )

                # Check every destination Internal Variable before changing
                # anything, so a bad mapping cannot leave a partial result.
                from routes.internal_variable import _connect
                with _connect() as iv_conn:
                    iv_rows = {}
                    for variable_name in destination_variables:
                        iv_row = iv_conn.execute(
                            """SELECT id, name, data_type
                               FROM internal_variables
                               WHERE name = ? COLLATE NOCASE""",
                            (variable_name,),
                        ).fetchone()

                        if iv_row is None:
                            raise ValueError(
                                f"Internal Variable '{variable_name}' not found"
                            )

                        if str(iv_row["data_type"] or "").strip().lower() == "system":
                            raise ValueError(
                                f"Internal Variable '{variable_name}' is System and cannot be written"
                            )

                        iv_rows[variable_name.lower()] = iv_row

                target_value = self._read_internal_variable(target_internal_variable)
                if target_value is None:
                    raise ValueError(
                        f"Internal Variable '{target_internal_variable}' not found"
                    )

                q_table = "`" + source_table.replace("`", "``") + "`"
                q_target = "`" + target_column.replace("`", "``") + "`"
                q_cols = ", ".join(
                    "`" + col.replace("`", "``") + "`"
                    for col in source_columns
                )

                # date_time is optional.
                # - If the table has date_time, duplicate target values use the newest row.
                # - If the table has no date_time (for example master_table), do not fail;
                #   simply return one matching row.
                date_time_column = next(
                    (c for c in available_columns if c.lower() == "date_time"),
                    None,
                )

                sql = (
                    f"SELECT {q_cols} FROM {q_table} "
                    f"WHERE {q_target} = %s "
                )
                if date_time_column:
                    q_date_time = "`" + date_time_column.replace("`", "``") + "`"
                    sql += f"ORDER BY {q_date_time} DESC LIMIT 1"
                else:
                    # No date_time: table is treated as a simple lookup table.
                    sql += "LIMIT 1"
                row = db.fetch_one(sql, (str(target_value),))

                if not row:
                    self._log(
                        f"Read SN Database: {target_database_column} '{target_value}' not found in table '{source_table}'",
                        "#EF4444",
                    )
                    self._follow(outputs, "next", db)
                    return

                # Only write after the row has been found and all mappings
                # have been validated.
                for source_column, variable_name in zip(
                    source_columns, destination_variables
                ):
                    value = row.get(source_column, "")
                    if value is None:
                        value = ""

                    ok = self._write_internal_variable(variable_name, value)

                    self._log(
                        (
                            f"Read SN Database: '{source_table}' "
                            f"{target_database_column} '{target_value}' {source_column} → "
                            f"{variable_name} = {value}"
                        )
                        if ok
                        else f"Read SN Database failed: '{variable_name}'",
                        "#A855F7" if ok else "#EF4444",
                    )

            except Exception as e:
                self._log(f"Read SN Database error CP{self.cp}: {e}", "#EF4444")

            self._follow(outputs, "next", db)
            return

        # ─── WRITE SN DATABASE: Fresh/New Data or Update existing data.
        #     New mode: ONLY SN List -> MySQL mappings.
        #     Update mode: target Primary Key comes from an Internal Variable;
        #     mapped values can come from Internal Variable or Fixed Value.
        if ntype == "write_sn_database":
            cfg = node.get("config", {}) or {}
            mappings = cfg.get("mappings")
            if not isinstance(mappings, list):
                mappings = cfg.get("db_mappings")
            if not isinstance(mappings, list):
                mappings = []
            mappings = [m for m in mappings if isinstance(m, dict)]

            destination_table = str(
                cfg.get("destination_table", cfg.get("table_name", "")) or ""
            ).strip()
            write_mode = str(cfg.get("write_mode", "new") or "new").strip().lower()
            if write_mode not in ("new", "update"):
                write_mode = "new"

            mappings = [m for m in mappings if str(m.get("destination_column", "")).strip()]

            if not destination_table:
                self._log("Write SN Database: destination database table is not configured", "#EF4444")
                self._follow(outputs, "next", db)
                return
            if not mappings:
                self._log("Write SN Database: no valid mapping configured", "#EF4444")
                self._follow(outputs, "next", db)
                return

            try:
                from routes.snlist import get_snlist_conn, get_table_name
                import re as _re

                if not db:
                    raise ValueError("MySQL database connection is not available")
                if not _re.fullmatch(r"[A-Za-z0-9_]+", destination_table):
                    raise ValueError("invalid destination database table name")

                dest_meta = db.fetch_all(f"SHOW COLUMNS FROM `{destination_table}`")
                if not dest_meta:
                    raise ValueError(
                        f"destination MySQL table '{destination_table}' not found or database is disconnected"
                    )
                dest_columns = {str(r.get("Field", "")) for r in dest_meta if isinstance(r, dict)}

                target_primary_key_column = str(
                    cfg.get("target_primary_key_column", "sn") or "sn"
                ).strip()
                if not _re.fullmatch(r"[A-Za-z0-9_]+", target_primary_key_column):
                    raise ValueError("invalid target Primary Key database column")
                if target_primary_key_column not in dest_columns:
                    raise ValueError(
                        f"target Primary Key database column '{target_primary_key_column}' does not exist in MySQL table '{destination_table}'"
                    )

                # ==============================================================
                # FRESH / NEW DATA
                # ONLY SN LIST is allowed as the source.
                # ==============================================================
                if write_mode == "new":
                    source_table = str(get_table_name(self.cp))
                    q_source_table = '"' + source_table.replace('"', '""') + '"'
                    with get_snlist_conn() as sn_conn:
                        source_row = sn_conn.execute(
                            f"SELECT * FROM {q_source_table} ORDER BY id DESC LIMIT 1"
                        ).fetchone()
                    if source_row is None:
                        raise ValueError(f"SN List CP{self.cp} has no row to send")

                    insert_columns = []
                    insert_values = []
                    seen = set()
                    details = []
                    for m in mappings:
                        source_type = str(m.get("source_type", "sn_list") or "sn_list").strip().lower()
                        destination_column = str(m.get("destination_column", "")).strip()
                        source_column = str(m.get("source_column", "")).strip()

                        if source_type not in ("sn_list", "", "none"):
                            raise ValueError(
                                "Fresh/New Data only supports Source = SN List; Fixed Value/Internal Variable are not allowed"
                            )
                        if not source_column:
                            raise ValueError(
                                f"SN List source column is not configured for destination '{destination_column}'"
                            )
                        if source_column == "id":
                            raise ValueError("source column 'id' cannot be copied")
                        if source_column not in source_row.keys():
                            raise ValueError(f"SN List source column '{source_column}' does not exist")
                        if destination_column not in dest_columns:
                            raise ValueError(
                                f"destination MySQL column '{destination_column}' does not exist"
                            )
                        if destination_column in seen:
                            raise ValueError(f"duplicate destination MySQL column '{destination_column}'")

                        seen.add(destination_column)
                        insert_columns.append(destination_column)
                        insert_values.append(source_row[source_column])
                        details.append(f"{source_column} → {destination_column}")

                    if target_primary_key_column not in insert_columns:
                        raise ValueError(
                            f"Fresh/New Data requires an SN List mapping to destination Primary Key column '{target_primary_key_column}'"
                        )

                    q_table = "`" + destination_table.replace("`", "``") + "`"
                    q_cols = ", ".join("`" + c.replace("`", "``") + "`" for c in insert_columns)
                    placeholders = ", ".join(["%s"] * len(insert_columns))
                    sql = f"INSERT INTO {q_table} ({q_cols}) VALUES ({placeholders})"
                    affected = db.execute(sql, insert_values)
                    if affected <= 0:
                        raise ValueError("MySQL INSERT returned 0 affected rows")

                    self._log(
                        f"Write SN Database CP{self.cp}: Fresh/New Data → MySQL '{destination_table}' ({', '.join(details)})",
                        "#0EA5E9",
                    )

                # ==============================================================
                # UPDATE DATA
                # Target DATABASE COLUMN is the key column (e.g. sn).
                # Target KEY VALUE is read from the selected Internal Variable.
                # Mappings can only use Internal Variable or Fixed Value.
                # ==============================================================
                else:
                    # Support both the current Builder key and legacy aliases so
                    # an existing saved flow is not broken by this feature update.
                    target_variable = str(
                        cfg.get("target_primary_key_variable")
                        or cfg.get("update_target_variable")
                        or cfg.get("target_internal_variable")
                        or ""
                    ).strip()
                    if not target_variable:
                        raise ValueError("Update Data requires Primary Key Value → Internal Variable")

                    target_value = self._read_internal_variable(target_variable)
                    if target_value is None or str(target_value).strip() == "":
                        raise ValueError(
                            f"Primary Key value from Internal Variable '{target_variable}' is empty or not found"
                        )
                    target_value = str(target_value).strip()

                    self._log(
                        f"[MYSQL] Update Data target: table={destination_table}, "
                        f"column={target_primary_key_column}, variable={target_variable}, value={target_value}",
                        "#8B5CF6",
                    )

                    update_columns = []
                    update_values = []
                    seen = set()
                    details = []

                    for m in mappings:
                        source_type = str(
                            m.get("source_type", "internal_variable") or "internal_variable"
                        ).strip().lower()
                        destination_column = str(m.get("destination_column", "")).strip()
                        if not destination_column:
                            continue

                        if destination_column.lower() == target_primary_key_column.lower():
                            raise ValueError(
                                f"Update Data cannot update Primary Key column '{target_primary_key_column}'"
                            )
                        if destination_column not in dest_columns:
                            raise ValueError(
                                f"destination MySQL column '{destination_column}' does not exist"
                            )
                        if destination_column in seen:
                            raise ValueError(f"duplicate destination MySQL column '{destination_column}'")

                        if source_type in ("fixed", "fixed_value", "value"):
                            # Current Builder uses value; fixed_value is kept for
                            # compatibility with previously saved configurations.
                            value = m.get("value", m.get("fixed_value", ""))
                            details.append(f"Fixed Value '{value}' → {destination_column}")
                        elif source_type in ("internal_variable", "internal"):
                            variable_name = str(
                                m.get("variable_name")
                                or m.get("source_variable")
                                or ""
                            ).strip()
                            if not variable_name:
                                raise ValueError(
                                    f"Internal Variable source is not configured for destination '{destination_column}'"
                                )
                            value = self._read_internal_variable(variable_name)
                            if value is None:
                                raise ValueError(f"Internal Variable '{variable_name}' not found")
                            details.append(f"{variable_name} → {destination_column}")
                        else:
                            raise ValueError(
                                "Update Data source must be Internal Variable or Fixed Value"
                            )

                        seen.add(destination_column)
                        update_columns.append(destination_column)
                        update_values.append(value)

                    if not update_columns:
                        raise ValueError("Update Data has no valid database mappings")

                    q_table = "`" + destination_table.replace("`", "``") + "`"
                    q_key = "`" + target_primary_key_column.replace("`", "``") + "`"
                    assignments = ", ".join(
                        "`" + c.replace("`", "``") + "` = %s" for c in update_columns
                    )

                    # Confirm the target row exists before updating it. This also
                    # distinguishes 'row not found' from MySQL rowcount=0 because
                    # the new value is identical to the old value.
                    check_sql = f"SELECT 1 AS _exists FROM {q_table} WHERE {q_key} = %s LIMIT 1"
                    existing = db.fetch_one(check_sql, (target_value,))
                    if not existing:
                        raise ValueError(
                            f"Primary Key value '{target_value}' was not found in MySQL table "
                            f"'{destination_table}' column '{target_primary_key_column}'"
                        )

                    self._log(
                        f"[MYSQL] UPDATE {destination_table}: "
                        f"WHERE {target_primary_key_column}='{target_value}' "
                        f"SET {dict(zip(update_columns, update_values))}",
                        "#8B5CF6",
                    )

                    sql = f"UPDATE {q_table} SET {assignments} WHERE {q_key} = %s"
                    params = update_values + [target_value]

                    # Do not use DatabaseManager.execute() here because the
                    # original helper catches SQL exceptions and returns 0.
                    # Execute directly on the same live MySQL connection so any
                    # real MySQL error is visible and the transaction is committed.
                    if not db.is_connected() and not db.connect():
                        raise RuntimeError("MySQL connection unavailable")
                    conn = getattr(db, "conn", None)
                    if conn is None:
                        raise RuntimeError("MySQL connection object unavailable")

                    cursor = conn.cursor()
                    try:
                        cursor.execute(sql, params)
                        conn.commit()
                        affected = cursor.rowcount
                    except Exception:
                        try:
                            conn.rollback()
                        except Exception:
                            pass
                        raise
                    finally:
                        cursor.close()

                    self._log(
                        f"[MYSQL] UPDATE affected rows = {affected}",
                        "#0EA5E9",
                    )

                    # Read the row back after commit so the operation is verified,
                    # not merely assumed successful.
                    verify_sql = f"SELECT * FROM {q_table} WHERE {q_key} = %s LIMIT 1"
                    verified = db.fetch_one(verify_sql, (target_value,))
                    if not verified:
                        raise ValueError("UPDATE committed but target row could not be read back")

                    mismatches = []
                    for col, wanted in zip(update_columns, update_values):
                        actual = verified.get(col)
                        if str(actual if actual is not None else "") != str(wanted if wanted is not None else ""):
                            mismatches.append(f"{col}: expected={wanted!r}, actual={actual!r}")
                    if mismatches:
                        raise ValueError(
                            "UPDATE did not persist: " + "; ".join(mismatches)
                        )

                    self._log(
                        f"Write SN Database CP{self.cp}: Update Data VERIFIED → "
                        f"'{destination_table}' WHERE {target_primary_key_column}='{target_value}' "
                        f"({', '.join(details)})",
                        "#22C55E",
                    )

            except Exception as e:
                self._log(f"Write SN Database error CP{self.cp}: {e}", "#EF4444")

            self._follow(outputs, "next", db)
            return

        # ─── TIMER: pause execution for a fixed duration, then continue — plain
        #     fire-and-forget delay, distinct from Multi-Condition Gate's "Wait
        #     Until Match" (which polls a condition, not a fixed clock). ──
        if ntype == "timer":
            cfg = node.get("config", {})
            try:
                duration = min(max(float(cfg.get("duration_seconds", 1)), 0), 120)
            except (TypeError, ValueError):
                duration = 1.0
            import time
            time.sleep(duration)
            self._log(f"Timer: waited {duration}s", "#3B82F6")
            self._follow(outputs, "next", db)
            return

        # ─── RESET: put one or several Internal Variables (or PLC coils/registers)
        #     back to their idle default — e.g. a trigger flag a Write Output set
        #     to fire a test needs to drop back down before the next cycle can
        #     raise it again (Device Trigger / Specification trigger both fire on
        #     a RISING edge, so a flag stuck "on" never fires a second time). "all"
        #     mode resets every Internal Variable app-wide; it deliberately never
        #     touches PLC devices — that would be reaching into hardware state well
        #     beyond what this flow declared it owns. ──
        if ntype == "reset_node":
            cfg = node.get("config", {})
            mode = cfg.get("mode", "selected")
            if mode == "all":
                count = self._reset_all_internal_variables()
                self._log(f"Reset: {count} internal variable(s) reset to default", "#3B82F6")
            elif mode == "group":
                group_name = cfg.get("group_name", "")
                if not group_name:
                    self._log("Reset: no group selected", "#EF4444")
                else:
                    count = self._reset_internal_variables_by_group(group_name)
                    self._log(f"Reset: {count} Internal Variable(s) used by Logic Builder Group '{group_name}' reset to default", "#3B82F6")
            else:
                targets = cfg.get("targets", []) or []
                if not targets:
                    self._log("Reset: no targets configured", "#EF4444")
                for t in targets:
                    if t.get("kind", "internal") == "internal":
                        var_name = t.get("variable_name", "")
                        ok = self._reset_internal_variable(var_name)
                        self._log(f"Reset: internal variable '{var_name}' -> default" if ok else f"Reset failed: '{var_name}'", "#3B82F6" if ok else "#EF4444")
                    else:
                        ok = self._write_device_value(t, "0")
                        self._log(f"Reset: {t.get('device_name', '?')} {t.get('address_type', '?')}@{t.get('address', '?')} -> 0" if ok else "Reset failed", "#3B82F6" if ok else "#EF4444")
            self._follow(outputs, "next", db)
            return

        # ─── GROUP INPUT: the Group's entry point (it never has an incoming
        #     connection so _flatten_flow's entry-point detection finds it
        #     naturally). Optionally also reads one value — from an Internal
        #     Variable or a PLC register — into a field key, the same way a
        #     Device Trigger can, so nodes further inside the Group have data to
        #     work with right from the start. ──
        if ntype == "group_input":
            cfg = node.get("config", {})
            read_source = cfg.get("read_source", "none")
            if read_source in ("internal", "device"):
                value = self._read_internal_variable(cfg.get("variable_name", "")) if read_source == "internal" else self._resolve_device_value(cfg)
                field_key = cfg.get("field_key", "")
                if field_key:
                    self._set_field(field_key, value if value is not None else "")
            self._follow(outputs, "next", db)
            return

        # ─── GROUP OUTPUT: an exit point of the Group — its configured port
        #     ("next"/"true"/"false") is exactly what _flatten_flow bridges out to
        #     the Group node's same-named outer port. Optionally also writes one
        #     value — to an Internal Variable or a PLC register — on its way out,
        #     the same way a Write Output node would. ──
        if ntype == "group_output":
            cfg = node.get("config", {})
            write_target = cfg.get("write_target", "none")
            if write_target in ("internal", "device"):
                value = self._resolve_source(
                    cfg.get("value_source", "static"), cfg,
                    static_value=cfg.get("value", ""), field_key=cfg.get("value_field_key", ""),
                )
                if write_target == "internal":
                    var_name = cfg.get("variable_name", "")
                    ok = self._write_internal_variable(var_name, value)
                    self._log(f"Group Output: internal variable '{var_name}' = {value}" if ok else f"Group Output failed: '{var_name}'", "#22C55E" if ok else "#EF4444")
                else:
                    ok = self._write_device_value(cfg, value)
                    self._log(f"Group Output: {cfg.get('device_name', '?')} {cfg.get('address_type', '?')}@{cfg.get('address', '?')} = {value}" if ok else "Group Output failed", "#22C55E" if ok else "#EF4444")
            self._follow(outputs, cfg.get("port", "next"), db)
            return

        # ─── (node type lain yang belum dibuat — tambahkan di sini
        #      satu per satu, `if ntype == "...": ... self._follow(outputs, "next", db); return`) ──
        self._log(f"Node type '{ntype}' is not implemented yet", "#EF4444")


# ─── SETTINGS SCHEMA ─────────────────────────────────────────────
@logic_engine_bp.get("/api/settings-schema")
def get_settings_schema():
    settings = _load_settings()
    sections = []
    section_fields = {}
    tables = []
    table_columns = {}

    for key, val in settings.items():
        if isinstance(val, dict):
            sections.append(key)
            section_fields[key] = [k for k in val.keys() if k != "_table"]
            if "_table" in val and isinstance(val["_table"], list) and len(val["_table"]) > 0:
                tables.append(key)
                table_columns[key] = list(val["_table"][0].keys())

    return jsonify({
        "sections": sections,
        "section_fields": section_fields,
        "tables": tables,
        "table_columns": table_columns
    })


# ─── RUN LOGIC ENDPOINT ──────────────────────────────────────────
@logic_engine_bp.post("/api/logic-run/<cp>")
def run_logic(cp):
    from db_manager import db
    body = request.get_json() or {}
    device = body.get("device", "")
    value = body.get("value", "")
    fields = body.get("fields", {})

    if not device or not value:
        return jsonify({"success": False, "commands": [], "message": "device and value required"}), 400

    try:
        executor = FlowExecutor(cp, fields, device, value)
        commands = executor.run(db=db)
        return jsonify({"success": True, "commands": commands, "fields": executor.fields})
    except Exception as e:
        print(f"[LOGIC ENGINE] Run error CP{cp}:", e)
        return jsonify({"success": False, "commands": [], "message": f"Logic engine error: {e}"}), 500


# ─── CUSTOM SCRIPT CHECK ENDPOINT — dry-run a script's code without a full
#     flow run (no camera/device needed), for the node's "Check" button ────
@logic_engine_bp.post("/api/logic-builder/custom-script/check")
def check_custom_script():
    from logic_builder.custom_script import run_custom_script
    body = request.get_json() or {}
    code = body.get("code", "")
    fields = body.get("fields", {}) or {}
    result = run_custom_script(code, fields)
    return jsonify(result)


# ─── RESET STATE ENDPOINT (opsional) ─────────────────────────────
@logic_engine_bp.post("/api/logic-reset/<cp>")
def reset_logic_state(cp):
    if cp in RUNTIME_STATES:
        RUNTIME_STATES[cp] = {"waiting_scan": None}
    return jsonify({"success": True})


# ─── PYTHON CODE GENERATOR ──────────────────────────────────────
def generate_python_logic(cp: str, nodes: list, connections: list):
    os.makedirs(PAGES_DIR, exist_ok=True)
    path = os.path.join(PAGES_DIR, f"cp{cp}.py")
    conn_map = {}
    for c in connections:
        if c["fromId"] not in conn_map:
            conn_map[c["fromId"]] = {}
        conn_map[c["fromId"]][c["fromPort"]] = c["toId"]

    lines = [
        f"# AUTO-GENERATED by Logic Builder — CP{cp}",
        f"# Generated: {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "# DO NOT EDIT — regenerate from Logic Builder",
        "",
        "from logic_builder.logic_engine import FlowExecutor",
        f"CP_NUMBER='{cp}'",
        "",
        "def handle_scan(device,value,fields,db=None):",
        "    executor=FlowExecutor(CP_NUMBER,fields,device,value)",
        "    return executor.run(db=db)",
        "",
        "# ── Flow summary ─────────────────────────────────────────────"
    ]
    for node in nodes:
        lines.append(f"# [{node['type'].upper()}] id={node['id']} config={json.dumps(node.get('config', {}))}")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"[LOGIC ENGINE] Generated {path}")