"""
routes/dashboard.py — configurable production dashboard.

Reads the same SN List SQLite tables (snlist_cp{cp}) used by SN List.
Each test result row contains result=OK/NG. Dashboard KPI classification is
per unique Serial Number:

PASS1
    Unique SN whose FIRST-EVER recorded test is OK. Later retries do not
    change the SN from PASS1.

PASS2
    Unique SN whose FIRST-EVER recorded test is NG and which later records
    an OK at any subsequent test attempt.

NG
    Unique SN whose FIRST-EVER recorded test is NG and which has not recorded
    a later OK yet.

TOTAL QTY
    Number of unique Serial Numbers with an OK/NG result in the selected range.

Classification uses complete history for each SN in the selected-period
population, so a serial can move from NG to PASS2 when a later retry finally
becomes OK.

Dashboard settings are stored per CP in data/dashboard_settings.json.
"""
import json
import os
import re
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

from routes.snlist import (
    get_snlist_conn,
    get_table_name,
    ensure_table_exists,
    COLUMN_CONFIG_PATH,
)

dashboard_bp = Blueprint("dashboard", __name__, url_prefix="/api/dashboard")

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
SETTINGS_PATH = os.path.join(DATA_DIR, "dashboard_settings.json")

DEFAULT_SHIFTS = [
    {"id": "shift1", "label": "Shift 1", "start": "08:00", "end": "19:30"},
    {"id": "shift2", "label": "Shift 2", "start": "20:00", "end": "07:30"},
]

DEFAULT_SETTINGS = {
    "kpi_format": "fpy_pass_ng_total",
    "sn_column": "auto",
    "fpy_formula": {
        "numerator": "pass",
        "denominator": "total_qty",
        "multiplier": 100.0,
    },
    "fpy1_formula": {
        "numerator": "pass1",
        "denominator": "total_qty",
        "multiplier": 100.0,
    },
    "fpy2_formula": {
        "numerator": "pass",
        "denominator": "total_qty",
        "multiplier": 100.0,
    },
    "shifts": DEFAULT_SHIFTS,
}

FORMULA_METRICS = {
    "pass1",
    "pass2",
    "pass",
    "ng",
    "total_qty",
    "test_qty",
    "ok_records",
    "ng_records",
}


def _safe_cp_key(cp):
    return str(cp or "").strip()


def _clone_default_settings():
    return json.loads(json.dumps(DEFAULT_SETTINGS))


def _normalize_formula(value, fallback):
    value = value if isinstance(value, dict) else {}
    numerator = str(value.get("numerator", fallback["numerator"])).strip().lower()
    denominator = str(value.get("denominator", fallback["denominator"])).strip().lower()
    try:
        multiplier = float(value.get("multiplier", fallback["multiplier"]))
    except (TypeError, ValueError):
        multiplier = float(fallback["multiplier"])

    if numerator not in FORMULA_METRICS:
        numerator = fallback["numerator"]
    if denominator not in FORMULA_METRICS:
        denominator = fallback["denominator"]
    if multiplier != multiplier or multiplier in (float("inf"), float("-inf")):
        multiplier = float(fallback["multiplier"])

    return {
        "numerator": numerator,
        "denominator": denominator,
        "multiplier": multiplier,
    }


def _normalize_time(value, fallback):
    raw = str(value or fallback).strip()
    try:
        parsed = datetime.strptime(raw, "%H:%M")
        return parsed.strftime("%H:%M")
    except ValueError:
        return fallback


def _normalize_shifts(value):
    incoming = value if isinstance(value, list) else []
    if not incoming:
        return _clone_default_settings()["shifts"]

    result = []
    used_ids = set()
    for index, item in enumerate(incoming[:8]):
        item = item if isinstance(item, dict) else {}
        raw_id = str(item.get("id") or f"shift{index + 1}").strip()
        shift_id = raw_id or f"shift{index + 1}"
        if shift_id in used_ids:
            shift_id = f"shift{index + 1}"
            while shift_id in used_ids:
                shift_id = f"shift{index + 1}_{len(used_ids) + 1}"
        used_ids.add(shift_id)

        default = DEFAULT_SHIFTS[index] if index < len(DEFAULT_SHIFTS) else {
            "label": f"Shift {index + 1}",
            "start": "00:00",
            "end": "00:00",
        }
        label = str(item.get("label") or default["label"]).strip() or default["label"]
        start = _normalize_time(item.get("start"), default["start"])
        end = _normalize_time(item.get("end"), default["end"])
        result.append({"id": shift_id, "label": label, "start": start, "end": end})

    return result or _clone_default_settings()["shifts"]


