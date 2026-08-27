# backend/routes/specification_engine.py
"""
Runtime engine for Specification.

It deliberately reuses the existing communication APIs:
    TCP    -> /api/tcp/read
    RS232  -> /api/rs232/latest
    Internal -> /api/internal-variables

It does NOT open another TCP socket or another COM port.
The existing tcp_ip.py and rs232.py remain the owners of device connections.
"""

import json
import os
import re
import statistics
import threading
import time
import urllib.error
import urllib.request

from flask import Blueprint, jsonify, request

from .specification import DB_PATH, _connect, _get_spec

specification_runtime_bp = Blueprint(
    "specification_runtime",
    __name__,
    url_prefix="/api/specifications/runtime",
)

API_BASE = os.environ.get(
    "EE_INTERLOCK_API",
    "http://127.0.0.1:8000",
).rstrip("/")

_state_lock = threading.RLock()
_runtimes = {}


def _http_json(method, path, payload=None, timeout=2.0):
    url = f"{API_BASE}{path}"

    data = None
    headers = {
        "Accept": "application/json",
    }

    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(
        url,
        data=data,
        headers=headers,
        method=method,
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            result = json.loads(raw) if raw else {}

            if response.status >= 400:
                raise RuntimeError(
                    result.get("message")
                    or f"HTTP {response.status}"
                )

            return result

    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")

        try:
            result = json.loads(raw)
        except Exception:
            result = {}

        raise RuntimeError(
            result.get("message")
            or f"HTTP {exc.code}: {raw[:200]}"
        )

    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Cannot reach backend API {url}: {exc.reason}"
        )


def _to_bool(value):
    if isinstance(value, bool):
        return value

    if isinstance(value, (int, float)):
        return value != 0

    text = str(value or "").strip().lower()

    if text in {
        "1",
        "true",
        "on",
        "yes",
        "high",
    }:
        return True

    if text in {
        "0",
        "false",
        "off",
        "no",
        "low",
        "",
    }:
        return False

    try:
        return float(text) != 0
    except ValueError:
        return False


def _to_number(value):
    if isinstance(value, bool):
        return float(value)

    if isinstance(value, (int, float)):
        return float(value)

    if isinstance(value, dict):
        for key in (
            "value",
            "Value",
            "data",
            "result",
        ):
            if key in value:
                try:
                    return _to_number(value[key])
                except Exception:
                    pass

        text = json.dumps(value)
    else:
        text = str(value or "")

    match = re.search(
        r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?",
        text,
    )

    if not match:
        raise ValueError(
            f"Cannot convert source value to number: {value!r}"
        )

    return float(match.group(0))


def _normalize_register_type(value):
    text = str(value or "").strip().lower()

    aliases = {
        "holding": "holding_register",
        "holding register": "holding_register",
        "holding_register": "holding_register",
        "coil": "coil",
        "discrete input": "discrete_input",
        "discrete_input": "discrete_input",
        "discrate input": "discrete_input",
        "input register": "input_register",
        "input_register": "input_register",
    }

    if text not in aliases:
        raise ValueError(
            f"Unsupported register type: {value}"
        )

    return aliases[text]


def _address(value):
    try:
        address = int(str(value).strip())
    except (TypeError, ValueError):
        raise ValueError(
            f"Modbus address must be an integer: {value!r}"
        )

    if address < 0 or address > 65535:
        raise ValueError(
            f"Modbus address out of range: {address}"
        )

    return address


def _get_internal_variables():
    data = _http_json(
        "GET",
        "/api/internal-variables",
    )

    return data.get("variables", [])


def _get_internal_value(name):
    variables = _get_internal_variables()

    for variable in variables:
        if str(variable.get("name")) == str(name):
            return variable.get("value")

    raise ValueError(
        f"Internal variable '{name}' not found"
    )


def _read_tcp(device_name, register_type, source):
    if not device_name:
        raise ValueError("TCP Device Source is required")

    address_type = _normalize_register_type(
        register_type
    )

    address = _address(source)

    data = _http_json(
        "POST",
        "/api/tcp/read",
        {
            "device_name": device_name,
            "address_type": address_type,
            "address": address,
            "count": 1,
        },
    )

    if not data.get("success", False):
        raise RuntimeError(
            data.get("message")
            or "TCP read failed"
        )

    return data.get("value")


def _get_rs232_devices():
    data = _http_json(
        "GET",
        "/api/rs232/devices",
    )
    return data.get("devices", [])


