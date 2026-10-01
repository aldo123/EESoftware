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

          // Keep the backend event outstanding until the runtime logic has
          // completely finished. This prevents Level mode (1 -> 1) from
          // generating another event while the previous /api/logic-run is
          // still being processed.
          let acknowledged = false;
          let acknowledge;

          const acknowledgedPromise = new Promise((resolve) => {
            acknowledge = () => {
              if (acknowledged) return;
              acknowledged = true;
              resolve();
            };
          });

          window.dispatchEvent(
            new CustomEvent("cp-scan", {
              detail: {
                cpNumber: String(cpNumber),
                source: deviceKey,
                value: String(value),
                kind: "device-trigger",
                acknowledge,
              },
            })
          );

          console.log(
            `[DeviceTrigger] Dispatched cp-scan for ${deviceKey} → ${value}; waiting for logic ACK`
          );

          // Fail-safe so a destroyed/unmounted runtime cannot block the
          // scanner forever.
          await Promise.race([
            acknowledgedPromise,
            new Promise((resolve) => setTimeout(resolve, 15000)),
          ]);

          if (!acknowledged) {
            console.warn(
              `[DeviceTrigger] Logic ACK timeout for ${deviceKey}; releasing event`
            );
          }

          // POP only after the logic flow has completed (or the fail-safe
          // timeout). While this item remains in the backend buffer, the
          // Level poller cannot create another outstanding event.
          await fetch(`${API}/api/device-trigger/pop`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device: deviceKey }),
          }).catch((err) => {
            console.warn(
              `[DeviceTrigger] Failed to pop ${deviceKey}:`,
              err
            );
          });
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
