import json
import os
import re
import sqlite3
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify

maintenance_bp = Blueprint("maintenance", __name__)

DATA_DIR       = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
MAINTENANCE_DB = os.path.join(DATA_DIR, "maintenance.db")

INTERLOCK_CANDIDATES = [
    os.path.join(DATA_DIR, "interlock.json"),
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "interlock.json"),
    os.path.join(os.getcwd(), "interlock.json"),
]

DEFAULT_DB_SETTINGS = {
    "enabled": True,
    "host": "",
    "port": 3306,
    "database": "",
    "username": "",
    "password": "",
    "machine_status_table": "machine_status",
    "history_downtime_table": "history_downtime",
}

_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _load_interlock_json():
    for path in INTERLOCK_CANDIDATES:
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception:
            continue
    return {}


def _machine_name_from_interlock():
    data = _load_interlock_json()
    cp = data.get("Control Point", {}) if isinstance(data, dict) else {}
    return str(cp.get("Control Point Name", "") or "").strip() or "Unknown Machine"


def _interlock_db_defaults():
    data = _load_interlock_json()
    section = data.get("Traceability Server", {}) if isinstance(data, dict) else {}
    section = section if isinstance(section, dict) else {}
    return {
        "host": str(section.get("Database Server", "") or "").strip(),
        "port": int(section.get("Database Port", 3306) or 3306),
        "database": str(section.get("TraceabilityCatalog", "") or "").strip(),
        "username": str(section.get("TraceabilityUserId", "") or "").strip(),
        "password": str(section.get("TraceabilityPassword", "") or ""),
    }


def _load_db_settings():
    settings = dict(DEFAULT_DB_SETTINGS)
    settings.update(_interlock_db_defaults())
    try:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT key, value FROM maintenance_db_config"
            ).fetchall()
        for row in rows:
            key = str(row["key"] or "")
            value = row["value"]
            if key == "enabled":
                settings[key] = str(value).strip().lower() in {"1", "true", "yes", "on"}
            elif key == "port":
                try:
                    settings[key] = int(value)
                except Exception:
                    pass
            elif key in settings:
                settings[key] = str(value or "")
    except Exception:
        pass
    settings["machine_name"] = _machine_name_from_interlock()
    return settings


