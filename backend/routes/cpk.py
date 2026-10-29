"""
routes/cpk.py — CPK Analyzer backend: process capability calculation, an
Excel importer that hands the whole table to the frontend (filtering,
summary, and failure analysis all run client-side from that table), a
Traceability MySQL puller for the database data source, and two Excel
exporters for the result/report and the raw dataset.
"""
import io
import re
import os
import json
import sqlite3
import math
from pathlib import Path
from datetime import datetime, timedelta
import numpy as np

from flask import Blueprint, request, jsonify, send_file
from openpyxl import load_workbook, Workbook



# ── Embedded CPK calculation engine (single-file deployment) ──
import math

import numpy as np


class UnsafeDataError(Exception):
    pass


def clean_values(raw):
    """Coerce a list of mixed values (numbers, numeric strings, None) into
    a numpy float array, dropping anything that doesn't parse — mirrors
    pandas.to_numeric(..., errors="coerce").dropna() from the original tool."""
    out = []
    for v in raw or []:
        if v is None or v == "":
            continue
        try:
            out.append(float(v))
        except (TypeError, ValueError):
            continue
    return np.array(out, dtype=float)


class CPKCalculator:
    @staticmethod
    def calculate(values: np.ndarray, lsl: float, usl: float) -> dict:
        if len(values) < 2:
            raise UnsafeDataError("Minimal 2 data diperlukan.")
        if lsl >= usl:
            raise UnsafeDataError("LSL harus lebih kecil daripada USL.")

        mean = float(values.mean())
        std = float(values.std(ddof=1))
        n = len(values)

        minimum = float(values.min())
        maximum = float(values.max())
        median = float(np.median(values))

        if std == 0 or np.isclose(std, 0):
            cpu = cpl = cp = cpk = math.inf
        else:
            cpu = (usl - mean) / (3 * std)
            cpl = (mean - lsl) / (3 * std)
            cp = (usl - lsl) / (6 * std)
            cpk = min(cpu, cpl)

        below_lsl = int((values < lsl).sum())
        above_usl = int((values > usl).sum())
        out_of_spec = below_lsl + above_usl
        ppm = (out_of_spec / n) * 1_000_000 if n > 0 else 0

        if std > 0:
            z_lsl = (lsl - mean) / std
            z_usl = (usl - mean) / std
            z_min = min(abs(z_lsl), abs(z_usl)) if not math.isinf(z_lsl) and not math.isinf(z_usl) else 0
            z_score = z_min + 1.5
        else:
            z_score = 0

        if cpk == math.inf:
            capability, rating = "EXCELLENT", 5
        elif cpk >= 1.67:
            capability, rating = "CAPABLE", 4
        elif cpk >= 1.33:
            capability, rating = "MARGINAL - CAPABLE", 3
        elif cpk >= 1.00:
            capability, rating = "MARGINAL", 2
        else:
            capability, rating = "NOT CAPABLE", 1

        return {
            "sample_size": n,
            "mean": mean,
            "std": std,
            "minimum": minimum,
            "maximum": maximum,
            "range": maximum - minimum,
            "median": median,
            "lsl": lsl,
            "usl": usl,
            "tolerance": usl - lsl,
            "cp": cp,
            "cpu": cpu,
            "cpl": cpl,
            "cpk": cpk,
            "below_lsl": below_lsl,
            "above_usl": above_usl,
            "out_of_spec": out_of_spec,
            "ppm": ppm,
            "z_score": z_score,
            "capability": capability,
            "rating": rating,
        }