def _shift_datetime_window(anchor_date, shift_cfg):
    """Return the shift occurrence for the selected/end date.

    The dashboard date fields represent the calendar dates of the displayed
    shift window. For an overnight shift such as 20:00-07:30, selecting
    27 Sep means 26 Sep 20:00 -> 27 Sep 07:30. For a same-day shift such as
    08:00-19:30, selecting 27 Sep means 27 Sep 08:00 -> 27 Sep 19:30.
    """
    start_text = str(shift_cfg.get("start", "08:00"))
    end_text = str(shift_cfg.get("end", "19:30"))
    start_t = datetime.strptime(start_text, "%H:%M").time()
    end_t = datetime.strptime(end_text, "%H:%M").time()

    anchor = anchor_date.replace(hour=0, minute=0, second=0, microsecond=0)
    start_same_day = anchor.replace(hour=start_t.hour, minute=start_t.minute)
    end_same_day = anchor.replace(hour=end_t.hour, minute=end_t.minute)
    overnight = end_t <= start_t

    if overnight:
        return start_same_day - timedelta(days=1), end_same_day
    return start_same_day, end_same_day


def _normalize_settings(raw):
    raw = raw if isinstance(raw, dict) else {}
    settings = _clone_default_settings()

    fmt = str(raw.get("kpi_format", settings["kpi_format"])).strip()
    if fmt in {"fpy_pass_ng_total", "pass1_pass2_fpy1_fpy2_total"}:
        settings["kpi_format"] = fmt

    settings["sn_column"] = str(raw.get("sn_column", "auto") or "auto").strip()

    settings["fpy_formula"] = _normalize_formula(
        raw.get("fpy_formula"), settings["fpy_formula"]
    )
    settings["fpy1_formula"] = _normalize_formula(
        raw.get("fpy1_formula"), settings["fpy1_formula"]
    )
    settings["fpy2_formula"] = _normalize_formula(
        raw.get("fpy2_formula"), settings["fpy2_formula"]
    )
    settings["shifts"] = _normalize_shifts(raw.get("shifts"))
    return settings