def _save_db_settings(payload):
    current = _load_db_settings()
    payload = payload if isinstance(payload, dict) else {}
    next_settings = dict(current)
    for key in (
        "enabled", "host", "port", "database", "username", "password",
        "machine_status_table", "history_downtime_table",
    ):
        if key in payload:
            next_settings[key] = payload[key]

    next_settings["enabled"] = bool(next_settings.get("enabled", True))
    try:
        next_settings["port"] = int(next_settings.get("port", 3306))
    except Exception:
        next_settings["port"] = 3306

    for key in ("host", "database", "username", "password"):
        next_settings[key] = str(next_settings.get(key, "") or "").strip()

    for key in ("machine_status_table", "history_downtime_table"):
        value = str(next_settings.get(key, "") or "").strip()
        if not _IDENT_RE.fullmatch(value):
            raise ValueError(f"Invalid table name: {value or '(empty)'}")
        next_settings[key] = value

    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_db_config (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        # Authoritative current downtime state.
        # Do not infer current downtime from unfinished history rows.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS downtime_runtime_state (
                machine_name  TEXT PRIMARY KEY,
                active        INTEGER NOT NULL DEFAULT 0,
                downtime_id   TEXT NULL,
                downtime_type TEXT NULL,
                since         TEXT NULL,
                technician    TEXT NULL,
                updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )
        """)
        conn.execute(
            "INSERT OR IGNORE INTO downtime_runtime_state "
            "(machine_name,active,downtime_id,downtime_type,since,technician,updated_at) "
            "VALUES (?,?,?,?,?,?,datetime('now','localtime'))",
            (_machine_name_from_interlock(), 0, None, None, None, None),
        )
        for key in (
            "enabled", "host", "port", "database", "username", "password",
            "machine_status_table", "history_downtime_table",
        ):
            value = next_settings[key]
            if key == "enabled":
                value = "1" if value else "0"
            conn.execute(
                "INSERT INTO maintenance_db_config(key,value) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, str(value)),
            )
    next_settings["machine_name"] = _machine_name_from_interlock()
    return next_settings


def _mysql_connect(settings):
    import mysql.connector
    if not settings.get("host") or not settings.get("database") or not settings.get("username"):
        raise ValueError("Database host, database name, and username are required.")
    return mysql.connector.connect(
        host=str(settings["host"]),
        port=int(settings.get("port", 3306) or 3306),
        database=str(settings["database"]),
        user=str(settings["username"]),
        password=str(settings.get("password", "") or ""),
        autocommit=False,
        connection_timeout=5,
    )


def _mysql_ident(name):
    value = str(name or "").strip()
    if not _IDENT_RE.fullmatch(value):
        raise ValueError(f"Invalid MySQL identifier: {value or '(empty)'}")
    return f"`{value}`"


def _ensure_external_tables(conn, settings):
    machine_table = _mysql_ident(settings["machine_status_table"])
    history_table = _mysql_ident(settings["history_downtime_table"])

    cur = conn.cursor()
    try:
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS {machine_table} (
                machine_name VARCHAR(255) NOT NULL PRIMARY KEY,
                status VARCHAR(64) NOT NULL DEFAULT 'RUNNING',
                since VARCHAR(32) NULL
            )
        """)
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS {history_table} (
                no INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                machine_name VARCHAR(255) NULL,
                date DATE NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NULL,
                duration TIME NULL,
                downtime_type VARCHAR(100) NULL,
                root_cause TEXT NULL,
                corrective_action TEXT NULL,
                technician VARCHAR(255) NULL
            )
        """)

        # Migrate existing history_downtime tables created before machine_name.
        cur.execute(f"SHOW COLUMNS FROM {history_table} LIKE 'machine_name'")
        if cur.fetchone() is None:
            cur.execute(
                f"ALTER TABLE {history_table} ADD COLUMN machine_name VARCHAR(255) NULL AFTER `no`"
            )

        # Populate legacy rows belonging to this current control point.
        current_machine_name = _machine_name_from_interlock()
        if current_machine_name:
            cur.execute(
                f"UPDATE {history_table} SET machine_name=%s "
                f"WHERE machine_name IS NULL OR TRIM(machine_name)=''",
                (current_machine_name,),
            )

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


def _sync_machine_status_external(status, since_value=""):
    settings = _load_db_settings()
    if not settings.get("enabled"):
        return False, "External database sync disabled"

    conn = None
    try:
        conn = _mysql_connect(settings)
        _ensure_external_tables(conn, settings)
        table = _mysql_ident(settings["machine_status_table"])
        name = _machine_name_from_interlock()
        cur = conn.cursor()
        try:
            cur.execute(
                f"SELECT machine_name FROM {table} WHERE machine_name=%s LIMIT 1",
                (name,),
            )
            exists = cur.fetchone() is not None
            if exists:
                cur.execute(
                    f"UPDATE {table} SET status=%s, since=%s WHERE machine_name=%s",
                    (str(status), str(since_value or ""), name),
                )
            else:
                cur.execute(
                    f"INSERT INTO {table}(machine_name,status,since) VALUES(%s,%s,%s)",
                    (name, str(status), str(since_value or "")),
                )
        finally:
            cur.close()
        conn.commit()
        return True, "Machine status synced"
    except Exception as exc:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        return False, str(exc)
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def _sync_history_start(downtime_row):
    settings = _load_db_settings()
    if not settings.get("enabled"):
        return None, "External database sync disabled"

    conn = None
    try:
        conn = _mysql_connect(settings)
        _ensure_external_tables(conn, settings)
        table = _mysql_ident(settings["history_downtime_table"])
        start_dt = datetime.strptime(
            downtime_row["start_time"], "%Y-%m-%d %H:%M:%S"
        )
        cur = conn.cursor()
        try:
            cur.execute(
                f"""INSERT INTO {table}
                    (`machine_name`,`date`,`start_time`,`end_time`,`duration`,
                     `downtime_type`,`root_cause`,`corrective_action`,`technician`)
                    VALUES (%s,%s,%s,NULL,NULL,%s,NULL,NULL,%s)""",
                (
                    _machine_name_from_interlock(),
                    start_dt.date(),
                    start_dt.time(),
                    downtime_row["downtime_type"],
                    downtime_row["technician"],
                ),
            )
            external_no = cur.lastrowid
        finally:
            cur.close()
        conn.commit()
        return int(external_no), "History start synced"
    except Exception as exc:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        return None, str(exc)
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def _sync_history_end(external_no, downtime_row):
    settings = _load_db_settings()
    if not settings.get("enabled"):
        return False, "External database sync disabled"
    if external_no in (None, ""):
        return False, "External history row number is unavailable"

    conn = None
    try:
        conn = _mysql_connect(settings)
        _ensure_external_tables(conn, settings)
        table = _mysql_ident(settings["history_downtime_table"])
        end_dt = datetime.strptime(
            downtime_row["end_time"], "%Y-%m-%d %H:%M:%S"
        )
        cur = conn.cursor()
        try:
            cur.execute(
                f"""UPDATE {table}
                    SET `machine_name`=%s, `end_time`=%s, `duration`=%s, `downtime_type`=%s,
                        `root_cause`=%s, `corrective_action`=%s,
                        `technician`=%s
                    WHERE `no`=%s""",
                (
                    _machine_name_from_interlock(),
                    end_dt.time(),
                    downtime_row["duration"],
                    downtime_row["downtime_type"],
                    downtime_row["root_cause"],
                    downtime_row["corrective_action"],
                    downtime_row["technician"],
                    int(external_no),
                ),
            )
        finally:
            cur.close()
        conn.commit()
        return True, "History end synced"
    except Exception as exc:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        return False, str(exc)
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def _format_elapsed(seconds):
    seconds = max(0, int(seconds or 0))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def _normalize_machine_status(raw_status, downtime_active=False):
    if downtime_active:
        return "IDLE"
    raw = str(raw_status or "").strip().upper()
    if "RUNNING" in raw:
        return "RUNNING"
    if raw == "IDLE" or "IDLE" in raw:
        return "IDLE"
    return "RUNNING"


# ── DB helpers ────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(MAINTENANCE_DB)
    conn.row_factory = sqlite3.Row
    return conn


def init_maintenance_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS downtime_events (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                downtime_id       TEXT,
                start_time        TEXT,
                end_time          TEXT,
                duration          TEXT,
                downtime_type     TEXT,
                root_cause        TEXT,
                corrective_action TEXT,
                technician        TEXT,
                shift             TEXT,
                notes             TEXT,
                machine_code      TEXT,
                external_history_no INTEGER,
                created_at        TEXT DEFAULT (datetime('now','localtime'))
            )
        """)
        # Safe migration for databases created by older versions.
        cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(downtime_events)").fetchall()
        }
        if "external_history_no" not in cols:
            conn.execute(
                "ALTER TABLE downtime_events ADD COLUMN external_history_no INTEGER"
            )

        conn.execute("""
            CREATE TABLE IF NOT EXISTS machine_config (
                key   TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_db_config (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)

        # Authoritative current downtime state. Keep this separate from
        # downtime_events so an old/stale unfinished history row can never
        # resurrect a downtime after the application is reopened.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS downtime_runtime_state (
                machine_name  TEXT PRIMARY KEY,
                active        INTEGER NOT NULL DEFAULT 0,
                downtime_id   TEXT NULL,
                downtime_type TEXT NULL,
                since         TEXT NULL,
                technician    TEXT NULL,
                updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )
        """)
        conn.execute(
            "INSERT OR IGNORE INTO downtime_runtime_state "
            "(machine_name,active,downtime_id,downtime_type,since,technician,updated_at) "
            "VALUES (?,?,?,?,?,?,datetime('now','localtime'))",
            (_machine_name_from_interlock(), 0, None, None, None, None),
        )

        for k, v in [
            ("machine_code", "CP2-PCBAVM3"),
            ("line_code",    "BW01-VM3"),
            ("spec_code",    "CP2-PCBAVM3"),
            ("technician",   "Aldo"),
            ("shift",        "Shift A"),
        ]:
            conn.execute(
                "INSERT OR IGNORE INTO machine_config (key, value) VALUES (?, ?)", (k, v)
            )
    print("[MAINTENANCE] DB initialized at", MAINTENANCE_DB)


