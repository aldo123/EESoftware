// src/hooks/useInternalVariables.js
// Fast shared Internal Variable cache: optimistic UI + background batched persistence.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { API } from "../service/api";

const API_BASE = `${API}/api/internal-variables`;
const POLL_INTERVAL = 50;
const WRITE_DEBOUNCE_MS = 5;

let state = { variables: [], byName: {}, byId: {}, loading: false, initialized: false, error: "" };
let listeners = new Set();
let pollTimer = null;
let refCount = 0;
let requestPromise = null;
let flushTimer = null;
let flushRunning = false;
const pending = new Map(); // id -> { value, version }
const dirty = new Map();   // id -> { id, value, version }

const emit = () => listeners.forEach((fn) => { try { fn(); } catch {} });

const normalizeValue = (value, type) => {
  if (type === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    const s = String(value).toLowerCase();
    return s === "true" || s === "1" || s === "on";
  }
  return value == null ? "" : String(value);
};

const normalizeVariable = (v) => ({ ...v, value: normalizeValue(v.value, v.data_type) });

const rebuild = (variables) => {
  const byName = {}, byId = {};
  for (const v of variables) {
    if (!v) continue;
    if (v.name) byName[v.name] = v;
    if (v.id != null) byId[String(v.id)] = v;
  }
  state = { ...state, variables, byName, byId, initialized: true };
};

const request = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok || data?.success === false) {
    throw new Error(data?.message || data?.error || `Internal variable request failed (${response.status})`);
  }
  return data;
};

const fetchVariables = async ({ silent = false } = {}) => {
  if (requestPromise) return requestPromise;
  if (!silent) {
    state = { ...state, loading: true, error: "" };
    emit();
  }
  requestPromise = request(API_BASE)
    .then((data) => {
      const server = Array.isArray(data?.variables) ? data.variables.map(normalizeVariable) : [];
      const merged = server.map((v) => {
        const p = pending.get(String(v.id));
        if (!p) return v;
        const pv = normalizeValue(p.value, v.data_type);
        if (Object.is(v.value, pv)) {
          pending.delete(String(v.id));
          return v;
        }
        return { ...v, value: pv };
      });
      rebuild(merged);
      state = { ...state, loading: false, error: "" };
      emit();
      return merged;
    })
    .catch((e) => {
      state = { ...state, loading: false, error: e?.message || "Failed to load internal variables" };
      emit();
      throw e;
    })
    .finally(() => { requestPromise = null; });
  return requestPromise;
};

const scheduleFlush = () => {
  if (flushTimer || typeof window === "undefined" || dirty.size === 0) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flushWrites().catch(() => {});
  }, WRITE_DEBOUNCE_MS);
};

const flushWrites = async () => {
  if (flushRunning || dirty.size === 0) return;
  flushRunning = true;
  const batch = Array.from(dirty.values());
  batch.forEach((x) => dirty.delete(String(x.id)));
  try {
    await request(`${API_BASE}/batch`, {
      method: "POST",
      body: JSON.stringify({ updates: batch.map(({ id, value }) => ({ id, value })) }),
    });
  } catch (e) {
    // Retry only values that have not been superseded.
    for (const item of batch) {
      const p = pending.get(String(item.id));
      if (p?.version === item.version) dirty.set(String(item.id), item);
    }
    state = { ...state, error: e?.message || "Failed to save internal variables" };
    emit();
    if (typeof window !== "undefined") {
      window.setTimeout(scheduleFlush, 250);
    }
  } finally {
    flushRunning = false;
    if (dirty.size) scheduleFlush();
  }
};

const startPolling = () => {
  if (pollTimer || typeof window === "undefined") return;
  fetchVariables({ silent: false }).catch(() => {});
  pollTimer = window.setInterval(() => fetchVariables({ silent: true }).catch(() => {}), POLL_INTERVAL);
};

const stopPolling = () => {
  if (!pollTimer || typeof window === "undefined") return;
  window.clearInterval(pollTimer);
  pollTimer = null;
};

