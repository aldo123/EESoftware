// src/pages/DynamicCPPage.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { API } from "../service/api";

function RuntimeTextBox({ widget, value, onChange, readOnly }) {
  const p = widget.props;
  const isEditable = p.source === "manual";
  const isReadOnly = readOnly || !isEditable;
  return (
    <div className="absolute flex flex-col" style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}>
      {p.showLabel && <span className="text-[9px] font-bold mb-0.5 uppercase tracking-wider" style={{ color: "#94A3B8" }}>{p.label}</span>}
      <div className="flex-1 flex items-center bg-[#172132] border border-[#334155] rounded-lg px-3 gap-2 focus-within:border-[#22C55E]/60 transition-colors">
        <span className="text-[#475569] font-mono text-sm shrink-0">▐▌</span>
        <input value={value || ""} onChange={e => onChange && onChange(e.target.value)} readOnly={isReadOnly} placeholder={p.placeholder} className="flex-1 bg-transparent text-white text-sm outline-none placeholder-[#334155]" />
        
      </div>
    </div>
  );
}

function RuntimeLabel({ widget }) {
  const p = widget.props;
  return (<div className="absolute flex items-center" style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}><span style={{ fontSize: p.fontSize, color: p.color, fontWeight: p.bold ? 700 : 400 }} className="leading-none">{p.text}</span></div>);
}

function RuntimeButton({ widget, onAction }) {
  const p = widget.props;
  return (<div className="absolute" style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}><button onClick={() => onAction && onAction(widget)} className="w-full h-full rounded-xl font-bold text-sm transition-all active:scale-[0.97] hover:brightness-110" style={{ background: p.color, color: p.textColor }}>{p.text}</button></div>);
}

function RuntimeMessageBox({ widget, logs }) {
  const p = widget.props;
  const logContainerRef = useRef(null);
  useEffect(() => { if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight; }, [logs]);
  return (
    <div className="absolute flex flex-col overflow-hidden" style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}>
      <span className="text-[9px] font-bold text-[#94A3B8] mb-1 uppercase tracking-wider shrink-0">{p.title}</span>
      <div ref={logContainerRef} className="flex-1 bg-[#0A0F1A] border border-[#111827] rounded p-2 overflow-y-auto font-mono text-[10px]" style={{ scrollbarWidth: "thin", scrollbarColor: "#334155 #0A0F1A" }}>
        {(logs || []).map((log, i) => <div key={i} style={{ color: log.color || "#22C55E" }}>[{log.time}] {log.message}</div>)}
        {(!logs || logs.length === 0) && <span className="text-[#334155]">Waiting for actions...</span>}
      </div>
    </div>
  );
}

function RuntimePicture({ widget }) {
  const p = widget.props;
  return (<div className="absolute flex items-center justify-center bg-[#172132] border border-[#334155] rounded-lg" style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}><span className="text-[#334155] text-xs font-mono select-none">{p.placeholder}</span></div>);
}

function RuntimeTable({ widget, rows }) {
  const p = widget.props;
  const columns = p.columns || [];
  return (
    <div className="absolute flex flex-col" style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}>
      <span className="text-[9px] font-bold text-[#94A3B8] mb-1 uppercase tracking-wider shrink-0">{p.title}</span>
      <div className="flex-1 overflow-hidden border border-[#334155] rounded-lg flex flex-col">
        <div className="flex bg-[#111827] shrink-0">
          {columns.map((col, i) => (<div key={i} className="flex-1 text-[9px] text-[#94A3B8] font-bold px-2 py-1.5 border-r border-[#334155] last:border-r-0 truncate">{col.name}</div>))}
        </div>
        <div className="flex-1 overflow-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "#334155 #0F172A" }}>
          {(rows || []).map((row, i) => (
            <div key={i} className="flex border-b border-[#1E293B] hover:bg-[#1E3A5F]/20 transition-colors">
              {columns.map((col, j) => (<div key={j} className="flex-1 text-[10px] text-white px-2 py-1.5 border-r border-[#1E293B] last:border-r-0 truncate font-mono">{row[col.name] || "—"}</div>))}
            </div>
          ))}
          {(!rows || rows.length === 0) && <div className="flex items-center justify-center h-full text-[#334155] text-[10px] py-4">No data</div>}
        </div>
      </div>
    </div>
  );
}

