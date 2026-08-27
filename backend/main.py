from routes.testtable import testtable_bp
import os
from flask import Flask, request, jsonify
from flask_cors import CORS

# ── Shared DB singleton ────────────────────────────────────────
from db_manager import db

# ── Blueprints ─────────────────────────────────────────────────
from routes.interlock import interlock_bp, init_interlock
from routes.setting import setting_bp, init_settings
from routes.maintenance import maintenance_bp, init_maintenance_db
from routes.snlist import snlist_bp
from routes.reference import reference_bp
from routes.page_config import page_config_bp
from logic_builder.logic_config import logic_config_bp
from logic_builder.logic_engine import logic_engine_bp
from logic_builder.logic_templates import logic_templates_bp
from logic_builder.device_poller import device_trigger_bp
from rs232 import rs232_bp
from tcp_ip import tcp_ip_bp
from modbus_rtu import modbus_rtu_bp
from vision.routes import vision_bp
from routes.internal_variable import (
    internal_variable_bp,
    init_internal_variables_db,
)

# ── Specification ──────────────────────────────────────────────
from routes.specification import (
    specification_bp,
    init_specification_db,
)
from routes.specification_engine import (
    specification_runtime_bp,
)

# ── App setup ──────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

# Pastikan folder data/ ada
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)

# ── One-time init ──────────────────────────────────────────────
init_interlock()
init_settings()
init_maintenance_db()
init_internal_variables_db()
init_specification_db()

# ── Register blueprints ────────────────────────────────────────
app.register_blueprint(interlock_bp)
app.register_blueprint(setting_bp)
app.register_blueprint(maintenance_bp)
app.register_blueprint(snlist_bp)
app.register_blueprint(reference_bp)
app.register_blueprint(page_config_bp)
app.register_blueprint(logic_config_bp)
app.register_blueprint(logic_engine_bp)
app.register_blueprint(logic_templates_bp)
app.register_blueprint(device_trigger_bp)
app.register_blueprint(rs232_bp)
app.register_blueprint(tcp_ip_bp)
app.register_blueprint(modbus_rtu_bp)
app.register_blueprint(vision_bp)
app.register_blueprint(internal_variable_bp)

# Specification CRUD + runtime
app.register_blueprint(specification_bp)
app.register_blueprint(specification_runtime_bp)

# Test table
app.register_blueprint(testtable_bp)


# ══════════════════════════════════════════════════════════════
# Routes yang tetap di main.py (butuh db MySQL langsung)
# ══════════════════════════════════════════════════════════════

@app.get("/api/health")
def health():
    db.connect()

    return jsonify({
        "status": "ok",
        "db_connected": db.is_connected(),
        "host": db.get_host(),
        "database": db.get_database_name(),
    })


@app.post("/api/login/card")
def login_card():
    body = request.get_json() or {}
    id_card = body.get("id_card", "").strip()

    if not id_card:
        return jsonify({
            "detail": "Card number required"
        }), 400

    user = db.fetch_one(
        """
        SELECT username, role, id_card
        FROM users
        WHERE id_card = %s
        LIMIT 1
        """,
        (id_card,),
    )

    if not user:
        return jsonify({
            "detail": "Card number not registered"
        }), 401

    return jsonify({
        "success": True,
        "user": user,
    })


@app.post("/api/login/password")
def login_password():
    body = request.get_json() or {}

    username = body.get("username", "").strip()
    password = body.get("password", "").strip()

    if not username or not password:
        return jsonify({
            "detail": "Username and password required"
        }), 400

    # TEMP DEV BYPASS
    if username == "admin" and password == "admin":
        return jsonify({
            "success": True,
            "user": {
                "username": "admin",
                "role": "Engineer",
                "id_card": None,
            },
        })

    user = db.fetch_one(
        """
        SELECT username, role, id_card
        FROM users
        WHERE username = %s
          AND password = %s
        LIMIT 1
        """,
        (username, password),
    )

    if not user:
        return jsonify({
            "detail": "Invalid username or password"
        }), 401

    return jsonify({
        "success": True,
        "user": user,
    })


@app.post("/api/test-connection")
def test_connection():
    try:
        body = request.get_json() or {}
        ts = body.get("Traceability Server", {})

        import mysql.connector

        conn = mysql.connector.connect(
            host=ts.get("Database Server", ""),
            user=ts.get("TraceabilityUserId", ""),
            password=ts.get("TraceabilityPassword", ""),
            database=ts.get("TraceabilityCatalog", ""),
            connection_timeout=5,
        )

        conn.close()

        return jsonify({
            "success": True,
            "message": (
                f"Connected to "
                f"{ts.get('Database Server')}/"
                f"{ts.get('TraceabilityCatalog')}"
            ),
        })

    except Exception as exc:
        return jsonify({
            "success": False,
            "message": str(exc),
        })


@app.post("/api/users/change-password")
def change_password():
    body = request.get_json() or {}

    username = body.get("username", "").strip()
    password = body.get("password", "").strip()

    if not username or not password:
        return jsonify({
            "detail": "Username and password required"
        }), 400

    try:
        db.execute(
            "UPDATE users SET password = %s WHERE username = %s",
            (password, username),
        )

        return jsonify({
            "success": True
        })

    except Exception as exc:
        return jsonify({
            "detail": str(exc)
        }), 500


if __name__ == "__main__":
    # Keep this at 8000 because the existing frontend API uses 8000.
    print(
        "[START] Server running on "
        "http://0.0.0.0:8000"
    )

    app.run(
        host="0.0.0.0",
        port=8000,
        debug=False,
        threaded=True,
    )