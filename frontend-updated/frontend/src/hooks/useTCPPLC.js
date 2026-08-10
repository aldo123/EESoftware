// src/hooks/useTCPPLC.js

import { useEffect, useRef } from "react";
import { API } from "../service/api";

/**
 * TCP/IP PLC Hook
 *
 * Fungsi:
 * - Polling data TCP PLC melalui backend
 * - Membaca endpoint /api/tcp/latest
 * - Mengirim event "plc-value" ke aplikasi React
 * - Tidak menangani Button / Light / Gauge secara langsung
 *
 * Backend:
 *   GET  /api/tcp/latest
 *   POST /api/tcp/pop
 */

export function useTCPPLC(cpNumber, active = true) {
  const intervalRef = useRef(null);
  const isProcessing = useRef(false);

  useEffect(() => {
    if (!active || !cpNumber) {
      console.log(`[TCP PLC] Inactive (cp=${cpNumber})`);
      return;
    }

    console.log(
      `[TCP PLC] Started polling for CP${cpNumber}`
    );

    const poll = async () => {
      // Mencegah request sebelumnya belum selesai
      if (isProcessing.current) return;

      isProcessing.current = true;

      try {
        const res = await fetch(
          `${API}/api/tcp/latest`
        );

        if (!res.ok) {
          console.warn(
            `[TCP PLC] /api/tcp/latest returned ${res.status}`
          );
          return;
        }

        const data = await res.json();

        if (!data || typeof data !== "object") {
          return;
        }

        // Proses semua TCP device
        for (const [deviceName, value] of Object.entries(data)) {
          if (
            value === null ||
            value === undefined ||
            value === ""
          ) {
            continue;
          }

          // Kirim event PLC ke aplikasi
          window.dispatchEvent(
            new CustomEvent("plc-value", {
              detail: {
                cpNumber: String(cpNumber),

                // Nama device dari Setting
                source: deviceName,
                deviceName: deviceName,

                // Data yang diterima dari PLC
                value: value,
              },
            })
          );

          console.log(
            `[TCP PLC] Dispatched plc-value for ${deviceName} →`,
            value
          );

          // Hapus data dari buffer setelah diproses
          await fetch(
            `${API}/api/tcp/pop`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                device_name: deviceName,
              }),
            }
          ).catch(() => {});
        }
      } catch (err) {
        console.error(
          "[TCP PLC] Poll error:",
          err
        );
      } finally {
        isProcessing.current = false;
      }
    };

    // Jalankan langsung ketika hook aktif
    poll();

    // Poll setiap 200 ms
    intervalRef.current = setInterval(
      poll,
      200
    );

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      console.log(
        `[TCP PLC] Stopped polling for CP${cpNumber}`
      );
    };
  }, [cpNumber, active]);
}