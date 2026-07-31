import os
import json
from flask import Blueprint, request, jsonify

logic_config_bp = Blueprint("logic_config", __name__)

DATA_DIR        = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
LOGIC_DIR       = os.path.join(DATA_DIR, "logic_flows")


def _ensure_dir():
    os.makedirs(LOGIC_DIR, exist_ok=True)


def _flow_path(cp: str) -> str:
    safe = "".join(c for c in str(cp) if c.isdigit()) or "1"
    return os.path.join(LOGIC_DIR, f"cp{safe}.json")


# ── GET /api/logic-config/<cp> ────────────────────────────────
@logic_config_bp.get("/api/logic-config/<cp>")
def get_logic_config(cp):
    _ensure_dir()
    path = _flow_path(cp)
    if not os.path.exists(path):
        return jsonify({"nodes": [], "connections": [], "cp": cp})
    try:
        with open(path, "r", encoding="utf-8") as f:
            return jsonify(json.load(f))
    except Exception as e:
        print(f"[LOGIC CONFIG] Read error CP{cp}:", e)
        return jsonify({"nodes": [], "connections": [], "cp": cp})


# ── POST /api/logic-config/<cp> ───────────────────────────────
@logic_config_bp.post("/api/logic-config/<cp>")
def save_logic_config(cp):
    _ensure_dir()
    body        = request.get_json() or {}
    nodes       = body.get("nodes", [])
    connections = body.get("connections", [])

    path = _flow_path(cp)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"cp": cp, "nodes": nodes, "connections": connections},
                      f, indent=2, ensure_ascii=False)
        print(f"[LOGIC CONFIG] Saved CP{cp}: {len(nodes)} nodes, {len(connections)} connections")

        # Auto-generate Python logic file setelah save
        from routes.logic_engine import generate_python_logic
        generate_python_logic(cp, nodes, connections)

        return jsonify({"success": True, "cp": cp,
                        "node_count": len(nodes),
                        "connection_count": len(connections)})
    except Exception as e:
        print(f"[LOGIC CONFIG] Save error CP{cp}:", e)
        return jsonify({"success": False, "message": str(e)}), 500


# ── DELETE /api/logic-config/<cp> ────────────────────────────
@logic_config_bp.delete("/api/logic-config/<cp>")
def delete_logic_config(cp):
    path = _flow_path(cp)
    if os.path.exists(path):
        os.remove(path)
    return jsonify({"success": True})


# ── GET /api/logic-config — list all ─────────────────────────
@logic_config_bp.get("/api/logic-config")
def list_logic_configs():
    _ensure_dir()
    result = []
    for fname in os.listdir(LOGIC_DIR):
        if fname.startswith("cp") and fname.endswith(".json"):
            cp_num = fname[2:-5]
            try:
                with open(os.path.join(LOGIC_DIR, fname), "r", encoding="utf-8") as f:
                    d = json.load(f)
                result.append({
                    "cp": cp_num,
                    "node_count":       len(d.get("nodes", [])),
                    "connection_count": len(d.get("connections", [])),
                })
            except Exception:
                pass
    return jsonify(result)