import os
import json
import sqlite3
from datetime import datetime
from flask import Blueprint, request, jsonify

snlist_bp = Blueprint("snlist", __name__)

DATA_DIR           = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
SNLIST_DB          = os.path.join(DATA_DIR, "snlist.db")
COLUMN_CONFIG_PATH = os.path.join(DATA_DIR, "snlist_columns.json")


# ═══════════════════════════════════════════════════════════════
# DB helpers
# ═══════════════════════════════════════════════════════════════

def get_snlist_conn():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(SNLIST_DB)
    conn.row_factory = sqlite3.Row
    return conn


def get_table_name(cp: str) -> str:
    return f"snlist_cp{cp}"


def ensure_table_exists(cp: str):
    table = get_table_name(cp)
    with get_snlist_conn() as conn:
        exists = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        if not exists:
            conn.execute(f"""
                CREATE TABLE {table} (
                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    date_time TEXT,
                    result    TEXT
                )
            """)
            print(f"[SNLIST] Created table {table}")
        else:
            # Older tables predate the `result` column (OK/NG) that the FPY
            # dashboard and Logic Builder's record_result() read/write —
            # add it in place so existing SN List data isn't disturbed.
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN result TEXT")
            except sqlite3.OperationalError as e:
                if "duplicate column name" not in str(e).lower():
                    raise


def record_result(cp: str, result: str, fields: dict = None) -> int:
    """Append one row to snlist_cp{cp} with the current timestamp and a
    Logic Builder run's OK/NG outcome — called from custom_script.py's
    `record_result(...)` sandbox builtin, not over HTTP. Any of `fields`
    that match an existing SN List column (e.g. chassis_sn) get carried
    into that row too, same as a manual SN List entry would set them."""
    ensure_table_exists(cp)
    table = get_table_name(cp)
    fields = fields or {}

    with get_snlist_conn() as conn:
        existing_cols = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        row = {"date_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "result": str(result)}
        for key, value in fields.items():
            if key in existing_cols and key not in ("id", "date_time", "result"):
                row[key] = str(value)

        cols = list(row.keys())
        placeholders = ", ".join("?" for _ in cols)
        cursor = conn.execute(
            f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders})",
            [row[c] for c in cols],
        )
        conn.commit()
        return cursor.lastrowid


def get_columns_from_table(cp: str) -> list:
    table = get_table_name(cp)
    ensure_table_exists(cp)
    with get_snlist_conn() as conn:
        cur = conn.execute(f"PRAGMA table_info({table})")
        return [row["name"] for row in cur.fetchall() if row["name"] != "id"]


def add_column_to_table(cp: str, col_name: str):
    table = get_table_name(cp)
    ensure_table_exists(cp)
    if not col_name.isidentifier():
        raise ValueError(f"Invalid column name: {col_name}")
    with get_snlist_conn() as conn:
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col_name} TEXT")
        except sqlite3.OperationalError as e:
            if "duplicate column name" not in str(e).lower():
                raise


def drop_column_from_table(cp: str, col_name: str):
    if col_name in ("id", "date_time", "result"):
        raise ValueError("Cannot drop id, date_time, or result column")
    table = get_table_name(cp)
    ensure_table_exists(cp)
    with get_snlist_conn() as conn:
        cur  = conn.execute(f"PRAGMA table_info({table})")
        keep = [r["name"] for r in cur.fetchall() if r["name"] not in ("id", col_name)]
        tmp  = f"{table}_new"
        col_defs  = ["id INTEGER PRIMARY KEY AUTOINCREMENT"] + [f"{c} TEXT" for c in keep]
        cols_str  = ", ".join(["id"] + keep)
        conn.execute(f"CREATE TABLE {tmp} ({', '.join(col_defs)})")
        conn.execute(f"INSERT INTO {tmp} ({cols_str}) SELECT {cols_str} FROM {table}")
        conn.execute(f"DROP TABLE {table}")
        conn.execute(f"ALTER TABLE {tmp} RENAME TO {table}")


def sync_columns_with_backend(cp: str, desired_columns: list):
    ensure_table_exists(cp)
    current      = set(get_columns_from_table(cp))
    desired_keys = [c["key"] for c in desired_columns if c["key"] != "id"]
    for key in desired_keys:
        if key not in current:
            add_column_to_table(cp, key)
    for col in list(current):
        if col not in desired_keys and col not in ("id", "date_time"):
            drop_column_from_table(cp, col)


# ═══════════════════════════════════════════════════════════════
# Column label config (data/snlist_columns.json)
# ═══════════════════════════════════════════════════════════════

def load_column_config(cp: str) -> list:
    if os.path.exists(COLUMN_CONFIG_PATH):
        try:
            with open(COLUMN_CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f).get(cp, [])
        except Exception:
            pass
    return []


