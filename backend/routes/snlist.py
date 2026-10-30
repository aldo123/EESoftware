import os
import json
import sqlite3
import csv
import hashlib
import re
import threading
import time
from pathlib import Path
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify
try:
    import tkinter as tk
    from tkinter import filedialog
except Exception:
    tk = None
    filedialog = None

snlist_bp = Blueprint("snlist", __name__)

DATA_DIR           = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
SNLIST_DB          = os.path.join(DATA_DIR, "snlist.db")
COLUMN_CONFIG_PATH = os.path.join(DATA_DIR, "snlist_columns.json")
SOURCE_CONFIG_PATH = os.path.join(DATA_DIR, "snlist_source_settings.json")
SOURCE_POLL_LOCK = threading.Lock()
SOURCE_WATCHER_STARTED = False



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


def _ensure_index(conn, table: str, column: str):
    """Create a single-column index once. Afterwards this is only a cheap read-only check.

    Without an index on date_time every "newest first" page, date filter and Dashboard/OEE
    window query scans and sorts the WHOLE table; without an index on the SN column the
    Dashboard history lookup scans the whole table once per 500 serial numbers.
    """
    safe = re.sub(r"[^A-Za-z0-9_]", "_", str(column))
    name = f"idx_{table}_{safe}"
    existing = {row[1] for row in conn.execute(f'PRAGMA index_list("{table}")').fetchall()}
    if name not in existing:
        col = str(column).replace('"', '""')
        conn.execute(f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}"("{col}")')


def ensure_table_exists(cp: str):
    table = get_table_name(cp)
    with get_snlist_conn() as conn:
        cols = {row["name"] for row in conn.execute(f'PRAGMA table_info("{table}")').fetchall()}
        if not cols:
            conn.execute(f"""
                CREATE TABLE {table} (
                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    date_time TEXT,
                    result    TEXT
                )
            """)
            print(f"[SNLIST] Created table {table}")
        elif "result" not in cols:
            # Older tables predate the `result` column (OK/NG) that the FPY
            # dashboard and Logic Builder's record_result() read/write —
            # add it in place so existing SN List data isn't disturbed.
            # (Only attempted when the column is really missing: this function runs on
            # every SN List / Dashboard request, an ALTER attempt each time is a wasted write.)
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN result TEXT")
            except sqlite3.OperationalError as e:
                if "duplicate column name" not in str(e).lower():
                    raise
        try:
            _ensure_index(conn, table, "date_time")
        except sqlite3.OperationalError:
            pass  # e.g. a legacy table without date_time: nothing to index


def record_result(cp: str, result: str, fields: dict = None) -> int:
    """Append one row to snlist_cp{cp} with the current timestamp and a
    Logic Builder run's OK/NG outcome — called from custom_script.py's
    `record_result(...)` sandbox builtin, not over HTTP. Any of `fields`
    that match an existing SN List column (e.g. chassis_sn) get carried
    into that row too, same as a manual SN List entry would set them."""
    # Source mode is exclusive: when realtime folder mode is enabled, SN List
    # rows come from the selected folder rather than Logic Builder writes.
    try:
        source_cfg = _load_source_configs().get(str(cp), {})
        if source_cfg.get("mode") == "folder" and source_cfg.get("enabled", True):
            return 0
    except Exception:
        pass
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


def _canonicalize_result_column(cp: str):
    """Merge legacy `results` into `result` and remove the duplicate column/config."""
    table = get_table_name(cp)
    cols = set(get_columns_from_table(cp))
    if "results" not in cols:
        return

    if "result" not in cols:
        add_column_to_table(cp, "result")
    with get_snlist_conn() as conn:
        conn.execute(
            f"UPDATE \"{table}\" SET result = results WHERE (result IS NULL OR TRIM(result) = '') AND results IS NOT NULL AND TRIM(results) <> ''"
        )

    drop_column_from_table(cp, "results")
    config = load_column_config(cp)
    cleaned, seen_result = [], False
    for item in config:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key", "")).strip().lower()
        if key in ("result", "results"):
            if seen_result:
                continue
            item = {**item, "key": "result", "label": item.get("label") or "RESULT"}
            seen_result = True
        cleaned.append(item)
    if not seen_result:
        cleaned.append({"key": "result", "label": "RESULT", "width": 140})
    save_column_config(cp, cleaned)


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
# Realtime folder source
# ═══════════════════════════════════════════════════════════════
def _load_source_configs():
    try:
        with open(SOURCE_CONFIG_PATH, "r", encoding="utf-8") as f:
            value = json.load(f)
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_source_configs(configs):
    os.makedirs(DATA_DIR, exist_ok=True)
    temp = SOURCE_CONFIG_PATH + ".tmp"
    with open(temp, "w", encoding="utf-8") as f:
        json.dump(configs, f, indent=2, ensure_ascii=False)
    os.replace(temp, SOURCE_CONFIG_PATH)