class CPKAssessment:
    STANDARDS = {
        "Automotive": {"excellent": 2.00, "capable": 1.67, "marginal": 1.33, "minimum": 1.00},
        "Medical": {"excellent": 2.00, "capable": 1.67, "marginal": 1.33, "minimum": 1.00},
        "Electronics": {"excellent": 1.67, "capable": 1.33, "marginal": 1.00, "minimum": 0.67},
        "General Manufacturing": {"excellent": 1.67, "capable": 1.33, "marginal": 1.00, "minimum": 0.67},
        "Consumer Products": {"excellent": 1.33, "capable": 1.00, "marginal": 0.67, "minimum": 0.50},
    }

    @staticmethod
    def get_industry_names():
        return list(CPKAssessment.STANDARDS.keys())

    @staticmethod
    def assess(cpk, cp, cpl, cpu, lsl, usl, mean, std, industry="General Manufacturing"):
        standards = CPKAssessment.STANDARDS.get(industry, CPKAssessment.STANDARDS["General Manufacturing"])

        if cpk == math.inf or cpk >= standards["excellent"]:
            status, level = "EXCELLENT", 5
        elif cpk >= standards["capable"]:
            status, level = "CAPABLE", 4
        elif cpk >= standards["marginal"]:
            status, level = "MARGINAL", 3
        elif cpk >= standards["minimum"]:
            status, level = "POOR", 2
        else:
            status, level = "NOT CAPABLE", 1

        recommendations = []
        target = (lsl + usl) / 2
        centering = abs(mean - target) / ((usl - lsl) / 2) * 100 if usl != lsl else 0

        if centering > 10:
            recommendations.append({
                "issue": "Process is off-center",
                "detail": f"Mean ({mean:.3f}) is {centering:.1f}% from target ({target:.3f})",
                "action": "Apply calibration to shift mean to target",
            })

        if cp != math.inf and cp < 1.0:
            recommendations.append({
                "issue": "Process variation is too high",
                "detail": f"Cp = {cp:.3f} (should be >= 1.0)",
                "action": "Reduce process variation by improving control",
            })

        if cp != math.inf and cpk != math.inf and (cp - cpk) > 0.3:
            recommendations.append({
                "issue": "Process is not centered",
                "detail": f"Cp - Cpk = {cp - cpk:.3f} (should be < 0.3)",
                "action": "Adjust process mean to center between LSL and USL",
            })

        if cpk != math.inf:
            if cpk >= standards["excellent"]:
                recommendations.append({"issue": "Process is EXCELLENT", "detail": f"Cpk = {cpk:.3f} >= {standards['excellent']:.2f}", "action": "Maintain current process control"})
            elif cpk >= standards["capable"]:
                recommendations.append({"issue": "Process is CAPABLE", "detail": f"Cpk = {cpk:.3f} >= {standards['capable']:.2f}", "action": "Continue monitoring and maintain control"})
            elif cpk >= standards["marginal"]:
                recommendations.append({"issue": "Process is MARGINAL", "detail": f"Cpk = {cpk:.3f} between {standards['marginal']:.2f}-{standards['capable']:.2f}", "action": "Improve process centering and reduce variation"})
            elif cpk >= standards["minimum"]:
                recommendations.append({"issue": "Process is POOR", "detail": f"Cpk = {cpk:.3f} is below {standards['marginal']:.2f}", "action": "Immediate improvement needed: center and reduce variation"})
            else:
                recommendations.append({"issue": "Process is NOT CAPABLE", "detail": f"Cpk = {cpk:.3f} is below {standards['minimum']:.2f}", "action": "URGENT: process redesign or major improvement required"})

        if cpl != math.inf and cpu != math.inf:
            if cpl < 1.0:
                recommendations.append({"issue": "Process too close to LSL", "detail": f"Cpl = {cpl:.3f} (should be >= 1.0)", "action": "Shift mean upward or reduce variation"})
            if cpu < 1.0:
                recommendations.append({"issue": "Process too close to USL", "detail": f"Cpu = {cpu:.3f} (should be >= 1.0)", "action": "Shift mean downward or reduce variation"})

        target_cpk = standards["capable"]
        if cpk != math.inf and cpk < target_cpk:
            improvement_needed = target_cpk - cpk
        else:
            target_cpk = cpk if cpk != math.inf else target_cpk
            improvement_needed = 0

        return {
            "status": status,
            "level": level,
            "standards": standards,
            "recommendations": recommendations,
            "target_cpk": target_cpk,
            "improvement_needed": improvement_needed,
        }