# ── GET /api/maintenance/config ───────────────────────────────
@maintenance_bp.get("/api/maintenance/config")
def get_machine_config():
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM machine_config").fetchall()
    return jsonify({r["key"]: r["value"] for r in rows})


# ── GET /api/maintenance/database-settings ─────────────────────
@maintenance_bp.get("/api/maintenance/database-settings")
def get_database_settings():
    settings = _load_db_settings()
    return jsonify({
        "success": True,
        "settings": settings,
        "machine_name": settings["machine_name"],
        "source": "interlock.json + saved maintenance settings",
    })


# ── PUT /api/maintenance/database-settings ────────────────────
@maintenance_bp.put("/api/maintenance/database-settings")
def update_database_settings():
    try:
        body = request.get_json(silent=True) or {}
        settings = _save_db_settings(body)
        return jsonify({
            "success": True,
            "settings": settings,
            "machine_name": settings["machine_name"],
        })
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 400


# ── POST /api/maintenance/database-test ───────────────────────
@maintenance_bp.post("/api/maintenance/database-test")
def test_database_settings():
    conn = None
    try:
        body = request.get_json(silent=True) or {}
        settings = _load_db_settings()
        # Test request may contain unsaved settings.
        if isinstance(body, dict):
            merged = dict(settings)
            for key in (
                "enabled", "host", "port", "database", "username", "password",
                "machine_status_table", "history_downtime_table",
            ):
                if key in body:
                    merged[key] = body[key]
            settings = _save_db_settings(merged)

        if not settings.get("enabled"):
            return jsonify({
                "success": True,
                "connected": False,
                "message": "External database sync is disabled.",
            })

        conn = _mysql_connect(settings)
        _ensure_external_tables(conn, settings)
        conn.close()
        conn = None
        return jsonify({
            "success": True,
            "connected": True,
            "message": "Database connection OK. Required tables are ready.",
            "machine_name": _machine_name_from_interlock(),
        })
    except Exception as exc:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
        return jsonify({
            "success": False,
            "connected": False,
            "message": str(exc),
        }), 400


