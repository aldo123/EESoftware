import os
import sqlite3
from datetime import datetime
from flask import Blueprint, request, jsonify

maintenance_bp = Blueprint("maintenance", __name__)

DATA_DIR       = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
MAINTENANCE_DB = os.path.join(DATA_DIR, "maintenance.db")


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
                created_at        TEXT DEFAULT (datetime('now','localtime'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS machine_config (
                key   TEXT PRIMARY KEY,
                value TEXT
            )
        """)
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


# ── POST /api/maintenance/downtime/start ─────────────────────
@maintenance_bp.post("/api/maintenance/downtime/start")
def start_downtime():
    body         = request.get_json() or {}
    technician   = body.get("technician",   "system")
    shift        = body.get("shift",        "Shift A")
    machine_code = body.get("machine_code", "CP2-PCBAVM3")
    now          = datetime.now()
    dtid         = f"DT-{now.strftime('%Y%m%d%H%M%S')}"

    with get_db() as conn:
        conn.execute(
            """INSERT INTO downtime_events
               (downtime_id, start_time, technician, shift, machine_code)
               VALUES (?, ?, ?, ?, ?)""",
            (dtid, now.strftime("%Y-%m-%d %H:%M:%S"), technician, shift, machine_code)
        )
    return jsonify({"success": True, "downtime_id": dtid, "start_time": now.isoformat()})


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
            "SELECT start_time FROM downtime_events WHERE downtime_id = ?", (dtid,)
        ).fetchone()
        if not row:
            return jsonify({"success": False, "message": "Downtime not found"}), 404

        start        = datetime.strptime(row["start_time"], "%Y-%m-%d %H:%M:%S")
        dur_sec      = int((end_time - start).total_seconds())
        h, m         = dur_sec // 3600, (dur_sec % 3600) // 60
        duration_str = f"{h:02d}:{m:02d}"

        conn.execute(
            """UPDATE downtime_events
               SET end_time=?, duration=?, downtime_type=?,
                   root_cause=?, corrective_action=?, notes=?
               WHERE downtime_id=?""",
            (
                end_time.strftime("%Y-%m-%d %H:%M:%S"), duration_str,
                body.get("downtime_type"), body.get("root_cause"),
                body.get("corrective_action"), body.get("notes", ""),
                dtid
            )
        )
    return jsonify({"success": True})


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