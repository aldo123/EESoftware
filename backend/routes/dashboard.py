"""
routes/dashboard.py — FPY / Output / OK / NG dashboard.

Reads from the same snlist_cp{cp} SQLite tables SN List already writes to
(routes/snlist.py). Each row's `result` column (OK/NG) — now guaranteed to
exist by snlist.ensure_table_exists() — is what Logic Builder writes via
the Custom Script node's record_result() builtin (see
logic_builder/custom_script.py). No separate production-results table:
this is the same log SN List's own page shows, just aggregated.
"""
import json
import os
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

from routes.snlist import get_snlist_conn, get_table_name, ensure_table_exists, COLUMN_CONFIG_PATH

dashboard_bp = Blueprint("dashboard", __name__, url_prefix="/api/dashboard")


@dashboard_bp.get("/cps")
def list_cps():
    """CPs that have an SN List table with at least one recorded result —
    reuses the same per-CP column config SN List itself is keyed by."""
    config = {}
    if os.path.exists(COLUMN_CONFIG_PATH):
        try:
            with open(COLUMN_CONFIG_PATH, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception:
            config = {}
    with get_snlist_conn() as conn:
        tables = {
            row["name"] for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'snlist_cp%'"
            )
        }
    cps = sorted(set(config.keys()) | {t[len("snlist_cp"):] for t in tables})
    return jsonify({"success": True, "cps": cps})


def _parse_date(value, fallback):
    if not value:
        return fallback
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return fallback


@dashboard_bp.get("/summary")
def summary():
    cp = request.args.get("cp", "").strip()
    if not cp:
        return jsonify({"success": False, "message": "cp is required"}), 400

    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    date_from = _parse_date(request.args.get("date_from"), today)
    date_to = _parse_date(request.args.get("date_to"), today + timedelta(days=1))
    # An inclusive end date (just "YYYY-MM-DD") should cover the whole day.
    if request.args.get("date_to") and len(request.args.get("date_to")) <= 10:
        date_to = date_to + timedelta(days=1)

    bucket = request.args.get("bucket") or ("hour" if (date_to - date_from) <= timedelta(days=2) else "day")
    bucket_fmt = "%Y-%m-%d %H:00" if bucket == "hour" else "%Y-%m-%d"

    ensure_table_exists(cp)
    table = get_table_name(cp)

    with get_snlist_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT date_time, result FROM {table}
            WHERE date_time >= ? AND date_time < ?
            ORDER BY date_time ASC
            """,
            (date_from.strftime("%Y-%m-%d %H:%M:%S"), date_to.strftime("%Y-%m-%d %H:%M:%S")),
        ).fetchall()

    ok = ng = other = 0
    buckets = {}
    for row in rows:
        result = str(row["result"] or "").strip().upper()
        if result == "OK":
            ok += 1
        elif result == "NG":
            ng += 1
        else:
            other += 1
            continue  # blank/manual rows with no result don't count toward FPY buckets

        raw_dt = row["date_time"] or ""
        try:
            dt = datetime.strptime(raw_dt[:19], "%Y-%m-%d %H:%M:%S")
            key = dt.strftime(bucket_fmt)
        except ValueError:
            key = raw_dt[:13] if bucket == "hour" else raw_dt[:10]

        entry = buckets.setdefault(key, {"bucket": key, "ok": 0, "ng": 0})
        entry["ok" if result == "OK" else "ng"] += 1

    output = ok + ng
    fpy = (ok / output * 100) if output else 0.0

    series = [buckets[k] for k in sorted(buckets.keys())]

    return jsonify({
        "success": True,
        "cp": cp,
        "date_from": date_from.strftime("%Y-%m-%d"),
        "date_to": (date_to - timedelta(days=1)).strftime("%Y-%m-%d"),
        "bucket": bucket,
        "output": output,
        "ok": ok,
        "ng": ng,
        "other": other,
        "fpy": fpy,
        "series": series,
    })