# ── GET /api/maintenance/machine-status ───────────────────────
@maintenance_bp.get("/api/maintenance/machine-status")
def get_machine_status():
    machine_name = _machine_name_from_interlock()
    now = datetime.now()

    # Current downtime is controlled ONLY by downtime_runtime_state.
    # Historical/open rows in downtime_events are not treated as active.
    with get_db() as conn:
        state = conn.execute(
            """SELECT active,downtime_id,downtime_type,since,technician
               FROM downtime_runtime_state
               WHERE machine_name=? LIMIT 1""",
            (machine_name,),
        ).fetchone()

    active = bool(
        state
        and int(state["active"] or 0) == 1
        and state["downtime_id"]
        and state["since"]
    )

    if active:
        since = str(state["since"])
        try:
            start = datetime.strptime(since, "%Y-%m-%d %H:%M:%S")
            elapsed = max(0, int((now - start).total_seconds()))
        except Exception:
            elapsed = 0
        downtime_id = state["downtime_id"]
        downtime_type = str(state["downtime_type"] or "").strip().upper()
        technician = state["technician"]
        # External/current machine status matches the actual downtime state.
        # Examples: MACHINE DOWN or WAITING MATERIAL.
        status = downtime_type if downtime_type in {"MACHINE DOWN", "WAITING MATERIAL"} else "IDLE"
    else:
        status = "RUNNING"
        since = ""
        elapsed = 0
        downtime_id = None
        downtime_type = None
        technician = None

    sync_result = None
    if str(request.args.get("sync", "0")).lower() in {"1", "true", "yes"}:
        ok, message = _sync_machine_status_external(status, since)
        sync_result = {"ok": ok, "message": message}

    return jsonify({
        "success": True,
        "machine_name": machine_name,
        "status": status,
        "since": since,
        "since_seconds": elapsed,
        "downtime_active": active,
        "downtime_id": downtime_id,
        "downtime_start": since if active else None,
        "downtime_start_iso": (
            datetime.strptime(since, "%Y-%m-%d %H:%M:%S").isoformat()
            if active else None
        ),
        "downtime_type": downtime_type,
        "technician": technician,
        "sync": sync_result,
    })