class CalibrationEngine:
    @staticmethod
    def calibrate(values: np.ndarray, k: float, b: float) -> np.ndarray:
        return k * values + b

    @staticmethod
    def auto_calibrate(values: np.ndarray, lsl: float, usl: float):
        if len(values) < 2:
            raise UnsafeDataError("Data tidak cukup untuk kalibrasi.")

        mean = float(values.mean())
        target_mean = (lsl + usl) / 2
        shift = target_mean - mean

        k = 1.0
        b = shift

        std = float(values.std(ddof=1))
        if std > 0:
            tolerance = usl - lsl
            target_std = tolerance / 6
            if target_std > 0:
                k_scale = target_std / std
                if 0.5 <= k_scale <= 2.0:
                    k = k_scale
                    b = target_mean - k * mean

        calibrated = CalibrationEngine.calibrate(values, k, b)
        original = CPKCalculator.calculate(values, lsl, usl)
        result = CPKCalculator.calculate(calibrated, lsl, usl)

        original_cpk = original["cpk"]
        new_cpk = result["cpk"]
        if original_cpk == math.inf:
            improvement_pct = 0
        elif new_cpk == math.inf:
            improvement_pct = 100
        else:
            improvement_pct = ((new_cpk - original_cpk) / original_cpk * 100) if original_cpk > 0 else 0

        return {
            "k": k,
            "b": b,
            "original": original,
            "calibrated": result,
            "improvement_pct": improvement_pct,
            "calibrated_values": calibrated.tolist(),
        }


def boxplot_stats(values: np.ndarray) -> dict:
    """Standard Tukey box plot: Q1/median/Q3, whiskers at 1.5*IQR, and any
    points beyond that as individual outliers."""
    q1 = float(np.percentile(values, 25))
    median = float(np.percentile(values, 50))
    q3 = float(np.percentile(values, 75))
    iqr = q3 - q1
    lower_fence = q1 - 1.5 * iqr
    upper_fence = q3 + 1.5 * iqr

    within_fences = values[(values >= lower_fence) & (values <= upper_fence)]
    whisker_low = float(within_fences.min()) if len(within_fences) else q1
    whisker_high = float(within_fences.max()) if len(within_fences) else q3
    outliers = values[(values < lower_fence) | (values > upper_fence)]

    return {
        "q1": q1,
        "median": median,
        "q3": q3,
        "whisker_low": whisker_low,
        "whisker_high": whisker_high,
        "outliers": outliers.tolist(),
    }


def histogram(values: np.ndarray, lsl: float, usl: float, bins: int = 20) -> dict:
    """Bin the data for a bar-chart histogram, keyed the same way regardless
    of whether the spec limits fall inside or outside the data range."""
    lo = min(float(values.min()), lsl)
    hi = max(float(values.max()), usl)
    if lo == hi:
        lo -= 0.5
        hi += 0.5

    counts, edges = np.histogram(values, bins=bins, range=(lo, hi))
    return {
        "counts": counts.tolist(),
        "edges": edges.tolist(),
    }


cpk_bp = Blueprint("cpk", __name__, url_prefix="/api/cpk")

# Table/column names can't be parameterized like values can, so they're
# checked against this whitelist before ever touching an f-string SQL query.
_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _safe_identifier(name, label):
    name = str(name or "").strip()
    if not _IDENTIFIER_RE.match(name):
        raise ValueError(f"{label} tidak valid: '{name}'")
    return name


@cpk_bp.get("/industries")
def get_industries():
    return jsonify({"success": True, "industries": CPKAssessment.get_industry_names()})


@cpk_bp.get("/standards")
def get_standards():
    return jsonify({"success": True, "standards": CPKAssessment.STANDARDS})


