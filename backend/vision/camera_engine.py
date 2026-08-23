"""
camera_engine.py — Open & read cameras (local webcam, GigE/RTSP, or Hikrobot GigE
Vision via MVS SDK), plus Datum Tracker (template matching to compensate for part
position drift). Ported from the standalone "Buble Tester V1" project — kept as a
separate file on purpose so a camera problem can be debugged here without touching
inspection_methods.py (per-zone inspection algorithms) or routes.py (Flask wiring).

Note: Hikrobot MVS SDK support (source_type "hikrobot_mvs") is NOT ported yet — the
vendor SDK (MvImport/, ~7MB of DLLs) wasn't copied over since nothing here can test it.
Selecting that source_type will raise ModuleNotFoundError with a clear traceback; port
hikrobot_camera.py + MvImport/ from the original project if/when that camera is needed.
"""
import threading
from pathlib import Path
import cv2

# ── Raw frame terakhir per kamera (sebelum digambari ROI/kontur) ───────────────
# Generic frame cache — useful for anything that needs "last raw frame for camera X"
# (e.g. a future Datum Tracker teaching UI), independent of any specific pipeline.
_raw_frames = {}
_raw_frame_lock = threading.Lock()

def store_raw_frame(camera_id: str, frame):
    with _raw_frame_lock:
        _raw_frames[camera_id] = frame.copy()

def get_raw_frame(camera_id: str):
    with _raw_frame_lock:
        frame = _raw_frames.get(camera_id)
        return frame.copy() if frame is not None else None


# ── Buka kamera sesuai source_type ──────────────────────────────────────────────
def _build_rtsp_url(cfg: dict) -> str:
    ip = (cfg.get("ip_address") or "").strip()
    user = (cfg.get("username") or "").strip()
    pwd  = (cfg.get("password") or "").strip()
    port = cfg.get("port", 554)
    path = cfg.get("rtsp_path") or "/Streaming/Channels/101"
    if not path.startswith("/"):
        path = "/" + path
    auth = f"{user}:{pwd}@" if (user or pwd) else ""
    return f"rtsp://{auth}{ip}:{port}{path}"

def open_camera(cfg: dict):
    """Buka kamera sesuai konfigurasi: webcam lokal (device index), kamera GigE/Hikvision
    via RTSP (IP address), atau kamera GigE Vision Hikrobot via MVS SDK (belum di-port —
    lihat catatan modul di atas)."""
    if cfg.get("source_type") == "hikrobot_mvs":
        ip = (cfg.get("ip_address") or "").strip()
        if not ip:
            return None
        from hikrobot_camera import HikrobotCapture
        cap = HikrobotCapture(ip)
        return cap if cap.isOpened() else None

    if cfg.get("source_type") == "gige":
        ip = (cfg.get("ip_address") or "").strip()
        if not ip:
            return None
        cap = cv2.VideoCapture(_build_rtsp_url(cfg))
    else:
        try:
            idx = int(cfg.get("device_index", 0))
        except (TypeError, ValueError):
            idx = 0
        cap = cv2.VideoCapture(idx)
    for _ in range(10):
        cap.read()
    return cap


# ── Datum Tracker: template matching untuk kompensasi posisi part ──────────────
DATUM_DIR = Path(__file__).parent.parent / "data" / "vision_datum_templates"
_datum_template_cache = {}  # node_id -> (mtime, np.ndarray)

def _load_datum_template(node_id: str):
    path = DATUM_DIR / f"{node_id}.png"
    if not path.exists():
        return None
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    cached = _datum_template_cache.get(node_id)
    if cached and cached[0] == mtime:
        return cached[1]
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is not None:
        _datum_template_cache[node_id] = (mtime, img)
    return img

def track_datum(frame_gray, datum_cfg: dict):
    """Cari posisi template datum di frame via template matching. Return (dx, dy, ok).
    Kalau confidence rendah / template belum diregister, ok=False (posisi taught dipakai apa adanya)."""
    template = _load_datum_template(datum_cfg["id"])
    if template is None:
        return 0, 0, False
    if frame_gray.shape[0] < template.shape[0] or frame_gray.shape[1] < template.shape[1]:
        return 0, 0, False
    res = cv2.matchTemplate(frame_gray, template, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(res)
    if max_val < datum_cfg.get("conf_threshold", 0.45):
        return 0, 0, False
    dx = max_loc[0] - int(datum_cfg.get("x", 0))
    dy = max_loc[1] - int(datum_cfg.get("y", 0))
    return dx, dy, True