def _load_all_settings():
    if not os.path.exists(SETTINGS_PATH):
        return {}
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_all_settings(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    temp_path = SETTINGS_PATH + ".tmp"
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(temp_path, SETTINGS_PATH)


def _load_settings(cp):
    all_settings = _load_all_settings()
    return _normalize_settings(all_settings.get(_safe_cp_key(cp), {}))


def _save_settings(cp, settings):
    cp_key = _safe_cp_key(cp)
    if not cp_key:
        raise ValueError("cp is required")
    all_settings = _load_all_settings()
    all_settings[cp_key] = _normalize_settings(settings)
    _save_all_settings(all_settings)
    return all_settings[cp_key]


def _quote_ident(identifier):
    return '"' + str(identifier).replace('"', '""') + '"'


def _table_columns(cp):
    table = get_table_name(cp)
    ensure_table_exists(cp)
    with get_snlist_conn() as conn:
        rows = conn.execute(f"PRAGMA table_info({_quote_ident(table)})").fetchall()
    return [str(row["name"]) for row in rows]


def _ensure_result_column(cp):
    table = get_table_name(cp)
    columns = _table_columns(cp)
    if "result" not in {c.lower() for c in columns}:
        with get_snlist_conn() as conn:
            conn.execute(
                f"ALTER TABLE {_quote_ident(table)} ADD COLUMN {_quote_ident('result')} TEXT"
            )
            conn.commit()
        columns = _table_columns(cp)
    return columns


def _load_column_labels(cp):
    labels = {}
    if not os.path.exists(COLUMN_CONFIG_PATH):
        return labels
    try:
        with open(COLUMN_CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
        for item in config.get(str(cp), []) or []:
            if isinstance(item, dict) and item.get("key"):
                labels[str(item["key"])] = str(item.get("label") or item["key"])
    except Exception:
        pass
    return labels


def _serial_candidates(columns):
    canonical = {
        re.sub(r"[^a-z0-9]", "", str(c).lower()): c
        for c in columns
    }
    preferred = [
        "serialnumber",
        "serialno",
        "serial",
        "sn",
        "snnumber",
        "snno",
        "productsn",
        "productserialnumber",
        "chassissn",
        "chassisserialnumber",
        "unitserialnumber",
    ]
    result = []
    for key in preferred:
        if key in canonical and canonical[key] not in result:
            result.append(canonical[key])

    # Common fallback names containing both SN and serial keywords.
    for col in columns:
        norm = re.sub(r"[^a-z0-9]", "", str(col).lower())
        if ("sn" in norm or "serial" in norm) and col not in result:
            result.append(col)
    return result


def _resolve_sn_column(cp, settings, columns):
    requested = str(settings.get("sn_column", "auto") or "auto").strip()
    lower_map = {c.lower(): c for c in columns}
    if requested.lower() == "auto":
        candidates = _serial_candidates(
            [c for c in columns if c.lower() not in {"id", "date_time", "result"}]
        )
        return (candidates[0] if candidates else None), candidates

    if requested.lower() in lower_map:
        return lower_map[requested.lower()], _serial_candidates(columns)

    return None, _serial_candidates(columns)


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


def _parse_datetime(value):
    raw = str(value or "")
    try:
        return datetime.strptime(raw[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def _metric_value(metrics, name):
    if name == "pass":
        return metrics.get("pass1", 0) + metrics.get("pass2", 0)
    return metrics.get(name, 0)


def _calculate_formula(formula, metrics):
    numerator = _metric_value(metrics, formula.get("numerator", "pass"))
    denominator = _metric_value(metrics, formula.get("denominator", "total_qty"))
    try:
        multiplier = float(formula.get("multiplier", 100.0))
    except (TypeError, ValueError):
        multiplier = 100.0
    if denominator == 0:
        return 0.0
    result = (float(numerator) / float(denominator)) * multiplier
    return round(result, 1)


def _classify_groups(period_rows, history_rows, sn_column, period_start=None):
    """
    Classify unique SNs using history that existed up to the end of the
    selected shift/date window.

    Counting rule:
      1. Before counting a SN in the selected period, check its history before
         period_start. If it had any earlier OK, it already passed and is
         completely excluded from this period (retest OK/NG is not counted).
      2. If it was not previously passed:
           PASS1 = first-ever test is OK.
           PASS2 = first-ever test is NG and a later OK occurs by period_end.
           NG    = first-ever test is NG and no later OK exists by period_end.

    This intentionally does not look into future shifts when a historical
    period is selected.
    """
    period_groups = {}
    skipped_prior_pass = set()

    # A prior OK means the SN already passed before this shift/date window.
    if period_start is not None:
        for row in history_rows:
            sn = str(row.get(sn_column, "") or "").strip()
            if not sn:
                continue
            result = str(row.get("result", "") or "").strip().upper()
            dt = _parse_datetime(row.get("date_time"))
            if result == "OK" and dt is not None and dt < period_start:
                skipped_prior_pass.add(sn)

    # Build only the SN population that is eligible for counting.
    result_count = 0
    ok_records = 0
    ng_records = 0

    for index, row in enumerate(period_rows):
        sn = str(row[sn_column] or "").strip()
        result = str(row["result"] or "").strip().upper()
        dt = _parse_datetime(row["date_time"])
        row_id = row.get("id", index) if isinstance(row, dict) else index

        if not sn or sn in skipped_prior_pass or result not in {"OK", "NG"}:
            continue

        if result == "OK":
            ok_records += 1
            result_count += 1
        elif result == "NG":
            ng_records += 1
            result_count += 1

        group = period_groups.setdefault(sn, {"tests": []})
        group["tests"].append(
            {
                "result": result,
                "dt": dt,
                "index": index,
                "id": row_id,
            }
        )

    candidate_sns = set(period_groups.keys())
    history_groups = {sn: [] for sn in candidate_sns}

    for index, row in enumerate(history_rows):
        sn = str(row.get(sn_column, "") or "").strip()
        if sn not in candidate_sns:
            continue

        result = str(row.get("result", "") or "").strip().upper()
        if result not in {"OK", "NG"}:
            continue

        dt = _parse_datetime(row.get("date_time"))
        row_id = row.get("id", index) if isinstance(row, dict) else index
        history_groups[sn].append(
            {
                "result": result,
                "dt": dt,
                "index": index,
                "id": row_id,
            }
        )

    classified = []
    for sn, period_group in period_groups.items():
        period_tests = sorted(
            period_group["tests"],
            key=lambda x: (
                x["dt"] or datetime.max,
                x.get("id", x["index"]),
                x["index"],
            ),
        )

        tests = sorted(
            history_groups.get(sn, []),
            key=lambda x: (
                x["dt"] or datetime.max,
                x.get("id", x["index"]),
                x["index"],
            ),
        )

        if not tests:
            continue

        results = [x["result"] for x in tests]
        first = results[0]

        if first == "OK":
            # No prior OK exists because such SNs were already excluded.
            category = "pass1"
        elif first == "NG" and "OK" in results[1:]:
            category = "pass2"
        elif first == "NG":
            category = "ng"
        else:
            category = "other"

        display_dt = period_tests[-1]["dt"] if period_tests else tests[0]["dt"]

        classified.append(
            {
                "sn": sn,
                "category": category,
                "first_dt": tests[0]["dt"],
                "display_dt": display_dt,
                "tests": len(period_tests),
                "history_tests": len(tests),
            }
        )

    return classified, {
        "test_qty": result_count,
        "ok_records": ok_records,
        "ng_records": ng_records,
        "skipped_prior_pass": len(skipped_prior_pass),
    }

def _aggregate_classifications(classified):
    metrics = {
        "pass1": 0,
        "pass2": 0,
        "ng": 0,
        "total_qty": len(classified),
        "test_qty": 0,
        "ok_records": 0,
        "ng_records": 0,
    }
    for item in classified:
        if item["category"] in {"pass1", "pass2", "ng"}:
            metrics[item["category"]] += 1
        metrics["test_qty"] += int(item["tests"] or 0)
    metrics["pass"] = metrics["pass1"] + metrics["pass2"]
    return metrics


def _bucket_label(dt, bucket_fmt):
    if not dt:
        return ""
    return dt.strftime(bucket_fmt)


def _current_shift_window(shifts, now=None):
    """Return (shift_cfg, start_dt, end_dt) for the shift active right now."""
    now = now or datetime.now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    for shift_cfg in shifts or []:
        try:
            start_t = datetime.strptime(
                str(shift_cfg.get("start", "08:00")), "%H:%M"
            ).time()
            end_t = datetime.strptime(
                str(shift_cfg.get("end", "19:30")), "%H:%M"
            ).time()
        except ValueError:
            continue

        current_t = now.time()
        if end_t > start_t:
            active = start_t <= current_t < end_t
            if not active:
                continue
            return (
                shift_cfg,
                today.replace(hour=start_t.hour, minute=start_t.minute),
                today.replace(hour=end_t.hour, minute=end_t.minute),
            )

        # Overnight shift, e.g. 20:00 -> 07:30.
        if current_t >= start_t:
            return (
                shift_cfg,
                today.replace(hour=start_t.hour, minute=start_t.minute),
                (today + timedelta(days=1)).replace(
                    hour=end_t.hour, minute=end_t.minute
                ),
            )
        if current_t < end_t:
            return (
                shift_cfg,
                (today - timedelta(days=1)).replace(
                    hour=start_t.hour, minute=start_t.minute
                ),
                today.replace(hour=end_t.hour, minute=end_t.minute),
            )

    return None


def _calculate_window_metrics(cp, date_from, date_to, history_end=None):
    """
    Read one dashboard window and calculate lifecycle KPIs.

    history_end limits history to the end of the viewed window (or the current
    time when a live window has not finished yet) so historical selections never
    get changed by later shifts.
    """
    settings = _load_settings(cp)
    columns = _ensure_result_column(cp)
    sn_column, candidates = _resolve_sn_column(cp, settings, columns)

    if not sn_column:
        raise ValueError(
            "Serial Number column is not configured. "
            "Open Dashboard Settings and select the SN column."
        )

    table = get_table_name(cp)

    with get_snlist_conn() as conn:
        period_rows_raw = conn.execute(
            f"""
            SELECT {_quote_ident('id')} AS id,
                   {_quote_ident(sn_column)} AS sn_value,
                   {_quote_ident('date_time')} AS date_time,
                   {_quote_ident('result')} AS result
            FROM {_quote_ident(table)}
            WHERE {_quote_ident('date_time')} >= ?
              AND {_quote_ident('date_time')} < ?
            ORDER BY {_quote_ident('date_time')} ASC, {_quote_ident('id')} ASC
            """,
            (
                date_from.strftime("%Y-%m-%d %H:%M:%S"),
                date_to.strftime("%Y-%m-%d %H:%M:%S"),
            ),
        ).fetchall()

    period_rows = []
    candidate_sns = []
    seen_sns = set()

    for row in period_rows_raw:
        sn = str(row["sn_value"] or "").strip()
        period_rows.append(
            {
                sn_column: row["sn_value"],
                "date_time": row["date_time"],
                "result": row["result"],
                "id": row["id"],
            }
        )
        result_value = str(row["result"] or "").strip().upper()
        if sn and result_value in {"OK", "NG"} and sn not in seen_sns:
            seen_sns.add(sn)
            candidate_sns.append(sn)

    # Do not look after the end of the historical window. For a live current
    # shift whose scheduled end is still in the future, stop at now.
    if history_end is None:
        history_end = date_to
    history_end = min(history_end, date_to)

    history_rows = []
    if candidate_sns:
        with get_snlist_conn() as conn:
            for start_idx in range(0, len(candidate_sns), 500):
                chunk = candidate_sns[start_idx:start_idx + 500]
                placeholders = ", ".join("?" for _ in chunk)
                history_rows_raw = conn.execute(
                    f"""
                    SELECT {_quote_ident('id')} AS id,
                           {_quote_ident(sn_column)} AS sn_value,
                           {_quote_ident('date_time')} AS date_time,
                           {_quote_ident('result')} AS result
                    FROM {_quote_ident(table)}
                    WHERE {_quote_ident(sn_column)} IN ({placeholders})
                      AND {_quote_ident('result')} IN ('OK', 'NG')
                      AND {_quote_ident('date_time')} < ?
                    ORDER BY {_quote_ident('date_time')} ASC, {_quote_ident('id')} ASC
                    """,
                    (*chunk, history_end.strftime("%Y-%m-%d %H:%M:%S")),
                ).fetchall()

                for row in history_rows_raw:
                    history_rows.append(
                        {
                            sn_column: row["sn_value"],
                            "date_time": row["date_time"],
                            "result": row["result"],
                            "id": row["id"],
                        }
                    )

    classified, record_metrics = _classify_groups(
        period_rows,
        history_rows,
        sn_column,
        period_start=date_from,
    )
    metrics = _aggregate_classifications(classified)
    metrics.update(record_metrics)
    metrics["pass"] = metrics["pass1"] + metrics["pass2"]

    return {
        "settings": settings,
        "sn_column": sn_column,
        "sn_candidates": candidates,
        "metrics": metrics,
        "classified": classified,
        "date_from": date_from,
        "date_to": date_to,
    }


def get_current_shift_dashboard_metrics(cp, now=None):
    """
    Return the KPI values for the shift/date active at the current time.

    This function is intentionally independent from the dashboard UI's selected
    historical date. Internal Variables use this function so System Dashboard
    values always represent the machine's current shift.
    """
    cp = str(cp or "").strip()
    now = now or datetime.now()
    settings = _load_settings(cp)

    current = _current_shift_window(settings.get("shifts", []), now=now)
    if current is None:
        return {
            "active": False,
            "shift_id": "",
            "shift_label": "No Active Shift",
            "shift_start": None,
            "shift_end": None,
            "pass1": 0,
            "pass2": 0,
            "pass": 0,
            "ng": 0,
            "total_qty": 0,
            "fpy": 0.0,
            "fpy1": 0.0,
            "fpy2": 0.0,
        }

    shift_cfg, date_from, date_to = current
    history_end = min(date_to, now)
    result = _calculate_window_metrics(
        cp,
        date_from,
        date_to,
        history_end=history_end,
    )
    metrics = result["metrics"]

    return {
        "active": True,
        "shift_id": str(shift_cfg.get("id", "")),
        "shift_label": str(shift_cfg.get("label", "Shift")),
        "shift_start": date_from.isoformat(),
        "shift_end": date_to.isoformat(),
        "pass1": int(metrics["pass1"]),
        # Raw lifecycle PASS2 remains available for chart/details.
        "pass2": int(metrics["pass2"]),
        # KPI Format 2 displays Pass2 as total Pass = Pass1 + lifecycle Pass2.
        "kpi_pass2": int(metrics["pass"]),
        "pass": int(metrics["pass"]),
        "ng": int(metrics["ng"]),
        "total_qty": int(metrics["total_qty"]),
        "fpy": _calculate_formula(settings["fpy_formula"], metrics),
        "fpy1": _calculate_formula(settings["fpy1_formula"], metrics),
        "fpy2": _calculate_formula(settings["fpy2_formula"], metrics),
    }

@dashboard_bp.get("/cps")
def list_cps():
    config = {}
    if os.path.exists(COLUMN_CONFIG_PATH):
        try:
            with open(COLUMN_CONFIG_PATH, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception:
            config = {}

    with get_snlist_conn() as conn:
        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name LIKE 'snlist_cp%'"
            )
        }

    cps = sorted(
        set(config.keys())
        | {t[len("snlist_cp") :] for t in tables}
    )
    return jsonify({"success": True, "cps": cps})


@dashboard_bp.get("/settings")
def get_dashboard_settings():
    cp = str(request.args.get("cp", "")).strip()
    if not cp:
        return jsonify({"success": False, "message": "cp is required"}), 400

    columns = _ensure_result_column(cp)
    settings = _load_settings(cp)
    labels = _load_column_labels(cp)

    selectable_columns = []
    for column in columns:
        low = column.lower()
        if low in {"id", "date_time", "result"}:
            continue
        selectable_columns.append(
            {
                "key": column,
                "label": labels.get(column, column),
            }
        )

    resolved, candidates = _resolve_sn_column(cp, settings, columns)

    return jsonify(
        {
            "success": True,
            "cp": cp,
            "settings": settings,
            "columns": selectable_columns,
            "sn_column_resolved": resolved,
            "sn_candidates": candidates,
        }
    )


@dashboard_bp.put("/settings")
def update_dashboard_settings():
    body = request.get_json(silent=True) or {}
    cp = str(body.get("cp", "")).strip()
    if not cp:
        return jsonify({"success": False, "message": "cp is required"}), 400

    columns = _ensure_result_column(cp)
    incoming = _normalize_settings(body.get("settings"))
    requested = incoming.get("sn_column", "auto")

    if requested.lower() != "auto" and requested.lower() not in {
        c.lower() for c in columns
    }:
        return (
            jsonify(
                {
                    "success": False,
                    "message": f"Invalid SN column: {requested}",
                }
            ),
            400,
        )

    saved = _save_settings(cp, incoming)
    resolved, candidates = _resolve_sn_column(cp, saved, columns)

    return jsonify(
        {
            "success": True,
            "cp": cp,
            "settings": saved,
            "sn_column_resolved": resolved,
            "sn_candidates": candidates,
        }
    )


@dashboard_bp.get("/summary")
def summary():
    cp = request.args.get("cp", "").strip()
    if not cp:
        return jsonify({"success": False, "message": "cp is required"}), 400

    now = datetime.now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    settings = _load_settings(cp)
    raw_shift = request.args.get("shift")
    selected_shift = str(raw_shift or "all").strip().lower()

    shift_cfg = None
    if raw_shift is None and not request.args.get("date_from") and not request.args.get("date_to"):
        current = _current_shift_window(settings.get("shifts", []), now=now)
        if current is not None:
            current_cfg, current_from, current_to = current
            selected_shift = str(current_cfg.get("id", "all")).strip().lower()
            shift_cfg = current_cfg

    if selected_shift != "all" and shift_cfg is None:
        for item in settings.get("shifts", []):
            if str(item.get("id", "")).strip().lower() == selected_shift:
                shift_cfg = item
                break

    requested_from = _parse_date(request.args.get("date_from"), today)
    requested_to = _parse_date(request.args.get("date_to"), today)

    if shift_cfg is not None:
        anchor_date = requested_to if request.args.get("date_to") else requested_from
        date_from, date_to = _shift_datetime_window(anchor_date, shift_cfg)
    else:
        selected_shift = "all"
        date_from = requested_from
        date_to = requested_to + timedelta(days=1)
        if request.args.get("date_to") and len(request.args.get("date_to")) > 10:
            date_to = requested_to

    bucket = request.args.get("bucket") or (
        "hour" if (date_to - date_from) <= timedelta(days=2) else "day"
    )
    if bucket not in {"hour", "day"}:
        bucket = "day"
    bucket_fmt = "%Y-%m-%d %H:00" if bucket == "hour" else "%Y-%m-%d"

    try:
        window = _calculate_window_metrics(
            cp,
            date_from,
            date_to,
            history_end=min(date_to, now),
        )
    except Exception as exc:
        return jsonify({
            "success": False,
            "message": str(exc),
        }), 400

    settings = window["settings"]
    sn_column = window["sn_column"]
    metrics = window["metrics"]
    classified = window["classified"]

    fpy = _calculate_formula(settings["fpy_formula"], metrics)
    fpy1 = _calculate_formula(settings["fpy1_formula"], metrics)
    fpy2 = _calculate_formula(settings["fpy2_formula"], metrics)

    buckets = {}
    for item in classified:
        if not item.get("display_dt"):
            continue
        key = _bucket_label(item["display_dt"], bucket_fmt)
        entry = buckets.setdefault(
            key,
            {
                "bucket": key,
                "pass1": 0,
                "pass2": 0,
                "ng": 0,
                "total_qty": 0,
                "test_qty": 0,
            },
        )
        entry["total_qty"] += 1
        entry["test_qty"] += int(item["tests"] or 0)
        if item["category"] in {"pass1", "pass2", "ng"}:
            entry[item["category"]] += 1

    series = []
    for key in sorted(buckets.keys()):
        entry = buckets[key]
        entry["pass"] = entry["pass1"] + entry["pass2"]
        entry["fpy"] = _calculate_formula(settings["fpy_formula"], entry)
        entry["fpy1"] = _calculate_formula(settings["fpy1_formula"], entry)
        entry["fpy2"] = _calculate_formula(settings["fpy2_formula"], entry)
        series.append(entry)

    output = metrics["test_qty"]
    ok = metrics["ok_records"]
    ng_records = metrics["ng_records"]

    return jsonify(
        {
            "success": True,
            "cp": cp,
            "date_from": date_from.strftime("%Y-%m-%d"),
            "date_to": (date_to - timedelta(days=1)).strftime("%Y-%m-%d"),
            "bucket": bucket,
            "shift": selected_shift,
            "shift_label": shift_cfg.get("label") if shift_cfg else "All Shift",
            "shift_start": date_from.isoformat() if shift_cfg else None,
            "shift_end": date_to.isoformat() if shift_cfg else None,
            "sn_column": sn_column,
            "sn_column_resolved": sn_column,
            "settings": settings,
            "pass1": metrics["pass1"],
            "pass2": metrics["pass2"],
            "pass": metrics["pass"],
            "ng": metrics["ng"],
            "total_qty": metrics["total_qty"],
            "test_qty": metrics["test_qty"],
            "ok_records": ok,
            "ng_records": ng_records,
            "skipped_prior_pass": metrics.get("skipped_prior_pass", 0),
            "fpy": fpy,
            "fpy1": fpy1,
            "fpy2": fpy2,
            "output": output,
            "ok": ok,
            "series": series,
        }
    )
