import json
import os
from flask import Blueprint, request, jsonify

setting_bp = Blueprint("setting", __name__)

DATA_DIR      = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
SETTINGS_PATH = os.path.join(DATA_DIR, "setting.json")

DEFAULT_SETTINGS = {
    "Message": {
        "OK Color":  "Green",
        "OK Font":   "Arial 24 Bold",
        "NOK Color": "Red",
        "NOK Font":  "Arial 24 Bold"
    },
    "Communication Devices": {
        "_table": [
            {"Device Name": "PSN",      "Type": "TCP", "IP Address": "192.168.108.1", "Port": "9004"},
            {"Device Name": "PSN Part", "Type": "TCP", "IP Address": "192.168.108.2", "Port": "9004"}
        ]
    },
    "Product Rules": {
        "_table": [
            {"Product": "1", "Part Voltage": "127V"},
            {"Product": "2", "Part Voltage": "240V"}
        ]
    },
    "Product Matrix Mapping": {
        "Part Matrix": "47", "PN": "1-7", "Vendor": "", "Voltage": "",
        "HW Ver": "", "FW Ver": "", "ESP FW": "", "Date": "", "Serial Number": ""
    },
    "SN Chassis Mapping": {
        "Product Matrix": "1-2", "Date": "3-4", "Type": "3-4", "Line": "5-6",
        "Serial Number": "7-12", "Partner": "13-14", "Voltage": "15-18",
        "Plug": "19-20", "Color": "21-22"
    }
}


def init_settings():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(SETTINGS_PATH):
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_SETTINGS, f, indent=4)
        print(f"[INIT] Created: {SETTINGS_PATH}")
    else:
        print(f"[INIT] Found:   {SETTINGS_PATH}")


# ── GET /api/settings ─────────────────────────────────────────
@setting_bp.get("/api/settings")
def get_settings():
    try:
        if os.path.exists(SETTINGS_PATH):
            with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
                return jsonify(json.load(f))
    except Exception as e:
        print("Get Settings Error:", e)
    return jsonify(DEFAULT_SETTINGS)


# ── POST /api/settings ────────────────────────────────────────
@setting_bp.post("/api/settings")
def save_settings():
    body = request.get_json() or {}
    data = body.get("data", {})
    if not data:
        return jsonify({"success": False, "message": "Empty data"}), 400
    try:
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500
    return jsonify({"success": True, "message": "Settings saved"})