# ── POST /api/maintenance/downtime/start ─────────────────────
@maintenance_bp.post("/api/maintenance/downtime/start")
def start_downtime():
    body         = request.get_json() or {}
    technician   = body.get("technician", "system")
    shift        = body.get("shift", "Shift A")
    # Machine identity is always taken from the active interlock.json.
    machine_code = _machine_name_from_interlock()
    now          = datetime.now()

    with get_db() as conn:
        active_state = conn.execute(
            "SELECT active,downtime_id FROM downtime_runtime_state WHERE machine_name=? LIMIT 1",
            (machine_code,),
        ).fetchone()
        if active_state and int(active_state["active"] or 0) == 1:
            return jsonify({
                "success": False,
                "message": f"Downtime already active: {active_state['downtime_id'] or 'unknown'}",
                "downtime_id": active_state["downtime_id"],
            }), 409

        dtid = f"DT-{now.strftime('%Y%m%d%H%M%S')}"
        conn.execute(
            """INSERT INTO downtime_events
               (downtime_id, start_time, technician, shift, machine_code, downtime_type)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                dtid,
                now.strftime("%Y-%m-%d %H:%M:%S"),
                technician,
                shift,
                machine_code,
                "MACHINE DOWN" if str(body.get("downtime_type", "")).upper() == "MACHINE DOWN"
                else "WAITING MATERIAL",
            )
        )
        row = conn.execute(
            """SELECT id,downtime_id,start_time,downtime_type,technician
               FROM downtime_events WHERE downtime_id=?""",
            (dtid,),
        ).fetchone()

        # Persist CURRENT downtime separately from history.
        conn.execute(
            """INSERT INTO downtime_runtime_state
               (machine_name,active,downtime_id,downtime_type,since,technician,updated_at)
               VALUES (?,?,?,?,?,?,datetime('now','localtime'))
               ON CONFLICT(machine_name) DO UPDATE SET
                   active=excluded.active,
                   downtime_id=excluded.downtime_id,
                   downtime_type=excluded.downtime_type,
                   since=excluded.since,
                   technician=excluded.technician,
                   updated_at=excluded.updated_at""",
            (machine_code, 1, dtid, row["downtime_type"], row["start_time"], technician),
        )
        conn.commit()

    external_no, sync_message = _sync_history_start(dict(row))
    with get_db() as conn:
        conn.execute(
            "UPDATE downtime_events SET external_history_no=? WHERE downtime_id=?",
            (external_no, dtid),
        )
        conn.commit()

    # External machine_status keeps the requested three fields:
    # machine_name, status (RUNNING/IDLE), since (downtime start timestamp).
    _sync_machine_status_external(
        row["downtime_type"] if row["downtime_type"] in {"MACHINE DOWN", "WAITING MATERIAL"} else "IDLE",
        now.strftime("%Y-%m-%d %H:%M:%S"),
    )

    return jsonify({
        "success": True,
        "downtime_id": dtid,
        "start_time": now.isoformat(),
        "machine_name": machine_code,
        "external_history_no": external_no,
        "external_sync_message": sync_message,
    })


# ── POST /api/maintenance/downtime/end ───────────────────────
@maintenance_bp.post("/api/maintenance/downtime/end")
def end_downtime():
    body = request.get_json() or {}
    dtid = body.get("downtime_id")
    if not dtid:
        return jsonify({"success": False, "message": "Missing downtime_id"}), 400

    end_time = datetime.now()
    with get_db() as conn:
        row = conn.execute(
            """SELECT id,start_time,technician,shift,machine_code,
                      external_history_no,downtime_type
               FROM downtime_events WHERE downtime_id = ?""",
            (dtid,)
        ).fetchone()
        if not row:
            return jsonify({"success": False, "message": "Downtime not found"}), 404

        start        = datetime.strptime(row["start_time"], "%Y-%m-%d %H:%M:%S")
        dur_sec      = max(0, int((end_time - start).total_seconds()))
        h, rem       = divmod(dur_sec, 3600)
        m, s         = divmod(rem, 60)
        # Keep the history table duration in HH:MM, matching the existing UI.
        duration_str = f"{h:02d}:{m:02d}"

        downtime_type = body.get("downtime_type") or row["downtime_type"]
        technician = row["technician"] or body.get("technician", "system")
        conn.execute(
            """UPDATE downtime_events
               SET end_time=?, duration=?, downtime_type=?,
                   root_cause=?, corrective_action=?, notes=?
               WHERE downtime_id=?""",
            (
                end_time.strftime("%Y-%m-%d %H:%M:%S"), duration_str,
                downtime_type, body.get("root_cause"),
                body.get("corrective_action"), body.get("notes", ""),
                dtid
            )
        )

        updated = conn.execute(
            """SELECT downtime_id,start_time,end_time,duration,downtime_type,
                      root_cause,corrective_action,technician,external_history_no
               FROM downtime_events WHERE downtime_id=?""",
            (dtid,),
        ).fetchone()

        # Clear CURRENT downtime state immediately after closing the event.
        conn.execute(
            """UPDATE downtime_runtime_state
               SET active=0,downtime_id=NULL,downtime_type=NULL,since=NULL,
                   technician=NULL,updated_at=datetime('now','localtime')
               WHERE machine_name=?""",
            (row["machine_code"],),
        )
        conn.commit()

    ext_ok, ext_message = _sync_history_end(
        updated["external_history_no"], dict(updated)
    )
    _sync_machine_status_external("RUNNING", "")

    return jsonify({
        "success": True,
        "external_sync": ext_ok,
        "external_sync_message": ext_message,
    })


# ── GET /api/maintenance/events ───────────────────────────────
@maintenance_bp.get("/api/maintenance/events")
def get_events():
    start_date = request.args.get("start_date")
    end_date   = request.args.get("end_date")
    page       = int(request.args.get("page", 1))
    per        = int(request.args.get("per", 10))
    start_time = request.args.get("start_time", "00:00")
    end_time   = request.args.get("end_time",   "23:59")

    if not start_date or not end_date:
        return jsonify({"error": "start_date and end_date required"}), 400

    start_dt = f"{start_date} {start_time}:00"
    end_dt   = f"{end_date} {end_time}:59"
    offset   = (page - 1) * per

    with get_db() as conn:
        total = conn.execute(
            """SELECT COUNT(*) FROM downtime_events
               WHERE datetime(start_time) BETWEEN datetime(?) AND datetime(?)
               AND end_time IS NOT NULL""",
            (start_dt, end_dt)
        ).fetchone()[0]

        rows = conn.execute(
            """SELECT * FROM downtime_events
               WHERE datetime(start_time) BETWEEN datetime(?) AND datetime(?)
               AND end_time IS NOT NULL
               ORDER BY start_time DESC LIMIT ? OFFSET ?""",
            (start_dt, end_dt, per, offset)
        ).fetchall()

    return jsonify({"total": total, "page": page, "per": per, "data": [dict(r) for r in rows]})


# ── GET /api/maintenance/stats ────────────────────────────────
@maintenance_bp.get("/api/maintenance/stats")
def get_stats():
    start_date = request.args.get("start_date")
    end_date   = request.args.get("end_date")
    if not start_date or not end_date:
        return jsonify({"error": "start_date and end_date required"}), 400

    with get_db() as conn:
        rows = conn.execute(
            """SELECT duration FROM downtime_events
               WHERE DATE(start_time) BETWEEN ? AND ?
               AND end_time IS NOT NULL AND duration IS NOT NULL""",
            (start_date, end_date)
        ).fetchall()

        total_min = 0
        for r in rows:
            if r[0]:
                try:
                    h, m = r[0].split(":")
                    total_min += int(h) * 60 + int(m)
                except Exception:
                    pass

        occ  = len(rows)
        mttr = total_min // occ if occ else 0

        times = conn.execute(
            """SELECT start_time FROM downtime_events
               WHERE DATE(start_time) BETWEEN ? AND ?
               AND end_time IS NOT NULL
               ORDER BY start_time ASC""",
            (start_date, end_date)
        ).fetchall()

    intervals = []
    for i in range(1, len(times)):
        prev = datetime.strptime(times[i-1][0], "%Y-%m-%d %H:%M:%S")
        curr = datetime.strptime(times[i][0],   "%Y-%m-%d %H:%M:%S")
        intervals.append((curr - prev).total_seconds() / 60)

    mtbf      = int(sum(intervals) / len(intervals)) if intervals else 0
    mtbf_str  = f"{mtbf // 60:02d}:{mtbf % 60:02d}"
    total_str = f"{total_min // 60:02d}:{total_min % 60:02d}"

    return jsonify({
        "total_downtime": total_str,
        "occurrences":    occ,
        "mttr":           mttr,
        "mtbf":           mtbf_str,
    })


# ── GET /api/maintenance/hourly ───────────────────────────────
@maintenance_bp.get("/api/maintenance/hourly")
def get_hourly():
    start_date = request.args.get("start_date")
    end_date   = request.args.get("end_date")
    if not start_date or not end_date:
        return jsonify({"error": "start_date and end_date required"}), 400

    with get_db() as conn:
        rows = conn.execute(
            """SELECT strftime('%H', start_time) as hour,
                  SUM(
                    CAST(substr(duration,1,instr(duration,':')-1) AS INT)*60 +
                    CAST(substr(duration,instr(duration,':')+1,2) AS INT)
                  ) as minutes
               FROM downtime_events
               WHERE DATE(start_time) BETWEEN ? AND ?
                 AND end_time IS NOT NULL AND duration IS NOT NULL
               GROUP BY hour""",
            (start_date, end_date)
        ).fetchall()

    hourly = [0] * 24
    for r in rows:
        try:
            h = int(r["hour"])
            if 0 <= h < 24:
                hourly[h] = int(r["minutes"] or 0)
        except Exception:
            pass

    return jsonify(hourly)


# ── GET /api/maintenance/export ───────────────────────────────
@maintenance_bp.get("/api/maintenance/export")
def export_csv():
    return jsonify({"message": "Export CSV endpoint", "success": True})