import { useState, useEffect, useRef, useCallback } from "react";
import { ModalBackdrop, ModalPanel } from "../components/motion";
import { API } from "../service/api";

// ── Serial over UDP Terminal ───────────────────────────────────
// Diagnostic terminal for every configured Serial-over-UDP device.
// It intentionally uses the same backend API as the runtime hook so the
// terminal tests the real communication path instead of a browser UDP socket.
export default function UDPSerialTerminal({ onClose }) {
  const [devices, setDevices] = useState([]);
  const [deviceName, setDeviceName] = useState("");
  const [sendData, setSendData] = useState("");
  const [hexMode, setHexMode] = useState(false);
  const [cr, setCr] = useState(true);
  const [lf, setLf] = useState(true);
  const [responseMode, setResponseMode] = useState("text");
  const [encoding, setEncoding] = useState("ascii");
  const [timeout, setTimeoutValue] = useState("2000");
  const [autoRead, setAutoRead] = useState(false);
  const [autoCommand, setAutoCommand] = useState("");
  const [autoInterval, setAutoInterval] = useState("1000");
  const [terminal, setTerminal] = useState("");
  const [terminalHex, setTerminalHex] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [receiveActive, setReceiveActive] = useState(false);
  const [status, setStatus] = useState("READY");
  const [error, setError] = useState("");
  const receiveAbortRef = useRef(null);

  const selected = devices.find(
    (d) => String(d?.name || d?.["Device Name"] || "") === String(deviceName)
  ) || null;

  const nameOf = (d) => String(d?.name || d?.["Device Name"] || "");

  const fetchJson = useCallback(async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      cache: "no-store",
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
  }, []);

  const appendTerminal = useCallback((direction, value, hex, ok = true) => {
    const now = new Date().toLocaleTimeString();
    const prefix = direction === "TX" ? "→ TX" : "← RX";
    setTerminal((prev) =>
      `${prev}${prev ? "\n" : ""}[${now}] ${prefix} ${ok ? "" : "[ERROR] "}${String(value ?? "")}`
    );
    if (hex !== undefined) {
      setTerminalHex((prev) =>
        `${prev}${prev ? "\n" : ""}[${now}] ${prefix} ${String(hex ?? "")}`
      );
    }
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const data = await fetchJson(`${API}/api/udp/devices`);
      const list = Array.isArray(data?.devices) ? data.devices : [];
      setDevices(list);
      setDeviceName((prev) => {
        if (prev && list.some((d) => nameOf(d) === prev)) return prev;
        return nameOf(list[0]) || "";
      });
      setError("");
    } catch (e) {
      setError(e?.message || "Failed to load UDP devices");
    }
  }, [fetchJson]);

  useEffect(() => {
    loadDevices();
    const timer = setInterval(loadDevices, 3000);
    return () => clearInterval(timer);
  }, [loadDevices]);

  const endpointInfo = selected ? {
    localIp: selected?.["Local IP Address"] ?? selected?.["Local IP"] ?? selected?.local_ip ?? "0.0.0.0",
    localPort: selected?.["Local Port"] ?? selected?.local_port ?? 0,
    remoteIp: selected?.["Remote IP Address"] ?? selected?.["Remote IP"] ?? selected?.["IP Address"] ?? selected?.remote_ip ?? "",
    remotePort: selected?.["Remote Port"] ?? selected?.Port ?? selected?.remote_port ?? 0,
  } : null;

  const normalizePayload = () => {
    let value = String(sendData ?? "");
    if (!hexMode) {
      if (cr) value += "\r";
      if (lf) value += "\n";
      return { request_text: value, request_hex: null };
    }

    // In HEX mode CR/LF are appended as actual bytes, matching the
    // original C# terminal behavior while allowing arbitrary binary data.
    let clean = value.replace(/[^0-9a-fA-F]/g, "");
    if (clean.length % 2) throw new Error("HEX data must contain an even number of hex digits");
    if (cr) clean += "0D";
    if (lf) clean += "0A";
    return { request_text: null, request_hex: clean };
  };

  const decodeForLog = (data) => {
    if (typeof data === "string") return data.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    if (Array.isArray(data)) return data.join(" ");
    try { return JSON.stringify(data); } catch { return String(data); }
  };

  const send = async ({ waitResponse = false, overrideData = null } = {}) => {
    if (!selected) {
      setError("Please select a Serial-over-UDP device.");
      return;
    }
    setBusy(true);
    setStatus(waitResponse ? "WAITING RESPONSE..." : "SENDING...");
    setError("");
    try {
      const source = overrideData !== null ? String(overrideData) : sendData;
      const old = sendData;
      if (overrideData !== null) setSendData(source);

      let value = source;
      if (!hexMode) {
        if (cr) value += "\r";
        if (lf) value += "\n";
      }
      let requestText = null;
      let requestHex = null;
      if (hexMode) {
        requestHex = value.replace(/[^0-9a-fA-F]/g, "");
        if (requestHex.length % 2) throw new Error("HEX data must contain an even number of hex digits");
        if (cr) requestHex += "0D";
        if (lf) requestHex += "0A";
      } else {
        requestText = value;
      }

      const endpoint = waitResponse ? "/api/udp/request" : "/api/udp/send";
      const body = waitResponse ? {
        device_name: nameOf(selected),
        request_text: requestText,
        request_hex: requestHex,
        response_mode: responseMode,
        encoding,
        response_timeout: Number(timeout) || 2000,
      } : {
        device_name: nameOf(selected),
        data_text: requestText,
        data_hex: requestHex,
        encoding,
      };

      const data = await fetchJson(`${API}${endpoint}`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      const sentHex = data?.sent_hex ||
        (requestHex || Array.from(new TextEncoder().encode(requestText || "")).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase());
      appendTerminal("TX", hexMode ? (requestHex || "") : decodeForLog(requestText), sentHex);

      if (waitResponse) {
        appendTerminal("RX", decodeForLog(data?.response ?? data?.value), data?.response_hex || "");
        setStatus("REMOTE RESPONSE OK");
      } else {
        setStatus("SENT OK");
      }
      setSendData(overrideData !== null ? old : sendData);
    } catch (e) {
      appendTerminal("TX", e?.message || "UDP send failed", "", false);
      setError(e?.message || "UDP communication failed");
      setStatus("ERROR");
    } finally {
      setBusy(false);
    }
  };

  const receive = async () => {
    if (!selected) {
      setError("Please select a Serial-over-UDP device.");
      return;
    }
    if (receiveAbortRef.current) {
      receiveAbortRef.current.abort();
    }
    const controller = new AbortController();
    receiveAbortRef.current = controller;
    setReceiveActive(true);
    setBusy(true);
    setStatus("RECEIVING...");
    setError("");
    try {
      const data = await fetchJson(`${API}/api/udp/receive`, {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          device_name: nameOf(selected),
          response_mode: responseMode,
          encoding,
          response_timeout: Number(timeout) || 2000,
        }),
      });
      if (controller.signal.aborted) return;
      appendTerminal("RX", decodeForLog(data?.response ?? data?.value), data?.response_hex || "");
      setStatus("RECEIVE OK");
    } catch (e) {
      if (controller.signal.aborted || e?.name === "AbortError") {
        appendTerminal("RX", "RECEIVE STOPPED BY USER", "", true);
        setStatus("RECEIVE STOPPED");
        setError("");
      } else {
        setError(e?.message || "UDP receive timeout");
        setStatus("TIMEOUT / ERROR");
        appendTerminal("RX", e?.message || "UDP receive timeout", "", false);
      }
    } finally {
      if (receiveAbortRef.current === controller) receiveAbortRef.current = null;
      setReceiveActive(false);
      setBusy(false);
    }
  };

  const stopReceive = () => {
    const controller = receiveAbortRef.current;
    if (!controller) return;
    controller.abort();
    receiveAbortRef.current = null;
    setReceiveActive(false);
    setBusy(false);
    setStatus("RECEIVE STOPPED");
    setError("");
  };

  const shortcut = async (command) => {
    setSendData(command);
    await send({ waitResponse: true, overrideData: command });
  };

  useEffect(() => {
    if (!autoRead || !selected || autoBusy) return;
    let cancelled = false;
    const run = async () => {
      if (cancelled || autoBusy) return;
      const command = String(autoCommand || "").trim();
      if (!command) return;
      setAutoBusy(true);
      try {
        const data = await fetchJson(`${API}/api/udp/request`, {
          method: "POST",
          body: JSON.stringify({
            device_name: nameOf(selected),
            request_text: command + (cr ? "\r" : "") + (lf ? "\n" : ""),
            response_mode: responseMode,
            encoding,
            response_timeout: Number(timeout) || 1000,
          }),
        });
        if (!cancelled) {
          appendTerminal("TX", decodeForLog(command), data?.request_hex || "");
          appendTerminal("RX", decodeForLog(data?.response ?? data?.value), data?.response_hex || "");
          setStatus("AUTO READ OK");
        }
      } catch (e) {
        if (!cancelled) setStatus("AUTO READ TIMEOUT");
      } finally {
        setAutoBusy(false);
      }
    };
    run();
    const id = setInterval(run, Math.max(250, Number(autoInterval) || 1000));
    return () => { cancelled = true; clearInterval(id); };
  }, [autoRead, selected, autoCommand, autoInterval, cr, lf, responseMode, encoding, timeout, appendTerminal, fetchJson, autoBusy]);

  useEffect(() => {
    return () => {
      try { receiveAbortRef.current?.abort(); } catch {}
      receiveAbortRef.current = null;
    };
  }, []);

  const clearTerminal = () => {
    setTerminal("");
    setTerminalHex("");
    setError("");
    setStatus("READY");
  };

  return (
    <ModalBackdrop className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-md p-5">
      <ModalPanel
        className="w-[min(1200px,96vw)] h-[min(850px,94vh)] rounded-2xl border border-[#22C55E]/35 overflow-hidden shadow-2xl flex flex-col"
        style={{ background: "var(--bg-surface-2)" }}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#22C55E]/15 border border-[#22C55E]/30 flex items-center justify-center text-lg">⌁</div>
            <div>
              <div className="text-[#22C55E] font-bold text-lg">SERIAL OVER UDP TERMINAL</div>
              <div className="text-[var(--text-muted)] text-xs">Diagnostic terminal • real UDP device communication</div>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#DC2626] hover:text-white transition-colors">✕</button>
        </div>

        <div className="px-5 py-3 border-b border-[var(--border)] grid grid-cols-12 gap-3 shrink-0">
          <div className="col-span-4">
            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">UDP Device</label>
            <select
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              className="w-full h-10 rounded-lg px-3 bg-[var(--bg-input)] border border-[var(--border-soft)] text-[var(--text-primary)] text-sm outline-none focus:border-[#22C55E]"
            >
              <option value="">Select device...</option>
              {devices.map((d) => <option key={nameOf(d)} value={nameOf(d)}>{nameOf(d)}</option>)}
            </select>
          </div>
          <div className="col-span-5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-soft)] px-3 py-2 text-xs">
            <div className="text-[var(--text-muted)] mb-0.5">ENDPOINT</div>
            <div className="font-mono text-[var(--text-primary)]">
              {endpointInfo ? `${endpointInfo.localIp}:${endpointInfo.localPort}  →  ${endpointInfo.remoteIp}:${endpointInfo.remotePort}` : "—"}
            </div>
          </div>
          <div className="col-span-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-2">
            <div className="text-[var(--text-muted)] text-[10px] uppercase">Status</div>
            <div className={`font-bold text-sm ${status.includes("OK") ? "text-[#22C55E]" : status.includes("ERROR") || status.includes("TIMEOUT") ? "text-[#EF4444]" : "text-[var(--text-primary)]"}`}>
              {status}
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-12 gap-3 p-4">
          <div className="col-span-8 min-h-0 grid grid-rows-1 gap-3">
            <div className="min-h-0 grid grid-rows-2 gap-3">
              <div className="min-h-0 rounded-xl border border-[var(--border-soft)] overflow-hidden">
                <div className="px-3 py-2 bg-[var(--bg-elevated)] border-b border-[var(--border-soft)] text-xs font-bold text-[var(--text-secondary)]">RECEIVE • TEXT</div>
                <textarea readOnly value={terminal} className="w-full h-[calc(100%-36px)] resize-none bg-[#050B09] text-[#86EFAC] font-mono text-xs p-3 outline-none" />
              </div>
              <div className="min-h-0 rounded-xl border border-[var(--border-soft)] overflow-hidden">
                <div className="px-3 py-2 bg-[var(--bg-elevated)] border-b border-[var(--border-soft)] text-xs font-bold text-[var(--text-secondary)]">RECEIVE • HEX</div>
                <textarea readOnly value={terminalHex} className="w-full h-[calc(100%-36px)] resize-none bg-[#080B12] text-[#93C5FD] font-mono text-xs p-3 outline-none" />
              </div>
            </div>
          </div>

          <div className="col-span-4 min-h-0 rounded-xl border-2 border-[#22C55E] bg-white p-4 overflow-y-auto shadow-sm">
            <div className="text-xs font-bold text-[#15803D] mb-3">TRANSMIT</div>
            <textarea
              value={sendData}
              onChange={(e) => setSendData(e.target.value)}
              onKeyDown={(e) => { if (e.ctrlKey && e.key === "Enter") send({ waitResponse: true }); }}
              placeholder={hexMode ? "HEX: 4C 4F 4E" : "Command / data..."}
              className="w-full h-28 rounded-lg bg-white border-2 border-[#22C55E] text-[#111827] placeholder-[#6B7280] font-mono text-sm p-3 outline-none focus:border-[#16A34A] resize-none shadow-inner"
            />

            <div className="grid grid-cols-2 gap-2 mt-3">
              <label className="flex items-center gap-2 text-xs text-[#374151]">
                <input type="checkbox" checked={hexMode} onChange={(e) => setHexMode(e.target.checked)} /> HEX
              </label>
              <label className="flex items-center gap-2 text-xs text-[#374151]">
                <input type="checkbox" checked={cr} onChange={(e) => setCr(e.target.checked)} /> CR
              </label>
              <label className="flex items-center gap-2 text-xs text-[#374151]">
                <input type="checkbox" checked={lf} onChange={(e) => setLf(e.target.checked)} /> LF
              </label>
              <label className="flex items-center gap-2 text-xs text-[#374151]">
                <input type="checkbox" checked={autoRead} onChange={(e) => setAutoRead(e.target.checked)} /> Auto Read
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-3">
              <div>
                <label className="block text-[10px] text-[var(--text-muted)] mb-1">RESPONSE</label>
                <select value={responseMode} onChange={(e) => setResponseMode(e.target.value)} className="w-full h-9 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-soft)] text-[var(--text-primary)] text-xs px-2">
                  <option value="text">Text</option>
                  <option value="hex">Hex</option>
                  <option value="bytes">Bytes</option>
                  <option value="json">JSON</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-[var(--text-muted)] mb-1">ENCODING</label>
                <select value={encoding} onChange={(e) => setEncoding(e.target.value)} className="w-full h-9 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-soft)] text-[var(--text-primary)] text-xs px-2">
                  <option value="ascii">ASCII</option>
                  <option value="utf-8">UTF-8</option>
                  <option value="latin-1">Latin-1</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <label className="block text-[10px] text-[var(--text-muted)] mb-1">TIMEOUT (ms)</label>
                <input type="number" min="50" max="10000" value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} className="w-full h-9 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-soft)] text-[var(--text-primary)] text-xs px-2 outline-none" />
              </div>
              <div>
                <label className="block text-[10px] text-[var(--text-muted)] mb-1">AUTO INTERVAL (ms)</label>
                <input type="number" min="250" max="60000" value={autoInterval} onChange={(e) => setAutoInterval(e.target.value)} className="w-full h-9 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-soft)] text-[var(--text-primary)] text-xs px-2 outline-none" />
              </div>
            </div>

            {autoRead && (
              <div className="mt-2">
                <label className="block text-[10px] text-[var(--text-muted)] mb-1">AUTO READ COMMAND</label>
                <input value={autoCommand} onChange={(e) => setAutoCommand(e.target.value)} placeholder="Example: READ / *IDN?" className="w-full h-9 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-soft)] text-[var(--text-primary)] text-xs px-2 outline-none focus:border-[#22C55E]" />
              </div>
            )}

            <div className="grid grid-cols-4 gap-2 mt-4">
              <button disabled={busy || !selected} onClick={() => send()} className="h-10 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-bold text-xs disabled:opacity-40">SEND</button>
              <button disabled={busy || !selected} onClick={() => send({ waitResponse: true })} className="h-10 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] font-bold text-xs disabled:opacity-40">SEND + WAIT</button>
              <button disabled={busy || !selected} onClick={receive} className="h-10 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-bold text-xs disabled:opacity-40">RECEIVE</button>
              <button disabled={!receiveActive} onClick={stopReceive} className="h-10 rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white font-bold text-xs disabled:opacity-40">STOP</button>
            </div>

            <div className="grid grid-cols-4 gap-2 mt-2">
              <button disabled={busy || !selected} onClick={() => shortcut("LON")} className="h-9 rounded-lg border border-[#22C55E]/40 text-[#86EFAC] hover:bg-[#14532D] text-xs font-bold disabled:opacity-40">LON</button>
              <button disabled={busy || !selected} onClick={() => shortcut("LOFF")} className="h-9 rounded-lg border border-[#EF4444]/40 text-[#FCA5A5] hover:bg-[#7F1D1D] text-xs font-bold disabled:opacity-40">LOFF</button>
              <button disabled={busy || !selected} onClick={() => shortcut("*IDN?")} className="h-9 rounded-lg border border-[#60A5FA]/40 text-[#93C5FD] hover:bg-[#1E3A8A] text-xs font-bold disabled:opacity-40">*IDN?</button>
              <button onClick={clearTerminal} className="h-9 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] text-xs font-bold">CLEAR</button>
            </div>

            {error && <div className="mt-3 p-2.5 rounded-lg border border-[#EF4444]/30 bg-[#7F1D1D]/20 text-[#FCA5A5] text-xs">{error}</div>}

            <div className="mt-4 p-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] text-[10px] text-[var(--text-muted)] leading-relaxed">
              <b className="text-[var(--text-secondary)]">Terminal behavior:</b> SEND only transmits. SEND + WAIT performs request/response and is the best diagnostic for checking whether the remote UDP serial device actually responds. RECEIVE waits for an incoming datagram.
            </div>
          </div>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
