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
const isUDP = (d) => {
  const type = String(d?.type || d?.Type || d?.transport || d?.Transport || "").trim().toLowerCase();
  const protocol = String(
    d?.protocol ||
    d?.Protocol ||
    d?.protocol_label ||
    d?.["Protocol Label"] ||
    d?.["Communication Protocol"] ||
    d?.Mode ||
    ""
  ).trim().toLowerCase().replace(/[-_]/g, " ");
  return type === "udp" ||
    type === "udp/ip" ||
    protocol === "udp" ||
    protocol === "udp ip" ||
    protocol === "udp serial" ||
    protocol === "serial over udp" ||
    protocol === "serial udp";
};
const keyOf = (d, a, id) => `${nameOf(d)}:udp_serial:${String(a ?? "")}:${id ?? ""}`;

export function useUDP({ devices = [], enabled = true, statusInterval = DEFAULT_STATUS_INTERVAL } = {}) {
  const [values, setValues] = useState({}); const [connectionStatus, setConnectionStatus] = useState({}); const [errors, setErrors] = useState({}); const [deviceStatus, setDeviceStatus] = useState({});
  const bindingsRef = useRef(new Map()); const busyRef = useRef(false); const mountedRef = useRef(false);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const registerBinding = useCallback(({ widgetId, device, address, requestText, requestHex, responseMode, encoding, responseTimeout } = {}) => { if (widgetId == null || !device) return; const target = String(address ?? ""); bindingsRef.current.set(String(widgetId), { widgetId: String(widgetId), device, address: target, requestText, requestHex, responseMode, encoding, responseTimeout, key: keyOf(device, target, widgetId) }); }, []);
  const unregisterBinding = useCallback((id) => bindingsRef.current.delete(String(id)), []); const clearBindings = useCallback(() => bindingsRef.current.clear(), []);
  const connectDevice = useCallback((d) => fetchJson(`${API}/api/udp/connect`, { method: "POST", body: JSON.stringify({ device_name: nameOf(d) }) }), []);
  const disconnectDevice = useCallback((d) => fetchJson(`${API}/api/udp/disconnect`, { method: "POST", body: JSON.stringify({ device_name: nameOf(d) }) }), []);
  const getTCPDevices = useCallback(() => fetchJson(`${API}/api/udp/devices`), []); const getTCPStatus = useCallback(() => fetchJson(`${API}/api/udp/status`), []);
  const requestUDP = useCallback(async ({ device, requestText = "", requestHex = "", responseMode = "text", encoding = "ascii", responseTimeout } = {}) => { const d = await fetchJson(`${API}/api/udp/request`, { method: "POST", body: JSON.stringify({ device_name: nameOf(device), request_text: requestText, request_hex: requestHex, response_mode: responseMode, encoding, response_timeout: responseTimeout }) }); return d?.response ?? d?.value; }, []);
  const receiveUDP = useCallback(({ device, responseMode = "text", encoding = "ascii", responseTimeout } = {}) => fetchJson(`${API}/api/udp/receive`, { method: "POST", body: JSON.stringify({ device_name: nameOf(device), response_mode: responseMode, encoding, response_timeout: responseTimeout }) }), []);
  const writeUDP = useCallback(({ device, dataText = "", dataHex = "", waitResponse = false, responseMode = "text", encoding = "ascii", responseTimeout } = {}) => fetchJson(`${API}/api/udp/send`, { method: "POST", body: JSON.stringify({ device_name: nameOf(device), data_text: dataText, data_hex: dataHex, wait_response: waitResponse, response_mode: responseMode, encoding, response_timeout: responseTimeout }) }), []);

  const refreshConnectionStatus = useCallback(async () => {
    if (!enabled || busyRef.current) return; busyRef.current = true;
    try {
      const data = await getTCPStatus(); const next = {};
      (devices || []).filter(isUDP).forEach((d) => { next[nameOf(d)] = data?.[nameOf(d)]?.connected === true; });
      // UDP is connectionless: this status reports the local UDP socket/bind state.
      if (mountedRef.current) setDeviceStatus(next);
      const cs = {}; const es = {};
      bindingsRef.current.forEach((b) => { const ok = next[nameOf(b.device)] === true; cs[b.key] = ok; if (!ok) es[b.key] = "UDP local socket is disconnected."; });
      if (mountedRef.current) { setConnectionStatus(cs); setErrors(es); }
    } catch (error) {
      const next = {}; (devices || []).filter(isUDP).forEach((d) => { next[nameOf(d)] = false; });
      if (mountedRef.current) { setDeviceStatus(next); setConnectionStatus(Object.fromEntries([...bindingsRef.current.values()].map((b) => [b.key, false]))); setErrors(Object.fromEntries([...bindingsRef.current.values()].map((b) => [b.key, error?.message || "UDP status error."]))); }
    } finally { busyRef.current = false; }
  }, [enabled, devices, getTCPStatus]);

  useEffect(() => { if (!enabled || Number(statusInterval) <= 0) return undefined; refreshConnectionStatus(); const t = setInterval(refreshConnectionStatus, Math.max(100, Number(statusInterval) || DEFAULT_STATUS_INTERVAL)); return () => clearInterval(t); }, [enabled, statusInterval, refreshConnectionStatus]);

  const poll = useCallback(async () => {
    if (!enabled) return;
    for (const b of bindingsRef.current.values()) {
      try { const value = await requestUDP(b); if (!mountedRef.current) return; setValues((p) => ({ ...p, [b.key]: value, [b.widgetId]: value })); setConnectionStatus((p) => ({ ...p, [b.key]: true })); setErrors((p) => { const n = { ...p }; delete n[b.key]; return n; }); }
      catch (e) { if (!mountedRef.current) return; setConnectionStatus((p) => ({ ...p, [b.key]: false })); setErrors((p) => ({ ...p, [b.key]: e?.message || "UDP communication error." })); }
    }
  }, [enabled, requestUDP]);

  const getValue = useCallback(({ device, address, widgetId } = {}) => { const b = widgetId != null ? bindingsRef.current.get(String(widgetId)) : null; return values[b?.key || keyOf(device, address, widgetId)]; }, [values]);
  const getConnectionStatus = useCallback(({ device, address, widgetId } = {}) => { const b = widgetId != null ? bindingsRef.current.get(String(widgetId)) : null; const name = nameOf(b?.device || device); return connectionStatus[b?.key || keyOf(device, address, widgetId)] === true || (widgetId == null && deviceStatus[name] === true); }, [connectionStatus, deviceStatus]);
  const getError = useCallback(({ device, address, widgetId } = {}) => { const b = widgetId != null ? bindingsRef.current.get(String(widgetId)) : null; return errors[b?.key || keyOf(device, address, widgetId)] || null; }, [errors]);

  return { values, tcpValues: values, connectionStatus, errors, deviceStatus, devices: (devices || []).filter(isUDP), registerBinding, unregisterBinding, clearBindings, requestUDP, receiveUDP, writeUDP, readPLC: requestUDP, writePLC: writeUDP, connectDevice, disconnectDevice, getTCPDevices, getTCPStatus, getValue, getConnectionStatus, getError, refreshConnectionStatus, poll };
}
export default useUDP;
