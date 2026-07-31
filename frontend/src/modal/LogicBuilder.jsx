// src/modal/LogicBuilder.jsx
import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react";
import { API } from "../service/api";

// ── Node type definitions ─────────────────────────────────────────────────────
const NODE_TYPES = [
  // Triggers
  { type: "scan_input", category: "trigger", color: "#3B82F6", icon: "📡", label: "Scan Input", desc: "Scanner trigger (Product/Part)" },
  // Checks
  { type: "check_cp", category: "check", color: "#F97316", icon: "📍", label: "Check CP", desc: "Is SN for this CP?" },
  { type: "check_duplicate_sn", category: "check", color: "#EF4444", icon: "🔁", label: "Duplicate SN", desc: "Check if SN already processed" },
  { type: "check_duplicate_part", category: "check", color: "#EF4444", icon: "🔁", label: "Duplicate Part", desc: "Check if Part already used" },
  { type: "check_voltage", category: "check", color: "#EF4444", icon: "⚡", label: "Check Voltage", desc: "Match Part voltage vs Product" },
  { type: "check_variable", category: "check", color: "#8B5CF6", icon: "🔒", label: "Sequence Guard", desc: "Check if a field has a value" },
  // Data
  { type: "db_query", category: "data", color: "#8B5CF6", icon: "🗄", label: "DB Query", desc: "Query MySQL table" },
  { type: "parse_sn", category: "data", color: "#8B5CF6", icon: "🔍", label: "Parse SN", desc: "Parse fields from SN string" },
  // Actions
  { type: "update_field", category: "action", color: "#22C55E", icon: "✏", label: "Update Field", desc: "Set a textbox value" },
  { type: "update_table", category: "action", color: "#22C55E", icon: "⊞", label: "Update Table", desc: "Add/update a table row" },
  { type: "update_instruction", category: "action", color: "#22C55E", icon: "💬", label: "Update Instruction", desc: "Change instruction bar text" },
  { type: "log_message", category: "action", color: "#94A3B8", icon: "📝", label: "Log Message", desc: "Write to message box" },
  { type: "submit_move", category: "action", color: "#22C55E", icon: "✅", label: "Submit / Move", desc: "Save record & complete step" },
];

const CATEGORY_COLORS = {
  trigger: "#1E3A5F",
  check: "#3B1F1F",
  data: "#2D1B69",
  action: "#14532D",
};

const CATEGORY_LABELS = {
  trigger: "Triggers",
  check: "Checks",
  data: "Data",
  action: "Actions",
};

let _nid = 1;
const nid = () => `n${Date.now()}_${_nid++}`;

function IconX() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconTrash() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" /></svg>; }
function IconPlus() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>; }

// ── Node default configs ──────────────────────────────────────────────────────
const DEFAULT_NODE_CONFIG = {
  scan_input: { device: "Product", fieldKey: "" },
  check_cp: { cp_number: "", sn_table: "traceability", sn_col: "chassis_sn", cp_col: "cp_number", sn_source: "product_sn" },
  check_duplicate_sn: { sn_table: "traceability", sn_col: "chassis_sn", cp_col: "cp_number", sn_source: "product_sn" },
  check_duplicate_part: { part_table: "traceability", part_col: "main_pcba", part_source: "part_sn" },
  
  // 💡 FULLY CONFIGURABLE CHECK VOLTAGE DEFAULT
  check_voltage: { 
    product_field: "product_sn", 
    part_sn_field: "part_sn",
    product_mapping_section: "SN Chassis Mapping",
    product_mapping_field: "Product Matrix",
    rule_table_section: "Product Rules",
    rule_key_column: "Product",
    rule_value_column: "Part Voltage",
    part_mapping_section: "Product Matrix Mapping",
    part_mapping_field: "Voltage"
  },
  
  check_variable: { target_field: "", condition: "exists", expected_value: "" },
  db_query: { table: "production_orders", key_col: "product", key_source: "product_matrix", fields: [] },
  parse_sn: { source_field: "part_sn", use_setting: "Product Matrix Mapping" },
  update_field: { target_field: "", value_source: "" },
  update_table: { table_widget: "", columns: [] },
  update_instruction: { text: "", source: "static", widget: "", color: "blue" },
  log_message: { message: "", color: "#22C55E", source: "static" },
  submit_move: { table: "traceability", fields_map: [] },
};

