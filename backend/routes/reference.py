# backend/reference.py
import json
import os
import sqlite3
from datetime import datetime
from flask import Blueprint, request, jsonify

reference_bp = Blueprint("reference", __name__)

# ── PERBAIKAN UTAMA DI SINI ──
# Samakan logika path dengan snlist.py (naik 2 tingkat, lalu cari folder data)
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")

REFERENCE_DB = os.path.join(DATA_DIR, "reference.db")
COLUMN_CONFIG_PATH = os.path.join(DATA_DIR, "reference_columns.json")

# Pastikan folder data ada
os.makedirs(DATA_DIR, exist_ok=True)

# ── Helper SQLite ──────────────────────────────────────────────
def get_db_conn():
    conn = sqlite3.connect(REFERENCE_DB)
    conn.row_factory = sqlite3.Row
    return conn

def get_table_name():
    return "reference_master"

def ensure_table_exists():
    """Buat tabel reference_master dengan kolom default."""
    table = get_table_name()
    with get_db_conn() as conn:
        cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
        if cur.fetchone() is None:
            conn.execute(f"""
                CREATE TABLE {table} (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date_time TEXT,
                    name TEXT,
                    description TEXT,
                    program TEXT,
                    producttype TEXT,
                    line TEXT,
                    partner TEXT,
                    voltage TEXT,
                    plug TEXT,
                    colour TEXT,
                    customer TEXT
                )
            """)
            print(f"[REFERENCE] Created table {table}")

def get_columns_from_table():
    ensure_table_exists()
    with get_db_conn() as conn:
        cur = conn.execute(f"PRAGMA table_info({get_table_name()})")
        cols = cur.fetchall()
        return [col['name'] for col in cols if col['name'] != 'id']

def add_column_to_table(col_name):
    ensure_table_exists()
    if not col_name.isidentifier():
        raise ValueError(f"Invalid column name: {col_name}")
    with get_db_conn() as conn:
        try:
            conn.execute(f"ALTER TABLE {get_table_name()} ADD COLUMN {col_name} TEXT")
        except sqlite3.OperationalError as e:
            if "duplicate column name" not in str(e).lower():
                raise

def drop_column_from_table(col_name):
    ensure_table_exists()
    if col_name == 'id' or col_name == 'date_time':
        raise ValueError("Cannot drop id or date_time column")
    with get_db_conn() as conn:
        cur = conn.execute(f"PRAGMA table_info({get_table_name()})")
        cols = [r['name'] for r in cur.fetchall() if r['name'] not in ('id', col_name)]
        temp_table = f"{get_table_name()}_new"
        col_defs = ["id INTEGER PRIMARY KEY AUTOINCREMENT"] + [f"{c} TEXT" for c in cols]
        create_sql = f"CREATE TABLE {temp_table} ({', '.join(col_defs)})"
        conn.execute(create_sql)
        select_cols = ["id"] + cols
        insert_cols = ", ".join(select_cols)
        conn.execute(f"INSERT INTO {temp_table} ({insert_cols}) SELECT {insert_cols} FROM {get_table_name()}")
        conn.execute(f"DROP TABLE {get_table_name()}")
        conn.execute(f"ALTER TABLE {temp_table} RENAME TO {get_table_name()}")

def sync_columns_with_backend(desired_columns):
    ensure_table_exists()
    current_cols = get_columns_from_table()
    desired_keys = [c['key'] for c in desired_columns if c['key'] != 'id']
    for key in desired_keys:
        if key not in current_cols:
            add_column_to_table(key)
    for col in current_cols:
        if col not in desired_keys and col not in ('id', 'date_time'):
            drop_column_from_table(col)

