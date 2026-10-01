"""
live_status.py — Shared "is a Count Over Time window currently running against
this camera, and what does it see right now" status, purely for UI feedback
(countdown timer + live blob highlights on the Camera Feed widget). This is
read-only observability — nothing here affects the actual counting/pass-fail
decision in blob_counter.py / window_counter.py, it just mirrors their progress
so a widget can poll and show it.
"""
import threading

_status = {}  # camera_id -> dict
_lock = threading.Lock()


def start(camera_id: str, duration: float):
    with _lock:
        _status[camera_id] = {"counting": True, "duration": duration, "elapsed": 0.0, "count": 0, "blobs": []}


def update(camera_id: str, elapsed: float, count: int, blobs=None):
    with _lock:
        if camera_id in _status:
            _status[camera_id]["elapsed"] = elapsed
            _status[camera_id]["count"] = count
            _status[camera_id]["blobs"] = blobs or []


def stop(camera_id: str):
    with _lock:
        if camera_id in _status:
            _status[camera_id]["counting"] = False


def get(camera_id: str) -> dict:
    with _lock:
        return dict(_status.get(camera_id, {"counting": False}))