def _source_table_ready():
    with get_snlist_conn() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS snlist_source_rows (
            cp TEXT NOT NULL, source_file TEXT NOT NULL, row_hash TEXT NOT NULL,
            imported_at TEXT NOT NULL, PRIMARY KEY(cp, row_hash))""")
        conn.execute("""CREATE TABLE IF NOT EXISTS snlist_source_state (
            cp TEXT NOT NULL, source_file TEXT NOT NULL, file_size INTEGER NOT NULL,
            mtime REAL NOT NULL, scanned_at TEXT NOT NULL,
            PRIMARY KEY(cp, source_file))""")


def _normalize_result_value(value):
    """Normalize common source test outcomes to the SN List OK/NG convention."""
    raw = str(value or "").strip()
    normalized = re.sub(r"\s+", " ", raw).upper()
    if normalized in ("PASS", "PASSED"):
        return "OK"
    if normalized in ("FAIL", "FAILED"):
        return "NG"
    return raw


def _slug_header(header, index):
    raw = str(header or "").strip().replace("\ufeff", "")
    normalized = re.sub(r"[^0-9A-Za-z]+", "_", raw).strip("_").lower()
    if not normalized:
        normalized = f"column_{index + 1}"
    if normalized in ("time", "date_time", "datetime", "date_time_start", "date"):
        return "date_time"
    if normalized in ("result", "results", "final_result", "final_results", "test_result", "test_results"):
        return "result"
    if normalized == "id":
        return "source_id"

    # Keep equivalent spellings mapped to the same SN List field.
    # This is important when different log versions use slightly different
    # labels for the same column.
    header_aliases = {
        "forbid_connectivity": "forbid_connectivity",
        "forbid_connectivity_check": "forbid_connectivity",
        "forbidconnectivity": "forbid_connectivity",
    }
    return header_aliases.get(normalized, normalized[:120])


def _detect_delimiter(sample, configured="auto"):
    if configured and configured != "auto":
        return "\t" if configured == "\\t" else configured
    try:
        return csv.Sniffer().sniff(sample[:20000], delimiters=",;|\t").delimiter
    except csv.Error:
        first = sample.splitlines()[0] if sample.splitlines() else sample
        return max([",", ";", "|", "\t"], key=lambda d: first.count(d))


def _read_csv_header(path, delimiter="auto"):
    with open(path, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
        sample = f.read(20000)
        if not sample:
            return [], [], _detect_delimiter("", delimiter)
        sep = _detect_delimiter(sample, delimiter)
        f.seek(0)
        reader = csv.reader(f, delimiter=sep)
        headers = next(reader, [])
    # Duplicate source headers map to the same normalized database field; never append _2/_3.
    keys, used = [], set()
    for i, h in enumerate(headers):
        key = _slug_header(h, i)
        if key in used:
            # Identical duplicate header in one physical file is ambiguous; keep the first only.
            keys.append(None)
        else:
            keys.append(key); used.add(key)
    return headers, keys, sep


def _filename_matches_length(path, cfg):
    """Apply an optional length rule to the filename stem (without extension)."""
    if not cfg.get("filename_length_enabled", False):
        return True
    try:
        limit = max(0, int(cfg.get("filename_length", 10)))
    except (TypeError, ValueError):
        limit = 10
    operator = str(cfg.get("filename_length_operator", ">"))
    length = len(os.path.splitext(os.path.basename(path))[0])
    comparisons = {
        ">": length > limit,
        "<": length < limit,
        "=": length == limit,
        ">=": length >= limit,
        "<=": length <= limit,
    }
    return comparisons.get(operator, length > limit)


def _source_files(cfg):
    root = os.path.abspath(os.path.expanduser(str(cfg.get("path", "") or "")))
    if not root:
        return []
    supported = {".csv", ".txt", ".log"}
    if os.path.isfile(root):
        candidates = [root] if os.path.splitext(root)[1].lower() in supported else []
    elif not os.path.isdir(root):
        return []
    else:
        candidates = []
        recursive = cfg.get("recursive", True) is not False
        if recursive:
            for current, _, names in os.walk(root):
                candidates.extend(os.path.join(current, n) for n in names
                                  if os.path.splitext(n)[1].lower() in supported)
        else:
            candidates.extend(os.path.join(root, n) for n in os.listdir(root)
                              if os.path.isfile(os.path.join(root, n))
                              and os.path.splitext(n)[1].lower() in supported)
    # Filter consistently for preview, initial sync, and background watcher.
    return sorted(path for path in candidates if _filename_matches_length(path, cfg))


def _normalize_existing_result_values(cp):
    """Convert legacy PASS/FAIL values already stored in the SN List table."""
    ensure_table_exists(cp)
    table = get_table_name(cp)
    if "result" not in set(get_columns_from_table(cp)):
        return
    with get_snlist_conn() as conn:
        conn.execute(
            f'''UPDATE "{table}"
                SET result = CASE
                    WHEN UPPER(TRIM(result)) IN ('PASS', 'PASSED') THEN 'OK'
                    WHEN UPPER(TRIM(result)) IN ('FAIL', 'FAILED') THEN 'NG'
                    ELSE result
                END
                WHERE UPPER(TRIM(COALESCE(result, ''))) IN ('PASS', 'PASSED', 'FAIL', 'FAILED')'''
        )


def _merge_source_headers(cp, headers, keys):
    ensure_table_exists(cp)
    _canonicalize_result_column(cp)
    _normalize_existing_result_values(cp)
    current = set(get_columns_from_table(cp))
    config = load_column_config(cp)
    config_by_key = {str(c.get("key")): c for c in config if isinstance(c, dict) and c.get("key")}
    for header, key in zip(headers, keys):
        if not key:
            continue
        if key not in current:
            add_column_to_table(cp, key)
            current.add(key)
        if key not in config_by_key:
            item = {"key": key, "label": str(header or key).strip() or key, "width": 150}
            config.append(item); config_by_key[key] = item
    # RESULT must always be the final displayed column, regardless of which
    # source file was imported first or whether optional columns are present.
    result_items = [c for c in config if isinstance(c, dict) and str(c.get("key", "")).strip().lower() == "result"]
    config = [c for c in config if not (isinstance(c, dict) and str(c.get("key", "")).strip().lower() == "result")]
    if result_items:
        result_item = result_items[0]
        result_item = {**result_item, "key": "result", "label": result_item.get("label") or "RESULT"}
    else:
        result_item = {"key": "result", "label": "RESULT", "width": 140}
    config.append(result_item)
    save_column_config(cp, config)


def _normalize_source_datetime(value):
    value = str(value or "").strip()
    if not value:
        return ""
    formats = (
        "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M",
        "%d/%m/%Y", "%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %I:%M %p",
        "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%m/%d/%Y",
    )
    for fmt in formats:
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
    return value



def _align_source_row(headers, keys, values):
    """Align a CSV row to its own header when optional test columns are omitted.

    Some production CSVs have a 123-column header containing the three
    Forbid Connectivity fields, while individual rows contain only 120 values.
    In those rows the three optional fields are omitted in the middle of the
    record (not at the end). Padding only at the end shifts Empty Water Weight
    and Result into the wrong fields. Insert blanks at the actual header
    position so all following values stay aligned.
    """
    values = list(values or [])
    header_count = len(keys)

    # Locate the first optional Forbid Connectivity field by normalized key.
    forbid_indexes = [
        i for i, key in enumerate(keys)
        if key and (
            key == "forbid_connectivity"
            or key.startswith("forbid_connectivity_")
        )
    ]

    if forbid_indexes and len(values) < header_count:
        missing = header_count - len(values)
        first_forbid = min(forbid_indexes)

        # This known format omits all three Forbid Connectivity values in a
        # row while retaining the values after them (e.g. Empty Water Weight
        # and Result). Insert exactly the missing cells before the first
        # Forbid Connectivity field.
        if len(forbid_indexes) == 3 and missing == 3:
            values[first_forbid:first_forbid] = [""] * 3

    # Normalize remaining length mismatches without shifting existing values.
    if len(values) < header_count:
        values.extend([""] * (header_count - len(values)))
    elif len(values) > header_count:
        # Keep extras only when no matching header exists is unsafe; truncate
        # to the file's declared schema so values cannot leak into other fields.
        values = values[:header_count]

    return values


def _expand_mixed_row_schema(path, headers, keys, delimiter):
    """Infer the three optional Forbid Connectivity columns if data rows contain
    three more cells than an older 120-column header.

    A few supplied files contain mixed 120- and 123-value rows under the same
    120-column header. In that case the added values occur immediately before
    Empty Water Weight, so the source schema must be expanded before DB columns
    are merged and before any rows are imported.
    """
    has_forbid = any(
        key and (key == "forbid_connectivity" or key.startswith("forbid_connectivity_"))
        for key in keys
    )
    if has_forbid:
        return headers, keys

    empty_indexes = [
        i for i, key in enumerate(keys)
        if key and key.startswith("empty_water_weight")
    ]
    if not empty_indexes:
        return headers, keys

    try:
        max_row_len = 0
        with open(path, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
            reader = csv.reader(f, delimiter=delimiter)
            next(reader, None)
            for row in reader:
                if row and any(str(v).strip() for v in row):
                    max_row_len = max(max_row_len, len(row))
                    if max_row_len > len(keys) + 3:
                        return headers, keys
    except OSError:
        return headers, keys

    if max_row_len != len(keys) + 3:
        return headers, keys

    insert_at = min(empty_indexes)
    inferred_headers = [
        "Forbid Connectivity Lowlimit",
        "Forbid Connectivity Uplimit",
        "Forbid Connectivity",
    ]
    inferred_keys = [
        "forbid_connectivity_lowlimit",
        "forbid_connectivity_uplimit",
        "forbid_connectivity",
    ]
    headers = list(headers)
    keys = list(keys)
    headers[insert_at:insert_at] = inferred_headers
    keys[insert_at:insert_at] = inferred_keys
    print(f"[SNLIST] inferred 3 Forbid Connectivity columns in mixed-row CSV: {os.path.basename(path)}")
    return headers, keys

def _row_fingerprint(values):
    packed = json.dumps([str(v or "") for v in values], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(packed.encode("utf-8", errors="replace")).hexdigest()


def _import_source_file(cp, path, cfg):
    try:
        stat = os.stat(path)
    except OSError:
        return 0
    _source_table_ready()
    with get_snlist_conn() as conn:
        state = conn.execute("SELECT file_size, mtime FROM snlist_source_state WHERE cp=? AND source_file=?", (str(cp), os.path.abspath(path))).fetchone()
        if state and int(state["file_size"]) == stat.st_size and float(state["mtime"]) == stat.st_mtime:
            return 0
    headers, keys, delimiter = _read_csv_header(path, cfg.get("delimiter", "auto"))
    if not headers:
        return 0
    headers, keys = _expand_mixed_row_schema(path, headers, keys, delimiter)
    _merge_source_headers(cp, headers, keys)
    table = get_table_name(cp)
    inserted = 0
    # File is only parsed when size/mtime changes. Fingerprints protect against
    # overlapping daily/monthly files and repeated scans of the same rows.
    with open(path, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
        reader = csv.reader(f, delimiter=delimiter)
        next(reader, None)
        with get_snlist_conn() as conn:
            dbcols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
            for values in reader:
                if not values or not any(str(v).strip() for v in values):
                    continue
                # Align each source row to THIS file's own header before writing
                # to the shared SN List table. Never map against the combined DB
                # column order: some log versions do not contain
                # "Forbid Connectivity", and that field must remain blank without
                # shifting the values that follow it.
                values = _align_source_row(headers, keys, values)
                # Keep the existing fingerprint format for compatibility with
                # rows already imported by earlier versions.
                fingerprint = _row_fingerprint(values)
                cur = conn.execute("INSERT OR IGNORE INTO snlist_source_rows(cp,source_file,row_hash,imported_at) VALUES(?,?,?,?)",
                                   (str(cp), os.path.abspath(path), fingerprint, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
                if cur.rowcount == 0:
                    # Row fingerprint is unique across all files in this CP.
                    # This prevents overlap between daily and monthly log files.
                    continue
                # Start with blank values for every known DB field. Fields
                # absent from this particular file (e.g. forbid_connectivity)
                # stay blank; existing fields are populated strictly by header key.
                row = {
                    key: ""
                    for key in dbcols
                    if key not in ("id",)
                }
                for key, value in zip(keys, values):
                    if key and key in dbcols and key not in ("id",):
                        row[key] = _normalize_result_value(value) if key == "result" else str(value).strip()
                # Normalize common production timestamps for SN List date filtering.
                if row.get("date_time"):
                    row["date_time"] = _normalize_source_datetime(row["date_time"])
                else:
                    row["date_time"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cols = list(row)
                if cols:
                    conn.execute(f"INSERT INTO {table} ({', '.join(chr(34)+c+chr(34) for c in cols)}) VALUES ({', '.join('?' for _ in cols)})", [row[c] for c in cols])
                    inserted += 1
            conn.execute("INSERT INTO snlist_source_state(cp,source_file,file_size,mtime,scanned_at) VALUES(?,?,?,?,?) ON CONFLICT(cp,source_file) DO UPDATE SET file_size=excluded.file_size,mtime=excluded.mtime,scanned_at=excluded.scanned_at",
                         (str(cp), os.path.abspath(path), stat.st_size, stat.st_mtime, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
    return inserted


def _source_scan_once():
    if not SOURCE_POLL_LOCK.acquire(blocking=False):
        return
    try:
        for cp, cfg in _load_source_configs().items():
            if not isinstance(cfg, dict) or cfg.get("mode") != "folder" or not cfg.get("enabled", True):
                continue
            try:
                _normalize_existing_result_values(cp)
            except Exception as exc:
                print(f"[SNLIST] result normalization failed for CP {cp}: {exc}")
            for path in _source_files(cfg):
                try:
                    _import_source_file(cp, path, cfg)
                except Exception as exc:
                    print(f"[SNLIST] source import failed ({path}): {exc}")
    finally:
        SOURCE_POLL_LOCK.release()


def _source_watcher_loop():
    while True:
        try:
            _source_scan_once()
        except Exception as exc:
            print(f"[SNLIST] source watcher error: {exc}")
        intervals = [max(500, int(c.get("interval_ms", 2000) or 2000)) for c in _load_source_configs().values()
                     if isinstance(c, dict) and c.get("mode") == "folder" and c.get("enabled", True)]
        time.sleep(min(intervals or [2000]) / 1000.0)


def start_source_watcher():
    global SOURCE_WATCHER_STARTED
    if SOURCE_WATCHER_STARTED:
        return
    SOURCE_WATCHER_STARTED = True
    threading.Thread(target=_source_watcher_loop, daemon=True, name="snlist-folder-source").start()


@snlist_bp.get("/api/snlist/source-settings")
def get_source_settings_route():
    cp = str(request.args.get("cp", "1") or "1")
    cfg = _load_source_configs().get(cp, {"mode": "logic_builder", "path": "", "enabled": False, "interval_ms": 2000, "delimiter": "auto", "recursive": True, "filename_length_enabled": False, "filename_length_operator": ">", "filename_length": 10})
    if cfg.get("mode") == "folder" and cfg.get("enabled", True):
        start_source_watcher()
    return jsonify(cfg)


@snlist_bp.post("/api/snlist/source-settings")
def save_source_settings_route():
    cp = str(request.args.get("cp", "1") or "1")
    body = request.get_json(silent=True) or {}
    mode = str(body.get("mode", "logic_builder"))
    if mode not in ("logic_builder", "folder"):
        return jsonify({"success": False, "error": "Unsupported source mode"}), 400
    path = str(body.get("path", "") or "").strip()
    if mode == "folder" and (not path or not os.path.isdir(os.path.expanduser(path))):
        return jsonify({"success": False, "error": "Folder path does not exist on the backend computer"}), 400
    length_operator = str(body.get("filename_length_operator", ">"))
    if length_operator not in (">", "<", "=", ">=", "<="):
        length_operator = ">"
    try:
        filename_length = max(0, int(body.get("filename_length", 10)))
    except (TypeError, ValueError):
        filename_length = 10
    cfg = {"mode": mode, "path": os.path.abspath(os.path.expanduser(path)) if path else "",
           "enabled": bool(body.get("enabled", mode == "folder")) if mode == "folder" else False,
           "interval_ms": max(500, min(60000, int(body.get("interval_ms", 2000) or 2000))),
           "delimiter": body.get("delimiter", "auto"), "recursive": bool(body.get("recursive", True)),
           "filename_length_enabled": bool(body.get("filename_length_enabled", False)),
           "filename_length_operator": length_operator, "filename_length": filename_length}
    configs = _load_source_configs(); configs[cp] = cfg; _save_source_configs(configs)
    if mode == "folder":
        try:
            files = _source_files(cfg)
            if not files:
                return jsonify({"success": False, "error": "No CSV/TXT/LOG files found in selected folder", "settings": cfg}), 400
            # Preview headers and create columns immediately.
            headers, keys, delimiter = _read_csv_header(files[0], cfg.get("delimiter", "auto"))
            headers, keys = _expand_mixed_row_schema(files[0], headers, keys, delimiter)
            _merge_source_headers(cp, headers, keys)
            start_source_watcher()
        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 400
    return jsonify({"success": True, **cfg})


@snlist_bp.get("/api/snlist/source-browse")
def browse_source_folder_route():
    if tk is None or filedialog is None:
        return jsonify({"success": False, "error": "Windows folder picker unavailable; enter the absolute path manually."}), 500
    root = None
    try:
        root = tk.Tk(); root.withdraw(); root.attributes("-topmost", True); root.update()
        selected = filedialog.askdirectory(parent=root, title="Select SN List source folder", mustexist=True)
        return jsonify({"success": True, "path": selected or "", "cancelled": not bool(selected)})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500
    finally:
        if root is not None:
            try: root.destroy()
            except Exception: pass


@snlist_bp.post("/api/snlist/source-preview")
def preview_source_folder_route():
    body = request.get_json(silent=True) or {}
    path = os.path.abspath(os.path.expanduser(str(body.get("path", "") or "")))
    cfg = {"path": path, "recursive": body.get("recursive", True), "delimiter": body.get("delimiter", "auto"),
           "filename_length_enabled": bool(body.get("filename_length_enabled", False)),
           "filename_length_operator": body.get("filename_length_operator", ">"),
           "filename_length": body.get("filename_length", 10)}
    if not os.path.isdir(path):
        return jsonify({"success": False, "error": "Folder path does not exist on backend computer"}), 400
    files = _source_files(cfg)
    if not files:
        return jsonify({"success": False, "error": "No CSV/TXT/LOG files found"}), 400
    all_headers, seen = [], set()
    for file_path in files:
        try:
            headers, keys, _ = _read_csv_header(file_path, cfg["delimiter"])
            for original, key in zip(headers, keys):
                if key and key not in seen:
                    seen.add(key); all_headers.append({"key": key, "label": str(original or key).strip() or key, "original": str(original or "")})
        except Exception as exc:
            print(f"[SNLIST] preview skipped {file_path}: {exc}")
    return jsonify({"success": True, "files": [os.path.relpath(p, path) for p in files], "headers": all_headers})


@snlist_bp.post("/api/snlist/source-sync")
def sync_source_folder_route():
    cp = str(request.args.get("cp", "1") or "1")
    cfg = _load_source_configs().get(cp, {})
    if cfg.get("mode") != "folder" or not cfg.get("enabled", True):
        return jsonify({"success": True, "inserted": 0, "files": 0})
    files = _source_files(cfg); inserted = 0; errors = []
    for path in files:
        try: inserted += _import_source_file(cp, path, cfg)
        except Exception as exc: errors.append(f"{os.path.basename(path)}: {exc}")
    return jsonify({"success": not errors, "inserted": inserted, "files": len(files), "errors": errors})


# ═══════════════════════════════════════════════════════════════
# Routes
# ═══════════════════════════════════════════════════════════════



# ── GET /api/snlist/top-defects ──────────────────────────────────────────────
@snlist_bp.get("/api/snlist/top-defects")
def get_snlist_top_defects():
    """Aggregate defects from each SN's first-ever test record in SN List only."""
    cp = str(request.args.get("cp", "1")).strip()
    date_from = str(request.args.get("date_from", "")).strip()
    date_to = str(request.args.get("date_to", "")).strip()
    bucket = str(request.args.get("bucket", "day")).strip().lower()
    test_stage = str(request.args.get("test_stage", "fpy1")).strip().lower()
    if test_stage not in {"fpy1", "fpy2"}:
        test_stage = "fpy1"
    if bucket not in {"hour", "day", "7days", "month"}:
        bucket = "day"

    table = get_table_name(cp)
    ensure_table_exists(cp)
    columns = get_columns_from_table(cp)
    config = load_column_config(cp)
    labels = {str(x.get("key")): str(x.get("label") or x.get("key"))
              for x in config if isinstance(x, dict)}
    # Keep source/configured order for detecting a blank measurement followed by
    # another populated measurement. Limits themselves are not measurement values.
    ordered = [str(x.get("key")) for x in config if isinstance(x, dict)]
    ordered += [c for c in columns if c not in ordered]
    colset = set(columns)
    pairs = []
    for key in ordered:
        if not key or key not in colset or key.endswith("_lowlimit") or key.endswith("_uplimit"):
            continue
        if key in {"id", "date_time", "result", "results", "sn", "mac", "line", "model", "station", "version"}:
            continue
        low = key + "_lowlimit"
        up = key + "_uplimit"
        if low in colset or up in colset:
            pairs.append((key, low if low in colset else None, up if up in colset else None))

    # Load the complete history first so a repeat test cannot be mistaken for
    # the SN's first test just because the user selected a later date range.
    # The earliest record per SN is the only record eligible for Top Defect.
    with get_snlist_conn() as conn:
        rows = [dict(r) for r in conn.execute(
            f'SELECT * FROM "{table}" ORDER BY date_time ASC, id ASC'
        ).fetchall()]

    def _sn_value(row):
        return str(row.get("sn") or row.get("serial_number") or row.get("barcode") or "").strip()

    def _parse_stamp(row):
        stamp = str(row.get("date_time") or "")
        try:
            return datetime.fromisoformat(stamp)
        except Exception:
            try:
                return datetime.strptime(stamp[:19], "%Y-%m-%d %H:%M:%S")
            except Exception:
                return None

    # Classify each SN's tests using its full chronological history.
    # FPY1 includes only test #1. FPY2 includes test #2 and every later retest.
    test_rows_by_sn = {}
    rows_without_sn = []
    for row in rows:
        sn_key = _sn_value(row)
        if not sn_key:
            rows_without_sn.append(row)
        else:
            test_rows_by_sn.setdefault(sn_key, []).append(row)

    if test_stage == "fpy1":
        stage_rows = [items[0] for items in test_rows_by_sn.values() if items]
        # Rows without an SN cannot be assigned a repeat-test number; retain
        # them in FPY1 as individual records, but exclude them from FPY2.
        stage_rows.extend(rows_without_sn)
    else:
        stage_rows = [row for items in test_rows_by_sn.values() for row in items[1:]]

    # Apply selected date range only after assigning each row to its test stage.
    def _within_selected_dates(row):
        stamp = str(row.get("date_time") or "")
        dt = _parse_stamp(row)
        if dt is None:
            return False
        if date_from:
            try:
                start_dt = datetime.strptime(date_from[:10], "%Y-%m-%d")
                if dt < start_dt:
                    return False
            except Exception:
                if stamp < date_from:
                    return False
        if date_to:
            try:
                end_dt = datetime.strptime(date_to[:10], "%Y-%m-%d") + timedelta(days=1)
                if dt >= end_dt:
                    return False
            except Exception:
                if stamp > date_to:
                    return False
        return True

    rows = [row for row in stage_rows if _within_selected_dates(row)]

    from collections import Counter
    counts = Counter()
    trend_counts = {}
    defect_rows = []
    for row in rows:
        stamp = str(row.get("date_time") or "")
        try:
            dt = datetime.fromisoformat(stamp)
        except Exception:
            try: dt = datetime.strptime(stamp[:19], "%Y-%m-%d %H:%M:%S")
            except Exception: continue
        if bucket == "hour":
            period = dt.strftime("%Y-%m-%d %H:00")
        elif bucket == "7days":
            period = f"{dt.isocalendar().year}-W{dt.isocalendar().week:02d}"
        elif bucket == "month":
            period = dt.strftime("%Y-%m")
        else:
            period = dt.strftime("%Y-%m-%d")
        sn = str(row.get("sn") or row.get("serial_number") or row.get("barcode") or "").strip()
        row_defects = []
        # A test fails if a measured value falls outside an available numeric
        # low/high limit. Non-numeric limit/value fields are not compared.
        measured_present = []
        for key, low_key, up_key in pairs:
            raw = row.get(key)
            present = raw is not None and str(raw).strip() != ""
            measured_present.append((key, present))
            if not present:
                continue
            try:
                value = float(str(raw).strip().replace(",", "."))
            except Exception:
                continue
            low_raw = row.get(low_key) if low_key else None
            up_raw = row.get(up_key) if up_key else None
            try: low = float(str(low_raw).strip().replace(",", ".")) if low_raw is not None and str(low_raw).strip() else None
            except Exception: low = None
            try: high = float(str(up_raw).strip().replace(",", ".")) if up_raw is not None and str(up_raw).strip() else None
            except Exception: high = None
            if (low is not None and value < low) or (high is not None and value > high):
                row_defects.append({"key": key, "label": labels.get(key, key.replace("_", " ").title()), "reason": "Out of spec", "value": raw, "low": low_raw, "high": up_raw})
        # Incomplete test: once a measurement field is blank, later populated
        # measurement fields indicate testing stopped / data shifted.
        first_blank = None
        for idx, (key, present) in enumerate(measured_present):
            if not present:
                first_blank = idx
                break
        if first_blank is not None and any(present for _, present in measured_present[first_blank + 1:]):
            key = measured_present[first_blank][0]
            row_defects.append({"key": key, "label": labels.get(key, key.replace("_", " ").title()), "reason": "Incomplete test (blank field)", "value": "", "low": row.get(key + "_lowlimit"), "high": row.get(key + "_uplimit")})
        # RESULT NG/FAIL is not itself a defect category.
        # For each eligible test record in the selected FPY stage, report ONLY
        # ONE defect: whichever defective measurement appears earliest in the configured SN List
        # column order. This avoids counting multiple NG parameters from the
        # same test and makes the displayed defect deterministic.
        if row_defects:
            column_order = {key: idx for idx, key in enumerate(ordered)}
            first_defect = min(
                row_defects,
                key=lambda d: column_order.get(d["key"], len(column_order)),
            )
            d = first_defect
            defect_name = d["label"] if d["reason"] != "Incomplete test (blank field)" else f'{d["label"]} (Incomplete)'
            counts[defect_name] += 1
            trend_counts.setdefault(period, Counter())[defect_name] += 1
            defect_rows.append({"date_time": stamp, "sn": sn, "defect": defect_name, "reason": d["reason"], "value": d["value"], "lower_limit": d["low"], "upper_limit": d["high"]})

    defect_summary = [{"defect": k, "count": v} for k, v in counts.most_common()]
    periods = sorted(trend_counts)
    trend = [{"period": p, **dict(trend_counts[p])} for p in periods]
    return jsonify({
        "cp": cp, "bucket": bucket, "test_stage": test_stage, "date_from": date_from, "date_to": date_to,
        "records_scanned": len(rows), "defects_total": len(defect_rows),
        "summary": defect_summary, "trend": trend, "details": defect_rows[-500:],
    })


