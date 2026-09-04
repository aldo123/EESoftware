import os
import re
import sqlite3
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
    return value if value in {"string", "number", "boolean"} else None

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
    d["value"] = _parse_value(d.get("value",""), d.get("data_type","string"))
    return d

@internal_variable_bp.get("")
def list_internal_variables():
    cp_number = str(
        request.args.get("cp_number", request.args.get("cp", ""))
        or ""
    ).strip()

    with _connect() as conn:
        if cp_number:
            rows = conn.execute(
                """SELECT id,name,cp_number,data_type,value,created_at,updated_at
                   FROM internal_variables
                   WHERE cp_number = ?
                   ORDER BY name COLLATE NOCASE""",
                (cp_number,),
            ).fetchall()
        else:
            # Keep backward compatibility for runtime/global callers.
            rows = conn.execute(
                """SELECT id,name,cp_number,data_type,value,created_at,updated_at
                   FROM internal_variables
                   ORDER BY name COLLATE NOCASE"""
            ).fetchall()

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

    if not name:
        return jsonify({"success": False, "message": "Invalid variable name."}), 400
    if not data_type:
        return jsonify({"success": False, "message": "Invalid data type."}), 400
    if not cp_number:
        return jsonify({"success": False, "message": "CP number is required."}), 400

    try:
        value = _normalize_value(body.get("value",""), data_type)
        with _connect() as conn:
            # Variable names are intentionally still globally unique.
            # This avoids breaking the existing runtime lookup by name.
            cur = conn.execute(
                """INSERT INTO internal_variables
                   (name,cp_number,data_type,value)
                   VALUES (?,?,?,?)""",
                (name, cp_number, data_type, value),
            )
            row = conn.execute(
                """SELECT id,name,cp_number,data_type,value,created_at,updated_at
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
                normalized.append((row["id"], _normalize_value(item.get("value",row["value"]),row["data_type"])))
            # One transaction for the entire batch.
            for vid,value in normalized:
                conn.execute("UPDATE internal_variables SET value=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",(value,vid))
            conn.commit()
            rows = []
            for vid,_ in normalized:
                rows.append(_row(conn.execute("SELECT id,name,cp_number,data_type,value,created_at,updated_at FROM internal_variables WHERE id=?",(vid,)).fetchone()))
        return jsonify({"success":True,"count":len(rows),"variables":rows})
    except Exception as exc:
        return jsonify({"success":False,"message":str(exc)}),400

@internal_variable_bp.put("/<int:variable_id>")
def update_internal_variable(variable_id):
    body = request.get_json(silent=True) or {}
    with _connect() as conn:
        existing = conn.execute("SELECT id,name,data_type,value FROM internal_variables WHERE id=?",(variable_id,)).fetchone()
        if existing is None: return jsonify({"success":False,"message":"Variable not found."}),404
        name = _validate_name(body.get("name",existing["name"]))
        data_type = _normalize_type(body.get("data_type",existing["data_type"]))
        if not name or not data_type: return jsonify({"success":False,"message":"Invalid variable name or data type."}),400
        try:
            value = _normalize_value(body.get("value",existing["value"]),data_type)
            conn.execute("""UPDATE internal_variables SET name=?,data_type=?,value=?,updated_at=CURRENT_TIMESTAMP WHERE id=?""",(name,data_type,value,variable_id))
            row = conn.execute("SELECT id,name,data_type,value,created_at,updated_at FROM internal_variables WHERE id=?",(variable_id,)).fetchone()
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