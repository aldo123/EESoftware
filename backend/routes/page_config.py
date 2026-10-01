import os
import sys
import json
import traceback
import logging
from flask import Blueprint, request, jsonify


logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger(__name__)

page_config_bp = Blueprint("page_config", __name__)


# ============================================================
# PATH
# ============================================================

def _get_base_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)

    return os.path.dirname(os.path.dirname(__file__))


BASE_DIR = _get_base_dir()

DATA_DIR = os.path.join(BASE_DIR, "data")
PAGE_CONFIG_DIR = os.path.join(DATA_DIR, "page_configs")


def _ensure_dir():
    os.makedirs(PAGE_CONFIG_DIR, exist_ok=True)

    if not os.access(PAGE_CONFIG_DIR, os.W_OK):
        raise PermissionError(
            f"Directory not writable: {PAGE_CONFIG_DIR}"
        )


def _config_path(cp: str) -> str:
    safe = "".join(
        c for c in str(cp)
        if c.isdigit()
    ) or "1"

    return os.path.join(
        PAGE_CONFIG_DIR,
        f"cp{safe}.json"
    )


# ============================================================
# NORMALIZE PAGES
# ============================================================

def _normalize_pages(body):
    """
    Normalize page configuration.

    Rules:
    - Dynamic Page is ALWAYS present.
    - Dynamic Page is the protected main page.
    - All custom pages are preserved.
    - Custom pages may be deleted.
    - Manual and Calibration are NOT mandatory.
    - Legacy top-level "widgets" is used as fallback
      for Dynamic Page.
    """

    if not isinstance(body, dict):
        body = {}

    # --------------------------------------------------------
    # Legacy widgets
    # --------------------------------------------------------

    legacy_widgets = body.get("widgets", [])

    if not isinstance(legacy_widgets, list):
        legacy_widgets = []


    # --------------------------------------------------------
    # Pages
    # --------------------------------------------------------

    raw_pages = body.get("pages", {})

    if not isinstance(raw_pages, dict):
        raw_pages = {}


    normalized = {}


    # ========================================================
    # DYNAMIC PAGE
    # ========================================================

    dynamic_raw = raw_pages.get("dynamic", {})

    if not isinstance(dynamic_raw, dict):
        dynamic_raw = {}


    dynamic_widgets = dynamic_raw.get(
        "widgets",
        legacy_widgets
    )

    if not isinstance(dynamic_widgets, list):
        dynamic_widgets = []


    normalized["dynamic"] = {
        "name": (
            dynamic_raw.get("name")
            or "Dynamic Page"
        ),

        "icon": (
            dynamic_raw.get("icon")
            or "🖥"
        ),

        "widgets": dynamic_widgets,
    }


    # ========================================================
    # CUSTOM PAGES
    # ========================================================

    for key, value in raw_pages.items():

        # Dynamic already handled
        if key == "dynamic":
            continue


        # Ignore invalid page objects
        if not isinstance(value, dict):
            continue


        page_widgets = value.get(
            "widgets",
            []
        )

        if not isinstance(page_widgets, list):
            page_widgets = []


        normalized[str(key)] = {
            "name": (
                value.get("name")
                or str(key)
            ),

            "icon": (
                value.get("icon")
                or "📄"
            ),

            "widgets": page_widgets,
        }


    return normalized


# ============================================================
# GET PAGE CONFIG
# ============================================================

@page_config_bp.get("/api/page-config/<cp>")
def get_page_config(cp):

    try:

        _ensure_dir()

        path = _config_path(cp)


        # ----------------------------------------------------
        # Config doesn't exist yet
        # ----------------------------------------------------

        if not os.path.exists(path):

            return jsonify({
                "cp": cp,

                # Legacy compatibility
                "widgets": [],

                # ONLY Dynamic is mandatory
                "pages": {
                    "dynamic": {
                        "name": "Dynamic Page",
                        "icon": "🖥",
                        "widgets": [],
                    }
                },
            })


        # ----------------------------------------------------
        # Read config
        # ----------------------------------------------------

        with open(
            path,
            "r",
            encoding="utf-8"
        ) as f:

            data = json.load(f)


        if not isinstance(data, dict):
            data = {}


        # ----------------------------------------------------
        # Normalize pages
        # ----------------------------------------------------

        pages = _normalize_pages(data)


        # ----------------------------------------------------
        # Keep backward compatibility
        # ----------------------------------------------------

        data["pages"] = pages

        data["widgets"] = (
            pages
            .get("dynamic", {})
            .get("widgets", [])
        )

        data["cp"] = cp


        return jsonify(data)


    except Exception as e:

        logger.error(
            f"Get error CP{cp}: {e}"
        )

        traceback.print_exc()

        return jsonify({
            "success": False,
            "message": str(e),
        }), 500


