import os
import sys
import json
import traceback
import logging
from flask import Blueprint, request, jsonify

# Setup logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

page_config_bp = Blueprint("page_config", __name__)

# ── Tentukan BASE_DIR ─────────────────────────────────────────────────────────
def _get_base_dir():
    if getattr(sys, 'frozen', False):
        # Dijalankan dari executable hasil PyInstaller
        return os.path.dirname(sys.executable)
    else:
        # Mode development (python langsung)
        return os.path.dirname(os.path.dirname(__file__))

BASE_DIR = _get_base_dir()
DATA_DIR = os.path.join(BASE_DIR, "data")
PAGE_CONFIG_DIR = os.path.join(DATA_DIR, "page_configs")

logger.info(f"BASE_DIR = {BASE_DIR}")
logger.info(f"PAGE_CONFIG_DIR = {PAGE_CONFIG_DIR}")

# ── Fungsi bantu ──────────────────────────────────────────────────────────────
def _ensure_dir():
    try:
        os.makedirs(PAGE_CONFIG_DIR, exist_ok=True)
        if not os.access(PAGE_CONFIG_DIR, os.W_OK):
            raise PermissionError(f"Directory not writable: {PAGE_CONFIG_DIR}")
    except Exception as e:
        logger.error(f"Failed to create/check directory: {e}")
        traceback.print_exc()
        raise

def _config_path(cp: str) -> str:
    # sanitasi: hanya digit yang diizinkan
    safe = "".join(c for c in str(cp) if c.isdigit()) or "1"
    return os.path.join(PAGE_CONFIG_DIR, f"cp{safe}.json")

# ── GET /api/page-config/<cp> ────────────────────────────────────────────────
@page_config_bp.get("/api/page-config/<cp>")
def get_page_config(cp):
    try:
        _ensure_dir()
        path = _config_path(cp)
        if not os.path.exists(path):
            return jsonify({"widgets": [], "cp": cp})
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return jsonify(data)
    except Exception as e:
        logger.error(f"Get error CP{cp}: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# ── POST /api/page-config/<cp> ───────────────────────────────────────────────
@page_config_bp.post("/api/page-config/<cp>")
def save_page_config(cp):
    try:
        _ensure_dir()
        body = request.get_json() or {}
        widgets = body.get("widgets", [])
        if not isinstance(widgets, list):
            return jsonify({"success": False, "message": "widgets must be list"}), 400

        path = _config_path(cp)
        # Tulis file
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"cp": cp, "widgets": widgets}, f, indent=2, ensure_ascii=False)

        logger.info(f"Saved CP{cp}: {len(widgets)} widgets → {path}")
        return jsonify({"success": True, "cp": cp, "widget_count": len(widgets)})
    except Exception as e:
        logger.error(f"Save error CP{cp}: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500

# ── DELETE /api/page-config/<cp> ─────────────────────────────────────────────
@page_config_bp.delete("/api/page-config/<cp>")
def delete_page_config(cp):
    try:
        path = _config_path(cp)
        if os.path.exists(path):
            os.remove(path)
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Delete error CP{cp}: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500

# ── GET /api/page-config (list all saved CPs) ───────────────────────────────
@page_config_bp.get("/api/page-config")
def list_page_configs():
    try:
        _ensure_dir()
        configs = []
        for fname in os.listdir(PAGE_CONFIG_DIR):
            if fname.startswith("cp") and fname.endswith(".json"):
                cp_num = fname[2:-5]
                path = os.path.join(PAGE_CONFIG_DIR, fname)
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                configs.append({
                    "cp": cp_num,
                    "widget_count": len(data.get("widgets", [])),
                    "file": fname,
                })
        return jsonify(configs)
    except Exception as e:
        logger.error(f"List error: {e}")
        traceback.print_exc()
        return jsonify([]), 500