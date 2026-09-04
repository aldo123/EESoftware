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
from concurrent.futures import ThreadPoolExecutor, wait
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

# Short runtime cache to collapse duplicate reads from multiple specification rows.
_RUNTIME_CACHE_TTL = 0.040
_runtime_cache_lock = threading.RLock()
_runtime_cache = {}
_runtime_inflight = {}


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


def _cached_read(key, loader, ttl=_RUNTIME_CACHE_TTL):
    now = time.monotonic()
    with _runtime_cache_lock:
        cached = _runtime_cache.get(key)
        if cached and now - cached[0] < ttl:
            return cached[1]
        event = _runtime_inflight.get(key)
        if event is None:
            event = threading.Event()
            _runtime_inflight[key] = event
            owner = True
        else:
            owner = False

    if not owner:
        event.wait(timeout=0.25)
        with _runtime_cache_lock:
            cached = _runtime_cache.get(key)
            if cached:
                return cached[1]
        return loader()

    try:
        value = loader()
        with _runtime_cache_lock:
            _runtime_cache[key] = (time.monotonic(), value)
        return value
    finally:
        with _runtime_cache_lock:
            event = _runtime_inflight.pop(key, None)
            if event is not None:
                event.set()


def _get_internal_variables():
    return _cached_read(
        "internal:variables",
        lambda: _http_json("GET", "/api/internal-variables").get("variables", []),
    )


def _get_internal_value(name):
    wanted = str(name)
    for variable in _get_internal_variables():
        if str(variable.get("name")) == wanted:
            return variable.get("value")
    raise ValueError(f"Internal variable '{name}' not found")


def _read_tcp(device_name, register_type, source):
    if not device_name:
        raise ValueError("TCP Device Source is required")

    address_type = _normalize_register_type(register_type)
    address = _address(source)
    key = f"tcp:{device_name}:{address_type}:{address}"

    def loader():
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
            raise RuntimeError(data.get("message") or "TCP read failed")
        return data.get("value")

    return _cached_read(key, loader)


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


def _find_internal_variable(name):
    wanted = str(name or "").strip()
    if not wanted:
        raise ValueError("Internal result variable is required")

    for variable in _get_internal_variables():
        if str(variable.get("name")) == wanted:
            return variable

    raise ValueError(f"Internal variable '{wanted}' not found")


def _write_internal_value(name, value):
    variable = _find_internal_variable(name)
    variable_id = variable.get("id")
    if variable_id is None:
        raise ValueError(f"Internal variable '{name}' has no id")

    data_type = str(variable.get("data_type") or "string").strip().lower()
    if data_type == "boolean":
        payload_value = _to_bool(value)
    elif data_type == "number":
        payload_value = float(_to_number(value))
    else:
        payload_value = str(value)

    payload = {
        "name": variable.get("name"),
        "cp_number": variable.get("cp_number"),
        "data_type": variable.get("data_type") or "string",
        "value": payload_value,
    }
    return _http_json(
        "PUT",
        f"/api/internal-variables/{variable_id}",
        payload,
    )


def _write_tcp(device_name, register_type, address, value):
    if not device_name:
        raise ValueError("TCP result device is required")

    area = _normalize_register_type(register_type)
    if area not in {"coil", "holding_register"}:
        raise ValueError(
            "Result TCP register must be Holding or Coil"
        )

    numeric_address = _address(address)
    if area == "coil":
        payload_value = _to_bool(value)
    else:
        payload_value = int(round(float(_to_number(value))))
        if payload_value < 0 or payload_value > 65535:
            raise ValueError(
                f"Holding register result out of range: {payload_value}"
            )

    return _http_json(
        "POST",
        "/api/tcp/write",
        {
            "device_name": device_name,
            "address_type": area,
            "address": numeric_address,
            "value": payload_value,
        },
    )


