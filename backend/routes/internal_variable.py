import os
import re
import sqlite3
import json
from flask import Blueprint, request, jsonify

internal_variable_bp = Blueprint(
    "internal_variable", __name__, url_prefix="/api/internal-variables"
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "internalvariable.db")

def _connect():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=2.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=2000")
    conn.execute("PRAGMA temp_store=MEMORY")
    return conn

def init_internal_variables_db():
    with _connect() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS internal_variables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE COLLATE NOCASE,
            cp_number TEXT NOT NULL DEFAULT '',
            data_type TEXT NOT NULL DEFAULT 'string',
            value TEXT NOT NULL DEFAULT '',
            system_key TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")

        # Safe migration for databases created by older versions.
        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(internal_variables)").fetchall()
        }
        if "cp_number" not in columns:
            conn.execute(
                "ALTER TABLE internal_variables ADD COLUMN cp_number TEXT NOT NULL DEFAULT ''"
            )
        if "system_key" not in columns:
            conn.execute(
                "ALTER TABLE internal_variables ADD COLUMN system_key TEXT NOT NULL DEFAULT ''"
            )

        conn.execute("""CREATE INDEX IF NOT EXISTS idx_internal_variables_name
                        ON internal_variables(name COLLATE NOCASE)""")
        conn.execute("""CREATE INDEX IF NOT EXISTS idx_internal_variables_cp
                        ON internal_variables(cp_number)""")
        conn.commit()

def _validate_name(name):
    name = str(name or "").strip()
    return name if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) else None

def _normalize_type(value):
    value = str(value or "string").strip().lower()
    return value if value in {"string", "number", "boolean", "system"} else None


# ---------------------------------------------------------------------------
# SYSTEM INTERNAL VARIABLES
# A System variable is a String whose source is a leaf value in either
# setting.json or interlock.json. The source is stored in system_key as:
#   setting.json|Section|Key|...
#   interlock.json|Section|Key|...
# Every read refreshes the persisted value so the DB contains the latest
# value while the source remains linked to the JSON setting.
# ---------------------------------------------------------------------------
def _json_candidates(filename):
    return [
        os.path.join(DATA_DIR, filename),
        os.path.join(BASE_DIR, filename),
        os.path.join(os.getcwd(), filename),
    ]

def _json_path(filename):
    for path in _json_candidates(filename):
        if os.path.isfile(path):
            return path
    return _json_candidates(filename)[0]

def _load_json_file(filename):
    # Try all known project locations. A temporary malformed JSON must not
    # turn the API into an HTML 500 response.
    for path in _json_candidates(filename):
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError, TypeError):
            continue
    return {}

def _flatten_json_leaves(data, prefix=None):
    prefix = list(prefix or [])
    result = []
    if isinstance(data, dict):
        for key, value in data.items():
            result.extend(_flatten_json_leaves(value, prefix + [str(key)]))
    elif isinstance(data, list):
        for idx, value in enumerate(data):
            result.extend(_flatten_json_leaves(value, prefix + [str(idx)]))
    else:
        result.append(prefix)
    return result

def _get_json_value(data, path_parts):
    current = data
    for part in path_parts:
        if isinstance(current, dict):
            current = current.get(part, "")
        elif isinstance(current, list):
            try:
                current = current[int(part)]
            except Exception:
                return ""
        else:
            return ""
    if current is None:
        return ""
    if isinstance(current, (dict, list)):
        return json.dumps(current, ensure_ascii=False)
    return str(current)

def _read_system_value(system_key):
    key = str(system_key or "").strip()
    parts = key.split("|")
    if len(parts) < 2 or parts[0] not in {"setting.json", "interlock.json"}:
        return ""
    filename = parts[0]
    return _get_json_value(_load_json_file(filename), parts[1:])

def _system_sources():
    sources = []
    labels = {
        "setting.json": "Setting",
        "interlock.json": "Interlock",
    }
    for filename in ("setting.json", "interlock.json"):
        data = _load_json_file(filename)
        for path_parts in _flatten_json_leaves(data):
            if not path_parts:
                continue
            key = "|".join([filename] + path_parts)
            value = _get_json_value(data, path_parts)
            sources.append({
                "key": key,
                "file": filename,
                "label": f'{labels[filename]} → {" → ".join(path_parts)}',
                "path": path_parts,
                "value": value,
            })
    sources.sort(key=lambda x: x["label"].lower())
    return sources

