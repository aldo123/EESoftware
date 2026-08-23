"""
capture_worker.py — Runs one background thread per registered camera, continuously
reading frames and keeping the latest one available as JPEG bytes for streaming.

This is new code (not ported) — it's the minimal "keep a camera alive and expose its
latest frame" layer that both a live-view Page Builder widget and, later, a Logic
Builder inspection node can sit on top of. It intentionally does not know about zones,
ROIs, or inspection methods (see inspection_methods.py) — this file's only job is
"open camera, keep reading, hand back the latest JPEG".
"""
import threading
import time
import cv2

from vision.camera_engine import open_camera, store_raw_frame

_lock = threading.Lock()
_workers = {}  # camera_id -> {"cfg": dict, "stop_event": Event, "thread": Thread,
                #               "jpg": bytes|None, "error": str|None, "started_at": float}


def _run(camera_id: str, cfg: dict, stop_event: threading.Event):
    cap = None
    try:
        cap = open_camera(cfg)
        if cap is None or not cap.isOpened():
            with _lock:
                _workers[camera_id]["error"] = "Failed to open camera"
            return

        while not stop_event.is_set():
            try:
                ret, frame = cap.read()
            except Exception as e:
                with _lock:
                    _workers[camera_id]["error"] = f"Read error: {e}"
                time.sleep(0.5)
                continue

            if not ret or frame is None:
                time.sleep(0.05)
                continue

            store_raw_frame(camera_id, frame)
            ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if ok:
                with _lock:
                    _workers[camera_id]["jpg"] = jpg.tobytes()
                    _workers[camera_id]["error"] = None
    except Exception as e:
        with _lock:
            if camera_id in _workers:
                _workers[camera_id]["error"] = str(e)
    finally:
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass


def start_camera(camera_id: str, cfg: dict) -> dict:
    """Idempotent: if already running with this id, leaves it alone."""
    with _lock:
        existing = _workers.get(camera_id)
        if existing and existing["thread"].is_alive():
            return {"already_running": True}

        stop_event = threading.Event()
        _workers[camera_id] = {
            "cfg": cfg, "stop_event": stop_event, "thread": None,
            "jpg": None, "error": None, "started_at": time.time(),
        }
        thread = threading.Thread(target=_run, args=(camera_id, cfg, stop_event), daemon=True)
        _workers[camera_id]["thread"] = thread
        thread.start()
        return {"already_running": False}


def stop_camera(camera_id: str) -> bool:
    with _lock:
        worker = _workers.get(camera_id)
        if not worker:
            return False
        worker["stop_event"].set()
    worker["thread"].join(timeout=2)
    with _lock:
        _workers.pop(camera_id, None)
    return True


def get_latest_jpg(camera_id: str):
    with _lock:
        worker = _workers.get(camera_id)
        return worker["jpg"] if worker else None


def list_cameras() -> list:
    with _lock:
        result = []
        for camera_id, w in _workers.items():
            result.append({
                "camera_id": camera_id,
                "running": w["thread"].is_alive(),
                "has_frame": w["jpg"] is not None,
                "error": w["error"],
                "started_at": w["started_at"],
            })
        return result