def _cell_to_json(value):
    """openpyxl hands back datetime/Decimal-ish objects for some cells —
    stringify anything that isn't already JSON-safe."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


@cpk_bp.post("/parse-file")
def parse_file():
    """Read an uploaded Excel file and hand back the whole table (headers +
    every row as an object). The page keeps this in memory and does all its
    filtering/summary/failure-analysis client-side from it, same as the
    desktop tool kept the loaded DataFrame in memory."""
    file = request.files.get("file")
    if not file:
        return jsonify({"success": False, "message": "No file uploaded"}), 400

    try:
        wb = load_workbook(file, data_only=True, read_only=True)
        ws = wb.active

        first = next(ws.iter_rows(values_only=True), None)
        if not first:
            return jsonify({"success": False, "message": "File is empty"}), 400

        headers = [str(v or "").strip() for v in first]
        if not any(headers):
            return jsonify({"success": False, "message": "File has no column headers"}), 400

        rows = []
        for values in ws.iter_rows(min_row=2, values_only=True):
            if not values or not any(v not in (None, "") for v in values):
                continue
            row = {}
            for i, h in enumerate(headers):
                if not h:
                    continue
                row[h] = _cell_to_json(values[i] if i < len(values) else None)
            rows.append(row)

        return jsonify({
            "success": True,
            "columns": [h for h in headers if h],
            "rows": rows,
            "count": len(rows),
        })
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 500


@cpk_bp.post("/analyze")
def analyze():
    body = request.get_json(silent=True) or {}

    values = clean_values(body.get("values"))
    industry = body.get("industry") or "General Manufacturing"

    try:
        lsl = float(body.get("lsl"))
        usl = float(body.get("usl"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "LSL/USL harus berupa angka"}), 400

    try:
        stats = CPKCalculator.calculate(values, lsl, usl)
        assessment = CPKAssessment.assess(
            stats["cpk"], stats["cp"], stats["cpl"], stats["cpu"],
            lsl, usl, stats["mean"], stats["std"], industry,
        )
        hist = histogram(values, lsl, usl)
        boxplot = boxplot_stats(values)
    except UnsafeDataError as e:
        return jsonify({"success": False, "message": str(e)}), 400

    return jsonify({
        "success": True,
        "stats": stats,
        "assessment": assessment,
        "histogram": hist,
        "boxplot": boxplot,
        "industry": industry,
    })


@cpk_bp.post("/calibrate")
def calibrate():
    body = request.get_json(silent=True) or {}
    values = clean_values(body.get("values"))

    try:
        lsl = float(body.get("lsl"))
        usl = float(body.get("usl"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "LSL/USL harus berupa angka"}), 400

    try:
        result = CalibrationEngine.auto_calibrate(values, lsl, usl)
        calibrated = clean_values(result["calibrated_values"])
        result["calibrated_histogram"] = histogram(calibrated, lsl, usl)
        result["calibrated_boxplot"] = boxplot_stats(calibrated)
    except UnsafeDataError as e:
        return jsonify({"success": False, "message": str(e)}), 400

    return jsonify({"success": True, **result})


@cpk_bp.post("/query-database")
def query_database():
    """Pull one numeric column's values out of the Traceability MySQL
    database for CPK analysis, with an optional station/line/date-range
    filter. Table and column names come from the widget's own config
    (not free user input at runtime), but are still validated as plain
    identifiers since they can't be bound as query parameters."""
    from db_manager import db

    body = request.get_json(silent=True) or {}

    try:
        table = _safe_identifier(body.get("table"), "Table name")
        column = _safe_identifier(body.get("column"), "Column name")
    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400

    where_clauses = [f"`{column}` IS NOT NULL"]
    params = []

    station = body.get("station")
    if station:
        where_clauses.append("`STATION` = %s")
        params.append(station)

    line = body.get("line")
    if line:
        where_clauses.append("`LINE` = %s")
        params.append(line)

    date_from = body.get("date_from")
    if date_from:
        where_clauses.append("`DATETIME` >= %s")
        params.append(date_from)

    date_to = body.get("date_to")
    if date_to:
        where_clauses.append("`DATETIME` <= %s")
        params.append(date_to)

    limit = body.get("limit")
    try:
        limit = min(int(limit), 50000) if limit else 5000
    except (TypeError, ValueError):
        limit = 5000

    sql = (
        f"SELECT `{column}` AS value FROM `{table}` "
        f"WHERE {' AND '.join(where_clauses)} "
        f"ORDER BY `DATETIME` DESC LIMIT %s"
    )
    params.append(limit)

    rows = db.fetch_all(sql, tuple(params))
    values = [row.get("value") for row in rows]

    return jsonify({"success": True, "values": values, "count": len(values)})



