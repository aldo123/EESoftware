import { useCallback, useEffect, useRef, useState } from "react";
import { API } from "../service/api";

const DEFAULT_STATUS_INTERVAL = 20;
async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, cache: options.cache || "no-store", headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  let data = null; try { data = await response.json(); } catch { data = null; }
  if (!response.ok || data?.success === false) throw new Error(data?.message || `${response.status} ${response.statusText}`);
  return data;
}
const nameOf = (d) => String(d?.name || d?.["Device Name"] || d?.deviceName || d?.id || "");
const isFins = (d) => ["fins udp", "fins tcp", "fins/udp", "fins/tcp"].includes(String(d?.protocol || d?.Protocol || d?.["Communication Protocol"] || "").trim().toLowerCase().replace(/[-_]/g, " "));
const keyOf = (d, address, id) => `${nameOf(d)}:fins:${String(address ?? "")}:${id ?? ""}`;

// FINS (Omron) — FINS/UDP and FINS/TCP share one backend (/api/fins/*).
// `address` is an Omron address such as "D100", "CIO10.03" or "W5"; alternatively pass a
// plain number with `addressType` (DM / CIO / WR / HR / AR / EM).
export function useFINS({ devices = [], enabled = true, statusInterval = DEFAULT_STATUS_INTERVAL } = {}) {
  const [values, setValues] = useState({});
  const [connectionStatus, setConnectionStatus] = useState({});
  const [errors, setErrors] = useState({});
  const [deviceStatus, setDeviceStatus] = useState({});
  const bindingsRef = useRef(new Map()); const mountedRef = useRef(false); const busyRef = useRef(false);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const registerBinding = useCallback(({ widgetId, device, address, addressType, bit, dataType, count = 1 } = {}) => {
    if (widgetId == null || !device) return;
    const target = String(address ?? "").trim();
    bindingsRef.current.set(String(widgetId), { widgetId: String(widgetId), device, address: target, addressType, bit, dataType, count, key: keyOf(device, target, widgetId) });
  }, []);
  const unregisterBinding = useCallback((id) => bindingsRef.current.delete(String(id)), []);
  const clearBindings = useCallback(() => bindingsRef.current.clear(), []);
  const connectDevice = useCallback((d) => fetchJson(`${API}/api/fins/connect`, { method: "POST", body: JSON.stringify({ device_name: nameOf(d) }) }), []);
  const disconnectDevice = useCallback((d) => fetchJson(`${API}/api/fins/disconnect`, { method: "POST", body: JSON.stringify({ device_name: nameOf(d) }) }), []);
  const getTCPDevices = useCallback(() => fetchJson(`${API}/api/fins/devices`), []);
  const getTCPStatus = useCallback(() => fetchJson(`${API}/api/fins/status`), []);

  const readFINS = useCallback(async ({ device, address, addressType, bit, dataType, count = 1, wordOrder } = {}) => {
    const data = await fetchJson(`${API}/api/fins/read`, { method: "POST", body: JSON.stringify({ device_name: nameOf(device), address: String(address ?? "").trim(), address_type: addressType || undefined, bit: bit ?? undefined, data_type: dataType || undefined, count: Number(count) || 1, word_order: wordOrder || undefined }) });
    return data?.value ?? data?.values;
  }, []);

  // Batch read: one HTTP round-trip per FINS device and one React snapshot per polling cycle.
  // The backend keeps per-item results/errors so one bad address does not block the others.
  const readFINSBatch = useCallback(async (device, bindings = []) => {
    const requests = bindings.map((b) => ({
      id: String(b.widgetId),
      address: String(b.address ?? "").trim(),
      address_type: b.addressType || undefined,
      bit: b.bit ?? undefined,
      data_type: b.dataType || undefined,
      count: Number(b.count) || 1,
      word_order: b.wordOrder || undefined,
    }));
    const data = await fetchJson(`${API}/api/fins/read-batch`, {
      method: "POST",
      body: JSON.stringify({ device_name: nameOf(device), requests }),
    });
    return Array.isArray(data?.results) ? data.results : [];
  }, []);
  const writeFINS = useCallback(({ device, address, addressType, bit, value, dataType, wordOrder } = {}) => fetchJson(`${API}/api/fins/write`, { method: "POST", body: JSON.stringify({ device_name: nameOf(device), address: String(address ?? "").trim(), address_type: addressType || undefined, bit: bit ?? undefined, value, data_type: dataType || undefined, word_order: wordOrder || undefined }) }), []);

  const refreshConnectionStatus = useCallback(async () => {
    if (!enabled || busyRef.current) return;
    busyRef.current = true;
    try {
      const data = await getTCPStatus(); const next = {};
      (devices || []).filter(isFins).forEach((d) => { next[nameOf(d)] = data?.[nameOf(d)]?.connected === true; });
      if (mountedRef.current) setDeviceStatus(next);
      const cs = {}; const es = {};
      bindingsRef.current.forEach((b) => { const ok = next[nameOf(b.device)] === true; cs[b.key] = ok; if (!ok) es[b.key] = data?.[nameOf(b.device)]?.error || "FINS disconnected."; });
      if (mountedRef.current) { setConnectionStatus(cs); setErrors(es); }
    } catch (error) {
      const next = {}; (devices || []).filter(isFins).forEach((d) => { next[nameOf(d)] = false; });
      if (mountedRef.current) { setDeviceStatus(next); setConnectionStatus(Object.fromEntries([...bindingsRef.current.values()].map((b) => [b.key, false]))); setErrors(Object.fromEntries([...bindingsRef.current.values()].map((b) => [b.key, error?.message || "FINS status error."]))); }
    } finally { busyRef.current = false; }
  }, [enabled, devices, getTCPStatus]);

  useEffect(() => { if (!enabled || Number(statusInterval) <= 0) return undefined; refreshConnectionStatus(); const t = setInterval(refreshConnectionStatus, Math.max(100, Number(statusInterval) || DEFAULT_STATUS_INTERVAL)); return () => clearInterval(t); }, [enabled, statusInterval, refreshConnectionStatus]);

  const poll = useCallback(async () => {
    if (!enabled || busyRef.current) return;
    busyRef.current = true;
    try {
      const bindings = Array.from(bindingsRef.current.values());
      const groups = new Map();
      for (const b of bindings) {
        const deviceName = nameOf(b.device);
        if (!deviceName) continue;
        if (!groups.has(deviceName)) groups.set(deviceName, { device: b.device, bindings: [] });
        groups.get(deviceName).bindings.push(b);
      }

      const nextValues = {};
      const nextConnection = {};
      const nextErrors = {};

      await Promise.all(Array.from(groups.values()).map(async ({ device, bindings: groupBindings }) => {
        let results = [];
        try {
          results = await readFINSBatch(device, groupBindings);
        } catch (e) {
          const message = e?.message || "FINS communication error.";
          for (const b of groupBindings) {
            nextConnection[b.key] = false;
            nextErrors[b.key] = message;
          }
          return;
        }

        const byId = new Map(results.map((item) => [String(item.id), item]));
        for (const b of groupBindings) {
          const item = byId.get(String(b.widgetId));
          if (!item || item.success === false) {
            nextConnection[b.key] = false;
            nextErrors[b.key] = item?.message || "FINS read failed.";
            continue;
          }
          const value = item.value ?? item.values;
          nextValues[b.key] = value;
          nextValues[b.widgetId] = value;
          nextConnection[b.key] = true;
        }
      }));

      if (!mountedRef.current) return;
      // ONE React state commit for the complete FINS polling snapshot.
      setValues((prev) => {
        let changed = false;
        const merged = { ...prev };
        for (const [key, value] of Object.entries(nextValues)) {
          if (!Object.is(merged[key], value)) { merged[key] = value; changed = true; }
        }
        return changed ? merged : prev;
      });
      setConnectionStatus((prev) => {
        let changed = false;
        const merged = { ...prev };
        for (const [key, value] of Object.entries(nextConnection)) {
          if (!Object.is(merged[key], value)) { merged[key] = value; changed = true; }
        }
        return changed ? merged : prev;
      });
      setErrors((prev) => {
        let changed = false;
        const merged = { ...prev };
        for (const [key, value] of Object.entries(nextErrors)) {
          if (merged[key] !== value) { merged[key] = value; changed = true; }
        }
        for (const key of Object.keys(nextValues)) {
          if (key in merged) { delete merged[key]; changed = true; }
        }
        return changed ? merged : prev;
      });
    } finally {
      busyRef.current = false;
    }
  }, [enabled, readFINSBatch]);

  const getValue = useCallback(({ device, address, widgetId } = {}) => { const b = widgetId != null ? bindingsRef.current.get(String(widgetId)) : null; return values[b?.key || keyOf(device, address, widgetId)]; }, [values]);
  const getConnectionStatus = useCallback(({ device, address, widgetId } = {}) => { const b = widgetId != null ? bindingsRef.current.get(String(widgetId)) : null; const name = nameOf(b?.device || device); return connectionStatus[b?.key || keyOf(device, address, widgetId)] === true || (widgetId == null && deviceStatus[name] === true); }, [connectionStatus, deviceStatus]);
  const getError = useCallback(({ device, address, widgetId } = {}) => { const b = widgetId != null ? bindingsRef.current.get(String(widgetId)) : null; return errors[b?.key || keyOf(device, address, widgetId)] || null; }, [errors]);

  return { values, tcpValues: values, connectionStatus, errors, deviceStatus, devices: (devices || []).filter(isFins), registerBinding, unregisterBinding, clearBindings, readFINS, readFINSBatch, readPLC: readFINS, writeFINS, writePLC: writeFINS, connectDevice, disconnectDevice, getTCPDevices, getTCPStatus, getValue, getConnectionStatus, getError, refreshConnectionStatus, poll };
}
export default useFINS;
