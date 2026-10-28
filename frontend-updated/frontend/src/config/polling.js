// src/config/polling.js
// ONE place to tune how often the UI asks the backend / PLC for data.
//
// These are the ORIGINAL fast values (all <= 50 ms). Smoothness does not come from
// polling less: it comes from making each poll cheap (no re-render when nothing
// changed, cached backend reads, no log spam).
//
// Lower value  = faster reaction, more CPU.   Higher value = lighter.
// Every value is in milliseconds.
export const POLL = {
  // Shared Internal Variable store (GET /api/internal-variables)
  INTERNAL_VARIABLES_MS: 20,

  // Modbus TCP PLC bindings used by the Dynamic Page
  PLC_MODBUS_MS: 20,

  // Sweep for FINS / Modbus RTU / EtherNet/IP bindings
  PLC_SLOW_SWEEP_MS: 10,

  // Barcode scanner (RS232) and PLC "Device Trigger" queues
  SCANNER_MS: 50,

  // Specification / Testing Table runtime status
  SPEC_RUNTIME_MS: 50,

  // MainPage's own PLC hook has no bindings (its poll returns immediately)
  MAINPAGE_STATUS_MS: 20,
};