# ── Active CP SN List source ──────────────────────────────────────────────
def _find_interlock_json():
    """Resolve interlock.json in source and packaged Electron/PyInstaller layouts."""
    roots = [Path(__file__).resolve().parent]
    for parent in list(roots[0].parents)[:5]:
        roots.append(parent)
    if getattr(__import__('sys'), 'frozen', False):
        roots.append(Path(__import__('sys').executable).resolve().parent)
    meipass = getattr(__import__('sys'), '_MEIPASS', None)
    if meipass:
        roots.append(Path(meipass))
    candidates = []
    for root in roots:
        candidates.extend([root / 'interlock.json', root / 'Backend' / 'interlock.json',
                           root / 'config' / 'interlock.json', root / 'backend' / 'interlock.json'])
    seen = set()
    for path in candidates:
        key = str(path).lower()
        if key not in seen and path.is_file():
            return path
        seen.add(key)
    # Controlled shallow search in likely project roots; avoid scanning whole disks.
    for root in roots[:4]:
        try:
            for path in root.glob('*/interlock.json'):
                if path.is_file(): return path
            for path in root.glob('*/Backend/interlock.json'):
                if path.is_file(): return path
        except (OSError, PermissionError):
            pass
    return None


def _snlist_db_candidates(config_path):
    roots = [config_path.parent, *list(config_path.parent.parents)[:4]]
    result = []
    for root in roots:
        result.extend([root / 'data' / 'snlist.db', root / 'Backend' / 'data' / 'snlist.db',
                       root / 'backend' / 'data' / 'snlist.db'])
    # Existing conventional data directory next to backend source.
    result.append(Path(__file__).resolve().parent.parent / 'data' / 'snlist.db')
    seen = set()
    for path in result:
        key = str(path).lower()
        if key not in seen and path.is_file():
            yield path
        seen.add(key)


def _active_cp_table():
    config_path = _find_interlock_json()
    if not config_path:
        raise FileNotFoundError('interlock.json tidak ditemukan. Pastikan file konfigurasi tersedia di folder aplikasi/backend.')
    try:
        config = json.loads(config_path.read_text(encoding='utf-8-sig'))
    except Exception as exc:
        raise ValueError(f'interlock.json tidak bisa dibaca: {exc}')
    cp_obj = config.get('Control Point') or config.get('control_point') or {}
    cp = str(cp_obj.get('Process') or cp_obj.get('process') or '').strip()
    if not cp:
        raise ValueError("Control Point.Process tidak ditemukan di interlock.json.")
    # SN List get_table_name() uses f"snlist_cp{cp}"; Process may be CP101,
    # while actual normalized table suffix is 101. Match existing table names safely.
    suffix = re.sub(r'^CP(?=\d+$)', '', cp, flags=re.IGNORECASE)
    return cp, f'snlist_cp{suffix}', config_path


