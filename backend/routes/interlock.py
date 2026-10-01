import json
import os
from flask import Blueprint, request, jsonify

interlock_bp = Blueprint("interlock", __name__)

# Semua file data disimpan di folder data/ di root project
DATA_DIR        = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
INTERLOCK_PATH  = os.path.join(DATA_DIR, "interlock.json")

DEFAULT_INTERLOCK = {
    "Control Point": {
        "Control Point Code":   "BM01-VM01-CP20",
        "Control Point Family": "CP20 V-Mini",
        "Control Point Name":   "CP20 - Pallet Label Printing",
        "Data Point":           "CP20 V-Mini",
        "Interlock ByPass":     "No",
        "Process":              ""
    },
    "Documents":  {"Max Document Size": "10485760"},
    "Tester":     {"Max Retest Number": "1"},
    "Traceability Server": {
        "Database Server":       "127.0.0.1",
        "TraceabilityCatalog":   "interlock",
        "TraceabilityPassword":  "1234",
        "TraceabilitySslMode":   "REQUIRED",
        "TraceabilityUserId":    "root"
    }
}


def init_interlock():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(INTERLOCK_PATH):
        with open(INTERLOCK_PATH, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_INTERLOCK, f, indent=4)
        print(f"[INIT] Created: {INTERLOCK_PATH}")
    else:
        print(f"[INIT] Found:   {INTERLOCK_PATH}")


# ── GET /api/interlock ────────────────────────────────────────
@interlock_bp.get("/api/interlock")
def get_interlock():
    try:
        if os.path.exists(INTERLOCK_PATH):
            with open(INTERLOCK_PATH, "r", encoding="utf-8") as f:
                try:
                    return jsonify(json.load(f))
                except json.JSONDecodeError as e:
                    print(f"[ERROR] interlock.json corrupt ({e}). Resetting to default...")
                    with open(INTERLOCK_PATH, "w", encoding="utf-8") as fw:
                        json.dump(DEFAULT_INTERLOCK, fw, indent=4, ensure_ascii=False)
                    return jsonify(DEFAULT_INTERLOCK)
    except Exception as e:
        print("Get Interlock Error:", e)
    return jsonify(DEFAULT_INTERLOCK)


# ── POST /api/interlock ───────────────────────────────────────
@interlock_bp.post("/api/interlock")
def save_interlock():
    from db_manager import db

    body = request.get_json() or {}
    data = body.get("data", {})
    if not data:
        return jsonify({"success": False, "message": "Empty data"}), 400
    try:
        with open(INTERLOCK_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

    db.reload()
    db.connect()
    return jsonify({
        "success":      True,
        "message":      "Interlock saved",
        "db_connected": db.is_connected()
    })