def _read_rs232(device_name):
    if not device_name:
        raise ValueError("RS232 Device Source is required")

    data = _http_json(
        "GET",
        "/api/rs232/latest",
    )

    if device_name not in data:
        raise ValueError(
            f"No latest RS232 data from '{device_name}'"
        )

    return data[device_name]


def _read_source(row):
    source_type = str(
        row.get("data_source") or ""
    ).strip()

    if source_type == "TCP":
        return _read_tcp(
            row.get("source_device"),
            row.get("source_register_type"),
            row.get("source"),
        )

    if source_type == "internal":
        return _get_internal_value(
            row.get("source")
        )

    if source_type == "RS232":
        return _read_rs232(
            row.get("source_device")
        )

    raise ValueError(
        f"Unsupported Data Source: {source_type}"
    )


def _read_trigger(row):
    trigger_type = str(
        row.get("trigger_start") or ""
    ).strip()

    if trigger_type == "Realtime":
        return True

    if trigger_type == "Internal":
        value = _get_internal_value(
            row.get("trigger_source")
        )
        return _to_bool(value)

    if trigger_type == "TCP":
        value = _read_tcp(
            row.get("trigger_device"),
            row.get("trigger_register_type"),
            row.get("trigger_source"),
        )
        return _to_bool(value)

    raise ValueError(
        f"Unsupported Trigger Start: {trigger_type}"
    )


def _validate_source(row):
    source_type = str(
        row.get("data_source") or ""
    ).strip()

    if source_type == "TCP":
        if not row.get("source_device"):
            raise ValueError("TCP Device Source is required")
        if not row.get("source"):
            raise ValueError("TCP Source address is required")

        # Real read = actual connection validation.
        value = _read_source(row)
        return {
            "ok": True,
            "value": value,
            "source_type": "TCP",
        }

    if source_type == "internal":
        name = str(row.get("source") or "").strip()

        if not name:
            raise ValueError(
                "Internal variable Source is required"
            )

        value = _get_internal_value(name)

        return {
            "ok": True,
            "value": value,
            "source_type": "internal",
        }

    if source_type == "RS232":
        if not row.get("source_device"):
            raise ValueError(
                "RS232 Device Source is required"
            )

        value = _read_rs232(
            row.get("source_device")
        )

        return {
            "ok": True,
            "value": value,
            "source_type": "RS232",
        }

    raise ValueError(
        f"Unsupported Data Source: {source_type}"
    )


def _calculate(values, method):
    if not values:
        raise ValueError("No samples collected")

    if method == "Avg":
        return statistics.fmean(values)

    if method == "Min":
        return min(values)

    if method == "Max":
        return max(values)

    raise ValueError(
        f"Unsupported method: {method}"
    )


def _limit_result(value, lower, upper):
    if lower is not None and value < float(lower):
        return False

    if upper is not None and value > float(upper):
        return False

    return True


def _row_result(row):
    return {
        "parameter_test": row.get("parameter_test"),
        "status": "waiting",
        "result": None,
        "pass": None,
        "fail": None,
        "samples": [],
        "error": None,
    }


