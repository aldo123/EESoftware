// src/hooks/usePlcRuntime.js
//
// One PLC runtime for the Dynamic CP page that speaks every address-based protocol:
//   Modbus TCP   -> useTCPPLC        (unchanged, still the fast path)
//   Modbus RTU   -> useModbusRTU
//   Omron FINS   -> useFINS          (FINS/UDP and FINS/TCP)
//   EtherNet/IP  -> useTCPEthernet
//
// It exposes the same surface DynamicCPPage already used from useTCPPLC
// (values / connectionStatus / errors / registerBinding / clearBindings / writeValue /
// getValue), and routes each binding or write to the right protocol hook by looking at the
// bound device. A widget therefore only needs { device, addressType, address[, dataType] };
// it never has to know which protocol it is talking to.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTCPPLC } from "./useTCPPLC";
import { useFINS } from "./useFINS";
import { useTCPEthernet } from "./useTCPEthernet";
import { useModbusRTU } from "./useModbusRTU";
import { devicesOfProtocol, protocolOf, useCommDevices } from "../lib/comm";

const SLOW_POLL_INTERVAL = 2; // ms between sweeps for FINS / RTU / EtherNet/IP bindings

const OWNER = {
  modbus_tcp: "modbus",
  modbus_rtu: "rtu",
  fins: "fins",
  ethernet_ip: "enip",
};

export function usePlcRuntime({ devices = [], enabled = true, pollInterval = 20 } = {}) {
  const commDevices = useCommDevices(3000);

  const modbus = useTCPPLC({ devices, enabled, pollInterval });
  const fins = useFINS({ devices: devicesOfProtocol(commDevices, "fins"), enabled, statusInterval: 0 });
  const enip = useTCPEthernet({ devices: devicesOfProtocol(commDevices, "ethernet_ip"), enabled, statusInterval: 0 });
  const rtu = useModbusRTU({ devices: devicesOfProtocol(commDevices, "modbus_rtu"), enabled });

  const runtimes = { modbus, fins, enip, rtu };
  const ownerOfWidget = useRef(new Map()); // widgetId -> runtime key

  const ownerFor = (device) => OWNER[protocolOf(device)] || "modbus";

  // ── bindings ───────────────────────────────────────────────
  const registerBinding = useCallback((binding) => {
    const owner = ownerFor(binding?.device);
    ownerOfWidget.current.set(String(binding?.widgetId), owner);

    if (owner === "fins") {
      return fins.registerBinding({ ...binding, dataType: binding.dataType || undefined });
    }
    if (owner === "enip") {
      return enip.registerBinding({ ...binding, tag: binding.address, dataType: binding.dataType || undefined });
    }
    if (owner === "rtu") {
      return rtu.registerBinding(binding);
    }
    return modbus.registerBinding(binding);
  }, [modbus.registerBinding, fins.registerBinding, enip.registerBinding, rtu.registerBinding]);

  const unregisterBinding = useCallback((widgetId) => {
    ownerOfWidget.current.delete(String(widgetId));
    modbus.unregisterBinding?.(widgetId);
    fins.unregisterBinding(widgetId);
    enip.unregisterBinding(widgetId);
    rtu.unregisterBinding(widgetId);
  }, [modbus.unregisterBinding, fins.unregisterBinding, enip.unregisterBinding, rtu.unregisterBinding]);

  const clearBindings = useCallback(() => {
    ownerOfWidget.current.clear();
    modbus.clearBindings();
    fins.clearBindings();
    enip.clearBindings();
    rtu.clearBindings();
  }, [modbus.clearBindings, fins.clearBindings, enip.clearBindings, rtu.clearBindings]);

  // ── slow-protocol polling (Modbus TCP keeps its own 20 ms loop) ──
  const busyRef = useRef(false);
  const pollRef = useRef({});
  pollRef.current = { fins: fins.poll, enip: enip.poll, rtu: rtu.poll };

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        await Promise.allSettled([pollRef.current.fins(), pollRef.current.enip(), pollRef.current.rtu()]);
      } finally {
        busyRef.current = false;
      }
    }, SLOW_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [enabled]);

  // ── writes ─────────────────────────────────────────────────
  const writeValue = useCallback(async (args) => {
    const owner = ownerFor(args?.device);

    if (owner === "fins") {
      return fins.writeFINS({
        device: args.device, address: args.address, addressType: args.addressType,
        value: args.value, dataType: args.dataType || undefined,
      });
    }
    if (owner === "enip") {
      return enip.writeEtherNetIP({
        device: args.device, tag: args.address, value: args.value, dataType: args.dataType || undefined,
      });
    }
    if (owner === "rtu") {
      return rtu.writeRTU({
        device: args.device, addressType: args.addressType, address: args.address, value: args.value,
      });
    }
    return modbus.writeValue(args);
  }, [modbus.writeValue, fins.writeFINS, enip.writeEtherNetIP, rtu.writeRTU]);

  const getValue = useCallback((args = {}) => {
    const owner = args.widgetId != null
      ? ownerOfWidget.current.get(String(args.widgetId)) || ownerFor(args.device)
      : ownerFor(args.device);
    const runtime = runtimes[owner] || modbus;
    return runtime.getValue(args);
  }, [modbus.getValue, fins.getValue, enip.getValue, rtu.getValue]);

  // ── merged state ───────────────────────────────────────────
  const values = useMemo(
    () => ({ ...modbus.values, ...rtu.values, ...fins.values, ...enip.values }),
    [modbus.values, rtu.values, fins.values, enip.values]
  );
  const connectionStatus = useMemo(
    () => ({ ...modbus.connectionStatus, ...rtu.connectionStatus, ...fins.connectionStatus, ...enip.connectionStatus }),
    [modbus.connectionStatus, rtu.connectionStatus, fins.connectionStatus, enip.connectionStatus]
  );
  const errors = useMemo(
    () => ({ ...modbus.errors, ...rtu.errors, ...fins.errors, ...enip.errors }),
    [modbus.errors, rtu.errors, fins.errors, enip.errors]
  );
  const deviceStatus = useMemo(
    () => ({ ...modbus.deviceStatus, ...rtu.deviceStatus, ...fins.deviceStatus, ...enip.deviceStatus }),
    [modbus.deviceStatus, rtu.deviceStatus, fins.deviceStatus, enip.deviceStatus]
  );

  return {
    values,
    tcpValues: values,
    connectionStatus,
    errors,
    deviceStatus,
    devices: modbus.devices,
    commDevices,
    registerBinding,
    unregisterBinding,
    clearBindings,
    writeValue,
    writePLC: writeValue,
    getValue,
    getTCPDevices: modbus.getTCPDevices,
    getTCPStatus: modbus.getTCPStatus,
  };
}

export default usePlcRuntime;
