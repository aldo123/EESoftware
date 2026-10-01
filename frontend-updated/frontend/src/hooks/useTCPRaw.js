import { useCallback, useEffect, useRef, useState } from "react";
import { API } from "../service/api";

const DEFAULT_STATUS_INTERVAL = 250;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: options.cache || "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok || data?.success === false) {
    throw new Error(data?.message || `${response.status} ${response.statusText}`);
  }
  return data;
}

function nameOf(device) {
  return String(device?.name || device?.["Device Name"] || device?.deviceName || device?.id || "");
}

function isRawTCP(device) {
  const p = String(device?.protocol || device?.Protocol || device?.["Communication Protocol"] || "")
    .trim().toLowerCase().replace(/[-_]/g, " ");
  return ["raw tcp", "raw tcp/ip", "tcp socket", "tcp/ip", "raw"].includes(p);
}

function keyOf(device, address, widgetId) {
  return `${nameOf(device)}:raw_tcp:${String(address ?? "")}:${widgetId ?? ""}`;
}

export function useTCPRaw({ devices = [], enabled = true, statusInterval = DEFAULT_STATUS_INTERVAL } = {}) {
  const [values, setValues] = useState({});
  const [connectionStatus, setConnectionStatus] = useState({});
  const [errors, setErrors] = useState({});
  const [deviceStatus, setDeviceStatus] = useState({});
  const bindingsRef = useRef(new Map());
  const mountedRef = useRef(false);
  const statusBusyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const registerBinding = useCallback((args = {}) => {
    if (args.widgetId == null || !args.device) return;
    bindingsRef.current.set(String(args.widgetId), {
      ...args,
      widgetId: String(args.widgetId),
      key: keyOf(args.device, args.address ?? args.requestText ?? args.requestHex, args.widgetId),
    });
  }, []);

  const unregisterBinding = useCallback((id) => bindingsRef.current.delete(String(id)), []);
  const clearBindings = useCallback(() => bindingsRef.current.clear(), []);

  const connectDevice = useCallback((device) => fetchJson(`${API}/api/tcp-raw/connect`, {
    method: "POST", body: JSON.stringify({ device_name: nameOf(device) }),
  }), []);

  const disconnectDevice = useCallback((device) => fetchJson(`${API}/api/tcp-raw/disconnect`, {
    method: "POST", body: JSON.stringify({ device_name: nameOf(device) }),
  }), []);

  const getTCPDevices = useCallback(() => fetchJson(`${API}/api/tcp-raw/devices`), []);
  const getTCPStatus = useCallback(() => fetchJson(`${API}/api/tcp-raw/status`), []);

  const readRawTCP = useCallback(async ({
    device, requestText = "", requestHex = "", delimiterHex = "",
    responseMode = "text", encoding = "utf-8", readSize = 0,
    responseTimeout, waitResponse = true,
  } = {}) => {
    const data = await fetchJson(`${API}/api/tcp-raw/request`, {
      method: "POST",
      body: JSON.stringify({
        device_name: nameOf(device), request_text: requestText, request_hex: requestHex,
        delimiter_hex: delimiterHex, response_mode: responseMode, encoding,
        read_size: readSize, response_timeout: responseTimeout, wait_response: waitResponse,
      }),
    });
    return data?.response ?? data?.value;
  }, []);

  const writeRawTCP = useCallback(({
    device, dataText = "", dataHex = "", waitResponse = false,
    responseMode = "text", encoding = "utf-8", responseTimeout,
  } = {}) => fetchJson(`${API}/api/tcp-raw/send`, {
    method: "POST",
    body: JSON.stringify({
      device_name: nameOf(device), data_text: dataText, data_hex: dataHex,
      wait_response: waitResponse, response_mode: responseMode,
      encoding, response_timeout: responseTimeout,
    }),
  }), []);

  const refreshConnectionStatus = useCallback(async () => {
    if (!enabled || statusBusyRef.current) return;
    statusBusyRef.current = true;
    try {
      const data = await getTCPStatus();
      const next = {};
      (devices || []).filter(isRawTCP).forEach((device) => {
        const name = nameOf(device);
        next[name] = data?.[name]?.connected === true;
      });
      if (mountedRef.current) setDeviceStatus(next);

      const bindingStatus = {};
      const bindingErrors = {};
      bindingsRef.current.forEach((binding) => {
        const ok = next[nameOf(binding.device)] === true;
        bindingStatus[binding.key] = ok;
        if (!ok) bindingErrors[binding.key] = data?.[nameOf(binding.device)]?.error || "Raw TCP disconnected.";
      });
      if (mountedRef.current) {
        setConnectionStatus(bindingStatus);
        setErrors(bindingErrors);
      }
    } catch (error) {
      const next = {};
      (devices || []).filter(isRawTCP).forEach((device) => { next[nameOf(device)] = false; });
      if (mountedRef.current) {
        setDeviceStatus(next);
        setConnectionStatus(Object.fromEntries([...bindingsRef.current.values()].map((b) => [b.key, false])));
        setErrors(Object.fromEntries([...bindingsRef.current.values()].map((b) => [b.key, error?.message || "Raw TCP status error."])));
      }
    } finally {
      statusBusyRef.current = false;
    }
  }, [enabled, devices, getTCPStatus]);

  useEffect(() => {
    if (!enabled || Number(statusInterval) <= 0) return undefined;
    refreshConnectionStatus();
    const timer = setInterval(refreshConnectionStatus, Math.max(100, Number(statusInterval) || DEFAULT_STATUS_INTERVAL));
    return () => clearInterval(timer);
  }, [enabled, statusInterval, refreshConnectionStatus]);

  const poll = useCallback(async () => {
    if (!enabled) return;
    for (const binding of bindingsRef.current.values()) {
      try {
        const value = await readRawTCP(binding);
        if (!mountedRef.current) return;
        setValues((prev) => ({ ...prev, [binding.key]: value, [binding.widgetId]: value }));
        setConnectionStatus((prev) => ({ ...prev, [binding.key]: true }));
        setErrors((prev) => { const next = { ...prev }; delete next[binding.key]; return next; });
      } catch (error) {
        if (!mountedRef.current) return;
        setConnectionStatus((prev) => ({ ...prev, [binding.key]: false }));
        setErrors((prev) => ({ ...prev, [binding.key]: error?.message || "Raw TCP communication error." }));
      }
    }
  }, [enabled, readRawTCP]);

  const getValue = useCallback(({ device, address, widgetId } = {}) => {
    const binding = widgetId != null ? bindingsRef.current.get(String(widgetId)) : null;
    return values[binding?.key || keyOf(device, address, widgetId)];
  }, [values]);

  const getConnectionStatus = useCallback(({ device, address, widgetId } = {}) => {
    const binding = widgetId != null ? bindingsRef.current.get(String(widgetId)) : null;
    const name = nameOf(binding?.device || device);
    const key = binding?.key || keyOf(device, address, widgetId);
    return connectionStatus[key] === true || (widgetId == null && deviceStatus[name] === true);
  }, [connectionStatus, deviceStatus]);

  const getError = useCallback(({ device, address, widgetId } = {}) => {
    const binding = widgetId != null ? bindingsRef.current.get(String(widgetId)) : null;
    return errors[binding?.key || keyOf(device, address, widgetId)] || null;
  }, [errors]);

  return {
    values, tcpValues: values, connectionStatus, errors, deviceStatus,
    devices: (devices || []).filter(isRawTCP),
    registerBinding, unregisterBinding, clearBindings,
    readRawTCP, readPLC: readRawTCP, writeRawTCP, writePLC: writeRawTCP,
    connectDevice, disconnectDevice, getTCPDevices, getTCPStatus,
    getValue, getConnectionStatus, getError, refreshConnectionStatus, poll,
  };
}

export default useTCPRaw;