// ── Node card component (Dibungkus memo) ─────────────────────────────────────
const NodeCard = memo(function NodeCard({ node, selected, onSelect, onDragStart, onDelete, onPortMouseDown, onPortMouseUp }) {
  const def = NODE_TYPES.find(t => t.type === node.type);
  if (!def) return null;

  const hasTrue = ["check_cp", "check_duplicate_sn", "check_duplicate_part", "check_voltage", "check_variable"].includes(node.type);
  const hasFalse = hasTrue;

  return (
    <div
      id={`node-${node.id}`}
      onClick={e => { e.stopPropagation(); onSelect(node.id); }}
      className="absolute select-none cursor-default"
      style={{ left: node.x, top: node.y, width: 180, zIndex: selected ? 10 : 1 }}
    >
      <div className="rounded-xl overflow-hidden border-2 transition-all shadow-lg" style={{ borderColor: selected ? def.color : "#334155", background: CATEGORY_COLORS[def.category] || "#1E293B", boxShadow: selected ? `0 0 0 2px ${def.color}40` : "none" }}>
        <div className="flex items-center gap-2 px-3 py-2 cursor-grab active:cursor-grabbing" style={{ background: def.color + "22" }} onMouseDown={e => { e.stopPropagation(); onDragStart(e, node.id); }}>
          <span className="text-base leading-none">{def.icon}</span>
          <span className="text-white text-[11px] font-bold leading-tight flex-1">{def.label}</span>
          <button onMouseDown={e => { e.stopPropagation(); onDelete(node.id); }} className="w-5 h-5 rounded flex items-center justify-center text-[#475569] hover:text-[#EF4444] transition-colors"><IconTrash /></button>
        </div>
        <div className="px-3 py-1.5"><NodeSummary node={node} /></div>
      </div>

      <div onMouseUp={e => { e.stopPropagation(); onPortMouseUp(node.id, "in"); }} className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-[#475569] hover:border-[#22C55E] bg-[#0B1120] cursor-crosshair transition-colors z-20" />
      {hasTrue && (<div className="absolute -bottom-2 left-1/4 -translate-x-1/2 flex flex-col items-center z-20"><div onMouseDown={e => { e.stopPropagation(); onPortMouseDown(e, node.id, "true"); }} className="w-4 h-4 rounded-full border-2 border-[#22C55E] bg-[#0B1120] cursor-crosshair hover:bg-[#22C55E]/30" /><span className="text-[8px] text-[#22C55E] font-bold mt-0.5">✓</span></div>)}
      {hasTrue && (<div className="absolute -bottom-2 left-3/4 -translate-x-1/2 flex flex-col items-center z-20"><div onMouseDown={e => { e.stopPropagation(); onPortMouseDown(e, node.id, "false"); }} className="w-4 h-4 rounded-full border-2 border-[#EF4444] bg-[#0B1120] cursor-crosshair hover:bg-[#EF4444]/30" /><span className="text-[8px] text-[#EF4444] font-bold mt-0.5">✗</span></div>)}
      {!hasTrue && (<div className="absolute -bottom-2 left-1/2 -translate-x-1/2 z-20"><div onMouseDown={e => { e.stopPropagation(); onPortMouseDown(e, node.id, "next"); }} className="w-4 h-4 rounded-full border-2 border-[#94A3B8] bg-[#0B1120] cursor-crosshair hover:border-[#22C55E]" /></div>)}
    </div>
  );
});

const NodeSummary = memo(function NodeSummary({ node }) {
  const c = node.config || {};
  const style = { color: "#64748B", fontSize: 9 };
  if (node.type === "scan_input") return <p style={style}>Device: <b style={{ color: "#94A3B8" }}>{c.device || "?"}</b></p>;
  if (node.type === "check_cp") return <p style={style}>Table: <b style={{ color: "#94A3B8" }}>{c.sn_table || "?"}</b></p>;
  if (node.type === "check_duplicate_sn") return <p style={style}>Table: <b style={{ color: "#94A3B8" }}>{c.sn_table || "?"}</b></p>;
  if (node.type === "check_duplicate_part") return <p style={style}>Table: <b style={{ color: "#94A3B8" }}>{c.part_table || "?"}</b></p>;
  if (node.type === "check_voltage") return <p style={style}>Map: {c.product_mapping_section || "?"}</p>;
  if (node.type === "check_variable") return <p style={style}>Check: <b style={{ color: "#94A3B8" }}>{c.target_field || "?"}</b> {c.condition}</p>;
  if (node.type === "db_query") return <p style={style}>{c.table || "?"} → {c.fields?.length || 0} fields</p>;
  if (node.type === "parse_sn") return <p style={style}>From: <b style={{ color: "#94A3B8" }}>{c.source_field || "?"}</b></p>;
  if (node.type === "update_field") return <p style={style}>→ <b style={{ color: "#94A3B8" }}>{c.target_field || "?"}</b></p>;
  if (node.type === "update_table") return <p style={style}>Table: <b style={{ color: "#94A3B8" }}>{c.table_widget || "?"}</b></p>;
  if (node.type === "update_instruction") return <p style={style}>{c.source === "static" ? `"${(c.text || "").slice(0, 20)}"` : `from: ${c.source}`}</p>;
  if (node.type === "log_message") return <p style={style}>{c.source === "static" ? `"${(c.message || "").slice(0, 20)}"` : `from: ${c.source}`}</p>;
  if (node.type === "submit_move") return <p style={style}>→ {c.table || "?"}</p>;
  return null;
});

const Field = ({ label, children }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[9px] font-bold text-[#475569] uppercase tracking-wider">{label}</span>
    {children}
  </div>
);
const Input = ({ value, onChange: oc, placeholder = "" }) => (
  <input value={value ?? ""} onChange={e => oc(e.target.value)} placeholder={placeholder}
    className="bg-[#0F172A] border border-[#334155] text-white text-[10px] rounded px-2 h-7 outline-none focus:border-[#22C55E]/60" />
);
const Select = ({ value, onChange: oc, options }) => (
  <select value={value ?? ""} onChange={e => oc(e.target.value)}
    className="bg-[#0F172A] border border-[#334155] text-white text-[10px] rounded px-2 h-7 outline-none focus:border-[#22C55E]/60">
    {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
  </select>
);

// ── Property Panel ──────────────────────────────────────────────
const ConfigPanel = memo(function ConfigPanel({ node, onChange, commDevices, cpNumber, onApply, settingsSchema }) {
  const [localConfig, setLocalConfig] = useState({});

  useEffect(() => {
    setLocalConfig(node?.config || {});
  }, [node?.id]);

  if (!node) return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <span className="text-3xl opacity-20 mb-2">🖱</span>
      <p className="text-[#475569] text-[10px]">Click a node to configure it</p>
    </div>
  );

  const def = NODE_TYPES.find(t => t.type === node.type);
  const c = localConfig;

  const setLocal = (key, val) => {
    setLocalConfig(prev => ({ ...prev, [key]: val }));
  };

  const applyChanges = () => {
    onChange({ ...node, config: localConfig });
    if (onApply) onApply();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#1E293B] shrink-0">
        <span className="text-base">{def?.icon}</span>
        <span className="text-white font-bold text-xs">{def?.label}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3" style={{ scrollbarWidth: "thin", scrollbarColor: "#334155 #0F172A" }}>
        {node.type === "scan_input" && (<>
          <Field label="Scanner Device">
            <Select value={c.device} onChange={v => setLocal("device", v)} options={[{ value: "", label: "Select device…" }, ...commDevices.map(d => ({ value: d.name, label: `${d.name} (${d.port || ""})` }))]} />
          </Field>
          <Field label="Store result in field key"><Input value={c.fieldKey} onChange={v => setLocal("fieldKey", v)} placeholder="e.g. product_sn" /></Field>
        </>)}

        {node.type === "check_cp" && (<>
          <Field label="This CP Number"><Input value={c.cp_number || cpNumber} onChange={v => setLocal("cp_number", v)} placeholder={cpNumber} /></Field>
          <Field label="SN Table (MySQL)"><Input value={c.sn_table} onChange={v => setLocal("sn_table", v)} placeholder="traceability" /></Field>
          <Field label="SN Column"><Input value={c.sn_col} onChange={v => setLocal("sn_col", v)} placeholder="chassis_sn" /></Field>
          <Field label="CP Column"><Input value={c.cp_col} onChange={v => setLocal("cp_col", v)} placeholder="cp_number" /></Field>
          <Field label="SN source field key"><Input value={c.sn_source} onChange={v => setLocal("sn_source", v)} placeholder="product_sn" /></Field>
        </>)}

        {node.type === "check_duplicate_sn" && (<>
          <Field label="SN Table (MySQL)"><Input value={c.sn_table} onChange={v => setLocal("sn_table", v)} placeholder="traceability" /></Field>
          <Field label="SN Column"><Input value={c.sn_col} onChange={v => setLocal("sn_col", v)} placeholder="chassis_sn" /></Field>
          <Field label="CP Column"><Input value={c.cp_col} onChange={v => setLocal("cp_col", v)} placeholder="cp_number" /></Field>
          <Field label="SN source field key"><Input value={c.sn_source} onChange={v => setLocal("sn_source", v)} placeholder="product_sn" /></Field>
        </>)}

        {node.type === "check_duplicate_part" && (<>
          <Field label="Part Table (MySQL)"><Input value={c.part_table} onChange={v => setLocal("part_table", v)} placeholder="traceability" /></Field>
          <Field label="Part Column"><Input value={c.part_col} onChange={v => setLocal("part_col", v)} placeholder="main_pcba" /></Field>
          <Field label="Part SN source field key"><Input value={c.part_source} onChange={v => setLocal("part_source", v)} placeholder="part_sn" /></Field>
        </>)}

        {/* 🔥 CONFIGURABLE CHECK VOLTAGE PANEL - Urutan sudah diperbaiki sesuai keinginan Anda */}
        {node.type === "check_voltage" && (<>
          <div className="flex flex-col gap-3 pb-3 mb-1 border-b border-[#1E293B]">
            <p className="text-[#22C55E] text-[10px] font-bold">Step 1: Product Code Lookup</p>
            <Field label="Product Mapping Section">
              <Select value={c.product_mapping_section} onChange={v => setLocal("product_mapping_section", v)}
                options={settingsSchema.sections.map(s => ({ value: s, label: s }))} />
            </Field>
            <Field label="Product Mapping Field (range)">
              <Select value={c.product_mapping_field} onChange={v => setLocal("product_mapping_field", v)}
                options={(settingsSchema.section_fields[c.product_mapping_section] || []).map(f => ({ value: f, label: f }))} />
            </Field>
          </div>

          <div className="flex flex-col gap-3 pb-3 mb-1 border-b border-[#1E293B]">
            <p className="text-[#22C55E] text-[10px] font-bold">Step 2: Actual Part Voltage</p>
            <Field label="Part Mapping Section">
              <Select value={c.part_mapping_section} onChange={v => setLocal("part_mapping_section", v)}
                options={settingsSchema.sections.map(s => ({ value: s, label: s }))} />
            </Field>
            <Field label="Part Mapping Field (range)">
              <Select value={c.part_mapping_field} onChange={v => setLocal("part_mapping_field", v)}
                options={(settingsSchema.section_fields[c.part_mapping_section] || []).map(f => ({ value: f, label: f }))} />
            </Field>
          </div>

          <div className="flex flex-col gap-3 pb-3 mb-1 border-b border-[#1E293B]">
            <p className="text-[#22C55E] text-[10px] font-bold">Step 3: Required Voltage Lookup</p>
            <Field label="Rules Section (with _table)">
              <Select value={c.rule_table_section} onChange={v => setLocal("rule_table_section", v)}
                options={settingsSchema.tables.map(t => ({ value: t, label: t }))} />
            </Field>
            <Field label="Key Column (Product Code)">
              <Select value={c.rule_key_column} onChange={v => setLocal("rule_key_column", v)}
                options={(settingsSchema.table_columns[c.rule_table_section] || []).map(col => ({ value: col, label: col }))} />
            </Field>
            <Field label="Value Column (Required Voltage)">
              <Select value={c.rule_value_column} onChange={v => setLocal("rule_value_column", v)}
                options={(settingsSchema.table_columns[c.rule_table_section] || []).map(col => ({ value: col, label: col }))} />
            </Field>
          </div>
          
          <div className="flex flex-col gap-3">
            <Field label="Product SN Field Key (UI Textbox)">
              <Input value={c.product_field} onChange={v => setLocal("product_field", v)} placeholder="e.g. product_sn" />
            </Field>
            <Field label="Part SN Field Key (UI Textbox)">
              <Input value={c.part_sn_field} onChange={v => setLocal("part_sn_field", v)} placeholder="e.g. part_sn" />
            </Field>
          </div>
        </>)}

        {/* ✅ SEQUENCE GUARD CONFIG */}
        {node.type === "check_variable" && (<>
          <Field label="Target Widget ID / Field Key to Check">
            <Input value={c.target_field} onChange={v => setLocal("target_field", v)} placeholder="e.g. chassis_sn" />
          </Field>
          <Field label="Condition">
            <Select value={c.condition} onChange={v => setLocal("condition", v)} options={[
              { value: "exists", label: "Exists / Has value" },
              { value: "not_exists", label: "Not Exists / Is empty" },
              { value: "equals", label: "Equals exact value" },
            ]} />
          </Field>
          {c.condition === "equals" && (
            <Field label="Expected Value">
              <Input value={c.expected_value} onChange={v => setLocal("expected_value", v)} />
            </Field>
          )}
          <p className="text-[#475569] text-[9px] mt-1">
            If condition passes → follow <b style={{ color: "#22C55E" }}>Green (True)</b>. If fails → follow <b style={{ color: "#EF4444" }}>Red (False)</b>.
          </p>
        </>)}

        {node.type === "db_query" && (<>
          <Field label="MySQL Table"><Input value={c.table} onChange={v => setLocal("table", v)} placeholder="production_orders" /></Field>
          <Field label="Key Column (WHERE)"><Input value={c.key_col} onChange={v => setLocal("key_col", v)} placeholder="product_code" /></Field>
          <Field label="Key value from field key"><Input value={c.key_source} onChange={v => setLocal("key_source", v)} placeholder="product_matrix" /></Field>
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-bold text-[#475569] uppercase tracking-wider">Fields to fetch</span>
            {(c.fields || []).map((f, i) => (
              <div key={i} className="flex gap-1 items-center">
                <Input value={f.col} onChange={v => { const nf = [...c.fields]; nf[i] = { ...nf[i], col: v }; setLocal("fields", nf); }} placeholder="db_column" />
                <span className="text-[#475569] text-[9px]">→</span>
                <Input value={f.target} onChange={v => { const nf = [...c.fields]; nf[i] = { ...nf[i], target: v }; setLocal("fields", nf); }} placeholder="field_key" />
                <button onClick={() => setLocal("fields", c.fields.filter((_, j) => j !== i))} className="text-[#EF4444] hover:text-white p-0.5 shrink-0"><IconX /></button>
              </div>
            ))}
            <button onClick={() => setLocal("fields", [...(c.fields || []), { col: "", target: "" }])} className="text-[10px] text-[#22C55E] hover:text-white text-left flex items-center gap-1 mt-0.5"><IconPlus /> Add field mapping</button>
          </div>
        </>)}

        {node.type === "parse_sn" && (<>
          <Field label="Source field key (SN to parse)"><Input value={c.source_field} onChange={v => setLocal("source_field", v)} placeholder="part_sn" /></Field>
          <Field label="Mapping from setting.json">
            <Select value={c.use_setting} onChange={v => setLocal("use_setting", v)} options={[{ value: "Product Matrix Mapping", label: "Product Matrix Mapping (Part SN)" }, { value: "SN Chassis Mapping", label: "SN Chassis Mapping (Product SN)" }]} />
          </Field>
        </>)}

        {node.type === "update_field" && (<>
          <Field label="Target field key (textbox)"><Input value={c.target_field} onChange={v => setLocal("target_field", v)} placeholder="e.g. po_number" /></Field>
          <Field label="Value source">
            <Select value={c.source} onChange={v => setLocal("source", v)} options={[{ value: "static", label: "Static text" }, { value: "field_key", label: "From another field key" }, { value: "db_result", label: "From DB query result" }]} />
          </Field>
          {c.source === "static" && <Field label="Static value"><Input value={c.value} onChange={v => setLocal("value", v)} /></Field>}
          {c.source === "field_key" && <Field label="Source field key"><Input value={c.value_source} onChange={v => setLocal("value_source", v)} /></Field>}
        </>)}

        {node.type === "update_table" && (<>
          <Field label="Table widget ID (from Page Builder)"><Input value={c.table_widget} onChange={v => setLocal("table_widget", v)} placeholder="widget id or title" /></Field>
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-bold text-[#475569] uppercase tracking-wider">Column → value mapping</span>
            {(c.columns || []).map((col, i) => (
              <div key={i} className="flex gap-1 items-center">
                <Input value={col.header} onChange={v => { const nc = [...c.columns]; nc[i] = { ...nc[i], header: v }; setLocal("columns", nc); }} placeholder="Column header" />
                <span className="text-[#475569] text-[9px]">←</span>
                <Input value={col.source} onChange={v => { const nc = [...c.columns]; nc[i] = { ...nc[i], source: v }; setLocal("columns", nc); }} placeholder="field_key" />
                <button onClick={() => setLocal("columns", c.columns.filter((_, j) => j !== i))} className="text-[#EF4444] hover:text-white p-0.5 shrink-0"><IconX /></button>
              </div>
            ))}
            <button onClick={() => setLocal("columns", [...(c.columns || []), { header: "", source: "" }])} className="text-[10px] text-[#22C55E] hover:text-white text-left flex items-center gap-1 mt-0.5"><IconPlus /> Add column mapping</button>
          </div>
        </>)}

        {node.type === "update_instruction" && (<>
          <Field label="Target Instruction Widget ID">
            <Input value={c.widget} onChange={v => setLocal("widget", v)} placeholder="e.g. instruction_1" />
          </Field>
          <Field label="Text source">
            <Select value={c.source} onChange={v => setLocal("source", v)} options={[
              { value: "static", label: "Static text" },
              { value: "field_key", label: "From field key" },
              { value: "pass", label: "PASS" },
            ]} />
          </Field>
          {c.source === "static" && <Field label="Text"><Input value={c.text} onChange={v => setLocal("text", v)} placeholder="e.g. Please Scan Part SN" /></Field>}
          {c.source === "field_key" && <Field label="Field key"><Input value={c.field_key} onChange={v => setLocal("field_key", v)} /></Field>}
          <Field label="Color"><Select value={c.color || "blue"} onChange={v => setLocal("color", v)} options={[{ value: "blue", label: "Blue (instruction)" }, { value: "green", label: "Green (OK)" }, { value: "red", label: "Red (error)" }]} /></Field>
        </>)}

        {node.type === "log_message" && (<>
          <Field label="Message source">
            <Select value={c.source} onChange={v => setLocal("source", v)} options={[{ value: "static", label: "Static text" }, { value: "field_key", label: "From field key" }, { value: "result", label: "From previous node result" }]} />
          </Field>
          {c.source === "static" && <Field label="Message"><Input value={c.message} onChange={v => setLocal("message", v)} /></Field>}
          {c.source === "field_key" && <Field label="Field key"><Input value={c.field_key} onChange={v => setLocal("field_key", v)} /></Field>}
          <Field label="Color">
            <Select value={c.color} onChange={v => setLocal("color", v)} options={[{ value: "#22C55E", label: "Green (OK)" }, { value: "#EF4444", label: "Red (Error)" }, { value: "#00BFFF", label: "Blue (Info)" }, { value: "#EAB308", label: "Yellow (Warning)" }, { value: "#94A3B8", label: "Gray (System)" }]} />
          </Field>
        </>)}

        {node.type === "submit_move" && (<>
          <Field label="MySQL Table to insert"><Input value={c.table} onChange={v => setLocal("table", v)} placeholder="traceability" /></Field>
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-bold text-[#475569] uppercase tracking-wider">Field key → DB column mapping</span>
            {(c.fields_map || []).map((f, i) => (
              <div key={i} className="flex gap-1 items-center">
                <Input value={f.field_key} onChange={v => { const nm = [...c.fields_map]; nm[i] = { ...nm[i], field_key: v }; setLocal("fields_map", nm); }} placeholder="field_key" />
                <span className="text-[#475569] text-[9px]">→</span>
                <Input value={f.col} onChange={v => { const nm = [...c.fields_map]; nm[i] = { ...nm[i], col: v }; setLocal("fields_map", nm); }} placeholder="db_column" />
                <button onClick={() => setLocal("fields_map", c.fields_map.filter((_, j) => j !== i))} className="text-[#EF4444] hover:text-white p-0.5 shrink-0"><IconX /></button>
              </div>
            ))}
            <button onClick={() => setLocal("fields_map", [...(c.fields_map || []), { field_key: "", col: "" }])} className="text-[10px] text-[#22C55E] hover:text-white text-left flex items-center gap-1 mt-0.5"><IconPlus /> Add mapping</button>
          </div>
        </>)}
      </div>

      <div className="p-3 border-t border-[#1E293B] shrink-0">
        <button onClick={applyChanges} className="w-full py-2 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-white font-bold text-xs transition-colors shadow-lg">
          ✨ Apply Settings to Node
        </button>
      </div>
    </div>
  );
});

// ── SVG connection lines ──────────────────────────────────────────────────────
function ConnectionLines({ connections, nodes, draggingConnection, onSelectEdge }) {
  const getPortPos = (nodeId, portType) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return { x: 0, y: 0 };
    const W = 180, H = 80;
    if (portType === "in")    return { x: node.x + W/2, y: node.y };
    if (portType === "true")  return { x: node.x + W/4, y: node.y + H };
    if (portType === "false") return { x: node.x + W*3/4, y: node.y + H };
    if (portType === "next")  return { x: node.x + W/2, y: node.y + H };
    return { x: node.x + W/2, y: node.y + H };
  };

  return (
    <svg className="absolute inset-0" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      <defs>
        <marker id="arrow-green" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#22C55E" /></marker>
        <marker id="arrow-red" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#EF4444" /></marker>
        <marker id="arrow-gray" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#94A3B8" /></marker>
      </defs>
      {connections.map(conn => {
        const from = getPortPos(conn.fromId, conn.fromPort);
        const to = getPortPos(conn.toId, "in");
        const dx = Math.abs(to.x - from.x) * 0.5;
        const color = conn.fromPort === "true" ? "#22C55E" : conn.fromPort === "false" ? "#EF4444" : "#94A3B8";
        const arrow = conn.fromPort === "true" ? "url(#arrow-green)" : conn.fromPort === "false" ? "url(#arrow-red)" : "url(#arrow-gray)";
        const d = `M${from.x},${from.y} C${from.x},${from.y+dx} ${to.x},${to.y-dx} ${to.x},${to.y}`;
        return <path key={conn.id} d={d} fill="none" stroke={color} strokeWidth="2" strokeDasharray={conn.fromPort === "false" ? "6 3" : "none"} markerEnd={arrow} opacity="0.8" 
                     className="cursor-pointer hover:stroke-[3px]" 
                     onClick={(e) => { e.stopPropagation(); onSelectEdge(conn.id); }} />;
      })}
      {draggingConnection && (<path d={`M${draggingConnection.x1},${draggingConnection.y1} C${draggingConnection.x1},${draggingConnection.y1+50} ${draggingConnection.x2},${draggingConnection.y2-50} ${draggingConnection.x2},${draggingConnection.y2}`} fill="none" stroke="#22C55E" strokeWidth="2" strokeDasharray="4 2" opacity="0.6" />)}
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════
// MAIN LOGIC BUILDER MODAL
// ════════════════════════════════════════════════════════════════
export default function LogicBuilder({ cpNumber, onClose }) {
  const [nodes, setNodes] = useState([]);
  const [connections, setConnections] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [dragInfo, setDragInfo] = useState(null);
  const [draggingConn, setDraggingConn] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState("");
  const [applyMsg, setApplyMsg] = useState("");
  const [commDevices, setCommDevices] = useState([]);
  const [settingsSchema, setSettingsSchema] = useState({ sections: [], section_fields: {}, tables: [], table_columns: {} });
  const [paletteSearch, setPaletteSearch] = useState("");
  const canvasRef = useRef(null);

  // ✅ PERBAIKAN: State dinamis untuk ukuran kanvas (infinite scroll)
  const [canvasSize, setCanvasSize] = useState({ width: 1400, height: 900 });

  // ── Load flow, comm devices & setting.json schema ────────────
  useEffect(() => {
    fetch(`${API}/api/logic-config/${cpNumber}`)
      .then(r => r.ok ? r.json() : { nodes: [], connections: [] })
      .then(d => { setNodes(d.nodes || []); setConnections(d.connections || []); setLoading(false); })
      .catch(() => setLoading(false));

    fetch(`${API}/api/comm-status`)
      .then(r => r.json())
      .then(d => setCommDevices(d.devices || []))
      .catch(() => {});

    fetch(`${API}/api/settings-schema`)
      .then(r => r.ok ? r.json() : { sections: [], section_fields: {}, tables: [], table_columns: {} })
      .then(d => setSettingsSchema(d))
      .catch(() => {});
  }, [cpNumber]);

  // ── Delete key ────────────────────────────────────────────
  useEffect(() => {
    const h = e => {
      if ((e.key === "Delete" || e.key === "Backspace") && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        if (selectedEdge) {
          setConnections(cs => cs.filter(c => c.id !== selectedEdge));
          setSelectedEdge(null);
          return;
        }
        if (selected) {
          setNodes(ns => ns.filter(n => n.id !== selected));
          setConnections(cs => cs.filter(c => c.fromId !== selected && c.toId !== selected));
          setSelected(null);
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selected, selectedEdge]);

  // ✅ PERBAIKAN: Fungsi untuk memperluas kanvas secara otomatis
  const ensureCanvasSize = useCallback((x, y, nodeWidth = 180, nodeHeight = 80) => {
    const margin = 300; // Ruang kosong agar tidak terlalu ke pinggir
    const requiredWidth = x + nodeWidth + margin;
    const requiredHeight = y + nodeHeight + margin;
    setCanvasSize(prev => {
      const newWidth = Math.max(prev.width, requiredWidth, 1400);
      const newHeight = Math.max(prev.height, requiredHeight, 900);
      if (newWidth !== prev.width || newHeight !== prev.height) {
        return { width: newWidth, height: newHeight };
      }
      return prev;
    });
  }, []);

  // ── Drop from palette ─────────────────────────────────────
  const handleDrop = useCallback(e => {
    e.preventDefault();
    const type = e.dataTransfer.getData("node-type");
    if (!type) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const id = nid();
    const x = Math.max(0, e.clientX - rect.left - 90);
    const y = Math.max(0, e.clientY - rect.top - 40);
    setNodes(ns => [...ns, { id, type, x, y, config: { ...DEFAULT_NODE_CONFIG[type] } }]);
    // ✅ Perluas kanvas saat node baru diletakkan
    ensureCanvasSize(x, y);
    setSelected(id);
  }, [ensureCanvasSize]);

  // ── Node drag ─────────────────────────────────────────────
  const startNodeDrag = useCallback((e, id) => {
    if (e.button !== 0) return;
    const el = document.getElementById(`node-${id}`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDragInfo({ id, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top });
  }, []);

  useEffect(() => {
    if (!dragInfo) return;
    const onMove = e => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mouseX = e.clientX - rect.left - dragInfo.offsetX;
      const mouseY = e.clientY - rect.top - dragInfo.offsetY;
      let newX = Math.max(0, mouseX);
      let newY = Math.max(0, mouseY);
      
      setNodes(ns => ns.map(n => n.id === dragInfo.id ? { ...n, x: newX, y: newY } : n));
      
      // ✅ Perluas kanvas saat node diseret ke ujung layar
      ensureCanvasSize(newX, newY);
    };
    const onUp = () => setDragInfo(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragInfo, ensureCanvasSize]);

  // ── Port connection drag ──────────────────────────────────
  const startPortDrag = useCallback((e, fromId, fromPort) => {
    e.stopPropagation();
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const canvasRect = canvasRef.current.getBoundingClientRect();
    setDraggingConn({ fromId, fromPort, x1: rect.left + rect.width / 2 - canvasRect.left, y1: rect.top + rect.height / 2 - canvasRect.top, x2: rect.left + rect.width / 2 - canvasRect.left, y2: rect.top + rect.height / 2 - canvasRect.top });
  }, []);

  useEffect(() => {
    if (!draggingConn) return;
    const onMove = e => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDraggingConn(dc => dc ? { ...dc, x2: e.clientX - rect.left, y2: e.clientY - rect.top } : null);
    };
    const onUp = () => setDraggingConn(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [draggingConn]);

  const finishConnection = useCallback((toId) => {
    if (!draggingConn || draggingConn.fromId === toId) { setDraggingConn(null); return; }
    const exists = connections.find(c => c.fromId === draggingConn.fromId && c.fromPort === draggingConn.fromPort);
    if (!exists) setConnections(cs => [...cs, { id: nid(), fromId: draggingConn.fromId, fromPort: draggingConn.fromPort, toId }]);
    setDraggingConn(null);
  }, [draggingConn, connections]);

  // ── Save ──────────────────────────────────────────────────
  const save = async () => {
    setSaving(true); setSaveMsg("");
    try {
      const r = await fetch(`${API}/api/logic-config/${cpNumber}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nodes, connections }) });
      const d = await r.json();
      setSaveMsg(d.success ? "✓ Saved!" : "✗ Failed");
    } catch { setSaveMsg("✗ Network error"); }
    setSaving(false);
    setTimeout(() => setSaveMsg(""), 3000);
  };

  const updateNode = useCallback((updated) => {
    setNodes(ns => ns.map(n => n.id === updated.id ? updated : n));
  }, []);

  const selectedNode = useMemo(() => nodes.find(n => n.id === selected) || null, [nodes, selected]);
  const filteredPalette = useMemo(() => {
    const q = paletteSearch.toLowerCase();
    return NODE_TYPES.filter(t => t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q));
  }, [paletteSearch]);
  const categories = useMemo(() => {
    const cats = {};
    filteredPalette.forEach(t => { if (!cats[t.category]) cats[t.category] = []; cats[t.category].push(t); });
    return cats;
  }, [filteredPalette]);

  const handleApplySuccess = useCallback(() => {
    setApplyMsg("✓ Applied!");
    setTimeout(() => setApplyMsg(""), 2000);
  }, []);

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm font-sans">
      <div className="flex flex-col rounded-2xl overflow-hidden border border-[#334155] shadow-2xl" style={{ width: "min(98vw, 1700px)", height: "min(96vh, 900px)", background: "#0B1120" }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#1E293B] shrink-0" style={{ background: "#111827" }}>
          <div className="flex items-center gap-3">
            <span className="text-[#22C55E] font-black text-lg tracking-tighter">WIK</span>
            <div className="w-px h-5 bg-[#334155]" />
            <span className="text-white font-bold text-sm">Logic Builder</span>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/30">CP{String(cpNumber).padStart(2, "0")}</span>
          </div>

          <div className="flex items-center gap-2">
            {applyMsg && (
              <span className="text-[11px] font-bold px-3 py-1 rounded-full text-[#22C55E] bg-[#22C55E]/10">
                {applyMsg}
              </span>
            )}
            {saveMsg && (
              <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${saveMsg.startsWith("✓") ? "text-[#22C55E] bg-[#22C55E]/10" : "text-[#EF4444] bg-[#EF4444]/10"}`}>
                {saveMsg}
              </span>
            )}
            <button onClick={() => { setNodes([]); setConnections([]); setSelected(null); }} className="h-7 px-3 rounded-lg border border-[#334155] text-[#94A3B8] hover:bg-[#1E293B] text-[10px] font-bold transition-colors">Clear</button>
            <button onClick={save} disabled={saving} className="h-7 px-4 rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] text-white font-bold text-[10px] transition-colors disabled:opacity-50 flex items-center gap-1.5">{saving ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</> : "💾 Save Flow"}</button>
            <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-[#475569] hover:text-white hover:bg-[#1E293B] transition-colors"><IconX /></button>
          </div>
        </div>
        <div className="flex flex-1 overflow-hidden min-h-0">
          <div className="w-48 shrink-0 border-r border-[#1E293B] flex flex-col" style={{ background: "#0F172A" }}>
            <div className="px-3 pt-3 pb-2 shrink-0"><p className="text-[#3B82F6] text-[9px] font-bold uppercase tracking-widest mb-2">Logic Nodes</p><input value={paletteSearch} onChange={e => setPaletteSearch(e.target.value)} placeholder="Search…" className="w-full bg-[#1E293B] border border-[#334155] text-white text-[10px] rounded-lg px-2 h-7 outline-none placeholder-[#334155] focus:border-[#3B82F6]/50" /></div>
            <div className="flex-1 overflow-y-auto px-2 pb-3 flex flex-col gap-3" style={{ scrollbarWidth: "thin", scrollbarColor: "#334155 #0F172A" }}>
              {Object.entries(categories).map(([cat, items]) => (
                <div key={cat}>
                  <p className="text-[8px] font-bold uppercase tracking-widest px-1 mb-1" style={{ color: items[0] ? NODE_TYPES.find(t => t.category === cat)?.color : "#475569" }}>{CATEGORY_LABELS[cat]}</p>
                  <div className="flex flex-col gap-1">{items.map(node => (<div key={node.type} draggable onDragStart={e => e.dataTransfer.setData("node-type", node.type)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-[#1E293B] hover:border-opacity-50 cursor-grab active:cursor-grabbing transition-colors" style={{ borderColor: "#1E293B" }} onMouseEnter={e => e.currentTarget.style.borderColor = node.color + "60"} onMouseLeave={e => e.currentTarget.style.borderColor = "#1E293B"}><span className="text-sm w-5 text-center shrink-0">{node.icon}</span><div className="flex flex-col min-w-0"><span className="text-white text-[10px] font-semibold leading-tight">{node.label}</span><span className="text-[#475569] text-[8px] leading-tight truncate">{node.desc}</span></div></div>))}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-auto min-h-0 relative" style={{ background: "#080E1A", scrollbarWidth: "thin", scrollbarColor: "#334155 #080E1A" }}>
            {loading ? (<div className="flex items-center justify-center h-full gap-2 text-[#3B82F6] text-xs"><div className="w-4 h-4 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /> Loading flow…</div>) : (
              <div ref={canvasRef} onDragOver={e => e.preventDefault()} onDrop={handleDrop} onClick={(e) => { if (e.target === e.currentTarget) { setSelected(null); setSelectedEdge(null); } }} className="relative" 
                   // ✅ PERBAIKAN: Gunakan state dinamis untuk width dan height
                   style={{ width: canvasSize.width, height: canvasSize.height, background: "#0F172A", backgroundImage: "radial-gradient(circle, #1E293B 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
                {nodes.length === 0 && (<div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none"><span className="text-5xl opacity-10 mb-3">⚡</span><p className="text-[#1E293B] text-sm font-mono">Drag logic nodes here to build your flow</p></div>)}
                <ConnectionLines connections={connections} nodes={nodes} draggingConnection={draggingConn} onSelectEdge={setSelectedEdge} />
                {nodes.map(node => (<NodeCard key={node.id} node={node} selected={node.id === selected} onSelect={setSelected} onDragStart={startNodeDrag} onDelete={id => { setNodes(ns => ns.filter(n => n.id !== id)); setConnections(cs => cs.filter(c => c.fromId !== id && c.toId !== id)); if (selected === id) setSelected(null); }} onPortMouseDown={startPortDrag} onPortMouseUp={finishConnection} />))}
              </div>
            )}
          </div>
          <div className="w-64 shrink-0 border-l border-[#1E293B] flex flex-col" style={{ background: "#0F172A" }}>
            <ConfigPanel node={selectedNode} onChange={updateNode} onApply={handleApplySuccess} commDevices={commDevices} cpNumber={cpNumber} settingsSchema={settingsSchema} />
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-[#1E293B] shrink-0" style={{ background: "#080E1A" }}>
          <span className="text-[#334155] text-[9px] font-mono">{nodes.length} node{nodes.length !== 1 ? "s" : ""} · {connections.length} connection{connections.length !== 1 ? "s" : ""}</span>
          <span className="text-[#334155] text-[9px] font-mono">Del = delete node · drag port → port to connect · ✓ green = true · ✗ red = false</span>
        </div>
      </div>
    </div>
  );
}