# ── GET /api/snlist/columns ───────────────────────────────────
@snlist_bp.get("/api/snlist/columns")
def get_snlist_columns():
    cp      = request.args.get("cp", "1")
    ensure_table_exists(cp)
    _canonicalize_result_column(cp)
    db_cols = get_columns_from_table(cp)
    config  = load_column_config(cp)

    # IMPORTANT: the UI order is defined by snlist_columns.json, not by
    # SQLite PRAGMA table_info() order.  The Column Manager sends the exact
    # order chosen by the user, so always return that order here.
    #
    # 1. Start with configured columns in their saved order.
    # 2. Keep only columns that still exist in the actual DB table.
    # 3. Append any DB columns that are not yet in the config (for example a
    #    newly-created/legacy column). This prevents a refresh from shuffling
    #    existing columns.
    db_set = set(db_cols)
    result = []
    configured_keys = set()

    for item in config:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key", "")).strip()
        if not key or key == "id" or key not in db_set or key in configured_keys:
            continue
        result.append({
            "key": key,
            "label": item.get("label") or key,
            "width": item.get("width", 150),
        })
        configured_keys.add(key)

    # Preserve DB order only for genuinely new columns that have no saved
    # position yet. Once saved, their position is controlled by config.
    for key in db_cols:
        if key == "id" or key in configured_keys:
            continue
        result.append({"key": key, "label": key, "width": 150})
        configured_keys.add(key)

    # Result is a fixed final column; optional source columns (such as
    # Forbid Connectivity) remain before Empty Water Weight / Result.
    result = [item for item in result if item.get("key") != "result"] + [
        item for item in result if item.get("key") == "result"
    ]
    if not any(item.get("key") == "result" for item in result):
        result.append({"key": "result", "label": "RESULT", "width": 140})
    return jsonify(result)


