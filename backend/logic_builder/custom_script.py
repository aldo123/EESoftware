"""
custom_script.py — sandboxed execution for the "Custom Script" Logic Builder node.
Kept in its own file so the exec/whitelist boundary is easy to audit in one place,
separate from the rest of the flow engine.

Restricting __builtins__ alone (the naive approach) is NOT enough — Python
attribute access (`.`) doesn't go through __builtins__ at all, so code like
`().__class__.__bases__[0].__subclasses__()` can still walk from any literal to
a live `os`/`subprocess` reference via some class's `__init__.__globals__`,
completely bypassing an `import`-less builtins dict. This was verified against
this exact module (a payload reached `os.popen("whoami")` before this fix).
The real fix is to reject the code at the AST level, before it ever runs, if
it touches ANY dunder name/attribute or an import statement — that closes the
whole class of "walk the object graph to find a module" escapes, not just the
one payload that happened to be tried.
"""
import ast
import math
import threading


class _ReadOnlyModuleProxy:
    """Wraps a real module so scripts can read from it (`math.sqrt(2)`) but never
    write to it. `math` is one shared module object reused across every script
    execution (all CPs, all requests) — without this, `math.pi = 999` in one
    script would silently corrupt `math` for every other flow in the process
    until restart. Verified against this exact leak before adding the proxy.
    The private ref is stored under a '__'-prefixed name, which the AST
    checker below rejects outright in any script — so there's no attribute
    name a script could type to reach the real module directly, regardless of
    how Python's own attribute lookup resolves it internally."""
    def __init__(self, mod):
        object.__setattr__(self, "__mod", mod)

    def __getattr__(self, name):
        return getattr(object.__getattribute__(self, "__mod"), name)

    def __setattr__(self, name, value):
        raise AttributeError("module ini read-only di dalam Custom Script")

    def __delattr__(self, name):
        raise AttributeError("module ini read-only di dalam Custom Script")


SAFE_BUILTINS = {
    "len": len, "str": str, "int": int, "float": float, "bool": bool,
    "abs": abs, "min": min, "max": max, "round": round, "range": range,
    "enumerate": enumerate, "sum": sum, "sorted": sorted, "list": list,
    "dict": dict, "set": set, "tuple": tuple,
    "True": True, "False": False, "None": None,
    "math": _ReadOnlyModuleProxy(math),
}

# Pure-Python threads can't be force-killed, so a stuck script (e.g. `while True: pass`)
# keeps burning CPU on a leaked thread until the backend process restarts — there's no
# way around that without subprocess isolation, which is more than this local, single-
# operator tool needs. What this DOES guarantee: each call gets its own thread (never a
# shared pool that a few stuck scripts could exhaust) and the thread is `daemon=True`, so
# a leaked script never blocks the backend process from exiting/restarting.
EXEC_TIMEOUT_SECONDS = 5


class UnsafeScriptError(Exception):
    pass


# Every AST field that can hold a plain identifier string. Name.id and
# Attribute.attr are the obvious ones, but `global x` / `nonlocal x` carry
# their names as raw strings on Global/Nonlocal.names (not Name nodes), and
# function/class/parameter/except-alias names are plain strings too
# (FunctionDef.name, arg.arg, ExceptHandler.name, alias.asname). A filter that
# only checked Name/Attribute missed `global __builtins__; __builtins__ = ...`
# entirely — confirmed by testing it against this exact checker — so every
# identifier-bearing field is swept, not just the two common ones.
_IDENTIFIER_FIELDS = ("id", "attr", "name", "arg", "asname")


def _check_ast_safety(tree: ast.AST) -> None:
    """Reject anything that could reach outside the sandbox: import statements
    and any dunder identifier anywhere in the tree (__class__, __globals__,
    __subclasses__, __builtins__, __import__, etc. — the entire escape surface
    lives behind a dunder somewhere)."""
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise UnsafeScriptError("statement 'import' tidak diizinkan")

        if isinstance(node, (ast.Global, ast.Nonlocal)):
            for n in node.names:
                if n.startswith("__"):
                    raise UnsafeScriptError(f"akses nama '{n}' tidak diizinkan")
            continue

        for field in _IDENTIFIER_FIELDS:
            value = getattr(node, field, None)
            if isinstance(value, str) and value.startswith("__"):
                raise UnsafeScriptError(f"akses nama '{value}' tidak diizinkan")