@cpk_bp.get('/snlist-data')
def get_active_cp_snlist_data():
    """Load only OK/PASS measurements from active CP SN List within inclusive dates."""
    try:
        cp, expected_table, config_path = _active_cp_table()
        db_path = next(_snlist_db_candidates(config_path), None)
        if not db_path:
            return jsonify({'success': False, 'message': f"snlist.db tidak ditemukan. CP aktif: {cp}; konfigurasi: {str(config_path)}"}), 404
        date_from = (request.args.get('date_from') or '').strip()
        date_to = (request.args.get('date_to') or '').strip()
        for label, value in [('date_from', date_from), ('date_to', date_to)]:
            if value:
                try: datetime.strptime(value[:10], '%Y-%m-%d')
                except ValueError: return jsonify({'success': False, 'message': f'Format {label} harus YYYY-MM-DD.'}), 400
        if date_from and date_to and date_from > date_to:
            return jsonify({'success': False, 'message': 'Tanggal awal tidak boleh melewati tanggal akhir.'}), 400
        uri = f'file:{db_path.resolve().as_posix()}?mode=ro'
        conn = sqlite3.connect(uri, uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
        try:
            tables = [r['name'] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'snlist_cp%' ORDER BY name")]
            if expected_table not in tables:
                return jsonify({'success': False, 'message': f"Tabel CP aktif '{cp}' tidak ditemukan (dicari: {expected_table}). Tabel tersedia: {', '.join(tables) or '(tidak ada)'}", 'active_cp': cp, 'expected_table': expected_table, 'available_tables': tables}), 404
            columns = [r['name'] for r in conn.execute(f'PRAGMA table_info("{expected_table}")')]
            if not columns:
                return jsonify({'success': False, 'message': f'Tabel {expected_table} tidak memiliki kolom.'}), 400
            lower_map = {c.lower(): c for c in columns}
            time_col = next((lower_map[k] for k in ('date_time','datetime','timestamp','test_time','date') if k in lower_map), None)
            result_col = next((lower_map[k] for k in ('result','status','test_result','judgement','judge') if k in lower_map), None)
            if not result_col:
                return jsonify({'success': False, 'message': f"Kolom hasil OK/NG tidak ditemukan pada tabel {expected_table}.", 'columns': columns}), 400
            qtable = '"' + expected_table.replace('"','""') + '"'
            clauses = [f'UPPER(TRIM(COALESCE("{result_col}", ""))) IN (\'OK\', \'PASS\', \'PASSED\')']
            params = []
            if date_from and time_col:
                clauses.append(f'"{time_col}" >= ?'); params.append(date_from + ' 00:00:00')
            if date_to and time_col:
                end_exclusive = (datetime.strptime(date_to, '%Y-%m-%d').date() + timedelta(days=1)).strftime('%Y-%m-%d')
                clauses.append(f'"{time_col}" < ?'); params.append(end_exclusive + ' 00:00:00')
            sql = f'SELECT * FROM {qtable} WHERE ' + ' AND '.join(clauses)
            if time_col:
                sql += f' ORDER BY "{time_col}" DESC'
            else:
                sql += ' ORDER BY rowid DESC'
            sql += ' LIMIT 50000'
            rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
        finally:
            conn.close()
        # Preserve original DB columns for parameter selection; remove internal id only.
        output_columns = [c for c in columns if c.lower() != 'id']
        output_rows = [{k: v for k, v in row.items() if k.lower() != 'id'} for row in rows]
        return jsonify({'success': True, 'active_cp': cp, 'table': expected_table,
                        'date_from': date_from or None, 'date_to': date_to or None,
                        'date_column': time_col, 'result_column': result_col,
                        'pass_only': True, 'columns': output_columns, 'rows': output_rows,
                        'count': len(output_rows), 'database': str(db_path)})
    except (FileNotFoundError, ValueError) as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400
    except Exception as exc:
        return jsonify({'success': False, 'message': f'Gagal membaca SN List: {exc}'}), 500


def _autosize(ws):
    for col_cells in ws.columns:
        length = max((len(str(c.value)) if c.value is not None else 0) for c in col_cells)
        ws.column_dimensions[col_cells[0].column_letter].width = min(max(length + 2, 10), 60)


def _xlsx_response(wb, filename):
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return send_file(
        buf,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@cpk_bp.post("/export-result")
def export_result():
    """CPK_RESULT + FILTERED_DATA + RECOMMENDATIONS sheets, mirroring the
    desktop tool's Export Result dialog."""
    body = request.get_json(silent=True) or {}
    stats = body.get("stats") or {}
    assessment = body.get("assessment") or {}
    rows = body.get("rows") or []
    parameter = body.get("parameter") or ""
    industry = body.get("industry") or ""
    filters = body.get("filters") or {}
    calibration = body.get("calibration") or {}

    wb = Workbook()
    ws1 = wb.active
    ws1.title = "CPK_RESULT"

    fields = [
        ("Parameter", parameter),
        ("Sample Size", stats.get("sample_size")),
        ("Mean", stats.get("mean")),
        ("Std Dev", stats.get("std")),
        ("Minimum", stats.get("minimum")),
        ("Maximum", stats.get("maximum")),
        ("Range", stats.get("range")),
        ("LSL", stats.get("lsl")),
        ("USL", stats.get("usl")),
        ("Tolerance", stats.get("tolerance")),
        ("Cp", stats.get("cp")),
        ("Cpu", stats.get("cpu")),
        ("Cpl", stats.get("cpl")),
        ("Cpk", stats.get("cpk")),
        ("Z-Score", stats.get("z_score")),
        ("PPM", stats.get("ppm")),
        ("Below LSL", stats.get("below_lsl")),
        ("Above USL", stats.get("above_usl")),
        ("Out of Spec", stats.get("out_of_spec")),
        ("Capability", stats.get("capability")),
        ("LINE Filter", filters.get("line") or "ALL"),
        ("STATION Filter", filters.get("station") or "ALL"),
        ("RESULT Filter", filters.get("result") or "ALL"),
        ("Industry Standard", industry),
        ("Assessment Status", assessment.get("status")),
        ("Calibration k", calibration.get("k", "N/A")),
        ("Calibration b", calibration.get("b", "N/A")),
        ("Calibration Applied", "Yes" if calibration else "No"),
    ]
    ws1.append(["Field", "Value"])
    for label, value in fields:
        ws1.append([label, _cell_to_json(value)])
    _autosize(ws1)

    ws2 = wb.create_sheet("FILTERED_DATA")
    if rows:
        headers = list(rows[0].keys())
        ws2.append(headers)
        for row in rows:
            ws2.append([_cell_to_json(row.get(h)) for h in headers])
        _autosize(ws2)

    ws3 = wb.create_sheet("RECOMMENDATIONS")
    ws3.append(["Issue", "Detail", "Action"])
    for rec in assessment.get("recommendations", []):
        ws3.append([rec.get("issue"), rec.get("detail"), rec.get("action")])
    _autosize(ws3)

    return _xlsx_response(wb, "cpk_result.xlsx")


@cpk_bp.post("/export-all")
def export_all():
    """RAW_DATA + SUMMARY sheets, mirroring the desktop tool's Export All
    Data dialog."""
    body = request.get_json(silent=True) or {}
    rows = body.get("rows") or []
    summary = body.get("summary") or {}

    wb = Workbook()
    ws1 = wb.active
    ws1.title = "RAW_DATA"
    if rows:
        headers = list(rows[0].keys())
        ws1.append(headers)
        for row in rows:
            ws1.append([_cell_to_json(row.get(h)) for h in headers])
        _autosize(ws1)

    ws2 = wb.create_sheet("SUMMARY")
    ws2.append(["Field", "Value"])
    for key, value in summary.items():
        if isinstance(value, dict):
            for sub_key, sub_value in value.items():
                ws2.append([f"{key}.{sub_key}", _cell_to_json(sub_value)])
        else:
            ws2.append([key, _cell_to_json(value)])
    _autosize(ws2)

    return _xlsx_response(wb, "cpk_all_data.xlsx")
