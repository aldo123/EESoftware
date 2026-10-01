// src/lib/comm.js
//
// One place that knows every PLC-style communication protocol the app can bind a
// widget / Logic Builder node to, what a "device" of each protocol looks like, and
// which address fields each protocol needs.
//
//   modbus_tcp   Address Type (Coil / Discrete Input / Holding / Input) + Address
//   modbus_rtu   same as Modbus TCP, over RS485
//   fins         Omron FINS (UDP + TCP):  Memory Area (DM/CIO/WR/HR/AR/EM) + Address (100 / 10.03) + Data Type
//   ethernet_ip  Tag name + Data Type
//
// Text/stream protocols (RS232, Raw TCP, Serial-over-UDP) are not address based, so they
// are intentionally not part of this catalogue.

import { useEffect, useState } from "react";
import { API } from "../service/api";

// ── Catalogue ────────────────────────────────────────────────

export const PLC_PROTOCOLS = [
  { id: "modbus_tcp", label: "Modbus TCP" },
  { id: "modbus_rtu", label: "Modbus RTU (RS485)" },
  { id: "fins", label: "Omron FINS (UDP/TCP)" },
  { id: "ethernet_ip", label: "EtherNet/IP (CIP)" },
];

export const MODBUS_ADDRESS_TYPES = [
  { value: "coil", label: "Coil" },
  { value: "discrete_input", label: "Discrete Input" },
  { value: "holding_register", label: "Holding Register" },
  { value: "input_register", label: "Input Register" },
];

export const FINS_AREAS = [
  { value: "CIO", label: "CIO" },
  { value: "DM", label: "DM (D)" },
  { value: "WR", label: "WR (W)" },
  { value: "HR", label: "HR (H)" },
  { value: "AR", label: "AR (A)" },
  { value: "EM", label: "EM (E)" },
];

export const FINS_DATA_TYPES = [
  { value: "", label: "Auto (bit = BOOL, else WORD)" },
  { value: "BOOL", label: "BOOL (bit, e.g. 10.03)" },
  { value: "WORD", label: "WORD (UINT16)" },
  { value: "INT", label: "INT (INT16)" },
  { value: "DWORD", label: "DWORD (UINT32)" },
  { value: "DINT", label: "DINT (INT32)" },
  { value: "REAL", label: "REAL (FLOAT32)" },
];

export const ENIP_DATA_TYPES = [
  { value: "", label: "Auto (read type from PLC)" },
  { value: "BOOL", label: "BOOL" },
  { value: "SINT", label: "SINT" },
  { value: "INT", label: "INT" },
  { value: "DINT", label: "DINT" },
  { value: "UINT", label: "UINT" },
  { value: "UDINT", label: "UDINT" },
  { value: "REAL", label: "REAL" },
];

// Stored in a widget's `addressType` when the protocol has no address types, so existing
// "is there a binding?" checks (which require a non-empty addressType) keep working.
export const TAG_ADDRESS_TYPE = "tag";

const FINS_AREA_VALUES = new Set(FINS_AREAS.map((a) => a.value));

// ── Protocol detection ───────────────────────────────────────

const squash = (value) => String(value ?? "").trim().toLowerCase().replace(/[\s/_-]+/g, " ");

/**
 * Which PLC protocol a device row belongs to.
 * Understands the shapes returned by /api/tcp|rtu|fins|tcp-ethernet/devices and the
 * Communication Devices rows from setting.json / MainPage.
 * Returns "modbus_tcp" | "modbus_rtu" | "fins" | "ethernet_ip" | "raw_tcp" | "udp_serial" | "rs232" | "other".
 */