# ============================================================
# SAVE PAGE CONFIG
# ============================================================

@page_config_bp.post("/api/page-config/<cp>")
def save_page_config(cp):

    try:

        _ensure_dir()


        # ----------------------------------------------------
        # Read request
        # ----------------------------------------------------

        body = request.get_json(
            silent=True
        ) or {}


        # ----------------------------------------------------
        # Normalize
        # ----------------------------------------------------

        pages = _normalize_pages(body)


        # Safety:
        # Dynamic must always exist.
        if "dynamic" not in pages:

            pages["dynamic"] = {
                "name": "Dynamic Page",
                "icon": "🖥",
                "widgets": [],
            }


        # ----------------------------------------------------
        # Build payload
        # ----------------------------------------------------

        dynamic_widgets = (
            pages
            .get("dynamic", {})
            .get("widgets", [])
        )


        payload = {

            "cp": cp,

            # Legacy compatibility
            "widgets": dynamic_widgets,

            # ALL pages
            "pages": pages,

            # Canvas
            "canvas": body.get(
                "canvas",
                {
                    "width": 1920,
                    "height": 1080
                }
            ),

            "canvasWidth": body.get(
                "canvasWidth",
                1920
            ),

            "canvasHeight": body.get(
                "canvasHeight",
                1080
            ),

            "designCanvasWidth": body.get(
                "designCanvasWidth",
                1920
            ),

            "designCanvasHeight": body.get(
                "designCanvasHeight",
                1080
            ),
        }


        # ----------------------------------------------------
        # Write file
        # ----------------------------------------------------

        path = _config_path(cp)


        with open(
            path,
            "w",
            encoding="utf-8"
        ) as f:

            json.dump(
                payload,
                f,
                indent=2,
                ensure_ascii=False
            )


        # ----------------------------------------------------
        # Logging
        #
        # IMPORTANT:
        # Do NOT access pages["manual"] or
        # pages["calibration"] because those pages
        # are optional and can be deleted.
        # ----------------------------------------------------

        page_counts = {
            key: len(
                value.get("widgets", [])
            )
            for key, value in pages.items()
        }


        logger.info(
            "Saved CP%s: pages=%s -> %s",
            cp,
            page_counts,
            path
        )


        # ----------------------------------------------------
        # Response
        # ----------------------------------------------------

        return jsonify({

            "success": True,

            "cp": cp,

            "widget_count": len(
                dynamic_widgets
            ),

            "page_counts": page_counts,
        })


    except Exception as e:

        logger.error(
            f"Save error CP{cp}: {e}"
        )

        traceback.print_exc()

        return jsonify({
            "success": False,
            "message": str(e),
        }), 500


# ============================================================
# DELETE COMPLETE CP CONFIG
# ============================================================

@page_config_bp.delete("/api/page-config/<cp>")
def delete_page_config(cp):

    try:

        path = _config_path(cp)


        if os.path.exists(path):

            os.remove(path)


        return jsonify({
            "success": True
        })


    except Exception as e:

        logger.error(
            f"Delete error CP{cp}: {e}"
        )

        traceback.print_exc()

        return jsonify({
            "success": False,
            "message": str(e),
        }), 500


# ============================================================
# LIST PAGE CONFIGS
# ============================================================

@page_config_bp.get("/api/page-config")
def list_page_configs():

    try:

        _ensure_dir()

        configs = []


        for fname in os.listdir(
            PAGE_CONFIG_DIR
        ):

            if not (
                fname.startswith("cp")
                and fname.endswith(".json")
            ):
                continue


            cp_num = fname[2:-5]

            path = os.path.join(
                PAGE_CONFIG_DIR,
                fname
            )


            try:

                with open(
                    path,
                    "r",
                    encoding="utf-8"
                ) as f:

                    data = json.load(f)


                pages = _normalize_pages(
                    data
                    if isinstance(data, dict)
                    else {}
                )


                page_counts = {
                    key: len(
                        value.get(
                            "widgets",
                            []
                        )
                    )
                    for key, value in pages.items()
                }


                configs.append({

                    "cp": cp_num,

                    "widget_count": len(
                        pages
                        .get("dynamic", {})
                        .get("widgets", [])
                    ),

                    "page_counts": page_counts,

                    "file": fname,
                })


            except Exception as file_error:

                logger.error(
                    "Failed reading %s: %s",
                    fname,
                    file_error
                )


        return jsonify(configs)


    except Exception as e:

        logger.error(
            f"List error: {e}"
        )

        traceback.print_exc()

        return jsonify([]), 500