def _write_result_target(target_type, device, register_type, target, value):
    target = str(target or "").strip()
    if not target:
        return {"success": True, "skipped": True}
    target_type = str(target_type or "internal").strip()
    if target_type == "internal":
        return _write_internal_value(target, value)
    if target_type == "TCP":
        return _write_tcp(device, register_type, target, value)
    raise ValueError(f"Unsupported result target type: {target_type}")


def _write_result_outputs(row, final_value, passed):
    """
    Write the calculated result to the configured Value Result target and
    PASS/FAIL to the configured Status Result target.

    Status mapping:
      Internal boolean/number -> TRUE/1 for PASS, FALSE/0 for FAIL
      Internal string         -> "PASS" / "FAIL"
      TCP Coil                -> 1 for PASS, 0 for FAIL
      TCP Holding Register    -> 1 for PASS, 0 for FAIL
    """
    errors = []

    try:
        _write_result_target(
            row.get("value_result_type"),
            row.get("value_result_device"),
            row.get("value_result_register_type"),
            row.get("value_result"),
            final_value,
        )
    except Exception as exc:
        errors.append(f"Value Result: {exc}")

    status_value = "PASS" if passed else "FAIL"
    try:
        status_target_type = str(
            row.get("status_result_type") or "internal"
        ).strip()
        if status_target_type == "internal":
            variable = _find_internal_variable(row.get("status_result"))
            data_type = str(variable.get("data_type") or "string").lower()
            if data_type == "boolean":
                output_status_value = bool(passed)
            elif data_type == "number":
                output_status_value = 1 if passed else 0
            else:
                output_status_value = status_value
        else:
            # TCP Coil/Holding Register status is always 1 = PASS, 0 = FAIL.
            output_status_value = 1 if passed else 0

        _write_result_target(
            status_target_type,
            row.get("status_result_device"),
            row.get("status_result_register_type"),
            row.get("status_result"),
            output_status_value,
        )
    except Exception as exc:
        errors.append(f"Status Result: {exc}")

    return errors


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
        "output_errors": [],
        "output_error": None,
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
        self.cycle_count = 0

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

    def _wait_trigger_on(self, row):
        """Wait until a configured trigger becomes TRUE."""
        while not self.stop_event.is_set():
            try:
                if _read_trigger(row):
                    return True
            except Exception as exc:
                key = str(row["id"])
                self.results[key]["status"] = "trigger_error"
                self.results[key]["error"] = str(exc)

            time.sleep(0.05)

        return False

    def _wait_trigger_off(self, row):
        """Wait for a falling edge before accepting the next trigger."""
        trigger_type = str(row.get("trigger_start") or "").strip()

        # Realtime is intentionally level-free: every completed window
        # immediately starts the next window.
        if trigger_type == "Realtime":
            return True

        while not self.stop_event.is_set():
            try:
                if not _read_trigger(row):
                    return True
            except Exception as exc:
                key = str(row["id"])
                self.results[key]["status"] = "trigger_error"
                self.results[key]["error"] = str(exc)

            time.sleep(0.05)

        return False

    def _run_row(self, row, trigger_time=None, wait_for_trigger=True):
        key = str(row["id"])
        result = self.results[key]

        result["status"] = "waiting_trigger"

        if wait_for_trigger:
            if not self._wait_trigger(row):
                result["status"] = "stopped"
                return
            trigger_time = time.monotonic()

        if trigger_time is None:
            trigger_time = time.monotonic()

        result["status"] = "running"

        start = float(row.get("time_start") or 0)
        stop = float(row.get("time_stop") or 0)

        # trigger_time is supplied by the trigger group. Do NOT reset it here.
        # This keeps Time Start/Stop synchronized across rows sharing a trigger.
        samples = []
        sample_interval = 0.070
        next_sample = trigger_time + start

        while not self.stop_event.is_set():
            now = time.monotonic()

            if now >= trigger_time + stop:
                break

            if now < next_sample:
                time.sleep(min(next_sample - now, 0.01))
                continue

            try:
                raw = _read_source(row)
                value = _to_number(raw)
                samples.append(value)
                result["samples"] = list(samples)
                result["last_value"] = value
            except Exception as exc:
                result["error"] = str(exc)

            next_sample += sample_interval

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
        result["output_errors"] = _write_result_outputs(
            row,
            final_value,
            passed,
        )
        if result["output_errors"]:
            result["output_error"] = " | ".join(result["output_errors"])

    def _trigger_key(self, row):
        return (
            str(row.get("trigger_start") or "").strip(),
            str(row.get("trigger_device") or "").strip(),
            str(row.get("trigger_register_type") or "").strip(),
            str(row.get("trigger_source") or "").strip(),
        )

    def _run_parallel_group(self, rows):
        """
        Continuously execute all rows sharing the same trigger.

        Edge-triggered cycle for Internal/TCP triggers:
            OFF -> wait ON -> sample -> PASS/FAIL -> wait OFF -> repeat

        Realtime is intentionally continuous and starts another cycle as soon
        as the previous sampling window is complete.
        """
        if not rows:
            return

        trigger_row = rows[0]
        trigger_type = str(trigger_row.get("trigger_start") or "").strip()
        completed_cycle = False

        while not self.stop_event.is_set():
            # First cycle may trigger from the current active level. After a
            # cycle has consumed the trigger, require a real OFF state before
            # accepting the next ON state.
            if completed_cycle and trigger_type != "Realtime":
                if not self._wait_trigger_off(trigger_row):
                    break

            if self.stop_event.is_set():
                break

            # Prepare a clean result state for this cycle.
            for row in rows:
                result = self.results[str(row["id"])]
                result["status"] = "waiting_trigger"
                result["result"] = None
                result["pass"] = None
                result["fail"] = None
                result["samples"] = []
                result["last_value"] = None
                result["error"] = None

            self.message = "Waiting for trigger..."

            # Wait for the rising edge / active level.
            if not self._wait_trigger_on(trigger_row):
                break

            if self.stop_event.is_set():
                break

            trigger_time = time.monotonic()
            self.message = "Trigger detected"

            for row in rows:
                self.results[str(row["id"])] ["status"] = "running"

            executor = ThreadPoolExecutor(
                max_workers=max(1, len(rows)),
                thread_name_prefix=f"Specification-{self.spec_id}-Group",
            )
            futures = []

            try:
                for row in rows:
                    futures.append(
                        executor.submit(
                            self._run_row,
                            row,
                            trigger_time,
                            False,
                        )
                    )

                wait(futures)

                for future in futures:
                    future.result()
            finally:
                executor.shutdown(wait=True)

            if self.stop_event.is_set():
                break

            self.cycle_count = getattr(self, "cycle_count", 0) + 1
            completed_cycle = True
            self.message = (
                f"Test completed - cycle {self.cycle_count}; "
                "waiting for trigger OFF"
            )

            # Loop back. The next iteration will require OFF before accepting
            # another ON trigger, preventing a sustained HIGH from retriggering.

    def _run(self):
        try:
            rows = self.specification.get("rows", [])

            groups = []
            group_map = {}

            for row in rows:
                key = self._trigger_key(row)
                if key not in group_map:
                    group_map[key] = []
                    groups.append(group_map[key])
                group_map[key].append(row)

            # Every trigger group gets its own worker so different trigger
            # configurations can operate independently.
            group_threads = []

            for index, group in enumerate(groups):
                if self.stop_event.is_set():
                    break

                thread = threading.Thread(
                    target=self._run_parallel_group,
                    args=(group,),
                    daemon=True,
                    name=f"Specification-{self.spec_id}-TriggerGroup-{index}",
                )
                group_threads.append(thread)
                thread.start()

            # Keep the SpecificationRuntime alive while trigger groups are
            # waiting/running. This is what allows OFF -> ON -> OFF -> ON
            # cycles without requiring the frontend to call /start again.
            while not self.stop_event.is_set():
                if not any(thread.is_alive() for thread in group_threads):
                    break
                time.sleep(0.1)

        except Exception as exc:
            self.message = str(exc)

        finally:
            self.running = False
            if self.stop_event.is_set():
                self.message = "Stopped"
            elif not self.message:
                self.message = "Test completed"


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
        results = runtime.results
        completed = sum(
            1
            for item in results.values()
            if str(item.get("status", "")).upper() in {"PASS", "FAIL"}
        )
        return {
            "success": True,
            "running": runtime.running,
            "specification_id": runtime.spec_id,
            "message": runtime.message,
            "started_at": runtime.started_at,
            "completed_count": completed,
            "total_count": len(results),
            "cycle_count": getattr(runtime, "cycle_count", 0),
            "results": results,
        }