const subscribe = (listener) => {
  listeners.add(listener);
  refCount++;
  if (refCount === 1) startPolling();
  return () => {
    listeners.delete(listener);
    refCount = Math.max(0, refCount - 1);
    if (!refCount) stopPolling();
  };
};

const getSnapshot = () => state;

export function useInternalVariables(cpNumber = "") {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const scopedCP = String(cpNumber ?? "").trim();

  const refresh = useCallback(() => fetchVariables({ silent: false }), []);

  const getVariable = useCallback((name) => name ? state.byName[name] || null : null, []);
  const getValue = useCallback((name, fallback = undefined) => {
    const v = state.byName[name];
    return v ? v.value : fallback;
  }, []);

  const setValue = useCallback((name, value) => {
    const variable = state.byName[name];
    if (!variable) throw new Error(`Internal variable '${name}' does not exist.`);
    const normalized = normalizeValue(value, variable.data_type);
    const id = String(variable.id);
    const version = (pending.get(id)?.version || 0) + 1;

    rebuild(state.variables.map((v) => String(v.id) === id ? { ...v, value: normalized } : v));
    pending.set(id, { value: normalized, version });
    dirty.set(id, { id: variable.id, value: normalized, version });
    emit();
    scheduleFlush();

    // Deliberately not waiting for SQLite/network.
    return Promise.resolve(normalized);
  }, []);

  const setValues = useCallback((updates = []) => {
    const result = [];
    for (const u of updates) {
      const variable = u?.id != null ? state.byId[String(u.id)] : state.byName[u?.name];
      if (!variable) continue;
      const normalized = normalizeValue(u.value, variable.data_type);
      const id = String(variable.id);
      const version = (pending.get(id)?.version || 0) + 1;
      rebuild(state.variables.map((v) => String(v.id) === id ? { ...v, value: normalized } : v));
      pending.set(id, { value: normalized, version });
      dirty.set(id, { id: variable.id, value: normalized, version });
      result.push({ id: variable.id, name: variable.name, value: normalized });
    }
    emit();
    scheduleFlush();
    return Promise.resolve(result);
  }, []);

  const createVariable = useCallback(async ({ name, data_type = "string", value = "", cp_number = "", cpNumber = "" }) => {
    const n = String(name || "").trim();
    const scopedCP = String(cp_number || cpNumber || "").trim();
    if (!n) throw new Error("Variable name is required.");
    const data = await request(API_BASE, {
      method: "POST",
      body: JSON.stringify({
        name: n,
        ...(scopedCP ? { cp_number: scopedCP } : {}),
        data_type,
        value: normalizeValue(value, data_type),
      }),
    });
    await fetchVariables({ silent: true });
    return data?.variable || null;
  }, []);

  const updateVariable = useCallback(async (id, { name, data_type = "string", value = "", cp_number = "", cpNumber = "" }) => {
    if (id == null) throw new Error("Variable id is required.");
    const scopedCP = String(cp_number || cpNumber || "").trim();
    const data = await request(`${API_BASE}/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: String(name || "").trim(),
        ...(scopedCP ? { cp_number: scopedCP } : {}),
        data_type,
        value: normalizeValue(value, data_type),
      }),
    });
    pending.delete(String(id)); dirty.delete(String(id));
    await fetchVariables({ silent: true });
    return data?.variable || null;
  }, []);

  const deleteVariable = useCallback(async (id) => {
    if (id == null) throw new Error("Variable id is required.");
    await request(`${API_BASE}/${id}`, { method: "DELETE" });
    pending.delete(String(id)); dirty.delete(String(id));
    await fetchVariables({ silent: true });
    return true;
  }, []);

  useEffect(() => () => {}, []);

  const scopedVariables = scopedCP
    ? snapshot.variables.filter(
        (v) => String(v?.cp_number ?? v?.cp ?? "").trim() === scopedCP
      )
    : snapshot.variables;

  return {
    variables: scopedVariables,
    allVariables: snapshot.variables,
    byName: snapshot.byName, loading: snapshot.loading,
    initialized: snapshot.initialized, error: snapshot.error,
    getValue, getVariable, setValue, setValues,
    createVariable, updateVariable, deleteVariable, refresh,
  };
}

export default useInternalVariables;