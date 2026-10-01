import { useState, useEffect, useRef, useCallback } from "react";
import { ModalBackdrop, ModalPanel } from "../components/motion";
import { API } from "../service/api";

// ── COM / RS232 Terminal ───────────────────────────────────────
export default function ComSerialTerminal({ onClose }) {
  const [devices, setDevices] = useState([]);
  const [selected, setSelected] = useState("");
  const [connected, setConnected] = useState(false);
  const [terminal, setTerminal] = useState("");
  const [terminalHex, setTerminalHex] = useState("");
  const [sendText, setSendText] = useState("");
  const [sendMode, setSendMode] = useState("text");
  const [cr, setCr] = useState(true);
  const [lf, setLf] = useState(true);
  const [autoRead, setAutoRead] = useState(true);
  const [pollMs, setPollMs] = useState(100);
  const [busy, setBusy] = useState(false);
  const lastRxRef = useRef("");

  const selectedDevice = devices.find(d => d.name === selected) || null;

  const fetchDevices = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/rs232/devices`, { cache: "no-store" });
      const d = await r.json();
      const list = Array.isArray(d?.devices) ? d.devices : [];
      setDevices(list);
      setSelected(prev =>
        prev && list.some(x => x.name === prev)
          ? prev
          : (list[0]?.name || "")
      );
    } catch (e) {
      console.error("[COM TERMINAL] device load failed", e);
    }
  }, []);

  // STATUS CHECK TETAP ADA.
  // Tidak ada tombol Connect / Disconnect.
  const refreshStatus = useCallback(async () => {
    if (!selected) {
      setConnected(false);
      return;
    }

    try {
      const r = await fetch(`${API}/api/rs232/status`, {
        cache: "no-store"
      });
      const d = await r.json();
      setConnected(d?.[selected]?.connected === true);
    } catch (_) {
      setConnected(false);
    }
  }, [selected]);

  useEffect(() => {
    fetchDevices();
    const t = setInterval(fetchDevices, 3000);
    return () => clearInterval(t);
  }, [fetchDevices]);

  // Poll status tetap berjalan setiap 500 ms.
  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 500);
    return () => clearInterval(t);
  }, [refreshStatus]);

  const appendRx = useCallback((value) => {
    if (value == null) return;
    const text = String(value);
    if (!text || text === lastRxRef.current) return;

    lastRxRef.current = text;

    const hex = Array.from(new TextEncoder().encode(text))
      .map(b => b.toString(16).padStart(2, "0").toUpperCase())
      .join(" ");

    setTerminal(v => v + `RX < ${text}\n`);
    setTerminalHex(v => v + `RX < ${hex}\n`);
  }, []);

  useEffect(() => {
    if (!autoRead || !selected) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const r = await fetch(`${API}/api/rs232/latest`, {
          cache: "no-store"
        });
        const d = await r.json();

        if (!cancelled) {
          appendRx(d?.[selected]);
        }
      } catch (_) {}
    };

    tick();

    const t = setInterval(
      tick,
      Math.max(50, Number(pollMs) || 100)
    );

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [autoRead, selected, pollMs, appendRx]);

  const hexOf = (text) =>
    Array.from(new TextEncoder().encode(text))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();

  const hexToText = (hex) => {
    const c = String(hex).replace(/[^0-9a-f]/gi, "");

    if (c.length % 2) {
      throw new Error("HEX harus jumlah digit genap");
    }

    return String.fromCharCode(
      ...(c.match(/../g) || [])
        .map(x => parseInt(x, 16))
    );
  };

  // Kirim data langsung.
  // LON / LOFF / *IDN? menggunakan fungsi ini langsung.
  const sendData = async (
    text,
    mode = "text",
    clearInput = false
  ) => {
    if (!selected || !text || busy) return;

    setBusy(true);

    try {
      let payload = mode === "hex"
        ? hexToText(text)
        : text;

      if (cr) payload += "\r";
      if (lf) payload += "\n";

      const r = await fetch(`${API}/api/rs232/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          device_name: selected,
          data: payload
        })
      });

      const d = await r.json();

      if (!r.ok || d?.success === false) {
        throw new Error(d?.message || "Send failed");
      }

      setTerminal(v =>
        v +
        `TX > ${
          mode === "hex"
            ? hexOf(payload)
            : payload
                .replace(/\r/g, "\\r")
                .replace(/\n/g, "\\n")
        }\n`
      );

      setTerminalHex(v =>
        v + `TX > ${hexOf(payload)}\n`
      );

      if (clearInput) {
        setSendText("");
      }
    } catch (e) {
      setTerminal(v =>
        v + `[ERROR] ${e.message}\n`
      );
    } finally {
      setBusy(false);
    }
  };

  const send = async () =>
    sendData(sendText, sendMode, true);

  // QUICK COMMAND LANGSUNG KIRIM.
  const quick = async (x) =>
    sendData(x, "text", false);

  const clear = () => {
    setTerminal("");
    setTerminalHex("");
    lastRxRef.current = "";
  };

  return (
    <ModalBackdrop className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <ModalPanel
        className="w-[min(1200px,96vw)] h-[min(820px,94vh)] rounded-2xl border border-[#22C55E]/40 overflow-hidden shadow-2xl flex flex-col"
        style={{ background: "var(--bg-surface-2)" }}
      >
        <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg-surface)]">
          <div>
            <div className="text-[#22C55E] font-bold text-lg">
              ⌘ COM / RS232 TERMINAL
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              Serial diagnostic terminal
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg border border-[var(--border)] hover:bg-[#EF4444] hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-3 border-b border-[var(--border)] flex flex-wrap gap-3 items-end">
          <div className="min-w-[280px] flex-1">
            <label className="text-xs text-[var(--text-muted)]">
              COM DEVICE
            </label>

            <select
              value={selected}
              onChange={e => {
                setSelected(e.target.value);
                lastRxRef.current = "";
              }}
              className="w-full mt-1 h-10 rounded-lg px-3 bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-primary)]"
            >
              {devices.map(d => (
                <option key={d.name} value={d.name}>
                  {d.name} — {d.port}
                </option>
              ))}
            </select>
          </div>

          {/* STATUS CHECK TETAP DITAMPILKAN */}
          <div
            className={`h-10 px-4 rounded-lg flex items-center gap-2 border ${
              connected
                ? "border-[#22C55E]/50 text-[#22C55E]"
                : "border-[#EF4444]/50 text-[#EF4444]"
            }`}
          >
            <span>●</span>
            {connected ? "READY" : "NOT READY"}
          </div>

          <div className="text-xs text-[var(--text-muted)]">
            Port:
            <b className="text-[var(--text-primary)]">
              {selectedDevice?.port || "-"}
            </b>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-2 gap-px bg-[var(--border)]">
          <div className="min-h-0 flex flex-col bg-[#050A0F]">
            <div className="px-4 py-2 border-b border-white/10 text-xs font-bold text-[#22C55E]">
              TERMINAL TEXT
            </div>

            <pre className="flex-1 overflow-auto p-4 text-sm text-[#D1FAE5] font-mono whitespace-pre-wrap">
              {terminal || "Waiting for data..."}
            </pre>
          </div>

          <div className="min-h-0 flex flex-col bg-[#050A0F]">
            <div className="px-4 py-2 border-b border-white/10 text-xs font-bold text-[#60A5FA]">
              TERMINAL HEX
            </div>

            <pre className="flex-1 overflow-auto p-4 text-sm text-[#BFDBFE] font-mono whitespace-pre-wrap">
              {terminalHex || "Waiting for data..."}
            </pre>
          </div>
        </div>

        <div className="p-4 border-t border-[var(--border)] space-y-3 bg-[var(--bg-surface)]">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => quick("LON")}
              disabled={busy || !selected}
              className="px-3 py-2 rounded-lg bg-[#14532D] text-white text-xs disabled:opacity-50"
            >
              LON
            </button>

            <button
              onClick={() => quick("LOFF")}
              disabled={busy || !selected}
              className="px-3 py-2 rounded-lg bg-[#7F1D1D] text-white text-xs disabled:opacity-50"
            >
              LOFF
            </button>

            <button
              onClick={() => quick("*IDN?")}
              disabled={busy || !selected}
              className="px-3 py-2 rounded-lg bg-[#1E3A8A] text-white text-xs disabled:opacity-50"
            >
              *IDN?
            </button>

            <button
              onClick={clear}
              className="ml-auto px-3 py-2 rounded-lg border border-[var(--border)] text-xs"
            >
              CLEAR
            </button>
          </div>

          <div className="flex gap-2">
            <select
              value={sendMode}
              onChange={e => setSendMode(e.target.value)}
              className="h-11 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] px-3 text-sm"
            >
              <option value="text">TEXT</option>
              <option value="hex">HEX</option>
            </select>

            <input
              value={sendText}
              onChange={e => setSendText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              placeholder="Enter command / data..."
              className="flex-1 h-11 rounded-lg bg-[#050A0F] border border-[var(--border)] px-3 text-sm text-white font-mono"
            />

            <button
              onClick={send}
              disabled={busy || !selected || !sendText}
              className="px-7 rounded-lg bg-[#22C55E] text-[#052E16] font-bold disabled:opacity-50"
            >
              SEND
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-5 text-xs text-[var(--text-secondary)]">
            <label>
              <input
                type="checkbox"
                checked={cr}
                onChange={e => setCr(e.target.checked)}
              />{" "}
              CR
            </label>

            <label>
              <input
                type="checkbox"
                checked={lf}
                onChange={e => setLf(e.target.checked)}
              />{" "}
              LF
            </label>

            <label>
              <input
                type="checkbox"
                checked={autoRead}
                onChange={e => setAutoRead(e.target.checked)}
              />{" "}
              AUTO READ
            </label>

            <label>
              Poll{" "}
              <input
                value={pollMs}
                onChange={e => setPollMs(e.target.value)}
                className="w-16 ml-1 rounded bg-[var(--bg-elevated)] border border-[var(--border)] px-2 py-1"
              />{" "}
              ms
            </label>

            <span>Baud: {selectedDevice?.Baudrate ?? "-"}</span>
            <span>Parity: {selectedDevice?.Parity ?? "-"}</span>
            <span>Data: {selectedDevice?.["Data Bits"] ?? "-"}</span>
            <span>Stop: {selectedDevice?.["Stop Bits"] ?? "-"}</span>
          </div>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