def _refresh_system_rows(conn, rows):
    """Persist current JSON values without mutating sqlite3.Row objects.

    sqlite3.Row is read-only. The previous implementation attempted
    row["value"] = current, which caused GET /api/internal-variables to
    return HTTP 500. We only update the database here; callers convert the
    rows to dictionaries afterwards, and _row() reads the current value
    directly from the JSON source for System variables.
    """
    for row in rows:
        if str(row["data_type"] or "").strip().lower() != "system":
            continue

        current = _read_system_value(row["system_key"])
        old_value = str(row["value"] or "")

        if current != old_value:
            conn.execute(
                """UPDATE internal_variables
                   SET value=?, updated_at=CURRENT_TIMESTAMP
                   WHERE id=?""",
                (current, row["id"]),
            )

    return rows

def _normalize_value(value, data_type):
    if data_type == "number":
        if value is None or value == "": return "0"
        n = float(value)
        if not (n == n and abs(n) != float("inf")): raise ValueError("Value must be a finite number")
        return str(int(n)) if n.is_integer() else str(n)
    if data_type == "boolean":
        if isinstance(value, bool): return "true" if value else "false"
        s = str(value).strip().lower()
        if s in {"true","1","on","yes"}: return "true"
        if s in {"false","0","off","no"}: return "false"
        raise ValueError("Value must be true or false")
    return "" if value is None else str(value)

def _parse_value(value, data_type):
    if data_type == "number":
        try:
            n = float(value); return int(n) if n.is_integer() else n
        except Exception: return 0
    if data_type == "boolean": return str(value).lower() == "true"
    return value

def _row(row):
    if row is None: return None
    d = dict(row)
    if str(d.get("data_type", "")).strip().lower() == "system":
        d["value"] = _read_system_value(d.get("system_key", ""))
    else:
        d["value"] = _parse_value(d.get("value",""), d.get("data_type","string"))
    return d


@internal_variable_bp.post("/system-sync")
def sync_system_variables():
    try:
        with _connect() as conn:
            rows = conn.execute(
                """SELECT id,name,cp_number,data_type,value,system_key,created_at,updated_at
                   FROM internal_variables
                   WHERE lower(data_type) = 'system'"""
            ).fetchall()
            _refresh_system_rows(conn, rows)
            conn.commit()
            refreshed = [_row(r) for r in rows]
        return jsonify({"success": True, "variables": refreshed}), 200
    except Exception as e:
        return jsonify({"success": False, "variables": [], "message": str(e)}), 200

@internal_variable_bp.get("/system-sources")
def list_system_sources():
    try:
        return jsonify({
            "success": True,
            "sources": _system_sources(),
        }), 200
    except Exception as e:
        # Never let this endpoint return an HTML error page. The frontend
        # expects JSON and should continue to work with existing variables.
        return jsonify({
            "success": False,
            "sources": [],
            "message": str(e),
        }), 200

