import { useCallback, useEffect, useRef, useState } from "react";
import { API } from "../service/api";

const DEFAULT_STATUS_INTERVAL = 250;
async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, cache: options.cache || "no-store", headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  let data = null; try { data = await response.json(); } catch { data = null; }
  if (!response.ok || data?.success === false) throw new Error(data?.message || `${response.status} ${response.statusText}`);
  return data;
}
const nameOf = (d) => String(d?.name || d?.["Device Name"] || d?.deviceName || d?.id || "");
const isEthernet = (d) => ["ethernet/ip", "ethernet ip", "ethernetip", "enip", "cip", "ethernet_ip"].includes(String(d?.protocol || d?.Protocol || d?.["Communication Protocol"] || "").trim().toLowerCase().replace(/[-_]/g, " "));
const keyOf = (d, address, id) => `${nameOf(d)}:ethernet_ip:${String(address ?? "")}:${id ?? ""}`;

export function useTCPEthernet({ devices = [], enabled = true, statusInterval = DEFAULT_STATUS_INTERVAL } = {}) {
  const [values, setValues] = useState({});
  const [connectionStatus, setConnectionStatus] = useState({});
  const [errors, setErrors] = useState({});
  const [deviceStatus, setDeviceStatus] = useState({});
  const bindingsRef = useRef(new Map()); const mountedRef = useRef(false); const busyRef = useRef(false);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const registerBinding = useCallback(({ widgetId, device, address, tag, dataType, count = 1, addressType } = {}) => {
    if (widgetId == null || !device) return;
    const target = String(address ?? tag ?? "").trim();
    bindingsRef.current.set(String(widgetId), { widgetId: String(widgetId), device, address: target, tag: tag || target, dataType, count, addressType, key: keyOf(device, target, widgetId) });
  }, []);
  const unregisterBinding = useCallback((id) => bindingsRef.current.delete(String(id)), []);
  const clearBindings = useCallback(() => bindingsRef.current.clear(), []);
  const connectDevice = useCallback((d) => fetchJson(`${API}/api/tcp-ethernet/connect`, { method: "POST", body: JSON.stringify({ device_name: nameOf(d) }) }), []);
  const disconnectDevice = useCallback((d) => fetchJson(`${API}/api/tcp-ethernet/disconnect`, { method: "POST", body: JSON.stringify({ device_name: nameOf(d) }) }), []);
  const getTCPDevices = useCallback(() => fetchJson(`${API}/api/tcp-ethernet/devices`), []);
  const getTCPStatus = useCallback(() => fetchJson(`${API}/api/tcp-ethernet/status`), []);

  const readEtherNetIP = useCallback(async ({ device, tag, address, dataType, cipDataType, count = 1 } = {}) => {
    const target = String(tag ?? address ?? "").trim();
    const data = await fetchJson(`${API}/api/tcp-ethernet/read`, { method: "POST", body: JSON.stringify({ device_name: nameOf(device), tag: target, address: target, data_type: dataType || cipDataType || undefined, count: Number(count) || 1 }) });
    return data?.value ?? data?.values;
  }, []);
  const writeEtherNetIP = useCallback(({ device, tag, address, value, dataType, cipDataType } = {}) => fetchJson(`${API}/api/tcp-ethernet/write`, { method: "POST", body: JSON.stringify({ device_name: nameOf(device), tag: String(tag ?? address ?? "").trim(), address: String(tag ?? address ?? "").trim(), value, data_type: dataType || cipDataType || "DINT" }) }), []);

  const refreshConnectionStatus = useCallback(async () => {
    if (!enabled || busyRef.current) return;
    busyRef.current = true;
    try {
      const data = await getTCPStatus(); const next = {};
      (devices || []).filter(isEthernet).forEach((d) => { next[nameOf(d)] = data?.[nameOf(d)]?.connected === true; });
      if (mountedRef.current) setDeviceStatus(next);
      const cs = {}; const es = {};
      bindingsRef.current.forEach((b) => { const ok = next[nameOf(b.device)] === true; cs[b.key] = ok; if (!ok) es[b.key] = data?.[nameOf(b.device)]?.error || "EtherNet/IP disconnected."; });
      if (mountedRef.current) { setConnectionStatus(cs); setErrors(es); }
    } catch (error) {
      const next = {}; (devices || []).filter(isEthernet).forEach((d) => { next[nameOf(d)] = false; });
      if (mountedRef.current) { setDeviceStatus(next); setConnectionStatus(Object.fromEntries([...bindingsRef.current.values()].map((b) => [b.key, false]))); setErrors(Object.fromEntries([...bindingsRef.current.values()].map((b) => [b.key, error?.message || "EtherNet/IP status error."]))); }
    } finally { busyRef.current = false; }
  }, [enabled, devices, getTCPStatus]);

  useEffect(() => { if (!enabled || Number(statusInterval) <= 0) return undefined; refreshConnectionStatus(); const t = setInterval(refreshConnectionStatus, Math.max(100, Number(statusInterval) || DEFAULT_STATUS_INTERVAL)); return () => clearInterval(t); }, [enabled, statusInterval, refreshConnectionStatus]);

  const poll = useCallback(async () => {
    if (!enabled) return;
    for (const b of bindingsRef.current.values()) {
      try { const value = await readEtherNetIP(b); if (!mountedRef.current) return; setValues((p) => (Object.is(p[b.widgetId], value) && Object.is(p[b.key], value) ? p : { ...p, [b.key]: value, [b.widgetId]: value })); setConnectionStatus((p) => (p[b.key] === true ? p : { ...p, [b.key]: true })); setErrors((p) => { if (!(b.key in p)) return p; const n = { ...p }; delete n[b.key]; return n; }); }
      catch (e) { if (!mountedRef.current) return; setConnectionStatus((p) => ({ ...p, [b.key]: false })); setErrors((p) => ({ ...p, [b.key]: e?.message || "EtherNet/IP communication error." })); }
    }
  }, [enabled, readEtherNetIP]);

  const getValue = useCallback(({ device, tag, address, widgetId } = {}) => { const b = widgetId != null ? bindingsRef.current.get(String(widgetId)) : null; return values[b?.key || keyOf(device, tag ?? address, widgetId)]; }, [values]);
  const getConnectionStatus = useCallback(({ device, tag, address, widgetId } = {}) => { const b = widgetId != null ? bindingsRef.current.get(String(widgetId)) : null; const name = nameOf(b?.device || device); return connectionStatus[b?.key || keyOf(device, tag ?? address, widgetId)] === true || (widgetId == null && deviceStatus[name] === true); }, [connectionStatus, deviceStatus]);
  const getError = useCallback(({ device, tag, address, widgetId } = {}) => { const b = widgetId != null ? bindingsRef.current.get(String(widgetId)) : null; return errors[b?.key || keyOf(device, tag ?? address, widgetId)] || null; }, [errors]);

  return { values, tcpValues: values, connectionStatus, errors, deviceStatus, devices: (devices || []).filter(isEthernet), registerBinding, unregisterBinding, clearBindings, readEtherNetIP, readPLC: readEtherNetIP, writeEtherNetIP, writePLC: writeEtherNetIP, connectDevice, disconnectDevice, getTCPDevices, getTCPStatus, getValue, getConnectionStatus, getError, refreshConnectionStatus, poll };
}
export default useTCPEthernet;