export function protocolOf(device) {
  if (!device) return "other";
  if (device.protocolId) return device.protocolId;

  const protocol = squash(device.protocol ?? device.Protocol ?? device["Communication Protocol"] ?? device.Mode);
  const type = squash(device.type ?? device.Type);

  if (protocol.includes("fins") || type.includes("fins")) return "fins";
  if (["ethernet ip", "ethernetip", "enip", "cip"].includes(protocol)) return "ethernet_ip";
  if (protocol === "modbus rtu" || type === "modbus rtu") return "modbus_rtu";
  if (["raw tcp", "raw tcp ip", "raw", "tcp socket"].includes(protocol)) return "raw_tcp";
  if (protocol === "udp" || protocol === "udp serial" || protocol === "serial over udp" || type === "udp") return "udp_serial";
  if (type === "com" || protocol === "rs232") return "rs232";
  if (["modbus tcp", "modbus", "tcp modbus", "tcp", "tcp ip", ""].includes(protocol) || type === "tcp") return "modbus_tcp";
  return "other";
}

export const isPlcProtocol = (id) => PLC_PROTOCOLS.some((p) => p.id === id);

export const protocolLabel = (id) => PLC_PROTOCOLS.find((p) => p.id === id)?.label || String(id || "");

/** Protocol-specific kind of address a protocol uses: "modbus" | "fins" | "tag". */
export function addressKind(protocol) {
  if (protocol === "fins") return "fins";
  if (protocol === "ethernet_ip") return "tag";
  return "modbus";
}

/**
 * Address Type options for a protocol.
 * `allowedModbusTypes` (optional) narrows the Modbus list for widgets that cannot use all of
 * them (e.g. a Button only writes Coil / Holding Register). FINS areas are all read+write.
 */
export function addressTypeOptions(protocol, allowedModbusTypes) {
  const kind = addressKind(protocol);
  if (kind === "fins") return FINS_AREAS;
  if (kind === "tag") return [{ value: TAG_ADDRESS_TYPE, label: "Tag" }];
  if (!Array.isArray(allowedModbusTypes) || allowedModbusTypes.length === 0) return MODBUS_ADDRESS_TYPES;
  const allowed = new Set(allowedModbusTypes.map((t) => (typeof t === "string" ? t : t?.value)));
  return MODBUS_ADDRESS_TYPES.filter((t) => allowed.has(t.value));
}

export function defaultAddressType(protocol, allowedModbusTypes) {
  const options = addressTypeOptions(protocol, allowedModbusTypes);
  if (addressKind(protocol) === "fins") return "CIO";
  return options[0]?.value || "";
}

export function addressPlaceholder(protocol) {
  const kind = addressKind(protocol);
  if (kind === "fins") return "100  or  10.03 (bit)";
  if (kind === "tag") return "Program:Main.Motor1";
  return "0";
}

export function dataTypeOptions(protocol) {
  const kind = addressKind(protocol);
  if (kind === "fins") return FINS_DATA_TYPES;
  if (kind === "tag") return ENIP_DATA_TYPES;
  return null; // Modbus has no per-binding data type
}

/**
 * Is `addressType` meaningful for `protocol`?  Used to decide whether a saved widget needs its
 * addressType reset when the protocol changes.
 */
export function isAddressTypeValidFor(protocol, addressType, allowedModbusTypes) {
  const kind = addressKind(protocol);
  const value = String(addressType ?? "");
  if (kind === "fins") return FINS_AREA_VALUES.has(value.toUpperCase());
  if (kind === "tag") return value === TAG_ADDRESS_TYPE;
  return addressTypeOptions(protocol, allowedModbusTypes).some((t) => t.value === value);
}

/** FINS stores the area upper-case; Modbus keeps its own lower-case ids. */
export function normalizeFinsArea(value) {
  const area = String(value ?? "").trim().toUpperCase();
  return FINS_AREA_VALUES.has(area) ? area : "";
}

// ── Device list (shared, cached) ─────────────────────────────

const DEVICE_SOURCES = [
  { endpoint: "/api/tcp/devices", protocolId: "modbus_tcp" },
  { endpoint: "/api/rtu/devices", protocolId: "modbus_rtu" },
  { endpoint: "/api/fins/devices", protocolId: "fins" },
  { endpoint: "/api/tcp-ethernet/devices", protocolId: "ethernet_ip" },
];

