import os
import json
import re
from datetime import datetime
from flask import Blueprint, request, jsonify

logic_engine_bp = Blueprint("logic_engine", __name__)

BASE_DIR  = os.path.dirname(os.path.dirname(__file__))
DATA_DIR  = os.path.join(BASE_DIR, "data")
PAGES_DIR = os.path.join(BASE_DIR, "pages")

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


def _parse_range(spec: str) -> tuple[int, int] | None:
    if not spec:
        return None
    m = re.match(r"(\d+)-(\d+)", str(spec).strip())
    if m:
        start = int(m.group(1)) - 1
        end   = int(m.group(2))
        return start, end
    m = re.match(r"(\d+)", str(spec).strip())
    if m:
        start = int(m.group(1)) - 1
        end   = start + 1
        return start, end
    return None


def _extract_by_range(sn: str, spec: str) -> str:
    r = _parse_range(spec)
    if r is None:
        return ""
    return sn[r[0]:r[1]] if len(sn) >= r[1] else sn[r[0]:]


def _parse_part_sn_fields(part_sn: str, settings: dict) -> dict:
    mapping = settings.get("Product Matrix Mapping", {})
    result = {}
    skip = {"Part Matrix"}
    for field, spec in mapping.items():
        if field in skip or not spec:
            continue
        result[field] = _extract_by_range(part_sn, str(spec))
    return result


def _parse_chassis_sn_fields(chassis_sn: str, settings: dict) -> dict:
    mapping = settings.get("SN Chassis Mapping", {})
    result = {}
    for field, spec in mapping.items():
        if not spec:
            continue
        result[field] = _extract_by_range(chassis_sn, str(spec))
    return result


# ─── FLOW EXECUTOR ────────────────────────────────────────────────

