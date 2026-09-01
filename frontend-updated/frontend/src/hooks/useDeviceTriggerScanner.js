// src/hooks/useDeviceTriggerScanner.js
//
// Polls the backend's Modbus "Device Trigger" event queue (see
// backend/logic_builder/device_poller.py) and dispatches the same "cp-scan"
// CustomEvent as useRS232Scanner.js — DynamicCPPage.jsx's handleScan doesn't
// know or care whether a trigger came from a barcode scanner or a PLC register.
import { useEffect, useRef } from "react";
import { API } from "../service/api";

export function useDeviceTriggerScanner(cpNumber, active = true) {
  const intervalRef = useRef(null);
  const isProcessing = useRef(false);

  useEffect(() => {
    if (!active || !cpNumber) return;

    const poll = async () => {
      if (isProcessing.current) return;
      isProcessing.current = true;

      try {
        const res = await fetch(`${API}/api/device-trigger/latest`);
        if (!res.ok) {
          isProcessing.current = false;
          return;
        }
        const data = await res.json();

        for (const [deviceKey, value] of Object.entries(data)) {
          if (!value) continue;

          await fetch(`${API}/api/device-trigger/pop`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device: deviceKey }),
          }).catch(() => {});

          window.dispatchEvent(
            new CustomEvent("cp-scan", {
              detail: {
                cpNumber: String(cpNumber),
                source: deviceKey,
                value: String(value),
              },
            })
          );

          console.log(`[DeviceTrigger] Dispatched cp-scan for ${deviceKey} → ${value}`);
        }
      } catch (err) {
        console.error("[DeviceTrigger] Poll error:", err);
      } finally {
        isProcessing.current = false;
      }
    };

    intervalRef.current = setInterval(poll, 50);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [cpNumber, active]);
}
