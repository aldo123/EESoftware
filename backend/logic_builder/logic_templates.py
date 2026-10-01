import os
import re
import json
from flask import Blueprint, request, jsonify

# Single source of truth for template file resolution — must stay identical to what
# the FlowExecutor uses at runtime, or a template could save under one path and be
# looked up (silently as "empty") under another.
from logic_builder.logic_engine import TEMPLATES_DIR, _template_path

logic_templates_bp = Blueprint("logic_templates", __name__)


def _ensure_dir():
    os.makedirs(TEMPLATES_DIR, exist_ok=True)


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_\-]", "_", (name or "").strip().lower()).strip("_")
    return slug or "group"


# ── GET /api/logic-templates — list all ───────────────────────
@logic_templates_bp.get("/api/logic-templates")
def list_logic_templates():
    _ensure_dir()
    result = []
    for fname in os.listdir(TEMPLATES_DIR):
        if fname.endswith(".json"):
            try:
                with open(os.path.join(TEMPLATES_DIR, fname), "r", encoding="utf-8") as f:
                    d = json.load(f)
                result.append({
                    "id": d.get("id", fname[:-5]),
                    "name": d.get("name", fname[:-5]),
                    "description": d.get("description", ""),
                    "node_count": len(d.get("nodes", [])),
                })
            except Exception:
                continue
    return jsonify({"templates": result})


# ── POST /api/logic-templates — create new ────────────────────
@logic_templates_bp.post("/api/logic-templates")
def create_logic_template():
    _ensure_dir()
    body = request.get_json() or {}
    name = (body.get("name") or "New Group").strip() or "New Group"
    slug = _slugify(name)
    template_id = slug
    n = 1
    while os.path.exists(_template_path(template_id)):
        n += 1
        template_id = f"{slug}_{n}"

    data = {"id": template_id, "name": name, "description": body.get("description", ""), "nodes": [], "connections": []}
    with open(_template_path(template_id), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return jsonify({"success": True, **data})


# ── GET /api/logic-templates/<id> ──────────────────────────────
@logic_templates_bp.get("/api/logic-templates/<template_id>")
def get_logic_template(template_id):
    _ensure_dir()
    path = _template_path(template_id)
    if not os.path.exists(path):
        return jsonify({"id": template_id, "name": template_id, "description": "", "nodes": [], "connections": []})
    try:
        with open(path, "r", encoding="utf-8") as f:
            return jsonify(json.load(f))
    except Exception as e:
        print(f"[LOGIC TEMPLATES] Read error {template_id}:", e)
        return jsonify({"id": template_id, "name": template_id, "description": "", "nodes": [], "connections": []})


# ── POST /api/logic-templates/<id> — save ──────────────────────
@logic_templates_bp.post("/api/logic-templates/<template_id>")
def save_logic_template(template_id):
    _ensure_dir()
    body = request.get_json() or {}
    data = {
        "id": template_id,
        "name": body.get("name", template_id),
        "description": body.get("description", ""),
        "nodes": body.get("nodes", []),
        "connections": body.get("connections", []),
    }
    try:
        with open(_template_path(template_id), "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return jsonify({"success": True, "id": template_id,
                        "node_count": len(data["nodes"]),
                        "connection_count": len(data["connections"])})
    except Exception as e:
        print(f"[LOGIC TEMPLATES] Save error {template_id}:", e)
        return jsonify({"success": False, "message": str(e)}), 500


# ── DELETE /api/logic-templates/<id> ───────────────────────────
@logic_templates_bp.delete("/api/logic-templates/<template_id>")
def delete_logic_template(template_id):
    path = _template_path(template_id)
    if os.path.exists(path):
        os.remove(path)
    return jsonify({"success": True})