# ── File Konfigurasi Label Kolom ──────────────────────────────
def load_column_config():
    if os.path.exists(COLUMN_CONFIG_PATH):
        with open(COLUMN_CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

def save_column_config(columns):
    with open(COLUMN_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(columns, f, indent=4, ensure_ascii=False)

# ── ENDPOINTS ──────────────────────────────────────────────────

@reference_bp.get("/api/reference/columns")
def get_reference_columns():
    ensure_table_exists()
    cols = get_columns_from_table()
    config = load_column_config()
    result = []
    
    for c in cols:
        # 🛑 PERBAIKAN DI SINI: Jangan kirim kolom date_time ke Frontend
        if c == 'date_time':
            continue

        found = next((item for item in config if item["key"] == c), None)
        if found:
            result.append(found)
        else:
            result.append({"key": c, "label": c, "width": 150})
    return jsonify(result)

@reference_bp.post("/api/reference/columns")
def update_reference_columns():
    body = request.get_json() or {}
    columns = body.get("columns", [])
    if not isinstance(columns, list):
        return jsonify({"error": "columns must be a list"}), 400
    
    sync_columns_with_backend(columns)
    save_column_config(columns)
    return jsonify({"success": True})

@reference_bp.get("/api/reference/data")
def get_reference_data():
    page = int(request.args.get("page", 1))
    per = int(request.args.get("per", 50))
    date_from = request.args.get("date_from")
    date_to = request.args.get("date_to")
    q = request.args.get("q", "").strip()

    ensure_table_exists()
    cols = get_columns_from_table()
    search_cols = [c for c in cols if c != 'id']
    where_clauses = []
    params = []

    if date_from:
        where_clauses.append("date_time >= ?")
        params.append(date_from)
    if date_to:
        where_clauses.append("date_time <= ?")
        params.append(date_to)
    if q:
        like_conditions = []
        for col in search_cols:
            like_conditions.append(f"{col} LIKE ?")
            params.append(f"%{q}%")
        where_clauses.append(f"({' OR '.join(like_conditions)})")

    where_sql = " AND ".join(where_clauses)
    if where_sql:
        where_sql = "WHERE " + where_sql

    offset = (page - 1) * per
    query = f"SELECT id, * FROM {get_table_name()} {where_sql} ORDER BY id DESC LIMIT ? OFFSET ?"
    count_query = f"SELECT COUNT(*) FROM {get_table_name()} {where_sql}"

    with get_db_conn() as conn:
        total = conn.execute(count_query, params).fetchone()[0]
        rows = conn.execute(query, params + [per, offset]).fetchall()
        data = [dict(r) for r in rows]

    return jsonify({"data": data, "total": total, "page": page, "per": per})

@reference_bp.post("/api/reference/data")
def add_reference_data():
    body = request.get_json() or {}
    if "date_time" not in body or not body["date_time"]:
        body["date_time"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    ensure_table_exists()
    cols = get_columns_from_table()
    insert_cols = [c for c in cols if c in body]
    if not insert_cols:
        return jsonify({"error": "No valid columns to insert"}), 400
    
    placeholders = ", ".join(["?"] * len(insert_cols))
    values = [body[c] for c in insert_cols]
    sql = f"INSERT INTO {get_table_name()} ({', '.join(insert_cols)}) VALUES ({placeholders})"
    
    with get_db_conn() as conn:
        cur = conn.execute(sql, values)
        new_id = cur.lastrowid
    return jsonify({"success": True, "id": new_id})

@reference_bp.put("/api/reference/data/<int:record_id>")
def update_reference_data(record_id):
    body = request.get_json() or {}
    ensure_table_exists()
    cols = get_columns_from_table()
    update_cols = [c for c in cols if c in body and c != 'id']
    if not update_cols:
        return jsonify({"error": "No valid columns to update"}), 400
    
    set_clause = ", ".join([f"{c}=?" for c in update_cols])
    values = [body[c] for c in update_cols] + [record_id]
    sql = f"UPDATE {get_table_name()} SET {set_clause} WHERE id=?"
    
    with get_db_conn() as conn:
        conn.execute(sql, values)
    return jsonify({"success": True})

@reference_bp.delete("/api/reference/data/<int:record_id>")
def delete_reference_data(record_id):
    ensure_table_exists()
    with get_db_conn() as conn:
        conn.execute(f"DELETE FROM {get_table_name()} WHERE id=?", (record_id,))
    return jsonify({"success": True})