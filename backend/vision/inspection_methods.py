"""
inspection_methods.py — Metode inspeksi per-zone selain bubble counting: Color Ratio,
Border Overflow, Presence (Border/Inner), Bright Band, dan OCR Text. Dipisah dari
bubble_backend.py biar troubleshoot metode tertentu gampang tanpa perlu baca file kamera.

Tiap fungsi method_*(roi_bgr, params) menerima crop ROI (BGR, sudah dipotong sesuai posisi
zone + offset datum) dan dict parameter dari node-nya, return (ok: bool, value: angka
buat ditampilkan di UI). Dipanggil dari bubble_backend.py lewat METHOD_FUNCS[method_name].
"""
import os
import cv2
import numpy as np


def _hue_mask(hsv, p, prefix=""):
    h, s = hsv[:, :, 0], hsv[:, :, 1]
    sat_min = p.get(f"{prefix}sat_min", 70)
    m = (h >= p.get(f"{prefix}hue_min", 0)) & (h <= p.get(f"{prefix}hue_max", 25)) & (s >= sat_min)
    h2min, h2max = p.get(f"{prefix}hue_min2", 155), p.get(f"{prefix}hue_max2", 180)
    if h2max > h2min:
        m = m | ((h >= h2min) & (h <= h2max) & (s >= sat_min))
    return m


def method_color_ratio(roi_bgr, p):
    if roi_bgr.size == 0:
        return False, 0.0
    hsv = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2HSV)
    val_min = p.get("val_min", 50)
    mask = _hue_mask(hsv, p) & (hsv[:, :, 2] >= val_min)
    ratio = float(np.sum(mask)) / mask.size * 100 if mask.size else 0.0
    return ratio >= p.get("min_ratio_pct", 15), round(ratio, 1)


def method_border_overflow(roi_bgr, p):
    if roi_bgr.size == 0:
        return True, 0.0
    gray = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2GRAY)
    _, th = cv2.threshold(gray, p.get("white_threshold", 165), 255, cv2.THRESH_BINARY)
    ratio = float(np.sum(th == 255)) / th.size * 100 if th.size else 0.0
    return ratio <= p.get("max_overflow_pct", 10), round(ratio, 1)