_test_state_lock = threading.RLock()
_test_sessions = {}


def _test_status(session):
    with _test_state_lock:
        elapsed = 0.0
        if session.trigger_at is not None:
            elapsed = max(0.0, time.monotonic() - session.trigger_at)

        return {
            "success": True,
            "test_id": session.test_id,
            "parameter_test": session.row.get("parameter_test"),
            "status": session.status,
            "message": session.message,
            "running": session.running,
            "trigger_at": session.trigger_at,
            "elapsed_seconds": elapsed if session.status in {
                "running", "waiting_trigger"
            } else session.elapsed_seconds,
            "time_start": session.start,
            "time_stop": session.stop,
            "method": session.method,
            "sample_interval_ms": 70,
            "sample_count": len(session.samples),
            "samples": list(session.samples),
            "last_value": session.last_value,
            "result": session.result,
            "pass": session.passed,
            "fail": session.failed,
            "error": session.error,
            "output_errors": getattr(session, "output_errors", []),
            "output_error": getattr(session, "output_error", None),
        }


class SpecificationTestSession:
    """
    One row Test session.

    Flow:
        Test clicked
          -> WAITING_TRIGGER
          -> trigger becomes TRUE
          -> wait Time Start
          -> sample every 70 ms
          -> Time Stop
          -> Avg / Min / Max over ALL samples
          -> PASS / FAIL
    """

    def __init__(self, test_id, row):
        self.test_id = str(test_id)
        self.row = dict(row)

        self.running = True
        self.status = "waiting_trigger"
        self.message = "Waiting for trigger..."
        self.error = None

        self.start = float(row.get("time_start") or 0)
        self.stop = float(row.get("time_stop") or 0)
        self.method = str(row.get("method") or "Avg").strip()

        self.samples = []
        self.last_value = None
        self.result = None
        self.passed = None
        self.failed = None
        self.output_errors = []
        self.output_error = None

        self.trigger_at = None
        self.elapsed_seconds = 0.0

        self.stop_event = threading.Event()
        self.thread = None

    def start_session(self):
        self.thread = threading.Thread(
            target=self._run,
            daemon=True,
            name=f"SpecificationTest-{self.test_id}",
        )
        self.thread.start()

    def _wait_for_trigger(self):
        while not self.stop_event.is_set():
            try:
                if _read_trigger(self.row):
                    return True
                self.error = None
            except Exception as exc:
                # A temporary communication error should not terminate
                # the test. Keep the UI in Waiting for trigger.
                self.error = str(exc)
                self.message = f"Waiting for trigger... ({exc})"

            time.sleep(0.05)

        return False

    def _run(self):
        try:
            if self.start < 0 or self.stop < 0:
                raise ValueError("Time values cannot be negative")

            if self.stop < self.start:
                raise ValueError("Time Stop must be >= Time Start")

            if self.method not in {"Avg", "Min", "Max"}:
                raise ValueError(
                    f"Unsupported method: {self.method}"
                )

            # IMPORTANT: Test waits for the configured trigger.
            self.status = "waiting_trigger"
            self.message = "Waiting for trigger..."

            if not self._wait_for_trigger():
                self.status = "stopped"
                self.message = "Test stopped"
                return

            # Trigger has just become active. Time Start/Stop are
            # measured relative to this trigger event.
            self.trigger_at = time.monotonic()
            sample_window_start = self.trigger_at + self.start
            sample_window_stop = self.trigger_at + self.stop

            self.status = "running"
            self.message = "Trigger detected. Waiting for Time Start..."

            next_sample = sample_window_start

            while not self.stop_event.is_set():
                now = time.monotonic()

                if now < next_sample:
                    self.elapsed_seconds = max(
                        0.0, now - self.trigger_at
                    )
                    time.sleep(min(next_sample - now, 0.01))
                    continue

                # Time Stop reached. Do not take samples after it.
                if now > sample_window_stop and self.samples:
                    break

                if now > sample_window_stop and not self.samples:
                    break

                self.message = "Sampling..."

                try:
                    raw = _read_source(self.row)
                    value = _to_number(raw)

                    self.samples.append(value)
                    self.last_value = value
                    self.error = None
                except Exception as exc:
                    # Keep testing even if one 70 ms read fails.
                    self.error = str(exc)

                self.elapsed_seconds = max(
                    0.0, min(now - self.trigger_at, self.stop)
                )

                next_sample += 0.070

                if next_sample > sample_window_stop:
                    break

            if self.stop_event.is_set():
                self.status = "stopped"
                self.message = "Test stopped"
                return

            if not self.samples:
                raise ValueError(
                    self.error
                    or "No valid samples collected during test window"
                )

            self.result = _calculate(self.samples, self.method)
            self.passed = _limit_result(
                self.result,
                self.row.get("lower_limit"),
                self.row.get("upper_limit"),
            )
            self.failed = not self.passed

            self.output_errors = _write_result_outputs(
                self.row,
                self.result,
                self.passed,
            )
            self.output_error = (
                " | ".join(self.output_errors)
                if self.output_errors
                else None
            )

            self.elapsed_seconds = self.stop
            self.status = "PASS" if self.passed else "FAIL"
            self.message = (
                f"Test completed: {self.status}"
            )

        except Exception as exc:
            self.status = "error"
            self.error = str(exc)
            self.message = str(exc)
            self.passed = False
            self.failed = True

        finally:
            self.running = False

    def stop(self):
        self.stop_event.set()