# ── POST /api/snlist/columns ──────────────────────────────────
@snlist_bp.post("/api/snlist/columns")
def update_snlist_columns():
    cp      = request.args.get("cp", "1")
    body    = request.get_json() or {}
    columns = body.get("columns", [])
    if not isinstance(columns, list):
        return jsonify({"error": "columns must be a list"}), 400
    columns = [c for c in columns if isinstance(c, dict)]
    result_items = [c for c in columns if str(c.get("key", "")).strip().lower() == "result"]
    columns = [c for c in columns if str(c.get("key", "")).strip().lower() != "result"]
    columns.append(result_items[0] if result_items else {"key": "result", "label": "RESULT", "width": 140})
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
        # HTML date inputs send YYYY-MM-DD. Treat the selected end date as
        # inclusive by comparing against midnight of the following day.
        # Using <= 'YYYY-MM-DD' would otherwise exclude every timestamp
        # later than 00:00:00 on that date.
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_to):
            try:
                end_exclusive = (datetime.strptime(date_to, "%Y-%m-%d").date().fromordinal(
                    datetime.strptime(date_to, "%Y-%m-%d").date().toordinal() + 1
                )).strftime("%Y-%m-%d")
                where_clauses.append("date_time < ?")
                params.append(end_exclusive)
            except ValueError:
                where_clauses.append("date_time <= ?")
                params.append(date_to)
        else:
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