def method_presence(roi_bgr, p):
    if roi_bgr.size == 0:
        return False, 0.0
    gray = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2GRAY)
    _, th = cv2.threshold(gray, p.get("white_threshold", 165), 255, cv2.THRESH_BINARY)
    h, w = th.shape
    border_px = max(1, min(int(p.get("border_px", 6)), h // 3, w // 3))
    border_mask = np.zeros_like(th, dtype=bool)
    border_mask[:border_px, :] = True
    border_mask[-border_px:, :] = True
    border_mask[:, :border_px] = True
    border_mask[:, -border_px:] = True
    inner_mask = ~border_mask

    total_border = int(np.sum(border_mask))
    overflow_ratio = (int(np.sum((th == 255) & border_mask)) / total_border * 100) if total_border else 0.0
    total_inner = int(np.sum(inner_mask))
    inner_ratio = (int(np.sum((th == 255) & inner_mask)) / total_inner * 100) if total_inner else 0.0

    is_overflow = overflow_ratio > p.get("max_overflow_pct", 20)
    has_min     = inner_ratio >= p.get("min_inside_pct", 5)
    return (not is_overflow) and has_min, round(overflow_ratio, 1)


def method_bright_band(roi_bgr, p):
    h, w = roi_bgr.shape[:2]
    if h == 0 or w == 0:
        return False, 0.0
    hsv = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2HSV)
    col_pct = p.get("col_pct", 70) / 100.0
    cx1, cx2 = max(0, int(w * (0.5 - col_pct / 2))), min(w, int(w * (0.5 + col_pct / 2)))
    ncols = max(cx2 - cx1, 1)
    min_px_cap    = max(2, int(ncols * 0.25))
    min_px_bright = max(2, int(ncols * 0.30))
    bright_v_min = p.get("bright_v_min", 170)
    bright_s_max = p.get("bright_s_max", 100)

    cap_mask_full = _hue_mask(hsv[:, cx1:cx2], p, prefix="cap_")
    cap_rows = np.where(np.sum(cap_mask_full, axis=1) >= min_px_cap)[0]
    cap_bottom = int(cap_rows.max()) if cap_rows.size else 0

    bright_start, bright_end, in_run = None, None, False
    for r in range(cap_bottom + 1, h):
        row = hsv[r, cx1:cx2]
        n = int(((row[:, 2] >= bright_v_min) & (row[:, 1] <= bright_s_max)).sum())
        is_bright = n >= min_px_bright
        if is_bright and not in_run:
            bright_start, in_run = r, True
        elif not is_bright and in_run:
            bright_end = r - 1
            break
    if in_run and bright_end is None:
        bright_end = h - 1

    if bright_start is not None and bright_end is not None:
        thickness_pct = (bright_end - bright_start + 1) / h * 100
    else:
        return False, 0.0  # no glue/bright band at all -> NG

    return thickness_pct <= p.get("max_thickness_pct", 5), round(thickness_pct, 1)


# ── OCR ──────────────────────────────────────────────────────────────────────
# pytesseract di-import LAZY (baru pas method_ocr() pertama kali dipanggil), bukan di
# module load time — di beberapa komputer, import pytesseract bisa macet total kalau
# antivirus/EDR lagi scan package yang baru di-install, dan itu gak boleh sampai bikin
# seluruh backend gagal start hanya gara-gara node OCR ada di suatu program.
OCR_AVAILABLE = None   # None = belum dicoba, True/False = hasil percobaan pertama
OCR_IMPORT_ERROR = None
pytesseract = None

def _ensure_pytesseract():
    global OCR_AVAILABLE, OCR_IMPORT_ERROR, pytesseract
    if OCR_AVAILABLE is not None:
        return OCR_AVAILABLE
    try:
        import pytesseract as _pt
        pytesseract = _pt
        _TESSERACT_CANDIDATES = [
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        ]
        for _p in _TESSERACT_CANDIDATES:
            if os.path.exists(_p):
                pytesseract.pytesseract.tesseract_cmd = _p
                break
        OCR_AVAILABLE = True
    except Exception as e:
        OCR_IMPORT_ERROR = str(e)
        OCR_AVAILABLE = False
    return OCR_AVAILABLE

_ocr_warned = False

def method_ocr(roi_bgr, p):
    """Baca teks di ROI pakai Tesseract OCR. OK kalau teks yang kebaca cocok dengan
    expected_text (mode 'contains' atau 'exact') dan confidence >= min_confidence.
    value = confidence rata-rata (0-100) dari Tesseract."""
    global _ocr_warned
    if roi_bgr.size == 0:
        return False, 0.0
    if not _ensure_pytesseract():
        if not _ocr_warned:
            print(f"[OCR] Tesseract belum siap ({OCR_IMPORT_ERROR}). "
                  f"Install pip package 'pytesseract' + binary Tesseract OCR dulu.")
            _ocr_warned = True
        return False, 0.0

    expected   = (p.get("expected_text") or "").strip()
    match_mode = p.get("match_mode", "contains")
    psm        = int(p.get("psm", 7))
    lang       = p.get("lang", "eng")
    min_conf   = p.get("min_confidence", 60)

    try:
        gray = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2GRAY)
        _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        data = pytesseract.image_to_data(
            th, lang=lang, config=f"--psm {psm}", output_type=pytesseract.Output.DICT,
        )
        texts = [t.strip() for t in data.get("text", []) if t.strip()]
        confs = [float(c) for c in data.get("conf", []) if str(c) not in ("-1",)]
        read_text = " ".join(texts)
        avg_conf  = round(sum(confs) / len(confs), 1) if confs else 0.0
    except Exception as e:
        if not _ocr_warned:
            print(f"[OCR] Gagal membaca teks: {e}")
            _ocr_warned = True
        return False, 0.0

    if avg_conf < min_conf:
        return False, avg_conf
    if not expected:
        return True, avg_conf  # tanpa expected_text -> OK asal ada teks kebaca dengan confidence cukup

    if match_mode == "exact":
        ok = read_text.strip().lower() == expected.lower()
    else:
        ok = expected.lower() in read_text.lower()
    return ok, avg_conf


METHOD_FUNCS = {
    "color_ratio":     method_color_ratio,
    "border_overflow": method_border_overflow,
    "presence":        method_presence,
    "bright_band":     method_bright_band,
    "ocr":             method_ocr,
}