@specification_runtime_bp.post(
    "/test-source"
)
def test_source():
    """
    Start a single-row asynchronous test.

    Clicking Test immediately returns with status WAITING_TRIGGER.
    The frontend polls /test-source/status/<test_id> so the UI can show
    the trigger state and 70 ms samples in realtime.
    """
    body = request.get_json(silent=True) or {}
    row = body.get("row") or {}

    if not row:
        return jsonify({
            "success": False,
            "message": "row is required",
        }), 400

    try:
        start = float(row.get("time_start") or 0)
        stop = float(row.get("time_stop") or 0)

        if start < 0 or stop < 0:
            raise ValueError("Time values cannot be negative")

        if stop < start:
            raise ValueError("Time Stop must be >= Time Start")

        method = str(row.get("method") or "Avg").strip()
        if method not in {"Avg", "Min", "Max"}:
            raise ValueError(f"Unsupported method: {method}")

        import uuid

        test_id = uuid.uuid4().hex
        session = SpecificationTestSession(test_id, row)

        with _test_state_lock:
            _test_sessions[test_id] = session

        session.start_session()

        return jsonify(_test_status(session))

    except Exception as exc:
        return jsonify({
            "success": False,
            "message": str(exc),
        }), 400


@specification_runtime_bp.get(
    "/test-source/status/<test_id>"
)
def test_source_status(test_id):
    with _test_state_lock:
        session = _test_sessions.get(str(test_id))

    if not session:
        return jsonify({
            "success": False,
            "message": "Test session not found",
        }), 404

    return jsonify(_test_status(session))

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
        }), 300