function RuntimeInstruction({ widget, text }) {
  const p = widget.props;
  const display = text || p.defaultText;
  const isPass = display === "PASS";
  return (<div className="absolute flex items-center px-4 bg-[#172132] border border-[#334155] rounded-xl gap-3" style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}><span className="text-xl shrink-0">🧑‍💻</span><span className="font-bold text-base" style={{ color: isPass ? "#22C55E" : "#3B82F6" }}>{display}</span></div>);
}

function RuntimeCard({ widget }) {
  const p = widget.props;
  return (<div className="absolute border border-[#334155] rounded-lg bg-[#1E293B] p-3" style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}><span className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider">{p.title}</span></div>);
}

export default function DynamicCPPage({ cpNumber, user }) {
  const [widgets, setWidgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fieldValues, setFieldValues] = useState({});
  const [logs, setLogs] = useState([]);
  const [tableRows, setTableRows] = useState({});
  const [instructions, setInstructions] = useState({});
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 1260, height: 800 });

  const resetAll = useCallback(() => {
    setFieldValues({});
    setTableRows({});
    setInstructions({});
    setLogs([]);
    console.log(`[DynamicCPPage] Reset all states for CP${cpNumber}`);
  }, [cpNumber]);

  useEffect(() => { resetAll(); }, [cpNumber]);
  useEffect(() => { return () => { resetAll(); }; }, [resetAll]);
  useEffect(() => {
    const resetHandler = () => resetAll();
    window.addEventListener("cp-reset", resetHandler);
    return () => window.removeEventListener("cp-reset", resetHandler);
  }, [resetAll]);

  useEffect(() => {
    if (!cpNumber) { setError("CP Number is not defined."); setLoading(false); return; }
    setLoading(true); setError("");
    fetch(`${API}/api/page-config/${cpNumber}`)
      .then(r => r.ok ? r.json() : { widgets: [] })
      .then(d => {
        const loadedWidgets = d.widgets || [];
        setWidgets(loadedWidgets); setLoading(false);
        let maxW = 1260, maxH = 800;
        loadedWidgets.forEach(w => {
          const right = w.x + (w.props?.width || 0);
          const bottom = w.y + (w.props?.height || 0);
          if (right > maxW) maxW = right;
          if (bottom > maxH) maxH = bottom;
        });
        setCanvasSize({ width: Math.max(1260, maxW + 40), height: Math.max(800, maxH + 40) });
      })
      .catch(e => { setError("Failed to load page layout"); setLoading(false); });
  }, [cpNumber]);

  useEffect(() => {
    const updateScale = () => {
      if (containerRef.current) {
        const availableWidth = containerRef.current.clientWidth;
        let newScale = Math.max(0.4, availableWidth / canvasSize.width);
        setScale(newScale);
      }
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [canvasSize.width]);

  const addLog = useCallback((message, color = "#22C55E") => {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLogs(prev => [...prev.slice(-199), { time, message, color }]);
  }, []);

  // ── handleScan dengan source per kolom ─────────────────────────
  const handleScan = useCallback(async (source, value) => {
    console.log(`[handleScan] source=${source}, cpNumber=${cpNumber}`);
    try {
      const res = await fetch(`${API}/api/logic-run/${cpNumber}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device: source,
          value: value,
          fields: fieldValues,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        addLog(`Logic error: ${data.message}`, "#EF4444");
        return;
      }
      const commands = data.commands || [];
      for (const cmd of commands) {
        switch (cmd.cmd) {
          case "set_field":
            setFieldValues(prev => ({ ...prev, [cmd.key]: cmd.value }));
            break;
          case "set_table_row":
            setTableRows(prev => {
              const current = prev[cmd.widget] || [];
              return { ...prev, [cmd.widget]: [...current, cmd.row] };
            });
            break;
          case "set_instruction":
            setInstructions(prev => ({ ...prev, [cmd.widget]: cmd.text }));
            break;
          case "log":
            addLog(cmd.message, cmd.color || "#22C55E");
            break;
          case "reject":
            addLog(`REJECT: ${cmd.reason}`, "#EF4444");
            break;
          case "pass":
            addLog("PASS", "#22C55E");
            break;
          default:
            console.warn("Unknown command:", cmd);
        }
      }
    } catch (err) {
      addLog(`Scan error: ${err.message}`, "#EF4444");
      console.error(err);
    }
  }, [cpNumber, fieldValues, addLog]);


  const handleAction = useCallback((widget) => {
    const { action, text, apiEndpoint, plcAddress } = widget.props;
    if (action === "reset") { resetAll(); addLog("Page reset.", "#00BFFF"); return; }
    if (action === "submit") {
      const payload = { cp: cpNumber, fields: fieldValues, user: user?.username };
      fetch(`${API}/api/cp-submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        .then(r => r.json()).then(d => { if (d.success) addLog("Submit OK → " + (d.message || ""), "#22C55E"); else addLog("Submit FAILED: " + (d.message || ""), "#EF4444"); }).catch(e => addLog("Submit error: " + e.message, "#EF4444"));
      return;
    }
    if (action === "sn_reject") {
      const chassis = Object.values(fieldValues)[0] || "—";
      addLog(`SN Reject: ${chassis}`, "#EF4444");
      fetch(`${API}/api/sn-reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sn: chassis, user: user?.username }) }).catch(() => {});
      return;
    }
    if (action === "io_plc") { addLog(`PLC OUT → ${plcAddress || "?"}`, "#F97316"); fetch(`${API}/api/plc/output`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: plcAddress }) }).catch(() => {}); return; }
    if (action === "custom" && apiEndpoint) {
      addLog(`Calling ${apiEndpoint}…`, "#94A3B8");
      fetch(`${API}${apiEndpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: fieldValues }) })
        .then(r => r.json()).then(d => addLog(d.message || "Done", "#22C55E")).catch(e => addLog(e.message, "#EF4444"));
      return;
    }
    addLog(`Button: ${text}`, "#94A3B8");
  }, [cpNumber, fieldValues, user, addLog, resetAll]);

  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.cpNumber === cpNumber) {
        console.log(`[DynamicCPPage] Received cp-scan for ${e.detail.source} → ${e.detail.value}`);
        handleScan(e.detail.source, e.detail.value);
      }
    };
    window.addEventListener("cp-scan", handler);
    return () => { window.removeEventListener("cp-scan", handler); console.log(`[DynamicCPPage] Removed cp-scan listener`); };
  }, [cpNumber, handleScan]);

  if (!cpNumber) return <div className="flex-1 flex items-center justify-center text-[#EF4444] text-xs font-mono">Error: No CP Number provided.</div>;
  if (loading) return (<div className="flex-1 flex items-center justify-center"><div className="flex items-center gap-2 text-[#22C55E] text-xs"><div className="w-4 h-4 border-2 border-[#22C55E] border-t-transparent rounded-full animate-spin" /> Loading page layout…</div></div>);
  if (error) return (<div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8"><span className="text-3xl opacity-30">⚠</span><p className="text-[#EF4444] text-sm">{error}</p><p className="text-[#475569] text-xs">Make sure you have saved a layout in the Page Builder.</p></div>);
  if (widgets.length === 0) return (<div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8"><span className="text-4xl opacity-20">🔧</span><p className="text-white font-semibold">No layout configured for CP{cpNumber}</p><p className="text-[#475569] text-xs">Open Page Builder (Engineer → Settings) to design this CP page.</p></div>);

  const displayWidth = canvasSize.width * scale;
  const displayHeight = canvasSize.height * scale;

  return (
    <div ref={containerRef} className="flex-1 bg-[#0F172A] overflow-hidden font-sans p-4 flex justify-center">
      <div style={{ width: displayWidth, height: displayHeight, position: 'relative' }}>
        <div className="relative origin-top-left" style={{ width: canvasSize.width, height: canvasSize.height, transform: `scale(${scale})` }}>
          {widgets.map(widget => {
            const { type, id, props: p } = widget;
            if (type === "card") return <RuntimeCard key={id} widget={widget} />;
            if (type === "picture") return <RuntimePicture key={id} widget={widget} />;
            if (type === "label") return <RuntimeLabel key={id} widget={widget} />;
            if (type === "textbox") return <RuntimeTextBox key={id} widget={widget} value={fieldValues[p.fieldKey]} onChange={val => setFieldValues(prev => ({ ...prev, [p.fieldKey]: val }))} readOnly={p.source === "readonly"} />;
            if (type === "button") return <RuntimeButton key={id} widget={widget} onAction={handleAction} />;
            if (type === "messagebox") return <RuntimeMessageBox key={id} widget={widget} logs={logs} />;
            if (type === "table") return <RuntimeTable key={id} widget={widget} rows={tableRows[id]} />;
            if (type === "instruction") return <RuntimeInstruction key={id} widget={widget} text={instructions[id]} />;
            return null;
          })}
        </div>
      </div>
    </div>
  );
}