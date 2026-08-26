import os
import sys
import json
import traceback
import logging
from flask import Blueprint, request, jsonify

logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

page_config_bp = Blueprint("page_config", __name__)


def _get_base_dir():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(__file__))


BASE_DIR = _get_base_dir()
DATA_DIR = os.path.join(BASE_DIR, "data")
PAGE_CONFIG_DIR = os.path.join(DATA_DIR, "page_configs")


def _ensure_dir():
    os.makedirs(PAGE_CONFIG_DIR, exist_ok=True)
    if not os.access(PAGE_CONFIG_DIR, os.W_OK):
        raise PermissionError(f"Directory not writable: {PAGE_CONFIG_DIR}")


def _config_path(cp: str) -> str:
    safe = "".join(c for c in str(cp) if c.isdigit()) or "1"
    return os.path.join(PAGE_CONFIG_DIR, f"cp{safe}.json")


def _normalize_pages(body):
    """Normalize the new three-page format while preserving old layouts."""
    legacy_widgets = body.get("widgets", [])
    if not isinstance(legacy_widgets, list):
        legacy_widgets = []

    raw_pages = body.get("pages", {})
    if not isinstance(raw_pages, dict):
        raw_pages = {}

    def page_widgets(name, fallback=None):
        raw = raw_pages.get(name, {})
        if not isinstance(raw, dict):
            raw = {}
        widgets = raw.get("widgets", fallback if fallback is not None else [])
        return widgets if isinstance(widgets, list) else []

    return {
        "dynamic": {"widgets": page_widgets("dynamic", legacy_widgets)},
        "manual": {"widgets": page_widgets("manual")},
        "calibration": {"widgets": page_widgets("calibration")},
    }


@page_config_bp.get("/api/page-config/<cp>")
def get_page_config(cp):
    try:
        _ensure_dir()
        path = _config_path(cp)

        if not os.path.exists(path):
            return jsonify({
                "cp": cp,
                "widgets": [],
                "pages": {
                    "dynamic": {"widgets": []},
                    "manual": {"widgets": []},
                    "calibration": {"widgets": []},
                },
            })

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        # Migrate old files on read in-memory. The next Save will persist
        # the new format. Dynamic remains the legacy widgets source.
        pages = _normalize_pages(data if isinstance(data, dict) else {})
        data = data if isinstance(data, dict) else {}
        data["pages"] = pages
        data["widgets"] = pages["dynamic"]["widgets"]
        data["cp"] = cp

        return jsonify(data)

    except Exception as e:
        logger.error(f"Get error CP{cp}: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@page_config_bp.post("/api/page-config/<cp>")
def save_page_config(cp):
    try:
        _ensure_dir()
        body = request.get_json() or {}
        pages = _normalize_pages(body)

        # Keep Dynamic Page in the old key for backward compatibility with
        # any older runtime/client that still reads data.widgets.
        payload = {
            "cp": cp,
            "widgets": pages["dynamic"]["widgets"],
            "pages": pages,
            "canvas": body.get("canvas", {"width": 1980, "height": 1080}),
            "canvasWidth": body.get("canvasWidth", 1980),
            "canvasHeight": body.get("canvasHeight", 1080),
            "designCanvasWidth": body.get("designCanvasWidth", 1980),
            "designCanvasHeight": body.get("designCanvasHeight", 1080),
        }

        path = _config_path(cp)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)

        logger.info(
            "Saved CP%s: dynamic=%s manual=%s calibration=%s -> %s",
            cp,
            len(pages["dynamic"]["widgets"]),
            len(pages["manual"]["widgets"]),
            len(pages["calibration"]["widgets"]),
            path,
        )

        return jsonify({
            "success": True,
            "cp": cp,
            "widget_count": len(pages["dynamic"]["widgets"]),
            "page_counts": {
                "dynamic": len(pages["dynamic"]["widgets"]),
                "manual": len(pages["manual"]["widgets"]),
                "calibration": len(pages["calibration"]["widgets"]),
            },
        })

    except Exception as e:
        logger.error(f"Save error CP{cp}: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500


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
                pages = _normalize_pages(data if isinstance(data, dict) else {})
                configs.append({
                    "cp": cp_num,
                    "widget_count": len(pages["dynamic"]["widgets"]),
                    "page_counts": {
                        "dynamic": len(pages["dynamic"]["widgets"]),
                        "manual": len(pages["manual"]["widgets"]),
                        "calibration": len(pages["calibration"]["widgets"]),
                    },
                    "file": fname,
                })
        return jsonify(configs)
    except Exception as e:
        logger.error(f"List error: {e}")
        traceback.print_exc()
        return jsonify([]), 500