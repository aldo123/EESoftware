import os
import json
import re
from flask import Blueprint, request, jsonify

logic_engine_bp = Blueprint("logic_engine", __name__)

BASE_DIR      = os.path.dirname(os.path.dirname(__file__))
DATA_DIR      = os.path.join(BASE_DIR, "data")
PAGES_DIR     = os.path.join(BASE_DIR, "pages")
TEMPLATES_DIR = os.path.join(DATA_DIR, "logic_templates")

# Node types with true/false branch outputs, used when flattening Group (subflow_call)
# nodes. Add a type here whenever a new check-style node is built.
CHECK_NODE_TYPES = {"zone_inspect", "count_over_time", "custom_script"}
MAX_SUBFLOW_DEPTH = 8

# ─── Runtime State per CP ──────────────────────────────────────────
RUNTIME_STATES = {}  # { cp: {"waiting_scan": node_id or None} }

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
    return ["next"]


def _flatten_flow(nodes: list, connections: list, depth: int = 0) -> tuple[dict, list]:
    """Inline every 'subflow_call' (Group) node with the contents of the template it
    references, so the executor never needs to know Groups exist. A template's entry
    point is whichever of its nodes has no incoming connection; any of its output ports
    left unconnected falls through to whatever came after the Group node in the outer
    flow. Recurses so Groups can contain Groups, bounded by MAX_SUBFLOW_DEPTH."""
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
        # A Group's "next" port can itself fan out to several downstream nodes — keep them all.
        bridge_targets = [c["toId"] for c in conns if c.get("fromId") == call_id and c.get("fromPort") == "next"]

        del node_map[call_id]
        conns = [c for c in conns if c.get("fromId") != call_id and c.get("toId") != call_id]

        if not t_nodes:
            for c in outer_incoming:
                for i, target in enumerate(bridge_targets):
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
        # the rest.
        entry_ids = sorted(set(remapped_nodes.keys()) - {c["toId"] for c in remapped_conns}) or [next(iter(remapped_nodes))]
        for c in outer_incoming:
            for i, eid in enumerate(entry_ids):
                conns.append({**c, "id": f"{c.get('id', 'c')}__entry{i}", "toId": eid})

        used_out_ports = {(c["fromId"], c["fromPort"]) for c in remapped_conns}
        for nid, n in remapped_nodes.items():
            for port in _node_output_ports(n):
                if (nid, port) not in used_out_ports:
                    for i, target in enumerate(bridge_targets):
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

        if self.cp not in RUNTIME_STATES:
            RUNTIME_STATES[self.cp] = {"waiting_scan": None}

    def _node_outputs(self, node_id: str) -> dict:
        """port -> list of target node ids. A single port can fan out to multiple targets."""
        result = {}
        for conn in self.connections:
            if conn["fromId"] == node_id:
                result.setdefault(conn["fromPort"], []).append(conn["toId"])
        return result

    def _follow(self, outputs: dict, port: str, db=None):
        """Execute every node connected to the given output port (fan-out)."""
        for next_id in outputs.get(port, []):
            self._execute_node(next_id, db)

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
        """Resolve a value that can come from a static string, a field key, or a live
        device register — the three source kinds every 'source' dropdown offers."""
        if source == "field_key":
            return self._get_field(field_key)
        if source == "device":
            return self._resolve_device_value(cfg, device_prefix)
        return static_value

    def _set_field(self, key: str, value: str):
        self.fields[key] = value
        self.commands.append({"cmd": "set_field", "key": key, "value": value})

    def _log(self, message: str, color: str = "#22C55E"):
        self.commands.append({"cmd": "log", "message": message, "color": color})

    def _instruction(self, text: str, color: str = "blue", widget: str = ""):
        self.commands.append({"cmd": "set_instruction", "widget": widget, "text": text, "color": color})

    def _reject(self, reason: str):
        self.commands.append({"cmd": "reject", "reason": reason})

    def _evaluate_condition(self, cond: dict) -> bool:
        """Generic left-op-right evaluator, shared by any future check/gate node."""
        operator = cond.get("operator", "equals")
        field_source = cond.get("field_source", "field_key")
        left = self._resolve_device_value(cond, "field_") if field_source == "device" else self._get_field(cond.get("field", ""))
        right = self._resolve_source(cond.get("compare_source", "static"), cond, static_value=cond.get("value", ""), field_key=cond.get("value_source", ""), device_prefix="value_")
        try:
            if operator in ("greater_than", "less_than", "greater_equal", "less_equal"):
                l_num, r_num = float(left), float(right)
                if operator == "greater_than":
                    return l_num > r_num
                if operator == "less_than":
                    return l_num < r_num
                if operator == "greater_equal":
                    return l_num >= r_num
                return l_num <= r_num
            if operator == "equals":
                return str(left) == str(right)
            if operator == "not_equals":
                return str(left) != str(right)
            if operator == "contains":
                return str(right) in str(left)
        except (ValueError, TypeError):
            return False
        return False

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
        from logic_builder.device_poller import trigger_key

        state = RUNTIME_STATES[self.cp]
        waiting = state["waiting_scan"]

        # ─── Jika ada waiting_scan, coba proses ──────────────────
        if waiting:
            node = self.nodes.get(waiting)
            if node and node["type"] == "device_trigger":
                cfg = node.get("config", {})
                if trigger_key(cfg) == self.trigger_device:
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
                if trigger_key(cfg) == self.trigger_device:
                    start_node = node
                    break

        if not start_node:
            self._log(f"No device_trigger node found for device '{self.trigger_device}'", "#EF4444")
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
