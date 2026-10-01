import { useCallback, useEffect, useRef, useState } from "react";
import { API } from "../service/api";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, cache: options.cache || "no-store", headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  let data = null; try { data = await response.json(); } catch { data = null; }
  if (!response.ok || data?.success === false) throw new Error(data?.message || `${response.status} ${response.statusText}`);
  return data;
}
const nameOf = (d) => String(d?.name || d?.["Device Name"] || d?.deviceName || d?.id || "");
const keyOf = (d, addressType, address, id) => `${nameOf(d)}:rtu:${String(addressType ?? "")}:${String(address ?? "")}:${id ?? ""}`;

// Modbus RTU (RS485) — /api/rtu/*. Same shape as useFINS / useTCPEthernet so usePlcRuntime
// can treat every protocol the same way.
export function useModbusRTU({ devices = [], enabled = true } = {}) {
  const [values, setValues] = useState({});
  const [connectionStatus, setConnectionStatus] = useState({});
  const [errors, setErrors] = useState({});
  const [deviceStatus, setDeviceStatus] = useState({});
  const bindingsRef = useRef(new Map()); const mountedRef = useRef(false);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const registerBinding = useCallback(({ widgetId, device, address, addressType } = {}) => {
    if (widgetId == null || !device) return;
    bindingsRef.current.set(String(widgetId), { widgetId: String(widgetId), device, address: String(address ?? "").trim(), addressType, key: keyOf(device, addressType, address, widgetId) });
  }, []);
  const unregisterBinding = useCallback((id) => bindingsRef.current.delete(String(id)), []);
  const clearBindings = useCallback(() => bindingsRef.current.clear(), []);
  const getTCPDevices = useCallback(() => fetchJson(`${API}/api/rtu/devices`), []);
  const getTCPStatus = useCallback(() => fetchJson(`${API}/api/rtu/status`), []);

  const readRTU = useCallback(async ({ device, addressType, address, count = 1 } = {}) => {
    const data = await fetchJson(`${API}/api/rtu/read`, { method: "POST", body: JSON.stringify({ device_name: nameOf(device), address_type: addressType, address: Number(address), count: Number(count) || 1 }) });
    return data?.value ?? data?.values;
  }, []);
  const writeRTU = useCallback(({ device, addressType, address, value } = {}) => fetchJson(`${API}/api/rtu/write`, { method: "POST", body: JSON.stringify({ device_name: nameOf(device), address_type: addressType, address: Number(address), value }) }), []);

  const poll = useCallback(async () => {
    if (!enabled) return;
    const status = {};
    for (const b of bindingsRef.current.values()) {
      try {
        const value = await readRTU(b);
        if (!mountedRef.current) return;
        status[nameOf(b.device)] = true;
        setValues((p) => (Object.is(p[b.widgetId], value) && Object.is(p[b.key], value) ? p : { ...p, [b.key]: value, [b.widgetId]: value }));
        setConnectionStatus((p) => (p[b.key] === true ? p : { ...p, [b.key]: true }));
        setErrors((p) => { if (!(b.key in p)) return p; const n = { ...p }; delete n[b.key]; return n; });
      } catch (e) {
        if (!mountedRef.current) return;
        status[nameOf(b.device)] = false;
        setConnectionStatus((p) => ({ ...p, [b.key]: false }));
        setErrors((p) => ({ ...p, [b.key]: e?.message || "Modbus RTU communication error." }));
      }
    }
    if (mountedRef.current && Object.keys(status).length) setDeviceStatus((p) => ({ ...p, ...status }));
  }, [enabled, readRTU]);

  const getValue = useCallback(({ device, addressType, address, widgetId } = {}) => { const b = widgetId != null ? bindingsRef.current.get(String(widgetId)) : null; return values[b?.key || keyOf(device, addressType, address, widgetId)]; }, [values]);

  return { values, tcpValues: values, connectionStatus, errors, deviceStatus, devices, registerBinding, unregisterBinding, clearBindings, readRTU, writeRTU, getTCPDevices, getTCPStatus, getValue, poll };
}
export default useModbusRTU;
