// src/hooks/useRS232Scanner.js
import { useEffect, useRef } from "react";
import { API } from "../service/api";

export function useRS232Scanner(cpNumber, active = true) {
  const intervalRef = useRef(null);
  const isProcessing = useRef(false);

  useEffect(() => {
    if (!active || !cpNumber) {
      console.log(`[RS232 Scanner] Inactive (cp=${cpNumber})`);
      return;
    }

    console.log(`[RS232 Scanner] Started polling for CP${cpNumber}`);

    const poll = async () => {
      // Jika masih ada proses sebelumnya, lewati
      if (isProcessing.current) return;
      isProcessing.current = true;

      try {
        const res = await fetch(`${API}/api/rs232/latest`);
        if (!res.ok) {
          isProcessing.current = false;
          return;
        }
        const data = await res.json();

        // Proses semua device yang ada
        for (const [deviceName, value] of Object.entries(data)) {
          if (!value) continue;

          // Pop data dari buffer
          await fetch(`${API}/api/rs232/pop`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_name: deviceName }),
          }).catch(() => {});

          // Dispatch event
          window.dispatchEvent(
            new CustomEvent("cp-scan", {
              detail: {
                cpNumber: String(cpNumber),
                source: deviceName,
                value: String(value),
              },
            })
          );

          console.log(`[RS232] Dispatched cp-scan for ${deviceName} → ${value}`);
        }
      } catch (err) {
        console.error("[RS232] Poll error:", err);
      } finally {
        isProcessing.current = false;
      }
    };

    // Interval 200ms untuk menghindari race condition
    intervalRef.current = setInterval(poll, 50);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      console.log(`[RS232 Scanner] Stopped polling for CP${cpNumber}`);
    };
  }, [cpNumber, active]);
}