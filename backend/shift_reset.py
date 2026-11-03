"""
shift_reset.py — Fires a "shift reset" for a CP at the start of every shift.

The reset itself is NOT done here. At each shift time this module only pulses a
Logic Builder trigger — an Internal Variable (default "BT_ShiftReset") is written
0 -> 1 — and the CP's flow (Device Trigger on that variable) does whatever the
plant wants reset: counters, Dummy Check status, PLC flags... That keeps the reset
visible and editable in Logic Builder instead of hard-coded here.

Shift times come from the CP's own Dashboard shift settings (each shift's start),
or from an explicit "times" list in data/shift_reset.json:

    { "21": { "enabled": true, "variable": "BT_ShiftReset", "times": [] } }

Each time fires once per calendar day (tracked in data/shift_reset_state.json, so an
app restart after a time already fired does not fire it again). A time that has already
passed when the backend (re)starts and was missed is fired late — same self-healing
rule as comparing with >= instead of an exact HH:MM match. The first time a CP is seen,
times that already passed today are marked as done rather than fired, so enabling the
feature at 10:00 does not wipe a running shift.
"""
import json
import os
import threading
import time
from datetime import datetime

from flask import Blueprint, jsonify, request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
CONFIG_PATH = os.path.join(DATA_DIR, "shift_reset.json")
STATE_PATH = os.path.join(DATA_DIR, "shift_reset_state.json")

CHECK_INTERVAL = 5          # seconds between clock checks
PULSE_GAP = 0.2             # seconds the trigger variable is held at 0 before going to 1 (poller runs every 50 ms)

shift_reset_bp = Blueprint("shift_reset", __name__)
_lock = threading.RLock()
_thread = None


# ── small JSON helpers ───────────────────────────────────────────
def _read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_json(path, data):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def _normalize_time(value):
    try:
        return datetime.strptime(str(value).strip(), "%H:%M").strftime("%H:%M")
    except ValueError:
        return None


def load_config():
    return _read_json(CONFIG_PATH)


def reset_times(cp, cfg):
    """Explicit times if configured, otherwise the start of every Dashboard shift of this CP."""
    explicit = [t for t in (_normalize_time(x) for x in (cfg.get("times") or [])) if t]
    if explicit:
        return sorted(set(explicit))
    try:
        from routes.dashboard import _load_settings
        shifts = _load_settings(cp).get("shifts", [])
    except Exception as exc:
        print(f"[SHIFT RESET] CP{cp}: cannot read Dashboard shifts ({exc})")
        return []
    return sorted({t for t in (_normalize_time(s.get("start")) for s in shifts) if t})


# ── firing ───────────────────────────────────────────────────────
def _write_variable(name, value):
    from routes.internal_variable import _connect
    with _connect() as conn:
        row = conn.execute("SELECT id FROM internal_variables WHERE name = ? COLLATE NOCASE", (name,)).fetchone()
        if row is None:
            return False
        conn.execute("UPDATE internal_variables SET value=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (str(value), row["id"]))
        conn.commit()
    return True


def fire(cp, cfg=None):
    """Pulse the CP's shift-reset variable 0 -> 1. Returns True when the variable exists."""
    cfg = cfg if cfg is not None else load_config().get(str(cp), {})
    name = str(cfg.get("variable") or "").strip()
    if not name:
        return False
    if not _write_variable(name, 0):
        print(f"[SHIFT RESET] CP{cp}: Internal Variable '{name}' not found - nothing fired")
        return False
    time.sleep(PULSE_GAP)
    _write_variable(name, 1)
    print(f"[SHIFT RESET] CP{cp}: fired '{name}'")
    return True


def check_once(now=None):
    """One clock check over every enabled CP. Returns [(cp, 'HH:MM'), ...] that fired."""
    now = now or datetime.now()
    today = now.strftime("%Y-%m-%d")
    fired = []
    with _lock:
        config = load_config()
        state = _read_json(STATE_PATH)
        dirty = False
        for cp, cfg in config.items():
            if not isinstance(cfg, dict) or not cfg.get("enabled"):
                continue
            times = reset_times(cp, cfg)
            last = state.setdefault(cp, None)
            if last is None:     # first time we see this CP: what already passed today is NOT fired
                state[cp] = last = {t: today for t in times if now.strftime("%H:%M") >= t}
                dirty = True
            for t in times:
                if now.strftime("%H:%M") >= t and last.get(t) != today:
                    last[t] = today
                    dirty = True
                    fire(cp, cfg)
                    fired.append((cp, t))
        if dirty:
            _write_json(STATE_PATH, state)
    return fired


def _loop():
    while True:
        try:
            check_once()
        except Exception as exc:
            print(f"[SHIFT RESET] check error: {exc}")
        time.sleep(CHECK_INTERVAL)


def start_shift_reset_scheduler():
    """Start the background clock (idempotent)."""
    global _thread
    with _lock:
        if _thread is not None and _thread.is_alive():
            return
        _thread = threading.Thread(target=_loop, name="shift-reset", daemon=True)
        _thread.start()


# ── HTTP: view / edit config, fire by hand ───────────────────────
@shift_reset_bp.get("/api/shift-reset/<cp>")
def get_shift_reset(cp):
    cfg = load_config().get(str(cp), {"enabled": False, "variable": "", "times": []})
    return jsonify({"cp": cp, **cfg, "effective_times": reset_times(cp, cfg),
                    "last_fired": _read_json(STATE_PATH).get(str(cp)) or {}})


@shift_reset_bp.post("/api/shift-reset/<cp>")
def save_shift_reset(cp):
    body = request.get_json() or {}
    times = [t for t in (_normalize_time(x) for x in (body.get("times") or [])) if t]
    cfg = {"enabled": bool(body.get("enabled")), "variable": str(body.get("variable") or "").strip(), "times": times}
    if cfg["enabled"] and not cfg["variable"]:
        return jsonify({"success": False, "message": "'variable' is required when enabled"}), 400
    with _lock:
        config = load_config()
        config[str(cp)] = cfg
        _write_json(CONFIG_PATH, config)
    return jsonify({"success": True, **cfg, "effective_times": reset_times(cp, cfg)})


@shift_reset_bp.post("/api/shift-reset/<cp>/fire")
def fire_shift_reset(cp):
    ok = fire(cp)
    return jsonify({"success": ok, "message": "" if ok else "No shift-reset variable configured/found for this CP"}), (200 if ok else 400)
