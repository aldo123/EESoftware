// src/modal/PageBuilder.jsx
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { API } from "../service/api";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { QRCodeSVG } from "qrcode.react";

const GRID = 5;
const CANVAS_PRESETS = [{ label: "Optimal (1260x800)", width: 1260, height: 800 }];

const COMPONENT_TYPES = [
  { type: "textbox", label: "Text Box", icon: "⌨", desc: "Input field with source", defaultProps: { label: "Label", placeholder: "Scan here…", source: "scanner_a", width: 280, height: 40, showLabel: true, readOnly: false, fieldKey: "field_1" } },
  { type: "label", label: "Label", icon: "T", desc: "Static text / heading", defaultProps: { text: "Label Text", fontSize: 13, color: "#94A3B8", bold: false, width: 180, height: 28 } },
  { type: "button", label: "Button", icon: "◉", desc: "Action button", defaultProps: { text: "Button", action: "reset", plcAddress: "", color: "#22C55E", textColor: "#052E16", width: 140, height: 40 } },
  { type: "messagebox", label: "Message Box", icon: "☰", desc: "Scrollable log output", defaultProps: { title: "Message", width: 400, height: 140 } },
  { type: "picture", label: "Picture", icon: "🖼", desc: "Image / product photo placeholder", defaultProps: { placeholder: "[ Product Image ]", width: 200, height: 160 } },
  
  // 🛑 PERUBAHAN: Hapus "source", ganti jadi "fieldKey" di setiap kolom
  { type: "table", label: "Table", icon: "⊞", desc: "Data table with fieldKey per column", defaultProps: { title: "Table", columns: [{ name: "P/N", fieldKey: "" }, { name: "Description", fieldKey: "" }, { name: "PCBA SN", fieldKey: "" }, { name: "Mac Address", fieldKey: "" }], width: 520, height: 160 } },
  
  { type: "instruction", label: "Instruction", icon: "💬", desc: "Dynamic instruction bar", defaultProps: { defaultText: "Please Scan Product SN", width: 520, height: 52 } },
  { type: "card", label: "Card / Group", icon: "▭", desc: "Container card with title", defaultProps: { title: "Section Title", width: 400, height: 120 } },

  // ── Form controls ──────────────────────────────────────────
  { type: "dropdown", label: "Dropdown", icon: "▾", desc: "Select input bound to a field", defaultProps: { label: "Select", showLabel: true, fieldKey: "", options: [{ label: "Option 1", value: "opt1" }, { label: "Option 2", value: "opt2" }], width: 220, height: 44 } },
  { type: "checkbox", label: "Checkbox", icon: "☑", desc: "Boolean toggle bound to a field", defaultProps: { label: "Check me", fieldKey: "", width: 200, height: 32 } },

  // ── Monitoring / status widgets ────────────────────────────
  { type: "gauge", label: "Gauge", icon: "◔", desc: "Circular gauge for a numeric field", defaultProps: { title: "Value", fieldKey: "", min: 0, max: 100, unit: "%", color: "#22C55E", width: 180, height: 170 } },
  { type: "progressbar", label: "Progress Bar", icon: "▬", desc: "Linear progress indicator", defaultProps: { title: "Progress", fieldKey: "", min: 0, max: 100, unit: "%", color: "#22C55E", width: 320, height: 56 } },
  { type: "statuslight", label: "Status Light", icon: "●", desc: "LED indicator bound to a field value", defaultProps: { title: "Status", fieldKey: "", onValue: "PASS", onColor: "#22C55E", offColor: "#334155", width: 160, height: 60 } },
  { type: "counter", label: "Counter", icon: "#", desc: "Big number stat card", defaultProps: { title: "Total Pass", fieldKey: "", suffix: "", color: "#22C55E", width: 200, height: 100 } },

  // ── Chart / data visualization ─────────────────────────────
  { type: "chart", label: "Chart", icon: "📊", desc: "Line / Bar / Pie graph", defaultProps: { title: "Chart", chartType: "line", dataSource: "static", fieldKey: "", staticData: [{ name: "Mon", value: 10 }, { name: "Tue", value: 20 }, { name: "Wed", value: 15 }, { name: "Thu", value: 28 }], color: "#22C55E", width: 440, height: 260 } },

  // ── Misc display ────────────────────────────────────────────
  { type: "clock", label: "Clock", icon: "🕐", desc: "Live time / date display", defaultProps: { format: "24h", showDate: true, color: "#22C55E", width: 220, height: 64 } },
  { type: "divider", label: "Divider", icon: "—", desc: "Visual separator line", defaultProps: { orientation: "horizontal", color: "#334155", thickness: 2, width: 300, height: 20 } },
  { type: "qrcode", label: "QR Code", icon: "▦", desc: "QR code from field value or static text", defaultProps: { dataSource: "static", fieldKey: "", staticValue: "https://example.com", width: 150, height: 150 } },
];

const ACTION_OPTIONS = [
  { value: "reset", label: "Reset Page" },
  { value: "submit", label: "Submit / Move" },
  { value: "io_plc", label: "IO PLC Output" },
  { value: "sn_reject", label: "SN Reject" },
  { value: "custom", label: "Custom (API call)" },
];

const snap = (v) => Math.round(v / GRID) * GRID;
let _uid = 1;
const uid = () => `w${Date.now()}_${_uid++}`;

function IconX() { return (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>); }
function IconTrash() { return (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>); }
function IconDupe() { return (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>); }