def _exec_code(code: str, local_ns: dict, out: dict):
    try:
        exec(code, {"__builtins__": SAFE_BUILTINS}, local_ns)
    except Exception as e:
        out["error"] = e
    finally:
        out["done"] = True


def _make_record_result(cp, local_ns, logs):
    """Bound `record_result(value)` for the sandbox — logs one OK/NG row to
    SN List (snlist_cp{cp}) for the FPY dashboard. Only wired up when the
    script runs as part of a real flow (`cp` given); the Logic Builder
    "Check" dry-run button passes no cp, so it becomes a harmless no-op
    there instead of writing test rows into real production data.
    Reads `local_ns["fields"]` at call time (not a snapshot) so a script
    that edits `fields` before calling record_result() carries those
    edits into the logged row."""
    def _record_result(value):
        if not cp:
            logs.append("record_result() skipped: no cp in this context (dry-run Check)")
            return
        from routes.snlist import record_result as _write
        _write(cp, "OK" if value else "NG", local_ns.get("fields", {}))
        logs.append(f"record_result: {'OK' if value else 'NG'} logged to SN List CP{cp}")
    return _record_result


def run_custom_script(code: str, fields: dict, cp: str = None) -> dict:
    """Run user-written code in a restricted namespace (no imports, no dunder
    access, no file/OS access, bounded run time).

    The script reads/writes a `fields` dict and sets `result` (bool) to pick the
    true/false output branch; calling `log(msg)` appends to the returned log list;
    calling `record_result(True/False)` logs one OK/NG row to SN List for the FPY
    dashboard — the flow author decides where "the unit is done" happens, since
    a flow graph can branch in ways only they know the true endpoint of.
    Never raises — errors come back as {"success": False, "error": "..."}.
    """
    if not code or not code.strip():
        return {"success": False, "error": "Script kosong", "fields": {}, "result": None, "logs": []}

    try:
        tree = ast.parse(code, mode="exec")
        _check_ast_safety(tree)
    except SyntaxError as e:
        return {"success": False, "error": f"SyntaxError: {e}", "fields": {}, "result": None, "logs": []}
    except UnsafeScriptError as e:
        return {"success": False, "error": f"Unsafe script: {e}", "fields": {}, "result": None, "logs": []}

    logs = []
    local_ns = {
        "fields": dict(fields),
        "result": True,
        "log": lambda msg: logs.append(str(msg)),
    }
    local_ns["record_result"] = _make_record_result(cp, local_ns, logs)
    out = {}

    t = threading.Thread(target=_exec_code, args=(code, local_ns, out), daemon=True)
    t.start()
    t.join(EXEC_TIMEOUT_SECONDS)

    if t.is_alive():
        return {"success": False, "error": f"Script timeout (> {EXEC_TIMEOUT_SECONDS}s) — kemungkinan infinite loop", "fields": {}, "result": None, "logs": logs}
    if "error" in out:
        e = out["error"]
        return {"success": False, "error": f"{type(e).__name__}: {e}", "fields": {}, "result": None, "logs": logs}

    out_fields = local_ns.get("fields", {})
    if not isinstance(out_fields, dict):
        return {"success": False, "error": "'fields' harus tetap berupa dict", "fields": {}, "result": None, "logs": logs}

    # Stringify here (not just at the FlowExecutor call site) so a script that
    # stashes something odd in `fields` (a function, the math proxy, etc.) can
    # never break JSON serialization on the "Check" endpoint's response, and
    # so the preview always matches what a real flow run would actually store.
    return {"success": True, "error": None, "fields": {str(k): str(v) for k, v in out_fields.items()}, "result": bool(local_ns.get("result", True)), "logs": logs}