def save_column_config(cp: str, columns: list):
    data = {}
    if os.path.exists(COLUMN_CONFIG_PATH):
        try:
            with open(COLUMN_CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass
    data[cp] = columns
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(COLUMN_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════
# Routes
# ═══════════════════════════════════════════════════════════════

# ── GET /api/snlist/columns ───────────────────────────────────
@snlist_bp.get("/api/snlist/columns")
def get_snlist_columns():
    cp      = request.args.get("cp", "1")
    ensure_table_exists(cp)
    db_cols = get_columns_from_table(cp)
    config  = load_column_config(cp)

    result = []
    for c in db_cols:
        saved = next((item for item in config if item["key"] == c), None)
        result.append(saved if saved else {"key": c, "label": c, "width": 150})
    return jsonify(result)


# ── POST /api/snlist/columns ──────────────────────────────────
@snlist_bp.post("/api/snlist/columns")
def update_snlist_columns():
    cp      = request.args.get("cp", "1")
    body    = request.get_json() or {}
    columns = body.get("columns", [])
    if not isinstance(columns, list):
        return jsonify({"error": "columns must be a list"}), 400
    sync_columns_with_backend(cp, columns)
    save_column_config(cp, columns)
    return jsonify({"success": True})


# ── GET /api/snlist/data ──────────────────────────────────────
@snlist_bp.get("/api/snlist/data")
def get_snlist_data():
    cp        = request.args.get("cp", "1")
    page      = int(request.args.get("page", 1))
    per       = int(request.args.get("per", 50))
    date_from = request.args.get("date_from")
    date_to   = request.args.get("date_to")
    q         = request.args.get("q", "").strip()

    table       = get_table_name(cp)
    ensure_table_exists(cp)
    cols        = get_columns_from_table(cp)
    search_cols = [c for c in cols if c != "id"]

    where_clauses, params = [], []

    if date_from:
        where_clauses.append("date_time >= ?")
        params.append(date_from)
    if date_to:
        where_clauses.append("date_time <= ?")
        params.append(date_to)
    if q:
        like_parts = [f"{c} LIKE ?" for c in search_cols]
        where_clauses.append(f"({' OR '.join(like_parts)})")
        params += [f"%{q}%" for _ in search_cols]

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    offset    = (page - 1) * per

    with get_snlist_conn() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM {table} {where_sql}", params
        ).fetchone()[0]
        rows = conn.execute(
            f"SELECT id, * FROM {table} {where_sql} ORDER BY date_time DESC LIMIT ? OFFSET ?",
            params + [per, offset]
        ).fetchall()

    return jsonify({"data": [dict(r) for r in rows], "total": total, "page": page, "per": per})


# ── POST /api/snlist/data ─────────────────────────────────────
@snlist_bp.post("/api/snlist/data")
def add_snlist_data():
    cp   = request.args.get("cp", "1")
    body = request.get_json() or {}
    if not body.get("date_time"):
        body["date_time"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    table       = get_table_name(cp)
    ensure_table_exists(cp)
    cols        = get_columns_from_table(cp)
    insert_cols = [c for c in cols if c in body]

    if not insert_cols:
        return jsonify({"error": "No valid columns to insert"}), 400

    placeholders = ", ".join(["?"] * len(insert_cols))
    values       = [body[c] for c in insert_cols]
    sql          = f"INSERT INTO {table} ({', '.join(insert_cols)}) VALUES ({placeholders})"

    with get_snlist_conn() as conn:
        cur    = conn.execute(sql, values)
        new_id = cur.lastrowid

    return jsonify({"success": True, "id": new_id})


# ── PUT /api/snlist/data/<id> ─────────────────────────────────
@snlist_bp.put("/api/snlist/data/<int:record_id>")
def update_snlist_data(record_id):
    cp   = request.args.get("cp", "1")
    body = request.get_json() or {}

    table       = get_table_name(cp)
    ensure_table_exists(cp)
    cols        = get_columns_from_table(cp)
    update_cols = [c for c in cols if c in body and c != "id"]

    if not update_cols:
        return jsonify({"error": "No valid columns to update"}), 400

    set_clause = ", ".join([f"{c}=?" for c in update_cols])
    values     = [body[c] for c in update_cols] + [record_id]

    with get_snlist_conn() as conn:
        conn.execute(f"UPDATE {table} SET {set_clause} WHERE id=?", values)

    return jsonify({"success": True})


# ── DELETE /api/snlist/data/<id> ──────────────────────────────
@snlist_bp.delete("/api/snlist/data/<int:record_id>")
def delete_snlist_data(record_id):
    cp    = request.args.get("cp", "1")
    table = get_table_name(cp)
    ensure_table_exists(cp)
    with get_snlist_conn() as conn:
        conn.execute(f"DELETE FROM {table} WHERE id=?", (record_id,))
    return jsonify({"success": True})