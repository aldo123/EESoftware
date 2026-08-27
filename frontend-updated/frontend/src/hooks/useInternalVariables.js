// src/hooks/useInternalVariables.js
//
// Central access layer for backend/data/internalvariable.db.
//
// Usage from any widget:
//   const { getValue, setValue, variables, refresh } = useInternalVariables();
//
// The hook keeps one shared in-memory cache and synchronizes it with the
// backend API. Widgets should NOT call /api/internal-variables directly.

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { API } from "../service/api";

const API_BASE = `${API}/api/internal-variables`;
const POLL_INTERVAL = 1000;

let state = {
  variables: [],
  byName: {},
  loading: false,
  initialized: false,
  error: "",
};

let listeners = new Set();
let pollTimer = null;
let refCount = 0;
let requestPromise = null;

const emit = () => {
  listeners.forEach((listener) => listener());
};

const normalizeValue = (value, dataType) => {
  if (dataType === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  if (dataType === "boolean") {
    if (typeof value === "boolean") return value;
    return String(value).toLowerCase() === "true" || String(value) === "1";
  }

  return value == null ? "" : String(value);
};

const normalizeVariable = (item) => ({
  ...item,
  value: normalizeValue(item.value, item.data_type),
});

const rebuildIndex = (variables) => {
  const byName = {};

  for (const item of variables) {
    if (item?.name) {
      byName[item.name] = item;
    }
  }

  state = {
    ...state,
    variables,
    byName,
    initialized: true,
  };
};

const request = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    // Keep empty response body valid for DELETE/other endpoints.
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        `Internal variable request failed (${response.status})`
    );
  }

  return data;
};

const fetchVariables = async ({ silent = false } = {}) => {
  if (requestPromise) return requestPromise;

  if (!silent) {
    state = {
      ...state,
      loading: true,
      error: "",
    };
    emit();
  }

  requestPromise = request(`${API_BASE}`)
    .then((data) => {
      const list = Array.isArray(data?.variables)
        ? data.variables.map(normalizeVariable)
        : [];

      rebuildIndex(list);

      state = {
        ...state,
        loading: false,
        error: "",
      };

      emit();

      return list;
    })
    .catch((error) => {
      state = {
        ...state,
        loading: false,
        error: error?.message || "Failed to load internal variables",
      };

      emit();
      throw error;
    })
    .finally(() => {
      requestPromise = null;
    });

  return requestPromise;
};

const startPolling = () => {
  if (pollTimer || typeof window === "undefined") return;

  // Initial load.
  fetchVariables({ silent: false }).catch(() => {});

  pollTimer = window.setInterval(() => {
    fetchVariables({ silent: true }).catch(() => {});
  }, POLL_INTERVAL);
};

const stopPolling = () => {
  if (!pollTimer) return;

  window.clearInterval(pollTimer);
  pollTimer = null;
};

const subscribe = (listener) => {
  listeners.add(listener);
  refCount += 1;

  if (refCount === 1) {
    startPolling();
  }

  return () => {
    listeners.delete(listener);
    refCount = Math.max(0, refCount - 1);

    if (refCount === 0) {
      stopPolling();
    }
  };
};

const getSnapshot = () => state;

export function useInternalVariables() {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot
  );

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    return fetchVariables({ silent: false });
  }, []);

  const getVariable = useCallback((name) => {
    if (!name) return null;
    return state.byName[name] || null;
  }, []);

  const getValue = useCallback((name, fallback = undefined) => {
    const variable = state.byName[name];

    return variable ? variable.value : fallback;
  }, []);

  const setValue = useCallback(async (name, value) => {
    const variable = state.byName[name];

    if (!variable) {
      throw new Error(`Internal variable '${name}' does not exist.`);
    }

    const normalized = normalizeValue(value, variable.data_type);

    // Optimistic update so all widgets react immediately.
    const optimistic = state.variables.map((item) =>
      item.id === variable.id
        ? { ...item, value: normalized }
        : item
    );

    rebuildIndex(optimistic);
    emit();

    try {
      const data = await request(`${API_BASE}/${variable.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: variable.name,
          data_type: variable.data_type,
          value: normalized,
        }),
      });

      // Use backend's returned object when available.
      if (data?.variable) {
        const updated = normalizeVariable(data.variable);

        const next = state.variables.map((item) =>
          item.id === updated.id ? updated : item
        );

        rebuildIndex(next);
        emit();

        return updated.value;
      }

      // Otherwise refresh from DB.
      await fetchVariables({ silent: true });

      return getValue(name, normalized);
    } catch (error) {
      // Re-sync after failed optimistic write.
      await fetchVariables({ silent: true }).catch(() => {});
      throw error;
    }
  }, []);

  const createVariable = useCallback(
    async ({ name, data_type = "string", value = "" }) => {
      const trimmedName = String(name || "").trim();

      if (!trimmedName) {
        throw new Error("Variable name is required.");
      }

      const data = await request(API_BASE, {
        method: "POST",
        body: JSON.stringify({
          name: trimmedName,
          data_type,
          value: normalizeValue(value, data_type),
        }),
      });

      await fetchVariables({ silent: true });

      return data?.variable || null;
    },
    []
  );

  const updateVariable = useCallback(
    async (
      id,
      { name, data_type = "string", value = "" }
    ) => {
      if (id == null) {
        throw new Error("Variable id is required.");
      }

      const data = await request(`${API_BASE}/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: String(name || "").trim(),
          data_type,
          value: normalizeValue(value, data_type),
        }),
      });

      await fetchVariables({ silent: true });

      return data?.variable || null;
    },
    []
  );

  const deleteVariable = useCallback(async (id) => {
    if (id == null) {
      throw new Error("Variable id is required.");
    }

    await request(`${API_BASE}/${id}`, {
      method: "DELETE",
    });

    await fetchVariables({ silent: true });

    return true;
  }, []);

  return {
    // Shared state
    variables: snapshot.variables,
    byName: snapshot.byName,
    loading: snapshot.loading,
    initialized: snapshot.initialized,
    error: snapshot.error,

    // Read
    getValue,
    getVariable,

    // Write
    setValue,

    // CRUD
    createVariable,
    updateVariable,
    deleteVariable,

    // Manual synchronization
    refresh,
  };
}

export default useInternalVariables;