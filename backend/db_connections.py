"""
Selectable MySQL connections for the Logic Builder's database nodes.

"EE (interlock)" is the existing connection from interlock.json (db_manager.db) and stays the default.
Extra connections (for example the machine's `traceability` database) live in
data/database_connections.json:

    {"connections": [{"name": "traceability", "server": "172.18.1.4", "catalog": "traceability",
                      "user": "tb_user_remote", "password": "", "ssl_mode": "REQUIRED"}]}

A node picks one by name in its "Database" field; an empty value means the default.
"""
import json
import os
import threading

from database import DatabaseManager

DEFAULT_NAME = "EE (interlock)"
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "database_connections.json")

TEMPLATE = {"connections": [{
    "name": "traceability", "server": "172.18.1.4", "catalog": "traceability",
    "user": "tb_user_remote", "password": "", "ssl_mode": "REQUIRED",
}]}

_cache = {}
_lock = threading.RLock()


class NamedDatabase(DatabaseManager):
    """A DatabaseManager that takes its settings from a connection entry instead of interlock.json."""

    def __init__(self, params):
        self._params = dict(params)
        super().__init__(json_file="", section="")

    def load_config(self):
        p = getattr(self, "_params", {})
        self.host = str(p.get("server", "127.0.0.1"))
        self.database = str(p.get("catalog", ""))
        self.user = str(p.get("user", "root"))
        self.password = str(p.get("password", ""))
        self.ssl_mode = str(p.get("ssl_mode", "REQUIRED"))


def _load():
    if not os.path.exists(CONFIG_PATH):
        try:
            os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(TEMPLATE, f, indent=2)
        except OSError:
            return list(TEMPLATE["connections"])
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8-sig") as f:
            rows = json.load(f).get("connections", [])
        return [r for r in rows if isinstance(r, dict) and str(r.get("name", "")).strip()]
    except Exception as exc:
        print("[DB CONNECTIONS] load error:", exc)
        return []


def list_connections():
    """Names (never passwords) for the editor's Database dropdown; the default comes first."""
    rows = [{"name": DEFAULT_NAME, "default": True}]
    rows += [{"name": str(r["name"]).strip(), "server": r.get("server", ""), "catalog": r.get("catalog", "")}
             for r in _load()]
    return rows


def get_database(name=None):
    """The DatabaseManager for `name`; empty / the default name gives the shared EE connection."""
    wanted = str(name or "").strip()
    if not wanted or wanted == DEFAULT_NAME:
        from db_manager import db
        return db
    with _lock:
        params = next((r for r in _load() if str(r.get("name", "")).strip().lower() == wanted.lower()), None)
        if params is None:
            raise ValueError(f"Database connection '{wanted}' is not defined (see data/database_connections.json)")
        key = wanted.lower()
        cached = _cache.get(key)
        if cached is None or cached[0] != params:
            _cache[key] = (dict(params), NamedDatabase(params))
        return _cache[key][1]