class FlowExecutor:
    def __init__(self, cp: str, field_values: dict, trigger_device: str, scan_value: str):
        self.cp = cp
        self.fields = dict(field_values)
        self.trigger_device = trigger_device
        self.scan_value = scan_value
        self.settings = _load_settings()
        self.flow = _load_flow(cp)
        self.nodes = {n["id"]: n for n in self.flow.get("nodes", [])}
        self.connections = self.flow.get("connections", [])
        self.commands = []

        if self.cp not in RUNTIME_STATES:
            RUNTIME_STATES[self.cp] = {"waiting_scan": None}

    def _node_outputs(self, node_id: str) -> dict:
        result = {}
        for conn in self.connections:
            if conn["fromId"] == node_id:
                result[conn["fromPort"]] = conn["toId"]
        return result

    def _get_field(self, key: str) -> str:
        return str(self.fields.get(key, ""))

    def _set_field(self, key: str, value: str):
        self.fields[key] = value
        self.commands.append({"cmd": "set_field", "key": key, "value": value})

    def _log(self, message: str, color: str = "#22C55E"):
        self.commands.append({"cmd": "log", "message": message, "color": color})

    def _instruction(self, text: str, color: str = "blue", widget: str = ""):
        self.commands.append({"cmd": "set_instruction", "widget": widget, "text": text, "color": color})

    def _reject(self, reason: str):
        self.commands.append({"cmd": "reject", "reason": reason})

    def _db_query(self, table: str, key_col: str, key_val: str, fields: list, db) -> bool:
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
        state = RUNTIME_STATES[self.cp]
        waiting = state["waiting_scan"]

        # ─── Jika ada waiting_scan, coba proses ──────────────────
        if waiting:
            node = self.nodes.get(waiting)
            if node and node["type"] == "scan_input":
                cfg = node.get("config", {})
                if cfg.get("device") == self.trigger_device:
                    # Device cocok → isi field dan lanjut
                    field_key = cfg.get("fieldKey", "")
                    if field_key:
                        self._set_field(field_key, self.scan_value)

                    state["waiting_scan"] = None

                    next_id = self._node_outputs(waiting).get("next")
                    if next_id:
                        self._execute_node(next_id, db)
                    return self.commands
                else:
                    # Device tidak cocok → reset waiting_scan dan mulai dari awal
                    state["waiting_scan"] = None
                    # Lanjut ke logika pencarian scan_input pertama
            else:
                # waiting_scan tidak valid → reset
                state["waiting_scan"] = None

        # ─── Tidak ada waiting_scan (atau sudah di-reset) ────────
        start_node = None
        for node in self.nodes.values():
            if node["type"] == "scan_input":
                cfg = node.get("config", {})
                if cfg.get("device") == self.trigger_device:
                    start_node = node
                    break

        if not start_node:
            self._log(f"No scan_input node found for device '{self.trigger_device}'", "#EF4444")
            return self.commands

        # Isi field untuk scan_input pertama
        field_key = start_node.get("config", {}).get("fieldKey", "")
        if field_key:
            self._set_field(field_key, self.scan_value)

        # Lanjutkan dari node berikutnya
        next_id = self._node_outputs(start_node["id"]).get("next")
        if next_id:
            self._execute_node(next_id, db)
        return self.commands

    def _execute_node(self, node_id: str, db=None):
        node = self.nodes.get(node_id)
        if not node:
            return

        ntype = node["type"]
        cfg = node.get("config", {})
        outputs = self._node_outputs(node_id)

        # ─── SCAN INPUT: berhenti dan simpan sebagai waiting_scan ──
        if ntype == "scan_input":
            state = RUNTIME_STATES[self.cp]
            state["waiting_scan"] = node_id
            return

        # ─── CHECK CP ────────────────────────────────────────
        if ntype == "check_cp":
            sn_val = self._get_field(cfg.get("sn_source", "product_sn"))
            cp_col = cfg.get("cp_col", "cp_number")
            sn_col = cfg.get("sn_col", "chassis_sn")
            sn_table = cfg.get("sn_table", "traceability")
            this_cp = str(cfg.get("cp_number") or self.cp)
            try:
                row = db.fetch_one(f"SELECT {cp_col} FROM {sn_table} WHERE {sn_col} = %s LIMIT 1", (sn_val,))
                if row:
                    sn_cp = str(row.get(cp_col, "") or "")
                    if sn_cp and sn_cp != this_cp:
                        self._instruction(f"This SN belong to CP{sn_cp}", "red")
                        self._log(f"SN {sn_val} belongs to CP{sn_cp}, not CP{this_cp}", "#EF4444")
                        next_id = outputs.get("false")
                        if next_id:
                            self._execute_node(next_id, db)
                        return
                else:
                    self._instruction("Chassis SN not exist", "red")
                    self._log(f"SN NOT FOUND: {sn_val}", "#EF4444")
                    next_id = outputs.get("false")
                    if next_id:
                        self._execute_node(next_id, db)
                    return
            except Exception as e:
                self._log(f"Check CP error: {e}", "#EF4444")
            next_id = outputs.get("true")
            if next_id:
                self._execute_node(next_id, db)
            return

        # ─── CHECK DUPLICATE SN ──────────────────────────────
        if ntype == "check_duplicate_sn":
            sn_val = self._get_field(cfg.get("sn_source", "product_sn"))
            sn_table = cfg.get("sn_table", "traceability")
            sn_col = cfg.get("sn_col", "chassis_sn")
            cp_col = cfg.get("cp_col", "cp_number")
            try:
                row = db.fetch_one(f"SELECT id FROM {sn_table} WHERE {sn_col} = %s AND {cp_col} = %s LIMIT 1",
                                   (sn_val, self.cp))
                if row:
                    self._instruction("Duplicate SN! Already processed.", "red")
                    self._log(f"DUPLICATE SN: {sn_val}", "#EF4444")
                    next_id = outputs.get("false")
                    if next_id:
                        self._execute_node(next_id, db)
                    return
            except Exception as e:
                self._log(f"Check duplicate SN error: {e}", "#EF4444")
            next_id = outputs.get("true")
            if next_id:
                self._execute_node(next_id, db)
            return

        # ─── CHECK DUPLICATE PART ─────────────────────────────
        if ntype == "check_duplicate_part":
            part_val = self._get_field(cfg.get("part_source", "part_sn"))
            part_table = cfg.get("part_table", "traceability")
            part_col = cfg.get("part_col", "main_pcba")
            try:
                row = db.fetch_one(f"SELECT id FROM {part_table} WHERE {part_col} = %s LIMIT 1", (part_val,))
                if row:
                    self._instruction("Duplicate Part! Already used.", "red")
                    self._log(f"DUPLICATE PART: {part_val}", "#EF4444")
                    next_id = outputs.get("false")
                    if next_id:
                        self._execute_node(next_id, db)
                    return
            except Exception as e:
                self._log(f"Check duplicate part error: {e}", "#EF4444")
            next_id = outputs.get("true")
            if next_id:
                self._execute_node(next_id, db)
            return

        # ─── CHECK VOLTAGE ────────────────────────────────────
        if ntype == "check_voltage":
            if self.trigger_device != "Part":
                return

            product_sn = self._get_field(cfg.get("product_field", "product_sn"))
            part_sn = self._get_field(cfg.get("part_sn_field", "part_sn"))

            if not part_sn or str(part_sn).strip() == "":
                self._instruction("ERROR: Part SN belum di-scan! Harap scan Part terlebih dahulu.", "red")
                self._log("Check Voltage BLOCKED: Part SN is empty.", "#EF4444")
                next_id = outputs.get("false")
                if next_id:
                    self._execute_node(next_id, db)
                return

            if not product_sn or str(product_sn).strip() == "":
                self._instruction("ERROR: Product SN belum di-scan! Harap scan Product terlebih dahulu.", "red")
                self._log("Check Voltage BLOCKED: Product SN is empty.", "#EF4444")
                next_id = outputs.get("false")
                if next_id:
                    self._execute_node(next_id, db)
                return

            prod_sec = cfg.get("product_mapping_section", "SN Chassis Mapping")
            prod_fld = cfg.get("product_mapping_field", "Product Matrix")
            prod_mapping = self.settings.get(prod_sec, {})
            prod_code = _extract_by_range(product_sn, prod_mapping.get(prod_fld, ""))

            part_sec = cfg.get("part_mapping_section", "Product Matrix Mapping")
            part_fld = cfg.get("part_mapping_field", "Voltage")
            part_mapping = self.settings.get(part_sec, {})
            part_v = _extract_by_range(part_sn, part_mapping.get(part_fld, ""))

            rule_sec = cfg.get("rule_table_section", "Product Rules")
            rule_key = cfg.get("rule_key_column", "Product")
            rule_val = cfg.get("rule_value_column", "Part Voltage")
            required_v = ""
            rules = self.settings.get(rule_sec, {}).get("_table", [])
            for rule in rules:
                if str(rule.get(rule_key, "")) == str(prod_code):
                    required_v = rule.get(rule_val, "")
                    break

            self._log(f"Product Code: {prod_code}", "#00BFFF")
            self._log(f"Part voltage:     {part_v}", "#00BFFF")
            self._log(f"Required voltage: {required_v}", "#00BFFF")

            if not required_v:
                self._instruction("ERROR: Product Code tidak dikenali / Required Voltage kosong!", "red")
                self._log("Check Voltage FAILED: Required Voltage is empty. Cek setting.json 'Product Rules'.", "#EF4444")
                next_id = outputs.get("false")
                if next_id:
                    self._execute_node(next_id, db)
                return

            if not part_v or str(part_v).strip() == "":
                self._instruction("ERROR: Part Voltage tidak ditemukan pada SN ini! (Salah scan?)", "red")
                self._log("Check Voltage FAILED: Part Voltage is empty.", "#EF4444")
                next_id = outputs.get("false")
                if next_id:
                    self._execute_node(next_id, db)
                return

            if required_v and part_v and required_v.upper() != part_v.upper():
                self._instruction(f"Voltage mismatch! Need {required_v}, got {part_v}. Re-scan.", "red")
                self._log(f"VOLTAGE MISMATCH: need {required_v}, got {part_v}", "#EF4444")
                next_id = outputs.get("false")
                if next_id:
                    self._execute_node(next_id, db)
                return

            self._log(f"Voltage OK: {required_v}", "#22C55E")
            next_id = outputs.get("true")
            if next_id:
                self._execute_node(next_id, db)
            return

        # ─── CHECK VARIABLE ──────────────────────────────────
        if ntype == "check_variable":
            target_field = cfg.get("target_field", "")
            condition = cfg.get("condition", "exists")
            expected = cfg.get("expected_value", "")
            val = self._get_field(target_field)
            if condition == "exists":
                passed = bool(val)
            elif condition == "not_exists":
                passed = not bool(val)
            elif condition == "equals":
                passed = (val == expected)
            else:
                passed = False

            if passed:
                next_id = outputs.get("true")
            else:
                self._log(f"Sequence Guard blocked: '{target_field}' failed condition '{condition}'", "#EAB308")
                next_id = outputs.get("false")
            if next_id:
                self._execute_node(next_id, db)
            return

        # ─── DB QUERY ─────────────────────────────────────────
        if ntype == "db_query":
            key_val = self._get_field(cfg.get("key_source", ""))
            fields = cfg.get("fields", [])
            ok = False
            if db and key_val and fields:
                ok = self._db_query(cfg.get("table", ""), cfg.get("key_col", ""), key_val, fields, db)
            if not ok:
                self._log(f"DB query returned no result (table={cfg.get('table')}, key={key_val})", "#EAB308")
            next_id = outputs.get("next")
            if next_id:
                self._execute_node(next_id, db)
            return

        # ─── PARSE SN ─────────────────────────────────────────
        if ntype == "parse_sn":
            sn_val = self._get_field(cfg.get("source_field", ""))
            use_map = cfg.get("use_setting", "Product Matrix Mapping")
            parsed = _parse_part_sn_fields(sn_val, self.settings) if use_map == "Product Matrix Mapping" else _parse_chassis_sn_fields(sn_val, self.settings)
            for key, val in parsed.items():
                self._set_field(key, val)
                print(f"[DEBUG] Set field: '{key}' = '{val}'")  # Tambahkan baris ini
            self._log(f"Parsed {len(parsed)} fields from SN", "#22C55E")
            next_id = outputs.get("next")
            if next_id:
                self._execute_node(next_id, db)
            return

        # ─── UPDATE FIELD ────────────────────────────────────
        if ntype == "update_field":
            target = cfg.get("target_field", "")
            source = cfg.get("source", "static")
            val = cfg.get("value", "") if source == "static" else self._get_field(cfg.get("value_source", ""))
            if target:
                self._set_field(target, val)
            next_id = outputs.get("next")
            if next_id:
                self._execute_node(next_id, db)
            return

        # ─── UPDATE TABLE ────────────────────────────────────
        if ntype == "update_table":
            widget = cfg.get("table_widget", "")
            columns = cfg.get("columns", [])
            # ✅ Kirim sebagai Object (header -> value) agar kolom sesuai
            row = {col.get("header"): self._get_field(col.get("source", "")) for col in columns}
            self.commands.append({"cmd": "set_table_row", "widget": widget, "row": row})
            next_id = outputs.get("next")
            if next_id:
                self._execute_node(next_id, db)
            return

        # ─── UPDATE INSTRUCTION ──────────────────────────────
        if ntype == "update_instruction":
            source = cfg.get("source", "static")
            widget = cfg.get("widget", "")
            text = "PASS" if source == "pass" else self._get_field(cfg.get("field_key", "")) if source == "field_key" else cfg.get("text", "")
            self._instruction(text, cfg.get("color", "blue"), widget)
            next_id = outputs.get("next")
            if next_id:
                self._execute_node(next_id, db)
            return

        # ─── LOG MESSAGE ─────────────────────────────────────
        if ntype == "log_message":
            source = cfg.get("source", "static")
            msg = self._get_field(cfg.get("field_key", "")) if source == "field_key" else cfg.get("message", "")
            self._log(msg, cfg.get("color", "#22C55E"))
            next_id = outputs.get("next")
            if next_id:
                self._execute_node(next_id, db)
            return

        # ─── SUBMIT / MOVE ───────────────────────────────────
        if ntype == "submit_move":
            fields_map = cfg.get("fields_map", [])
            table = cfg.get("table", "traceability")
            if db and fields_map:
                try:
                    cols = ", ".join(f["col"] for f in fields_map)
                    vals = tuple(self._get_field(f["field_key"]) for f in fields_map)
                    phs = ", ".join(["%s"] * len(fields_map))
                    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    db.execute(f"INSERT INTO {table}({cols}, cp_number, created_at) VALUES ({phs}, %s, %s)",
                                vals + (self.cp, now))
                    self._log("Record saved successfully.", "#22C55E")
                    self.commands.append({"cmd": "pass"})

                    # ✅ Reset state setelah submit berhasil
                    RUNTIME_STATES[self.cp] = {"waiting_scan": None}
                except Exception as e:
                    self._log(f"Submit error: {e}", "#EF4444")
            next_id = outputs.get("next")
            if next_id:
                self._execute_node(next_id, db)
            return


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
        f"# Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "# DO NOT EDIT — regenerate from Logic Builder",
        "",
        "from routes.logic_engine import FlowExecutor",
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