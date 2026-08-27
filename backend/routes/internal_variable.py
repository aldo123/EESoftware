import os
import sqlite3
from flask import Blueprint, request, jsonify

internal_variable_bp = Blueprint("internal_variable", __name__, url_prefix="/api/internal-variables")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "internalvariable.db")


def _connect():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_internal_variables_db():
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS internal_variables (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                data_type TEXT NOT NULL DEFAULT 'string',
                value TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.commit()


def _validate_name(name):
    name = str(name or "").strip()
    if not name:
        return None
    # Keep variable names simple and safe for widget references/formulas.
    import re
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        return None
    return name


def _normalize_type(value):
    value = str(value or "string").strip().lower()
    return value if value in {"string", "number", "boolean"} else None


def _normalize_value(value, data_type):
    if data_type == "number":
        if value is None or value == "":
            return "0"
        number = float(value)
        if not (number == number and abs(number) != float("inf")):
            raise ValueError("Value must be a finite number")
        return str(int(number)) if number.is_integer() else str(number)

    if data_type == "boolean":
        if isinstance(value, bool):
            return "true" if value else "false"
        text = str(value).strip().lower()
        if text in {"true", "1", "on", "yes"}:
            return "true"
        if text in {"false", "0", "off", "no"}:
            return "false"
        raise ValueError("Value must be true or false")

    return "" if value is None else str(value)


def _parse_value(value, data_type):
    if data_type == "number":
        try:
            n = float(value)
            return int(n) if n.is_integer() else n
        except Exception:
            return 0
    if data_type == "boolean":
        return str(value).lower() == "true"
    return value


def _row(row):
    if row is None:
        return None
    d = dict(row)
    d["value"] = _parse_value(d.get("value", ""), d.get("data_type", "string"))
    return d


@internal_variable_bp.get("")
def list_internal_variables():
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, name, data_type, value, created_at, updated_at "
            "FROM internal_variables ORDER BY name COLLATE NOCASE"
        ).fetchall()
    return jsonify({"success": True, "variables": [_row(r) for r in rows]})


@internal_variable_bp.post("")
def create_internal_variable():
    body = request.get_json(silent=True) or {}
    name = _validate_name(body.get("name"))
    data_type = _normalize_type(body.get("data_type"))

    if not name:
        return jsonify({"success": False, "message": "Invalid variable name. Use letters, numbers and underscore; first character must be a letter or underscore."}), 400
    if not data_type:
        return jsonify({"success": False, "message": "Invalid data type."}), 400

    try:
        value = _normalize_value(body.get("value", ""), data_type)
        with _connect() as conn:
            cur = conn.execute(
                "INSERT INTO internal_variables (name, data_type, value) VALUES (?, ?, ?)",
                (name, data_type, value),
            )
            row = conn.execute(
                "SELECT id, name, data_type, value, created_at, updated_at FROM internal_variables WHERE id = ?",
                (cur.lastrowid,),
            ).fetchone()
            conn.commit()
        return jsonify({"success": True, "variable": _row(row)}), 201
    except sqlite3.IntegrityError:
        return jsonify({"success": False, "message": f"Variable '{name}' already exists."}), 409
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


@internal_variable_bp.put("/<int:variable_id>")
def update_internal_variable(variable_id):
    body = request.get_json(silent=True) or {}

    with _connect() as conn:
        existing = conn.execute(
            "SELECT id, name, data_type, value FROM internal_variables WHERE id = ?",
            (variable_id,),
        ).fetchone()
        if existing is None:
            return jsonify({"success": False, "message": "Variable not found."}), 404

        name = _validate_name(body.get("name", existing["name"]))
        data_type = _normalize_type(body.get("data_type", existing["data_type"]))
        if not name or not data_type:
            return jsonify({"success": False, "message": "Invalid variable name or data type."}), 400

        try:
            value = _normalize_value(body.get("value", existing["value"]), data_type)
            conn.execute(
                "UPDATE internal_variables SET name = ?, data_type = ?, value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (name, data_type, value, variable_id),
            )
            row = conn.execute(
                "SELECT id, name, data_type, value, created_at, updated_at FROM internal_variables WHERE id = ?",
                (variable_id,),
            ).fetchone()
            conn.commit()
            return jsonify({"success": True, "variable": _row(row)})
        except sqlite3.IntegrityError:
            return jsonify({"success": False, "message": f"Variable '{name}' already exists."}), 409
        except Exception as exc:
            return jsonify({"success": False, "message": str(exc)}), 400


@internal_variable_bp.delete("/<int:variable_id>")
def delete_internal_variable(variable_id):
    with _connect() as conn:
        cur = conn.execute("DELETE FROM internal_variables WHERE id = ?", (variable_id,))
        conn.commit()
    if cur.rowcount == 0:
        return jsonify({"success": False, "message": "Variable not found."}), 404
    return jsonify({"success": True})