@internal_variable_bp.get("")
def list_internal_variables():
    cp_number = str(
        request.args.get("cp_number", request.args.get("cp", ""))
        or ""
    ).strip()

    with _connect() as conn:
        if cp_number:
            rows = conn.execute(
                """SELECT id,name,cp_number,data_type,value,system_key,created_at,updated_at
                   FROM internal_variables
                   WHERE cp_number = ?
                   ORDER BY name COLLATE NOCASE""",
                (cp_number,),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT id,name,cp_number,data_type,value,system_key,created_at,updated_at
                   FROM internal_variables
                   ORDER BY name COLLATE NOCASE"""
            ).fetchall()

        _refresh_system_rows(conn, rows)
        conn.commit()

    return jsonify({
        "success": True,
        "cp_number": cp_number,
        "variables": [_row(r) for r in rows],
    })


@internal_variable_bp.post("")
def create_internal_variable():
    body = request.get_json(silent=True) or {}
    name = _validate_name(body.get("name"))
    data_type = _normalize_type(body.get("data_type"))
    cp_number = str(
        body.get("cp_number", body.get("cp", ""))
        or ""
    ).strip()
    system_key = str(body.get("system_key", "") or "").strip() if data_type == "system" else ""

    if data_type == "system" and system_key not in {s["key"] for s in _system_sources()}:
        return jsonify({"success": False, "message": "Invalid System source."}), 400

    if not name:
        return jsonify({"success": False, "message": "Invalid variable name."}), 400
    if not data_type:
        return jsonify({"success": False, "message": "Invalid data type."}), 400
    if not cp_number:
        return jsonify({"success": False, "message": "CP number is required."}), 400

    try:
        value = _read_system_value(system_key) if data_type == "system" else _normalize_value(body.get("value",""), data_type)
        with _connect() as conn:
            cur = conn.execute(
                """INSERT INTO internal_variables
                   (name,cp_number,data_type,value,system_key)
                   VALUES (?,?,?,?,?)""",
                (name, cp_number, data_type, value, system_key),
            )
            row = conn.execute(
                """SELECT id,name,cp_number,data_type,value,system_key,created_at,updated_at
                   FROM internal_variables WHERE id=?""",
                (cur.lastrowid,),
            ).fetchone()
            conn.commit()
        return jsonify({"success":True,"variable":_row(row)}),201
    except sqlite3.IntegrityError:
        return jsonify({"success":False,"message":f"Variable '{name}' already exists."}),409
    except Exception as exc:
        return jsonify({"success":False,"message":str(exc)}),400

@internal_variable_bp.post("/batch")
def batch_update_internal_variables():
    body = request.get_json(silent=True) or {}
    updates = body.get("updates", [])
    if not isinstance(updates,list) or not updates:
        return jsonify({"success":False,"message":"updates must be a non-empty list."}),400
    try:
        with _connect() as conn:
            normalized = []
            # Validate all values first.
            for i,item in enumerate(updates):
                if not isinstance(item,dict): raise ValueError(f"updates[{i}] must be an object.")
                try: vid = int(item.get("id"))
                except Exception: raise ValueError(f"updates[{i}].id must be an integer.")
                row = conn.execute("SELECT id,name,data_type,value FROM internal_variables WHERE id=?",(vid,)).fetchone()
                if row is None: raise ValueError(f"Variable id {vid} not found.")
                if str(row["data_type"] or "").strip().lower() == "system":
                    normalized.append((row["id"], _read_system_value(row["system_key"])))
                else:
                    normalized.append((row["id"], _normalize_value(item.get("value",row["value"]),row["data_type"])))
            # One transaction for the entire batch.
            for vid,value in normalized:
                conn.execute("UPDATE internal_variables SET value=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",(value,vid))
            conn.commit()
            rows = []
            for vid,_ in normalized:
                rows.append(_row(conn.execute("SELECT id,name,cp_number,data_type,value,system_key,created_at,updated_at FROM internal_variables WHERE id=?",(vid,)).fetchone()))
        return jsonify({"success":True,"count":len(rows),"variables":rows})
    except Exception as exc:
        return jsonify({"success":False,"message":str(exc)}),400

@internal_variable_bp.put("/<int:variable_id>")
def update_internal_variable(variable_id):
    body = request.get_json(silent=True) or {}
    with _connect() as conn:
        existing = conn.execute("SELECT id,name,data_type,value,system_key FROM internal_variables WHERE id=?",(variable_id,)).fetchone()
        if existing is None: return jsonify({"success":False,"message":"Variable not found."}),404
        name = _validate_name(body.get("name",existing["name"]))
        data_type = _normalize_type(body.get("data_type",existing["data_type"]))
        system_key = str(body.get("system_key", existing["system_key"] or "") or "").strip() if data_type == "system" else ""
        if data_type == "system" and system_key not in {s["key"] for s in _system_sources()}:
            return jsonify({"success":False,"message":"Invalid System source."}),400
        if not name or not data_type: return jsonify({"success":False,"message":"Invalid variable name or data type."}),400
        try:
            value = _read_system_value(system_key) if data_type == "system" else _normalize_value(body.get("value",existing["value"]),data_type)
            conn.execute("""UPDATE internal_variables SET name=?,data_type=?,value=?,system_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?""",(name,data_type,value,system_key,variable_id))
            row = conn.execute("SELECT id,name,cp_number,data_type,value,system_key,created_at,updated_at FROM internal_variables WHERE id=?",(variable_id,)).fetchone()
            conn.commit()
            return jsonify({"success":True,"variable":_row(row)})
        except sqlite3.IntegrityError:
            return jsonify({"success":False,"message":f"Variable '{name}' already exists."}),409
        except Exception as exc: return jsonify({"success":False,"message":str(exc)}),400

@internal_variable_bp.delete("/<int:variable_id>")
def delete_internal_variable(variable_id):
    with _connect() as conn:
        cur = conn.execute("DELETE FROM internal_variables WHERE id=?",(variable_id,)); conn.commit()
    if cur.rowcount == 0: return jsonify({"success":False,"message":"Variable not found."}),404
    return jsonify({"success":True})

init_internal_variables_db()