const CACHE_TTL_MS = 2500;
let cache = { at: 0, devices: [], promise: null };

const nameOf = (d) => String(d?.name ?? d?.["Device Name"] ?? d?.device_name ?? "").trim();

async function fetchSource({ endpoint, protocolId }) {
  const response = await fetch(`${API}${endpoint}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const rows = Array.isArray(data) ? data : Array.isArray(data?.devices) ? data.devices : [];
  return rows
    .filter(Boolean)
    .map((d) => ({ ...d, name: nameOf(d), protocolId }))
    .filter((d) => d.name);
}

/** Every PLC-style device from every protocol. One failing endpoint never hides the others. */
export function loadCommDevices({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.promise) return cache.promise;
  if (!force && cache.devices.length && now - cache.at < CACHE_TTL_MS) return Promise.resolve(cache.devices);

  const promise = Promise.allSettled(DEVICE_SOURCES.map(fetchSource)).then((results) => {
    const devices = [];
    results.forEach((result) => {
      if (result.status === "fulfilled") devices.push(...result.value);
    });
    cache = { at: Date.now(), devices, promise: null };
    return devices;
  });
  cache.promise = promise;
  promise.finally(() => {
    if (cache.promise === promise) cache.promise = null;
  });
  return promise;
}

const sameDevices = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** React hook: all PLC devices of all protocols, refreshed every `refreshMs` (0 = once). */
export function useCommDevices(refreshMs = 3000) {
  const [devices, setDevices] = useState(cache.devices);

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      loadCommDevices().then((next) => {
        if (!cancelled) setDevices((prev) => (sameDevices(prev, next) ? prev : next));
      });

    refresh();
    if (!refreshMs) return () => { cancelled = true; };
    const timer = setInterval(refresh, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshMs]);

  return devices;
}

export const devicesOfProtocol = (devices, protocol) =>
  (Array.isArray(devices) ? devices : []).filter((d) => protocolOf(d) === protocol);

export const findDevice = (devices, name) => {
  const wanted = String(name ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return (Array.isArray(devices) ? devices : []).find((d) => nameOf(d).toLowerCase() === wanted) || null;
};

// ── Direct write (outside the polling runtime) ───────────────
//
// Used by code that needs a one-off write without a registered binding, e.g. a Button's
// "Reset" targets. Routes to the right backend endpoint for the device's protocol.

const postJson = async (path, body) => {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.message || `Write failed (HTTP ${response.status})`);
  }
  return data;
};

/** The "idle / reset" value for a binding: false for bits and BOOL tags, 0 for everything else. */
export function zeroValueFor(protocol, addressType, address, dataType) {
  const kind = addressKind(protocol);
  if (kind === "fins") {
    const isBit = String(dataType || "").toUpperCase() === "BOOL" || /\.\d+$/.test(String(address ?? "").trim());
    return isBit ? false : 0;
  }
  if (kind === "tag") return String(dataType || "").toUpperCase() === "BOOL" ? false : 0;
  return String(addressType || "").toLowerCase() === "coil" ? false : 0;
}

export async function writePlcDirect({ deviceName, addressType, address, value, dataType }) {
  const device = findDevice(await loadCommDevices(), deviceName);
  if (!device) throw new Error(`Device '${deviceName}' was not found.`);
  const protocol = protocolOf(device);
  const kind = addressKind(protocol);

  if (kind === "fins") {
    return postJson("/api/fins/write", {
      device_name: device.name, address: String(address ?? "").trim(),
      address_type: addressType || undefined, value, data_type: dataType || undefined,
    });
  }
  if (kind === "tag") {
    return postJson("/api/tcp-ethernet/write", {
      device_name: device.name, tag: String(address ?? "").trim(), address: String(address ?? "").trim(),
      value, data_type: dataType || "DINT",
    });
  }
  const path = protocol === "modbus_rtu" ? "/api/rtu/write" : "/api/tcp/write";
  return postJson(path, {
    device_name: device.name, address_type: addressType, address: Number(address), value,
  });
}
