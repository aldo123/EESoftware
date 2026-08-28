"""
cpk_engine.py — process capability (Cp/Cpk/Cpu/Cpl) calculation, industry
assessment, and calibration math for the CPK Analyzer widget.

Ported from the standalone cpk_analyzer2.py Tkinter tool: same formulas,
but no Tkinter/matplotlib/pandas — pure Python + numpy so it can run as a
stateless Flask endpoint.
"""
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