class SpecificationRuntime:
    def __init__(self, specification):
        self.specification = specification
        self.spec_id = specification["id"]
        self.running = False
        self.thread = None
        self.stop_event = threading.Event()

        self.results = {
            str(row["id"]): _row_result(row)
            for row in specification.get("rows", [])
        }

        self.message = "Idle"
        self.started_at = None

    def start(self):
        if self.running:
            return

        self.running = True
        self.stop_event.clear()
        self.started_at = time.time()
        self.message = "Waiting for trigger..."

        self.thread = threading.Thread(
            target=self._run,
            daemon=True,
            name=f"Specification-{self.spec_id}",
        )
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.running = False
        self.message = "Stopped"

    def _wait_trigger(self, row):
        while not self.stop_event.is_set():
            try:
                if _read_trigger(row):
                    return True
            except Exception as exc:
                key = str(row["id"])
                self.results[key]["status"] = "trigger_error"
                self.results[key]["error"] = str(exc)

            if (
                str(row.get("trigger_start"))
                == "Realtime"
            ):
                return True

            time.sleep(0.1)

        return False

    def _run_row(self, row):
        key = str(row["id"])
        result = self.results[key]

        result["status"] = "waiting_trigger"

        if not self._wait_trigger(row):
            result["status"] = "stopped"
            return

        result["status"] = "running"

        start = float(row.get("time_start") or 0)
        stop = float(row.get("time_stop") or 0)

        trigger_time = time.monotonic()
        samples = []

        while not self.stop_event.is_set():
            elapsed = time.monotonic() - trigger_time

            if elapsed >= stop:
                break

            if elapsed >= start:
                try:
                    raw = _read_source(row)
                    value = _to_number(raw)
                    samples.append(value)
                    result["samples"] = list(samples)
                    result["last_value"] = value
                except Exception as exc:
                    result["error"] = str(exc)

            time.sleep(0.1)

        if self.stop_event.is_set():
            result["status"] = "stopped"
            return

        if not samples:
            result["status"] = "failed"
            result["fail"] = True
            result["pass"] = False
            result["error"] = (
                result["error"]
                or "No valid samples collected"
            )
            return

        final_value = _calculate(
            samples,
            row.get("method") or "Avg",
        )

        passed = _limit_result(
            final_value,
            row.get("lower_limit"),
            row.get("upper_limit"),
        )

        result["result"] = final_value
        result["status"] = "PASS" if passed else "FAIL"
        result["pass"] = passed
        result["fail"] = not passed

    def _run(self):
        try:
            rows = self.specification.get("rows", [])

            for row in rows:
                if self.stop_event.is_set():
                    break

                self._run_row(row)

            if not self.stop_event.is_set():
                self.message = "Test completed"

        except Exception as exc:
            self.message = str(exc)

        finally:
            self.running = False


def _load_spec(spec_id):
    with _connect() as conn:
        return _get_spec(conn, spec_id)


def _get_runtime(spec_id):
    with _state_lock:
        return _runtimes.get(int(spec_id))


@specification_runtime_bp.post(
    "/start/<int:specification_id>"
)
def start_runtime(specification_id):
    specification = _load_spec(specification_id)

    if not specification:
        return jsonify({
            "success": False,
            "message": "Specification not found",
        }), 404

    if not specification.get("rows"):
        return jsonify({
            "success": False,
            "message": "Specification has no parameters",
        }), 400

    with _state_lock:
        old = _runtimes.get(specification_id)

        if old and old.running:
            return jsonify({
                "success": True,
                "running": True,
                "message": "Already running",
            })

        runtime = SpecificationRuntime(specification)
        _runtimes[specification_id] = runtime
        runtime.start()

    return jsonify(runtime_status(runtime))


@specification_runtime_bp.post(
    "/stop/<int:specification_id>"
)
def stop_runtime(specification_id):
    runtime = _get_runtime(specification_id)

    if not runtime:
        return jsonify({
            "success": True,
            "running": False,
            "message": "Not running",
        })

    runtime.stop()

    return jsonify(runtime_status(runtime))


@specification_runtime_bp.get(
    "/status/<int:specification_id>"
)
def runtime_status_route(specification_id):
    runtime = _get_runtime(specification_id)

    if not runtime:
        return jsonify({
            "success": True,
            "running": False,
            "message": "Idle",
            "results": {},
        })

    return jsonify(runtime_status(runtime))


def runtime_status(runtime):
    with _state_lock:
        return {
            "success": True,
            "running": runtime.running,
            "specification_id": runtime.spec_id,
            "message": runtime.message,
            "started_at": runtime.started_at,
            "results": runtime.results,
        }


@specification_runtime_bp.post(
    "/test-source"
)
def test_source():
    body = request.get_json(silent=True) or {}
    row = body.get("row") or {}

    if not row:
        return jsonify({
            "success": False,
            "message": "row is required",
        }), 400

    try:
        result = _validate_source(row)

        return jsonify({
            "success": True,
            **result,
        })

    except Exception as exc:
        return jsonify({
            "success": False,
            "message": str(exc),
        }), 400


@specification_runtime_bp.get("/devices")
def runtime_devices():
    """
    Convenience endpoint for the Specification UI.
    The actual device lists remain owned by TCP/RS232 modules.
    """
    try:
        tcp = _http_json(
            "GET",
            "/api/tcp/devices",
        )

        rs232 = _http_json(
            "GET",
            "/api/rs232/devices",
        )

        internal = _http_json(
            "GET",
            "/api/internal-variables",
        )

        return jsonify({
            "success": True,
            "tcp": tcp.get("devices", []),
            "rs232": rs232.get("devices", []),
            "internal": internal.get("variables", []),
        })

    except Exception as exc:
        return jsonify({
            "success": False,
            "message": str(exc),
        }), 500