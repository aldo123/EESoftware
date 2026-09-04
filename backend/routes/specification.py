# backend/routes/specification.py
"""
Specification CRUD + source/device discovery + source test + runtime bridge.

The Specification table remains:
    Parameter Test
    Lower Limit
    Upper Limit
    Trigger Start
    Device Trigger
    Type Register Trigger
    Trigger Source
    Time Start
    Time Stop
    Method
    Data Source
    Device Source
    Type Register Source
    Source
"""

import os
import sqlite3
from flask import Blueprint, jsonify, request

specification_bp = Blueprint(
    "specification",
    __name__,
    url_prefix="/api/specifications",
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "specification.db")


def _connect():
    os.makedirs(DATA_DIR, exist_ok=True)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_specification_db():
    """
    Create/migrate specification.db.

    Each specification belongs to exactly one CP.  The unique key is:
        (name, cp_number)

    Existing databases created by older versions are migrated without
    deleting specification parameters.  Old specifications receive NULL
    cp_number because their CP cannot be inferred safely.
    """
    with _connect() as conn:
        columns = {
            row["name"]
            for row in conn.execute(
                "PRAGMA table_info(specifications)"
            ).fetchall()
        }

        if not columns:
            conn.execute(
                """
                CREATE TABLE specifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    cp_number TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        else:
            # Legacy table had name UNIQUE and no cp_number.  Rebuild it so
            # the old global UNIQUE(name) constraint is removed.
            if "cp_number" not in columns:
                conn.execute("PRAGMA foreign_keys = OFF")

                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS specifications_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        cp_number TEXT,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )

                conn.execute(
                    """
                    INSERT INTO specifications_new
                        (id, name, cp_number, created_at, updated_at)
                    SELECT
                        id, name, NULL, created_at, updated_at
                    FROM specifications
                    """
                )

                conn.execute("DROP TABLE specifications")
                conn.execute(
                    "ALTER TABLE specifications_new RENAME TO specifications"
                )

                conn.execute("PRAGMA foreign_keys = ON")

        # Ensure the parameter table exists.  It references specification id.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS specification_parameters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                specification_id INTEGER NOT NULL,

                parameter_test TEXT NOT NULL DEFAULT '',
                lower_limit REAL,
                upper_limit REAL,

                trigger_start TEXT NOT NULL DEFAULT 'TCP',
                trigger_device TEXT NOT NULL DEFAULT 'PLC',
                trigger_register_type TEXT NOT NULL DEFAULT 'Holding',
                trigger_source TEXT NOT NULL DEFAULT '',

                time_start REAL NOT NULL DEFAULT 1,
                time_stop REAL NOT NULL DEFAULT 10,
                method TEXT NOT NULL DEFAULT 'Avg',

                data_source TEXT NOT NULL DEFAULT 'TCP',
                source_device TEXT NOT NULL DEFAULT 'PLC',
                source_register_type TEXT NOT NULL DEFAULT 'Holding',
                source TEXT NOT NULL DEFAULT '',

                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

                FOREIGN KEY (specification_id)
                    REFERENCES specifications(id)
                    ON DELETE CASCADE
            )
            """
        )

        # A specification name may be reused in another CP, but not twice
        # inside the same CP.
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS
            ux_specifications_name_cp
            ON specifications(name COLLATE NOCASE, cp_number)
            """
        )

        conn.commit()


def _number(value, field, allow_none=True):
    if value is None or value == "":
        if allow_none:
            return None
        raise ValueError(f"{field} is required")

    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be a number")

    if not (number == number and abs(number) != float("inf")):
        raise ValueError(f"{field} must be a finite number")

    return number


def _row_to_dict(row):
    result = dict(row)

    for key in (
        "lower_limit",
        "upper_limit",
        "time_start",
        "time_stop",
    ):
        if result.get(key) is not None:
            result[key] = float(result[key])

    return result


def _get_spec(conn, spec_id):
    spec = conn.execute(
        """
        SELECT id, name, cp_number, created_at, updated_at
        FROM specifications
        WHERE id = ?
        """,
        (spec_id,),
    ).fetchone()

    if not spec:
        return None

    rows = conn.execute(
        """
        SELECT
            id,
            specification_id,
            parameter_test,
            lower_limit,
            upper_limit,
            trigger_start,
            trigger_device,
            trigger_register_type,
            trigger_source,
            time_start,
            time_stop,
            method,
            data_source,
            source_device,
            source_register_type,
            source,
            created_at,
            updated_at
        FROM specification_parameters
        WHERE specification_id = ?
        ORDER BY id
        """,
        (spec_id,),
    ).fetchall()

    result = dict(spec)
    result["rows"] = [_row_to_dict(row) for row in rows]
    return result


@specification_bp.get("")
def list_specifications():
    cp_number = str(
        request.args.get("cp_number", request.args.get("cp", ""))
        or ""
    ).strip()

    with _connect() as conn:
        if cp_number:
            ids = conn.execute(
                """
                SELECT id
                FROM specifications
                WHERE cp_number = ?
                ORDER BY name COLLATE NOCASE
                """,
                (cp_number,),
            ).fetchall()
        else:
            # Backward-compatible global listing for runtime/administrative
            # callers that intentionally do not provide a CP.
            ids = conn.execute(
                """
                SELECT id
                FROM specifications
                ORDER BY name COLLATE NOCASE
                """
            ).fetchall()

        specifications = [
            _get_spec(conn, row["id"])
            for row in ids
        ]

    return jsonify({
        "success": True,
        "cp_number": cp_number,
        "specifications": specifications,
    })


@specification_bp.get("/<int:specification_id>")
def get_specification(specification_id):
    with _connect() as conn:
        result = _get_spec(conn, specification_id)

    if not result:
        return jsonify({
            "success": False,
            "message": "Specification not found",
        }), 404

    return jsonify({
        "success": True,
        "specification": result,
    })


@specification_bp.post("")
def create_specification():
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip()
    cp_number = str(
        body.get("cp_number", body.get("cp", ""))
        or ""
    ).strip()

    if not name:
        return jsonify({
            "success": False,
            "message": "Specification name is required",
        }), 400

    if not cp_number:
        return jsonify({
            "success": False,
            "message": "CP number is required",
        }), 400

    try:
        with _connect() as conn:
            cursor = conn.execute(
                "INSERT INTO specifications (name, cp_number) VALUES (?, ?)",
                (name, cp_number),
            )
            conn.commit()
            result = _get_spec(conn, cursor.lastrowid)

        return jsonify({
            "success": True,
            "specification": result,
        }), 201

    except sqlite3.IntegrityError:
        return jsonify({
            "success": False,
            "message": f"Specification '{name}' already exists in CP {cp_number}",
        }), 409

    except Exception as exc:
        return jsonify({
            "success": False,
            "message": str(exc),
        }), 500


@specification_bp.put("/<int:specification_id>")
def update_specification(specification_id):
    body = request.get_json(silent=True) or {}

    name = str(body.get("name") or "").strip()
    rows = body.get("rows", [])
    cp_number = str(
        body.get("cp_number", body.get("cp", ""))
        or ""
    ).strip()

    if not name:
        return jsonify({
            "success": False,
            "message": "Specification name is required",
        }), 400

    if not isinstance(rows, list):
        return jsonify({
            "success": False,
            "message": "rows must be an array",
        }), 400

    trigger_values = {"TCP", "Internal", "Realtime"}
    register_values = {
        "Holding",
        "Coil",
        "Discrete Input",
        "Input Register",
    }
    method_values = {"Avg", "Min", "Max"}
    data_values = {"TCP", "internal", "RS232"}

    try:
        with _connect() as conn:
            exists = conn.execute(
                "SELECT id FROM specifications WHERE id = ?",
                (specification_id,),
            ).fetchone()

            if not exists:
                return jsonify({
                    "success": False,
                    "message": "Specification not found",
                }), 404

            if cp_number:
                conn.execute(
                    """
                    UPDATE specifications
                    SET name = ?, cp_number = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (name, cp_number, specification_id),
                )
            else:
                # Existing legacy records may have NULL cp_number.  Do not
                # accidentally erase ownership when an old client saves them.
                conn.execute(
                    """
                    UPDATE specifications
                    SET name = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (name, specification_id),
                )

            conn.execute(
                """
                DELETE FROM specification_parameters
                WHERE specification_id = ?
                """,
                (specification_id,),
            )

            for row in rows:
                parameter_test = str(
                    row.get("parameter_test") or ""
                ).strip()

                if not parameter_test:
                    raise ValueError(
                        "Parameter Test cannot be empty"
                    )

                trigger_start = str(
                    row.get("trigger_start") or "TCP"
                ).strip()

                trigger_device = str(
                    row.get("trigger_device") or ""
                ).strip()

                trigger_register_type = str(
                    row.get("trigger_register_type")
                    or "Holding"
                ).strip()

                trigger_source = str(
                    row.get("trigger_source") or ""
                ).strip()

                method = str(
                    row.get("method") or "Avg"
                ).strip()

                data_source = str(
                    row.get("data_source") or "TCP"
                ).strip()

                source_device = str(
                    row.get("source_device") or ""
                ).strip()

                source_register_type = str(
                    row.get("source_register_type")
                    or "Holding"
                ).strip()

                source = str(
                    row.get("source") or ""
                ).strip()

                if trigger_start not in trigger_values:
                    raise ValueError(
                        f"Invalid Trigger Start: {trigger_start}"
                    )

                if trigger_register_type not in register_values:
                    raise ValueError(
                        "Invalid Trigger Register Type"
                    )

                if source_register_type not in register_values:
                    raise ValueError(
                        "Invalid Source Register Type"
                    )

                if method not in method_values:
                    raise ValueError(
                        f"Invalid Method: {method}"
                    )

                if data_source not in data_values:
                    raise ValueError(
                        f"Invalid Data Source: {data_source}"
                    )

                lower_limit = _number(
                    row.get("lower_limit"),
                    "Lower Limit",
                    True,
                )

                upper_limit = _number(
                    row.get("upper_limit"),
                    "Upper Limit",
                    True,
                )

                time_start = _number(
                    row.get("time_start"),
                    "Time Start",
                    False,
                )

                time_stop = _number(
                    row.get("time_stop"),
                    "Time Stop",
                    False,
                )

                if time_start < 0 or time_stop < 0:
                    raise ValueError(
                        "Time values cannot be negative"
                    )

                if time_stop < time_start:
                    raise ValueError(
                        "Time Stop must be >= Time Start"
                    )

                conn.execute(
                    """
                    INSERT INTO specification_parameters (
                        specification_id,
                        parameter_test,
                        lower_limit,
                        upper_limit,
                        trigger_start,
                        trigger_device,
                        trigger_register_type,
                        trigger_source,
                        time_start,
                        time_stop,
                        method,
                        data_source,
                        source_device,
                        source_register_type,
                        source
                    )
                    VALUES (
                        ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?, ?
                    )
                    """,
                    (
                        specification_id,
                        parameter_test,
                        lower_limit,
                        upper_limit,
                        trigger_start,
                        trigger_device,
                        trigger_register_type,
                        trigger_source,
                        time_start,
                        time_stop,
                        method,
                        data_source,
                        source_device,
                        source_register_type,
                        source,
                    ),
                )

            conn.commit()
            result = _get_spec(conn, specification_id)

        return jsonify({
            "success": True,
            "specification": result,
        })

    except sqlite3.IntegrityError as exc:
        return jsonify({
            "success": False,
            "message": str(exc),
        }), 409

    except Exception as exc:
        return jsonify({
            "success": False,
            "message": str(exc),
        }), 400


@specification_bp.delete("/<int:specification_id>")
def delete_specification(specification_id):
    with _connect() as conn:
        cursor = conn.execute(
            "DELETE FROM specifications WHERE id = ?",
            (specification_id,),
        )
        conn.commit()

    if cursor.rowcount == 0:
        return jsonify({
            "success": False,
            "message": "Specification not found",
        }), 404

    return jsonify({
        "success": True,
        "message": "Specification deleted",
    })