function WidgetPreview({ widget }) {
  const { type, props: p } = widget;
  if (type === "textbox") return (<div className="flex flex-col w-full h-full">{p.showLabel && <span className="text-[9px] font-bold mb-0.5 truncate" style={{ color: "#94A3B8" }}>{p.label}</span>}<div className="flex-1 flex items-center bg-[#0F172A] border border-[#334155] rounded px-2 gap-1.5"><span className="text-[#475569] font-mono text-[9px]">▐▌</span><span className="text-[#334155] text-[10px] truncate">{p.placeholder}</span></div></div>);
  if (type === "label") return (<span className="truncate leading-none" style={{ fontSize: Math.min(p.fontSize, 14), color: p.color, fontWeight: p.bold ? 700 : 400 }}>{p.text}</span>);
  if (type === "button") return (<button className="w-full h-full rounded-lg font-bold text-[11px] transition-all" style={{ background: p.color, color: p.textColor }}>{p.text}</button>);
  if (type === "messagebox") return (<div className="flex flex-col w-full h-full"><span className="text-[9px] font-bold text-[#94A3B8] mb-1 uppercase tracking-wider">{p.title}</span><div className="flex-1 bg-[#0A0F1A] border border-[#111827] rounded p-1.5 overflow-hidden"><span className="text-[#22C55E] text-[9px] font-mono">[12:00:00] Waiting for actions...</span></div></div>);
  if (type === "picture") return (<div className="w-full h-full flex items-center justify-center bg-[#172132] border border-[#334155] rounded"><span className="text-[#334155] text-[10px] font-mono">{p.placeholder}</span></div>);
  if (type === "table") return (<div className="flex flex-col w-full h-full"><span className="text-[9px] font-bold text-[#94A3B8] mb-1 uppercase tracking-wider">{p.title}</span><div className="flex-1 overflow-hidden border border-[#334155] rounded"><div className="flex bg-[#111827]">{(p.columns || []).map((c, i) => (<div key={i} className="flex-1 text-[8px] text-[#94A3B8] font-bold px-1.5 py-1 border-r border-[#334155] truncate">{c.name}</div>))}</div><div className="p-2 text-center text-[8px] text-[#475569]">No data</div></div></div>);
  if (type === "instruction") return (<div className="w-full h-full flex items-center px-3 bg-[#172132] border border-[#334155] rounded-lg gap-2"><span className="text-base">🧑‍💻</span><span className="font-bold text-[#3B82F6] text-sm truncate">{p.defaultText}</span></div>);
  if (type === "card") return (<div className="w-full h-full border border-[#334155] rounded-lg bg-[#1E293B] p-2"><span className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider">{p.title}</span></div>);

  if (type === "dropdown") return (<div className="flex flex-col w-full h-full">{p.showLabel && <span className="text-[9px] font-bold mb-0.5 truncate" style={{ color: "#94A3B8" }}>{p.label}</span>}<div className="flex-1 flex items-center justify-between bg-[#0F172A] border border-[#334155] rounded px-2"><span className="text-[10px] text-[#94A3B8] truncate">{p.options?.[0]?.label || "Select…"}</span><span className="text-[#475569] text-[9px]">▾</span></div></div>);
  if (type === "checkbox") return (<div className="w-full h-full flex items-center gap-2"><div className="w-4 h-4 rounded border border-[#334155] bg-[#0F172A] shrink-0" /><span className="text-[10px] text-white truncate">{p.label}</span></div>);

  if (type === "gauge") {
    const pct = 0.65;
    const r = 40, cx = 50, cy = 50;
    const startAngle = Math.PI, endAngle = Math.PI * (1 - pct);
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
    return (<div className="flex flex-col items-center justify-center w-full h-full gap-1"><span className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider truncate">{p.title}</span><svg viewBox="0 0 100 60" className="w-full flex-1"><path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#1E293B" strokeWidth="8" strokeLinecap="round" /><path d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`} fill="none" stroke={p.color} strokeWidth="8" strokeLinecap="round" /></svg><span className="text-[10px] font-mono font-bold" style={{ color: p.color }}>{Math.round((p.max - p.min) * pct + p.min)}{p.unit}</span></div>);
  }
  if (type === "progressbar") return (<div className="flex flex-col w-full h-full justify-center gap-1"><div className="flex justify-between"><span className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider">{p.title}</span><span className="text-[9px] font-mono" style={{ color: p.color }}>60{p.unit}</span></div><div className="w-full h-2.5 bg-[#0F172A] border border-[#334155] rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: "60%", background: p.color }} /></div></div>);
  if (type === "statuslight") return (<div className="w-full h-full flex items-center gap-2 px-1"><div className="w-4 h-4 rounded-full shrink-0" style={{ background: p.onColor, boxShadow: `0 0 8px ${p.onColor}` }} /><span className="text-[10px] font-bold text-white truncate">{p.title}</span></div>);
  if (type === "counter") return (<div className="flex flex-col items-center justify-center w-full h-full"><span className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider">{p.title}</span><span className="text-2xl font-black font-mono" style={{ color: p.color }}>128{p.suffix}</span></div>);

  if (type === "chart") {
    const data = p.staticData || [];
    return (<div className="flex flex-col w-full h-full"><span className="text-[9px] font-bold text-[#94A3B8] mb-1 uppercase tracking-wider truncate">{p.title}</span><div className="flex-1 min-h-0"><ResponsiveContainer width="100%" height="100%">
      {p.chartType === "bar" ? (<BarChart data={data}><XAxis dataKey="name" tick={{ fontSize: 8, fill: "#475569" }} axisLine={{ stroke: "#334155" }} tickLine={false} /><YAxis tick={{ fontSize: 8, fill: "#475569" }} axisLine={false} tickLine={false} width={22} /><Bar dataKey="value" fill={p.color} radius={[3, 3, 0, 0]} /></BarChart>) :
      p.chartType === "pie" ? (<PieChart><Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="80%" label={{ fontSize: 8, fill: "#94A3B8" }}>{data.map((_, i) => (<Cell key={i} fill={["#22C55E", "#3B82F6", "#F97316", "#EF4444", "#A855F7"][i % 5]} />))}</Pie></PieChart>) :
      (<LineChart data={data}><XAxis dataKey="name" tick={{ fontSize: 8, fill: "#475569" }} axisLine={{ stroke: "#334155" }} tickLine={false} /><YAxis tick={{ fontSize: 8, fill: "#475569" }} axisLine={false} tickLine={false} width={22} /><Line type="monotone" dataKey="value" stroke={p.color} strokeWidth={2} dot={{ r: 2 }} /></LineChart>)}
    </ResponsiveContainer></div></div>);
  }

  if (type === "clock") return (<div className="flex flex-col items-center justify-center w-full h-full"><span className="text-lg font-black font-mono" style={{ color: p.color }}>12:00:00</span>{p.showDate && <span className="text-[9px] text-[#475569] font-mono">Jan 01, 2026</span>}</div>);
  if (type === "divider") return p.orientation === "vertical" ? (<div className="h-full flex justify-center"><div style={{ width: p.thickness, background: p.color, height: "100%" }} /></div>) : (<div className="w-full flex items-center h-full"><div style={{ height: p.thickness, background: p.color, width: "100%" }} /></div>);
  if (type === "qrcode") return (<div className="w-full h-full flex items-center justify-center bg-white rounded p-1"><QRCodeSVG value={p.staticValue || p.fieldKey || "wik"} size={Math.min(p.width, p.height) - 8} level="M" /></div>);

  return <div className="text-[10px] text-[#475569]">{type}</div>;
}

function PropInput({ label, value, onChange, type = "text", options, min, max }) {
  return (<div className="flex flex-col gap-0.5"><span className="text-[9px] font-bold text-[#475569] uppercase tracking-wider">{label}</span>
    {options ? (<select value={value} onChange={e => onChange(e.target.value)} className="bg-[#0F172A] border border-[#334155] text-white text-[10px] rounded px-2 h-7 outline-none focus:border-[#22C55E]/60">{options.map(o => (<option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>))}</select>) :
    type === "checkbox" ? (<label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} className="accent-[#22C55E]" /><span className="text-[10px] text-white">{label}</span></label>) :
    type === "color" ? (<div className="flex items-center gap-2"><input type="color" value={value} onChange={e => onChange(e.target.value)} className="w-7 h-7 rounded cursor-pointer bg-transparent border border-[#334155]" /><input type="text" value={value} onChange={e => onChange(e.target.value)} className="flex-1 bg-[#0F172A] border border-[#334155] text-white text-[10px] rounded px-2 h-7 outline-none font-mono" /></div>) :
    (<input type={type} value={value} min={min} max={max} onChange={e => onChange(type === "number" ? Number(e.target.value) : e.target.value)} className="bg-[#0F172A] border border-[#334155] text-white text-[10px] rounded px-2 h-7 outline-none focus:border-[#22C55E]/60" />)}
  </div>);
}
function PropSection({ title, children }) { return (<div className="flex flex-col gap-2 pb-3 border-b border-[#1E293B]"><span className="text-[9px] font-bold text-[#22C55E] uppercase tracking-widest pt-2">{title}</span>{children}</div>); }

// ── ColumnEditor with fieldKey per column ──────────────────────
// 🛑 PERUBAHAN: Hapus sourceOptions, ganti select menjadi input fieldKey
function ColumnEditor({ columns, onChange }) {
  const updateColumn = (index, field, value) => {
    const newCols = [...columns];
    newCols[index] = { ...newCols[index], [field]: value };
    onChange(newCols);
  };
  const addColumn = () => onChange([...columns, { name: "Column", fieldKey: "" }]);
  const removeColumn = (index) => onChange(columns.filter((_, i) => i !== index));
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[9px] font-bold text-[#475569] uppercase tracking-wider">Columns</span>
      {columns.map((col, i) => (
        <div key={i} className="flex items-center gap-1">
          <input value={col.name} onChange={e => updateColumn(i, "name", e.target.value)} placeholder="Display Header" className="flex-1 bg-[#0F172A] border border-[#334155] text-white text-[10px] rounded px-2 h-6 outline-none" />
          <input value={col.fieldKey || ""} onChange={e => updateColumn(i, "fieldKey", e.target.value)} placeholder="Field Key (e.g. part_sn)" className="flex-1 bg-[#0F172A] border border-[#334155] text-white text-[10px] rounded px-2 h-6 outline-none" />
          <button onClick={() => removeColumn(i)} className="text-[#EF4444] hover:text-white p-0.5"><IconX /></button>
        </div>
      ))}
      <button onClick={addColumn} className="text-[10px] text-[#22C55E] hover:text-white text-left mt-0.5">+ Add column</button>
    </div>
  );
}

function OptionsEditor({ options, onChange }) {
  const update = (i, field, value) => { const n = [...options]; n[i] = { ...n[i], [field]: value }; onChange(n); };
  const add = () => onChange([...options, { label: "Option", value: `opt${options.length + 1}` }]);
  const remove = (i) => onChange(options.filter((_, idx) => idx !== i));
  return (<div className="flex flex-col gap-2"><span className="text-[9px] font-bold text-[#475569] uppercase tracking-wider">Options</span>
    {options.map((o, i) => (<div key={i} className="flex items-center gap-1"><input value={o.label} onChange={e => update(i, "label", e.target.value)} placeholder="Label" className="flex-1 bg-[#0F172A] border border-[#334155] text-white text-[10px] rounded px-2 h-6 outline-none" /><input value={o.value} onChange={e => update(i, "value", e.target.value)} placeholder="Value" className="flex-1 bg-[#0F172A] border border-[#334155] text-white text-[10px] rounded px-2 h-6 outline-none" /><button onClick={() => remove(i)} className="text-[#EF4444] hover:text-white p-0.5"><IconX /></button></div>))}
    <button onClick={add} className="text-[10px] text-[#22C55E] hover:text-white text-left mt-0.5">+ Add option</button>
  </div>);
}

function ChartDataEditor({ data, onChange }) {
  const update = (i, field, value) => { const n = [...data]; n[i] = { ...n[i], [field]: field === "value" ? Number(value) : value }; onChange(n); };
  const add = () => onChange([...data, { name: `P${data.length + 1}`, value: 0 }]);
  const remove = (i) => onChange(data.filter((_, idx) => idx !== i));
  return (<div className="flex flex-col gap-2"><span className="text-[9px] font-bold text-[#475569] uppercase tracking-wider">Static Data Points</span>
    {data.map((d, i) => (<div key={i} className="flex items-center gap-1"><input value={d.name} onChange={e => update(i, "name", e.target.value)} placeholder="Name" className="flex-1 bg-[#0F172A] border border-[#334155] text-white text-[10px] rounded px-2 h-6 outline-none" /><input type="number" value={d.value} onChange={e => update(i, "value", e.target.value)} placeholder="Value" className="w-16 bg-[#0F172A] border border-[#334155] text-white text-[10px] rounded px-2 h-6 outline-none" /><button onClick={() => remove(i)} className="text-[#EF4444] hover:text-white p-0.5"><IconX /></button></div>))}
    <button onClick={add} className="text-[10px] text-[#22C55E] hover:text-white text-left mt-0.5">+ Add data point</button>
  </div>);
}

function PropertyPanel({ widget, onChange, onDelete, onDuplicate, canvasWidth, canvasHeight, sourceOptions }) {
  if (!widget) return (<div className="flex flex-col items-center justify-center h-full text-center px-4"><span className="text-3xl opacity-20 mb-2">🖱</span><p className="text-[#475569] text-[10px]">Click a widget on the canvas to edit its properties</p></div>);
  const { type, props: p, x, y } = widget;
  const set = useCallback((key, val) => {
    let newProps = { ...p, [key]: val };
    if (key === "width") { const maxW = canvasWidth - x; newProps.width = Math.min(maxW, Math.max(40, val)); }
    if (key === "height") { const maxH = canvasHeight - y; newProps.height = Math.min(maxH, Math.max(24, val)); }
    onChange({ ...widget, props: newProps });
  }, [widget, onChange, canvasWidth, canvasHeight, x, y, p]);
  const handleXChange = useCallback((v) => { const newX = Math.max(0, Math.min(snap(v), canvasWidth - p.width)); onChange({ ...widget, x: newX }); }, [widget, onChange, canvasWidth, p.width]);
  const handleYChange = useCallback((v) => { const newY = Math.max(0, Math.min(snap(v), canvasHeight - p.height)); onChange({ ...widget, y: newY }); }, [widget, onChange, canvasHeight, p.height]);
  return (<div className="flex flex-col h-full overflow-hidden"><div className="flex items-center justify-between px-3 py-2.5 border-b border-[#1E293B] shrink-0"><div className="flex items-center gap-2"><span className="text-base">{COMPONENT_TYPES.find(c => c.type === type)?.icon}</span><span className="text-white font-bold text-xs capitalize">{type}</span></div><div className="flex items-center gap-1"><button onClick={onDuplicate} title="Duplicate" className="w-6 h-6 rounded flex items-center justify-center text-[#475569] hover:text-[#3B82F6] hover:bg-[#1E3A5F] transition-colors"><IconDupe /></button><button onClick={onDelete} title="Delete" className="w-6 h-6 rounded flex items-center justify-center text-[#475569] hover:text-[#EF4444] hover:bg-[#7F1D1D]/20 transition-colors"><IconTrash /></button></div></div><div className="flex-1 overflow-y-auto px-3 flex flex-col gap-0" style={{ scrollbarWidth: "thin", scrollbarColor: "#334155 #0F172A" }}>
      <PropSection title="Position & Size"><div className="grid grid-cols-2 gap-2">
        <PropInput label="X" type="number" min={0} value={x} onChange={handleXChange} />
        <PropInput label="Y" type="number" min={0} value={y} onChange={handleYChange} />
        <PropInput label="Width" type="number" min={40} value={p.width} onChange={v => set("width", snap(v))} />
        <PropInput label="Height" type="number" min={24} value={p.height} onChange={v => set("height", snap(v))} />
      </div></PropSection>
      {type === "textbox" && <PropSection title="Text Box"><PropInput label="Field Key (unique)" value={p.fieldKey} onChange={v => set("fieldKey", v)} /><PropInput label="Label Text" value={p.label} onChange={v => set("label", v)} /><PropInput label="Placeholder" value={p.placeholder} onChange={v => set("placeholder", v)} /><PropInput label="Input Source" options={sourceOptions} value={p.source} onChange={v => set("source", v)} /><PropInput label="Show Label" type="checkbox" value={p.showLabel} onChange={v => set("showLabel", v)} /></PropSection>}
      {type === "label" && <PropSection title="Label"><PropInput label="Text" value={p.text} onChange={v => set("text", v)} /><PropInput label="Font Size" type="number" min={8} max={48} value={p.fontSize} onChange={v => set("fontSize", v)} /><PropInput label="Color" type="color" value={p.color} onChange={v => set("color", v)} /><PropInput label="Bold" type="checkbox" value={p.bold} onChange={v => set("bold", v)} /></PropSection>}
      {type === "button" && <PropSection title="Button"><PropInput label="Button Text" value={p.text} onChange={v => set("text", v)} /><PropInput label="Action" options={ACTION_OPTIONS} value={p.action} onChange={v => set("action", v)} />{p.action === "io_plc" && <PropInput label="PLC Address (e.g. Q0.0)" value={p.plcAddress} onChange={v => set("plcAddress", v)} />}{p.action === "custom" && <PropInput label="API Endpoint" value={p.apiEndpoint || ""} onChange={v => set("apiEndpoint", v)} />}<PropInput label="BG Color" type="color" value={p.color} onChange={v => set("color", v)} /><PropInput label="Text Color" type="color" value={p.textColor} onChange={v => set("textColor", v)} /></PropSection>}
      {type === "messagebox" && <PropSection title="Message Box"><PropInput label="Title" value={p.title} onChange={v => set("title", v)} /></PropSection>}
      {type === "picture" && <PropSection title="Picture"><PropInput label="Placeholder Text" value={p.placeholder} onChange={v => set("placeholder", v)} /></PropSection>}
      
      {/* 🛑 PERUBAHAN: Hapus sourceOptions dari ColumnEditor */}
      {type === "table" && (<PropSection title="Table"><PropInput label="Title" value={p.title} onChange={v => set("title", v)} /><ColumnEditor columns={p.columns || []} onChange={v => set("columns", v)} /></PropSection>)}
      
      {type === "instruction" && <PropSection title="Instruction Bar"><PropInput label="Default Text" value={p.defaultText} onChange={v => set("defaultText", v)} /></PropSection>}
      {type === "card" && <PropSection title="Card"><PropInput label="Title" value={p.title} onChange={v => set("title", v)} /></PropSection>}

      {type === "dropdown" && (<PropSection title="Dropdown"><PropInput label="Field Key (unique)" value={p.fieldKey} onChange={v => set("fieldKey", v)} /><PropInput label="Label Text" value={p.label} onChange={v => set("label", v)} /><PropInput label="Show Label" type="checkbox" value={p.showLabel} onChange={v => set("showLabel", v)} /><OptionsEditor options={p.options || []} onChange={v => set("options", v)} /></PropSection>)}
      {type === "checkbox" && (<PropSection title="Checkbox"><PropInput label="Field Key (unique)" value={p.fieldKey} onChange={v => set("fieldKey", v)} /><PropInput label="Label Text" value={p.label} onChange={v => set("label", v)} /></PropSection>)}

      {type === "gauge" && (<PropSection title="Gauge"><PropInput label="Field Key" value={p.fieldKey} onChange={v => set("fieldKey", v)} /><PropInput label="Title" value={p.title} onChange={v => set("title", v)} /><div className="grid grid-cols-2 gap-2"><PropInput label="Min" type="number" value={p.min} onChange={v => set("min", v)} /><PropInput label="Max" type="number" value={p.max} onChange={v => set("max", v)} /></div><PropInput label="Unit" value={p.unit} onChange={v => set("unit", v)} /><PropInput label="Color" type="color" value={p.color} onChange={v => set("color", v)} /></PropSection>)}
      {type === "progressbar" && (<PropSection title="Progress Bar"><PropInput label="Field Key" value={p.fieldKey} onChange={v => set("fieldKey", v)} /><PropInput label="Title" value={p.title} onChange={v => set("title", v)} /><div className="grid grid-cols-2 gap-2"><PropInput label="Min" type="number" value={p.min} onChange={v => set("min", v)} /><PropInput label="Max" type="number" value={p.max} onChange={v => set("max", v)} /></div><PropInput label="Unit" value={p.unit} onChange={v => set("unit", v)} /><PropInput label="Color" type="color" value={p.color} onChange={v => set("color", v)} /></PropSection>)}
      {type === "statuslight" && (<PropSection title="Status Light"><PropInput label="Field Key" value={p.fieldKey} onChange={v => set("fieldKey", v)} /><PropInput label="Title" value={p.title} onChange={v => set("title", v)} /><PropInput label="'On' Value (match)" value={p.onValue} onChange={v => set("onValue", v)} /><PropInput label="On Color" type="color" value={p.onColor} onChange={v => set("onColor", v)} /><PropInput label="Off Color" type="color" value={p.offColor} onChange={v => set("offColor", v)} /></PropSection>)}
      {type === "counter" && (<PropSection title="Counter"><PropInput label="Field Key" value={p.fieldKey} onChange={v => set("fieldKey", v)} /><PropInput label="Title" value={p.title} onChange={v => set("title", v)} /><PropInput label="Suffix (e.g. pcs)" value={p.suffix} onChange={v => set("suffix", v)} /><PropInput label="Color" type="color" value={p.color} onChange={v => set("color", v)} /></PropSection>)}

      {type === "chart" && (<PropSection title="Chart"><PropInput label="Title" value={p.title} onChange={v => set("title", v)} /><PropInput label="Chart Type" options={[{ value: "line", label: "Line" }, { value: "bar", label: "Bar" }, { value: "pie", label: "Pie" }]} value={p.chartType} onChange={v => set("chartType", v)} /><PropInput label="Data Source" options={[{ value: "static", label: "Static Data" }, { value: "field", label: "Bound Field (live)" }]} value={p.dataSource} onChange={v => set("dataSource", v)} />{p.dataSource === "field" ? (<PropInput label="Field Key (expects array)" value={p.fieldKey} onChange={v => set("fieldKey", v)} />) : (<ChartDataEditor data={p.staticData || []} onChange={v => set("staticData", v)} />)}<PropInput label="Color" type="color" value={p.color} onChange={v => set("color", v)} /></PropSection>)}

      {type === "clock" && (<PropSection title="Clock"><PropInput label="Format" options={[{ value: "24h", label: "24-hour" }, { value: "12h", label: "12-hour" }]} value={p.format} onChange={v => set("format", v)} /><PropInput label="Show Date" type="checkbox" value={p.showDate} onChange={v => set("showDate", v)} /><PropInput label="Color" type="color" value={p.color} onChange={v => set("color", v)} /></PropSection>)}
      {type === "divider" && (<PropSection title="Divider"><PropInput label="Orientation" options={[{ value: "horizontal", label: "Horizontal" }, { value: "vertical", label: "Vertical" }]} value={p.orientation} onChange={v => set("orientation", v)} /><PropInput label="Thickness (px)" type="number" min={1} max={20} value={p.thickness} onChange={v => set("thickness", v)} /><PropInput label="Color" type="color" value={p.color} onChange={v => set("color", v)} /></PropSection>)}
      {type === "qrcode" && (<PropSection title="QR Code"><PropInput label="Data Source" options={[{ value: "static", label: "Static Text" }, { value: "field", label: "Bound Field" }]} value={p.dataSource} onChange={v => set("dataSource", v)} />{p.dataSource === "field" ? (<PropInput label="Field Key" value={p.fieldKey} onChange={v => set("fieldKey", v)} />) : (<PropInput label="Static Value" value={p.staticValue} onChange={v => set("staticValue", v)} />)}</PropSection>)}
    </div></div>);
}

export default function PageBuilder({ cpNumber, onClose }) {
  const [canvasPreset, setCanvasPreset] = useState(CANVAS_PRESETS[0]);
  const CANVAS_W = canvasPreset.width, CANVAS_H = canvasPreset.height;
  const [widgets, setWidgets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [dragInfo, setDragInfo] = useState(null);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState("");
  const [resizing, setResizing] = useState(null);
  const canvasRef = useRef(null);
  const canvasContainerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [sourceOptions, setSourceOptions] = useState([]);

  useEffect(() => {
    fetch(`${API}/api/rs232/devices`)
      .then(res => res.json())
      .then(data => {
        const devices = data.devices || [];
        const options = devices.map(d => ({ value: d.name, label: d.name }));
        options.push({ value: "manual", label: "Manual Input" });
        options.push({ value: "readonly", label: "Read Only (display)" });
        setSourceOptions(options);
      })
      .catch(err => console.error("Failed to load RS232 devices:", err));
  }, []);

  useEffect(() => {
    if (!cpNumber) { setLoading(false); return; }
    fetch(`${API}/api/page-config/${cpNumber}`)
      .then(r => r.ok ? r.json() : { widgets: [] })
      .then(d => { setWidgets(d.widgets || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [cpNumber]);

  useEffect(() => {
    const updateScale = () => {
      if (canvasContainerRef.current) {
        const availableWidth = canvasContainerRef.current.clientWidth;
        let newScale = Math.max(0.4, Math.min(1, availableWidth / CANVAS_W));
        setScale(newScale);
      }
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [CANVAS_W]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selected && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        setWidgets(ws => ws.filter(w => w.id !== selected));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected]);

  const handleCanvasDrop = useCallback((e) => {
    e.preventDefault();
    const typeData = e.dataTransfer.getData("component-type");
    if (!typeData) return;
    const def = COMPONENT_TYPES.find(c => c.type === typeData);
    if (!def) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaledX = (e.clientX - rect.left) / scale;
    const scaledY = (e.clientY - rect.top) / scale;
    let x = snap(scaledX - (def.defaultProps.width / 2 || 60));
    let y = snap(scaledY - (def.defaultProps.height / 2 || 20));
    x = Math.max(0, Math.min(x, CANVAS_W - def.defaultProps.width));
    y = Math.max(0, Math.min(y, CANVAS_H - def.defaultProps.height));
    const id = uid();
    const needsFieldKey = Object.prototype.hasOwnProperty.call(def.defaultProps, "fieldKey");
    setWidgets(ws => [...ws, { id, type: def.type, x, y, props: { ...def.defaultProps, ...(needsFieldKey ? { fieldKey: `field_${id}` } : {}), width: Math.min(def.defaultProps.width, CANVAS_W - x), height: Math.min(def.defaultProps.height, CANVAS_H - y) } }]);
    setSelected(id);
  }, [scale, CANVAS_W, CANVAS_H]);

  const startDrag = useCallback((e, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const w = document.getElementById(`widget-${id}`);
    if (!w) return;
    const rect = w.getBoundingClientRect();
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const offsetX = (e.clientX - rect.left) / scale;
    const offsetY = (e.clientY - rect.top) / scale;
    setDragInfo({ id, offsetX, offsetY });
    setSelected(id);
  }, [scale]);

  useEffect(() => {
    if (!dragInfo) return;
    const onMove = (e) => {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const mouseX = (e.clientX - canvasRect.left) / scale;
      const mouseY = (e.clientY - canvasRect.top) / scale;
      let newX = snap(mouseX - dragInfo.offsetX);
      let newY = snap(mouseY - dragInfo.offsetY);
      setWidgets(ws => {
        const widget = ws.find(w => w.id === dragInfo.id);
        if (!widget) return ws;
        const maxX = CANVAS_W - widget.props.width;
        const maxY = CANVAS_H - widget.props.height;
        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));
        return ws.map(w => w.id === dragInfo.id ? { ...w, x: newX, y: newY } : w);
      });
    };
    const onUp = () => setDragInfo(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragInfo, scale, CANVAS_W, CANVAS_H]);

  const startResize = useCallback((e, id) => {
    e.stopPropagation(); e.preventDefault();
    const widget = widgets.find(w => w.id === id);
    if (!widget) return;
    setResizing({ id, startX: e.clientX, startY: e.clientY, startW: widget.props.width, startH: widget.props.height });
  }, [widgets]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e) => {
      const dw = (e.clientX - resizing.startX) / scale;
      const dh = (e.clientY - resizing.startY) / scale;
      setWidgets(ws => ws.map(w => {
        if (w.id !== resizing.id) return w;
        const newW = Math.max(40, snap(resizing.startW + dw));
        const newH = Math.max(24, snap(resizing.startH + dh));
        const maxW = CANVAS_W - w.x;
        const maxH = CANVAS_H - w.y;
        return { ...w, props: { ...w.props, width: Math.min(newW, maxW), height: Math.min(newH, maxH) } };
      }));
    };
    const onUp = () => setResizing(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [resizing, scale, CANVAS_W, CANVAS_H]);

  const save = useCallback(async () => {
    setSaving(true); setSaveMsg("");
    try {
      const r = await fetch(`${API}/api/page-config/${cpNumber}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ widgets }) });
      const d = await r.json();
      if (d.success) setSaveMsg("✓ Saved!"); else setSaveMsg("✗ Save failed");
    } catch { setSaveMsg("✗ Network error"); }
    setSaving(false);
    setTimeout(() => setSaveMsg(""), 3000);
  }, [cpNumber, widgets]);

  const clearCanvas = useCallback(() => { setWidgets([]); setSelected(null); }, []);
  const selectedWidget = useMemo(() => widgets.find(w => w.id === selected) || null, [widgets, selected]);
  const filteredPalette = useMemo(() => COMPONENT_TYPES.filter(c => c.label.toLowerCase().includes(paletteSearch.toLowerCase()) || c.desc.toLowerCase().includes(paletteSearch.toLowerCase())), [paletteSearch]);

  const displayWidth = CANVAS_W * scale;
  const displayHeight = CANVAS_H * scale;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm font-sans">
      <div className="flex flex-col rounded-2xl overflow-hidden border border-[#334155] shadow-2xl" style={{ width: "min(98vw, 1800px)", height: "min(96vh, 900px)", background: "#0B1120" }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#1E293B] shrink-0" style={{ background: "#111827" }}>
          <div className="flex items-center gap-3">
            <span className="text-[#22C55E] font-black text-lg tracking-tighter">WIK</span>
            <div className="w-px h-5 bg-[#334155]" />
            <span className="text-white font-bold text-sm">Page Builder</span>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30">CP{String(cpNumber).padStart(2,"0")}</span>
          </div>
          <div className="flex items-center gap-2">
            <select value={canvasPreset.width} onChange={e => { const newPreset = CANVAS_PRESETS.find(p => p.width === Number(e.target.value)); if (newPreset) setCanvasPreset(newPreset); }} className="bg-[#1E293B] border border-[#334155] text-white text-[10px] rounded px-2 h-7 outline-none cursor-pointer">{CANVAS_PRESETS.map(p => (<option key={p.width} value={p.width}>{p.label}</option>))}</select>
            {saveMsg && <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${saveMsg.startsWith("✓") ? "text-[#22C55E] bg-[#22C55E]/10" : "text-[#EF4444] bg-[#EF4444]/10"}`}>{saveMsg}</span>}
            <button onClick={clearCanvas} className="h-7 px-3 rounded-lg border border-[#334155] text-[#94A3B8] hover:bg-[#1E293B] text-[10px] font-bold transition-colors">Clear</button>
            <button onClick={save} disabled={saving} className="h-7 px-4 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] font-bold text-[10px] transition-colors disabled:opacity-50 flex items-center gap-1.5">{saving ? <><div className="w-3 h-3 border-2 border-[#052E16] border-t-transparent rounded-full animate-spin" /> Saving…</> : "💾 Save Layout"}</button>
            <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-[#475569] hover:text-white hover:bg-[#1E293B] transition-colors"><IconX /></button>
          </div>
        </div>
        <div className="flex flex-1 overflow-hidden min-h-0">
          <div className="w-68 shrink-0 border-r border-[#1E293B] flex flex-col" style={{ background: "#0F172A" }}>
            <div className="px-3 pt-3 pb-2 shrink-0"><p className="text-[#22C55E] text-[9px] font-bold uppercase tracking-widest mb-2">Components</p><input value={paletteSearch} onChange={e => setPaletteSearch(e.target.value)} placeholder="Search…" className="w-full bg-[#1E293B] border border-[#334155] text-white text-[10px] rounded-lg px-2 h-7 outline-none placeholder-[#334155] focus:border-[#22C55E]/50" /></div>
            <div className="flex-1 overflow-y-auto px-2 pb-3 flex flex-col gap-1" style={{ scrollbarWidth: "thin", scrollbarColor: "#334155 #0F172A" }}>{filteredPalette.map(comp => (<div key={comp.type} draggable onDragStart={e => e.dataTransfer.setData("component-type", comp.type)} className="flex items-center gap-2 px-2 py-2 rounded-lg border border-[#1E293B] hover:border-[#22C55E]/40 hover:bg-[#1E293B] cursor-grab active:cursor-grabbing transition-colors group"><span className="text-base w-6 text-center shrink-0">{comp.icon}</span><div className="flex flex-col min-w-0"><span className="text-white text-[10px] font-semibold leading-tight">{comp.label}</span><span className="text-[#475569] text-[8px] leading-tight truncate">{comp.desc}</span></div></div>))}</div>
          </div>
          <div ref={canvasContainerRef} className="flex-1 overflow-hidden min-h-0 flex items-center justify-center px-8 py-4" style={{ background: "#080E1A" }}>
            {loading ? (<div className="flex items-center gap-2 text-[#22C55E] text-xs mt-20"><div className="w-4 h-4 border-2 border-[#22C55E] border-t-transparent rounded-full animate-spin" /> Loading layout…</div>) : (
              <div style={{ width: displayWidth, height: displayHeight, position: 'relative' }}>
                <div ref={canvasRef} onDragOver={e => e.preventDefault()} onDrop={handleCanvasDrop} onClick={() => setSelected(null)} className="relative origin-top-left" style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})`, background: "#0F172A", border: "1px solid #1E293B", borderRadius: 8, backgroundImage: "radial-gradient(circle, #1E293B 1px, transparent 1px)", backgroundSize: `${GRID * 2}px ${GRID * 2}px` }}>
                  {widgets.length === 0 && (<div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none"><span className="text-4xl opacity-10 mb-2">🖱</span><p className="text-[#1E293B] text-sm font-mono">Drag components here</p></div>)}
                  {widgets.map(widget => {
                    const isSel = widget.id === selected;
                    return (<div key={widget.id} id={`widget-${widget.id}`} onMouseDown={e => startDrag(e, widget.id)} onClick={e => { e.stopPropagation(); setSelected(widget.id); }} className="absolute select-none" style={{ left: widget.x, top: widget.y, width: widget.props.width, height: widget.props.height, cursor: dragInfo?.id === widget.id ? "grabbing" : "grab", outline: isSel ? "2px solid #22C55E" : "1px solid transparent", outlineOffset: 2, borderRadius: 6, zIndex: isSel ? 10 : 1 }}><div className="w-full h-full overflow-hidden" style={{ borderRadius: 6 }}><WidgetPreview widget={widget} /></div>{isSel && <div className="absolute -top-5 left-0 flex items-center gap-1 pointer-events-none"><span className="text-[#22C55E] text-[9px] font-bold bg-[#0B1120] px-1.5 py-0.5 rounded font-mono capitalize">{widget.type}</span></div>}{isSel && <div onMouseDown={e => startResize(e, widget.id)} className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize" style={{ background: "#22C55E", borderRadius: "2px 0 4px 0", zIndex: 20 }} />}</div>);
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="w-74 shrink-0 border-l border-[#1E293B] flex flex-col" style={{ background: "#0F172A" }}>
            <PropertyPanel
              widget={selectedWidget}
              onChange={updated => setWidgets(ws => ws.map(w => w.id === updated.id ? updated : w))}
              onDelete={() => { setWidgets(ws => ws.filter(w => w.id !== selected)); setSelected(null); }}
              onDuplicate={() => { if (!selectedWidget) return; const newId = uid(); let newX = selectedWidget.x + 16, newY = selectedWidget.y + 16; const maxX = CANVAS_W - selectedWidget.props.width, maxY = CANVAS_H - selectedWidget.props.height; newX = Math.min(newX, maxX); newY = Math.min(newY, maxY); const clone = { ...selectedWidget, id: newId, x: newX, y: newY }; setWidgets(ws => [...ws, clone]); setSelected(newId); }}
              canvasWidth={CANVAS_W}
              canvasHeight={CANVAS_H}
              sourceOptions={sourceOptions}
            />
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-[#1E293B] shrink-0" style={{ background: "#080E1A" }}>
          <span className="text-[#334155] text-[9px] font-mono">{widgets.length} widget{widgets.length !== 1 ? "s" : ""} · Canvas {CANVAS_W}×{CANVAS_H}px · Grid {GRID}px</span>
          {selectedWidget && <span className="text-[#475569] text-[9px] font-mono">x:{selectedWidget.x} y:{selectedWidget.y} · {selectedWidget.props.width}×{selectedWidget.props.height}</span>}
          <span className="text-[#334155] text-[9px] font-mono">Del = delete · drag to move · ↘ to resize</span>
        </div>
      </div>
    </div>
  );
}