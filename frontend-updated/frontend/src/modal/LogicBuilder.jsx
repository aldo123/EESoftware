// src/modal/LogicBuilder.jsx
import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react";
import { API } from "../service/api";
import { ModalBackdrop, ModalPanel } from "../components/motion";
import { useInternalVariables } from "../hooks/useInternalVariables";

// ── Node type definitions ─────────────────────────────────────────────────────
// Add new node types here one at a time:
//   { type: "my_node", category: "check" | "data" | "action" | "trigger",
//     color: "#RRGGBB", icon: "🔧", label: "My Node", desc: "..." }
// then give it a default config below and a config panel block in <ConfigPanel>.
// "check" category nodes get true/false output ports (see NodeCard's `hasTrue`).
const NODE_TYPES = [
  { type: "device_trigger", category: "trigger", color: "#3B82F6", icon: "📡", label: "Device Trigger", desc: "Start a flow from Modbus TCP / Modbus RTU / Internal Variable" },
  { type: "zone_inspect", category: "check", color: "#8B5CF6", icon: "🔍", label: "Zone Inspect", desc: "Inspect a camera ROI (vision engine)" },
  { type: "count_over_time", category: "check", color: "#8B5CF6", icon: "⏱", label: "Count Over Time", desc: "Count detections in a camera ROI over N seconds" },
  { type: "custom_script", category: "check", color: "#F59E0B", icon: "🧩", label: "Custom Script", desc: "Write custom logic for cases no other node covers" },
  { type: "multi_condition_gate", category: "check", color: "#EAB308", icon: "🚦", label: "Multi-Condition Gate", desc: "AND-check several Internal Variables — all must pass to continue" },
  { type: "write_output", category: "action", color: "#22C55E", icon: "✍️", label: "Write Output", desc: "Write a value to a PLC coil/register or an Internal Variable" },
  { type: "write_sn_list", category: "action", color: "#06B6D4", icon: "📝", label: "Write SN List", desc: "Write Internal Variables to SN List columns" },
  { type: "reset_node", category: "action", color: "#3B82F6", icon: "🔄", label: "Reset", desc: "Reset trigger flags / variables back to idle — selected ones, or all at once" },
  { type: "timer", category: "action", color: "#F97316", icon: "⏲", label: "Timer", desc: "Pause for a fixed number of seconds, then continue" },
  { type: "subflow_call", category: "group", color: "#64748B", icon: "📦", label: "Group", desc: "Bundle several nodes into one, reusable across flows — keeps the main canvas clean" },
  { type: "group_input", category: "group", color: "#3B82F6", icon: "🔵", label: "Group Input", desc: "Only inside a Group — this is where the trigger from outside enters" },
  { type: "group_output", category: "group", color: "#EF4444", icon: "🔴", label: "Group Output", desc: "Only inside a Group — sends a result (next/true/false) back out" },
];

const CATEGORY_COLORS = {
  trigger: "#1E3A5F",
  check: "#3B1F1F",
  data: "#2D1B69",
  action: "#14532D",
  group: "#1E293B",
};

const CATEGORY_LABELS = {
  trigger: "Triggers",
  check: "Checks",
  data: "Data",
  action: "Actions",
  group: "Groups",
};

let _nid = 1;
const nid = () => `n${Date.now()}_${_nid++}`;

function IconX() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconTrash() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" /></svg>; }

// ── Node default configs ──────────────────────────────────────────────────────
// Keyed by node `type`. Add one entry per new node type.
const DEFAULT_NODE_CONFIG = {
  device_trigger: {
    sources: [
      { connection_type: "modbus_tcp", device: "", device_name: "", address_type: "holding_register", address: "0", trigger_value: "1", variable_name: "" },
    ],
    fieldKey: "",
  },
  zone_inspect: {
    camera_id: "", roi_x: "0", roi_y: "0", roi_w: "100", roi_h: "100",
    method: "color_ratio", method_params: {}, target_field: "",
  },
  count_over_time: {
    camera_id: "", roi_x: "0", roi_y: "0", roi_w: "100", roi_h: "100",
    method: "contour_blob", method_params: {}, duration: "3", max_count: "999", target_field: "",
  },
  custom_script: {
    code: "# fields: dict of current field values (read/write)\n# result: set True/False to pick the True/False output\n# log(msg): add a line to the run log\n\nresult = True\n",
  },
  multi_condition_gate: {
    conditions: [{ variable_name: "", operator: "equals", value: "", value2: "" }],
    wait_mode: "instant", // "instant" | "poll"
    timeout_seconds: "10",
  },
  write_output: {
    writes: [
      {
        target: "device",
        protocol: "tcp",
        device_name: "", address_type: "holding_register", address: "0",
        variable_name: "",
        value_source: "static",
        value: "1",
        value_field_key: "",
      },
    ],
  },  write_sn_list: {
    mappings: [
      { variable_name: "", column_key: "" },
    ],
  },

  subflow_call: {
    template_id: "",
    template_name: "",
    expose_check: false,
  },
  timer: {
    duration_seconds: "1",
  },
  reset_node: {
    mode: "selected", // "selected" | "group" | "all"
    group_name: "",
    targets: [{ kind: "internal", protocol: "tcp", device_name: "", address_type: "holding_register", address: "0", variable_name: "" }],
  },
  group_input: {
    read_source: "none", // "none" | "internal" | "device"
    protocol: "tcp", device_name: "", address_type: "holding_register", address: "0",
    variable_name: "",
    field_key: "",
  },
  group_output: {
    port: "next",
    write_target: "none", // "none" | "internal" | "device"
    protocol: "tcp", device_name: "", address_type: "holding_register", address: "0",
    variable_name: "",
    value_source: "static",
    value: "1",
    value_field_key: "",
  },
};

// ── Node card component ────────────────────────────────────────────────────
// "check" category nodes get true/false output ports; everything else gets a
// single generic "next" port. A node type that needs different ports again
// (e.g. Switch's dynamic per-case ports) should extend this the same way the
// old version did, keyed off `node.type` — not hardcoded here.
const NodeCard = memo(function NodeCard({ node, selected, onSelect, onDragStart, onDelete, onPortMouseDown, onPortMouseUp, onOpenGroup }) {
  const def = NODE_TYPES.find(t => t.type === node.type);
  if (!def) return null;
  const isGroup = node.type === "subflow_call";
  const hasTrue = def.category === "check" || (isGroup && node.config?.expose_check);
  const hasInPort = node.type !== "group_input";
  const hasOutPort = node.type !== "group_output";

  return (
    <div
      id={`node-${node.id}`}
      onClick={e => { e.stopPropagation(); onSelect(node.id, e.shiftKey || e.ctrlKey || e.metaKey); }}
      onDoubleClick={e => { if (isGroup) { e.stopPropagation(); onOpenGroup?.(node); } }}
      title={isGroup ? "Double-click buat buka isi Group" : undefined}
      className="absolute select-none cursor-default"
      style={{ left: node.x, top: node.y, width: 180, zIndex: selected ? 10 : 1 }}
    >
      <div className="rounded-xl overflow-hidden border-2 transition-all shadow-lg" style={{ borderColor: selected ? def.color : "#334155", background: CATEGORY_COLORS[def.category] || "#1E293B", boxShadow: selected ? `0 0 0 2px ${def.color}40` : "none" }}>
        <div className="flex items-center gap-2 px-3 py-2 cursor-grab active:cursor-grabbing" style={{ background: def.color + "22" }} onMouseDown={e => { e.stopPropagation(); onDragStart(e, node.id); }}>
          <span className="text-base leading-none">{def.icon}</span>
          <span className="text-white text-[11px] font-bold leading-tight flex-1 truncate">
            {isGroup && node.config?.template_name ? node.config.template_name : def.label}
            {node.type === "group_output" ? ` → ${node.config?.port || "next"}` : ""}
          </span>
          <button onMouseDown={e => { e.stopPropagation(); onDelete(node.id); }} className="w-5 h-5 rounded flex items-center justify-center text-[#475569] hover:text-[#EF4444] transition-colors"><IconTrash /></button>
        </div>
      </div>

      {hasInPort && (
        <div onMouseUp={e => { e.stopPropagation(); onPortMouseUp(node.id, "in"); }} className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-[#475569] hover:border-[#22C55E] bg-[#0B1120] cursor-crosshair transition-colors z-20" />
      )}
      {!hasOutPort ? null : hasTrue ? (
        <>
          <div className="absolute -bottom-2 left-1/4 -translate-x-1/2 flex flex-col items-center z-20"><div onMouseDown={e => { e.stopPropagation(); onPortMouseDown(e, node.id, "true"); }} className="w-4 h-4 rounded-full border-2 border-[#22C55E] bg-[#0B1120] cursor-crosshair hover:bg-[#22C55E]/30" /><span className="text-[8px] text-[#22C55E] font-bold mt-0.5">✓</span></div>
          <div className="absolute -bottom-2 left-3/4 -translate-x-1/2 flex flex-col items-center z-20"><div onMouseDown={e => { e.stopPropagation(); onPortMouseDown(e, node.id, "false"); }} className="w-4 h-4 rounded-full border-2 border-[#EF4444] bg-[#0B1120] cursor-crosshair hover:bg-[#EF4444]/30" /><span className="text-[8px] text-[#EF4444] font-bold mt-0.5">✗</span></div>
        </>
      ) : (
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 z-20"><div onMouseDown={e => { e.stopPropagation(); onPortMouseDown(e, node.id, "next"); }} className="w-4 h-4 rounded-full border-2 border-[#94A3B8] bg-[#0B1120] cursor-crosshair hover:border-[#22C55E]" /></div>
      )}
    </div>
  );
});

const Field = ({ label, children }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">{label}</span>
    {children}
  </div>
);
const Input = ({ value, onChange: oc, placeholder = "" }) => (
  <input value={value ?? ""} onChange={e => oc(e.target.value)} placeholder={placeholder}
    className="bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none focus:border-[#22C55E]/60" />
);
const Select = ({ value, onChange: oc, options }) => (
  <select value={value ?? ""} onChange={e => oc(e.target.value)}
    className="bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none focus:border-[#22C55E]/60">
    {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
  </select>
);

// ── ROI Picker: draw a rectangle on the camera's live feed by dragging ─────────
// Screen/CSS pixels (however big the preview is drawn) are converted to actual
// image pixels via the <img>'s naturalWidth/naturalHeight, so the resulting
// roi_x/y/w/h are correct regardless of how the preview is scaled on screen.
function RoiPicker({ cameraId, roi, onChange, thresholdValue }) {
  const imgRef = useRef(null);
  const [drag, setDrag] = useState(null); // {x1,y1,x2,y2} in CSS px, relative to the image
  const [, forceRender] = useState(0); // re-render once the <img> reports its real size
  const [showThreshold, setShowThreshold] = useState(false);

  const toImagePx = useCallback((cssX, cssY) => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return { x: 0, y: 0 };
    const rect = img.getBoundingClientRect();
    return {
      x: Math.round((cssX / rect.width) * img.naturalWidth),
      y: Math.round((cssY / rect.height) * img.naturalHeight),
    };
  }, []);

  const onMouseDown = useCallback((e) => {
    const rect = imgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    setDrag({ x1: x, y1: y, x2: x, y2: y });
  }, []);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e) => {
      const rect = imgRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDrag(d => ({ ...d, x2: Math.max(0, Math.min(rect.width, e.clientX - rect.left)), y2: Math.max(0, Math.min(rect.height, e.clientY - rect.top)) }));
    };
    const onUp = () => {
      setDrag(d => {
        if (d) {
          const x1 = Math.min(d.x1, d.x2), y1 = Math.min(d.y1, d.y2);
          const x2 = Math.max(d.x1, d.x2), y2 = Math.max(d.y1, d.y2);
          if (x2 - x1 > 3 && y2 - y1 > 3) {
            const p1 = toImagePx(x1, y1), p2 = toImagePx(x2, y2);
            onChange({ roi_x: p1.x, roi_y: p1.y, roi_w: p2.x - p1.x, roi_h: p2.y - p1.y });
          }
        }
        return null;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [drag, toImagePx, onChange]);

  if (!cameraId) {
    return <div className="h-32 flex items-center justify-center rounded border border-dashed border-[var(--border)] text-[9px] text-[var(--text-muted)]">Isi Camera ID dulu buat lihat preview</div>;
  }

  // Existing ROI, converted from image px -> CSS px for the overlay rectangle.
  const img = imgRef.current;
  const scaleX = img?.naturalWidth ? img.getBoundingClientRect().width / img.naturalWidth : 0;
  const scaleY = img?.naturalHeight ? img.getBoundingClientRect().height / img.naturalHeight : 0;
  const savedRect = (!drag && img?.naturalWidth) ? {
    left: (Number(roi.roi_x) || 0) * scaleX, top: (Number(roi.roi_y) || 0) * scaleY,
    width: (Number(roi.roi_w) || 0) * scaleX, height: (Number(roi.roi_h) || 0) * scaleY,
  } : null;
  const dragRect = drag ? {
    left: Math.min(drag.x1, drag.x2), top: Math.min(drag.y1, drag.y2),
    width: Math.abs(drag.x2 - drag.x1), height: Math.abs(drag.y2 - drag.y1),
  } : null;

  return (
    <div className="relative select-none rounded overflow-hidden border border-[var(--border)]" style={{ cursor: "crosshair" }} onMouseDown={onMouseDown}>
      <img
        ref={imgRef}
        src={showThreshold && thresholdValue !== undefined
          ? `${API}/api/vision/stream-threshold/${encodeURIComponent(cameraId)}?threshold=${Number(thresholdValue) || 165}`
          : `${API}/api/vision/stream/${encodeURIComponent(cameraId)}`}
        alt="camera preview"
        className="w-full h-auto block pointer-events-none"
        draggable={false}
        onLoad={() => forceRender(n => n + 1)}
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
      {savedRect && <div className="absolute border-2 border-[#8B5CF6] bg-[#8B5CF6]/10 pointer-events-none" style={savedRect} />}
      {dragRect && <div className="absolute border-2 border-[#22C55E] bg-[#22C55E]/10 pointer-events-none" style={dragRect} />}
      <span className="absolute bottom-1 left-1.5 text-[8px] text-white/70 bg-black/50 px-1 rounded pointer-events-none">drag buat gambar area</span>
      {thresholdValue !== undefined && (
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setShowThreshold(v => !v); }}
          className="absolute bottom-1 right-1.5 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ background: showThreshold ? "rgba(139,92,246,0.9)" : "rgba(30,41,59,0.85)", color: "#fff" }}
        >
          🔲 Threshold
        </button>
      )}
    </div>
  );
}

// ── Property Panel ──────────────────────────────────────────────
// No per-type config blocks yet — add one `{node.type === "..." && (<>...</>)}`
// block per node type as they get rebuilt (see git history for the old patterns:
// static/field-key/device-register "source" dropdowns, condition rows, etc.)
const ConfigPanel = memo(function ConfigPanel({ node, onChange, onApply, tcpDevices = [], rtuDevices = [], templates = [], onCreateTemplate, onOpenGroup, cpNumber = "", activeGroupName = "" }) {
  const [localConfig, setLocalConfig] = useState({});
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  // Groups shown in Reset -> Reset per Group are the actual
  // Logic Builder Groups (logic templates), not Internal Variable groups.
  const { variables: internalVariables, loading: internalVariablesLoading } = useInternalVariables(cpNumber || undefined);
  const [snListColumns, setSnListColumns] = useState([]);
  const [snListColumnsLoading, setSnListColumnsLoading] = useState(false);

  const logicBuilderGroups = useMemo(() => {
    const names = (templates || [])
      .map(g => String(g?.name ?? g?.template_name ?? "").trim())
      .filter(Boolean);

    // Keep the currently opened Group available even if the parent list has
    // not refreshed yet.
    if (activeGroupName && !names.includes(activeGroupName)) {
      names.unshift(activeGroupName);
    }

    return [...new Set(names)];
  }, [templates, activeGroupName]);

  useEffect(() => {
    setLocalConfig(node?.config || {});
    setCheckResult(null);
    setNewGroupName("");
  }, [node?.id]);

  useEffect(() => {
    if (!cpNumber || node?.type !== "write_sn_list") {
      setSnListColumns([]);
      setSnListColumnsLoading(false);
      return;
    }
    let cancelled = false;
    setSnListColumnsLoading(true);
    fetch(`${API}/api/snlist/columns?cp=${encodeURIComponent(cpNumber)}`)
      .then(r => r.ok ? r.json() : [])
      .then(cols => {
        if (!cancelled) setSnListColumns(Array.isArray(cols) ? cols.filter(c => c?.key && c.key !== "id" && c.key !== "date_time") : []);
      })
      .catch(() => { if (!cancelled) setSnListColumns([]); })
      .finally(() => { if (!cancelled) setSnListColumnsLoading(false); });
    return () => { cancelled = true; };
  }, [cpNumber, node?.type]);

  if (!node) return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <span className="text-3xl opacity-20 mb-2">🖱</span>
      <p className="text-[var(--text-muted)] text-[10px]">Click a node to configure it</p>
    </div>
  );

  const def = NODE_TYPES.find(t => t.type === node.type);
  const c = localConfig;

  const setLocal = (key, val) => {
    setLocalConfig(prev => ({ ...prev, [key]: val }));
  };
  const setParam = (key, val) => {
    setLocalConfig(prev => ({ ...prev, method_params: { ...(prev.method_params || {}), [key]: val } }));
  };

  const EMPTY_TRIGGER_SOURCE = { connection_type: "modbus_tcp", device: "", device_name: "", address_type: "holding_register", address: "0", trigger_value: "1", variable_name: "" };
  // Device Trigger supports Modbus TCP, Modbus RTU and Internal Variable only.
  // Any legacy unsupported source is converted to a blank Modbus TCP source.
  const normalizeTriggerSource = (src) => {
    const allowed = ["modbus_tcp", "modbus_rtu", "internal"];
    return allowed.includes(src?.connection_type)
      ? { ...src }
      : { ...EMPTY_TRIGGER_SOURCE };
  };
  const triggerSources = Array.isArray(c.sources) ? c.sources.map(normalizeTriggerSource)
    : c.connection_type ? [normalizeTriggerSource({ connection_type: c.connection_type, device: c.device, device_name: c.device_name, address_type: c.address_type, address: c.address, trigger_value: c.trigger_value, variable_name: c.variable_name })]
    : [EMPTY_TRIGGER_SOURCE];
  const updateTriggerSource = (idx, patch) => {
    setLocalConfig(prev => {
      const base = Array.isArray(prev.sources) ? prev.sources : triggerSources;
      return { ...prev, sources: base.map((s, i) => (i === idx ? { ...s, ...patch } : s)) };
    });
  };
  const addTriggerSource = () => {
    setLocalConfig(prev => {
      const base = Array.isArray(prev.sources) ? prev.sources : triggerSources;
      return { ...prev, sources: [...base, { ...EMPTY_TRIGGER_SOURCE }] };
    });
  };
  const removeTriggerSource = (idx) => {
    setLocalConfig(prev => {
      const base = Array.isArray(prev.sources) ? prev.sources : triggerSources;
      return { ...prev, sources: base.filter((_, i) => i !== idx) };
    });
  };

  const EMPTY_WRITE_TARGET = { target: "device", protocol: "tcp", device_name: "", address_type: "holding_register", address: "0", variable_name: "", value_source: "static", value: "1", value_field_key: "" };
  // Flows saved before multi-write support have their single write's fields
  // flattened directly onto the node config (no "writes" array) — wrap them
  // into a one-item list here so old and new flows share the same editor UI.
  const writeTargets = Array.isArray(c.writes) ? c.writes
    : c.target ? [{ target: c.target, protocol: c.protocol, device_name: c.device_name, address_type: c.address_type, address: c.address, variable_name: c.variable_name, value_source: c.value_source, value: c.value, value_field_key: c.value_field_key }]
    : [EMPTY_WRITE_TARGET];
  const updateWriteTarget = (idx, patch) => {
    setLocalConfig(prev => {
      const base = Array.isArray(prev.writes) ? prev.writes : writeTargets;
      return { ...prev, writes: base.map((w, i) => (i === idx ? { ...w, ...patch } : w)) };
    });
  };
  const addWriteTarget = () => {
    setLocalConfig(prev => {
      const base = Array.isArray(prev.writes) ? prev.writes : writeTargets;
      return { ...prev, writes: [...base, { ...EMPTY_WRITE_TARGET }] };
    });
  };
  const removeWriteTarget = (idx) => {
    setLocalConfig(prev => {
      const base = Array.isArray(prev.writes) ? prev.writes : writeTargets;
      return { ...prev, writes: base.filter((_, i) => i !== idx) };
    });
  };

  const EMPTY_RESET_TARGET = { kind: "internal", protocol: "tcp", device_name: "", address_type: "holding_register", address: "0", variable_name: "" };
  const resetTargets = Array.isArray(c.targets) ? c.targets : [EMPTY_RESET_TARGET];
  const updateResetTarget = (idx, patch) => {
    setLocalConfig(prev => {
      const base = Array.isArray(prev.targets) ? prev.targets : resetTargets;
      return { ...prev, targets: base.map((t, i) => (i === idx ? { ...t, ...patch } : t)) };
    });
  };
  const addResetTarget = () => {
    setLocalConfig(prev => {
      const base = Array.isArray(prev.targets) ? prev.targets : resetTargets;
      return { ...prev, targets: [...base, { ...EMPTY_RESET_TARGET }] };
    });
  };
  const removeResetTarget = (idx) => {
    setLocalConfig(prev => {
      const base = Array.isArray(prev.targets) ? prev.targets : resetTargets;
      return { ...prev, targets: base.filter((_, i) => i !== idx) };
    });
  };

  const conditions = Array.isArray(c.conditions) ? c.conditions : [];
  const updateCondition = (idx, patch) => {
    setLocalConfig(prev => ({
      ...prev,
      conditions: (prev.conditions || []).map((cond, i) => (i === idx ? { ...cond, ...patch } : cond)),
    }));
  };
  const addCondition = () => {
    setLocalConfig(prev => ({
      ...prev,
      conditions: [...(prev.conditions || []), { variable_name: "", operator: "equals", value: "", value2: "" }],
    }));
  };
  const removeCondition = (idx) => {
    setLocalConfig(prev => ({ ...prev, conditions: (prev.conditions || []).filter((_, i) => i !== idx) }));
  };

  const snMappings = Array.isArray(c.mappings) && c.mappings.length
    ? c.mappings
    : [{ variable_name: c.variable_name || "", column_key: c.column_key || "" }];
  const updateSnMapping = (idx, patch) => {
    setLocalConfig(prev => {
      const base = Array.isArray(prev.mappings) && prev.mappings.length
        ? prev.mappings
        : [{ variable_name: prev.variable_name || "", column_key: prev.column_key || "" }];
      return { ...prev, mappings: base.map((m, i) => i === idx ? { ...m, ...patch } : m) };
    });
  };
  const addSnMapping = () => {
    setLocalConfig(prev => ({
      ...prev,
      mappings: [...(Array.isArray(prev.mappings) ? prev.mappings : []), { variable_name: "", column_key: "" }],
    }));
  };
  const removeSnMapping = (idx) => {
    setLocalConfig(prev => {
      const base = Array.isArray(prev.mappings) ? prev.mappings : [];
      const next = base.filter((_, i) => i !== idx);
      return { ...prev, mappings: next.length ? next : [{ variable_name: "", column_key: "" }] };
    });
  };

  const applyChanges = () => {
    onChange({ ...node, config: localConfig });
    if (onApply) onApply();
  };

  const createGroup = async () => {
    const name = newGroupName.trim();
    if (!name || !onCreateTemplate) return;
    setCreatingGroup(true);
    try {
      const created = await onCreateTemplate(name);
      if (created?.id) {
        setLocalConfig(prev => ({ ...prev, template_id: created.id, template_name: created.name || name }));
        setNewGroupName("");
      }
    } finally {
      setCreatingGroup(false);
    }
  };

  const runCheck = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const r = await fetch(`${API}/api/logic-builder/custom-script/check`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c.code || "", fields: {} }),
      });
      setCheckResult(await r.json());
    } catch {
      setCheckResult({ success: false, error: "Network error — backend gak kejangkau" });
    }
    setChecking(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border-soft)] shrink-0">
        <span className="text-base">{def?.icon}</span>
        <span className="text-[var(--text-primary)] font-bold text-xs">{def?.label || node.type}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3" style={{ scrollbarWidth: "thin", scrollbarColor: "#334155 var(--bg-surface-2)" }}>
        {node.type === "device_trigger" && (<>
          {triggerSources.map((src, idx) => (
            <div key={idx} className="flex flex-col gap-1.5 rounded-lg border border-[var(--border-soft)] p-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Source {idx + 1}</span>
                {triggerSources.length > 1 && (
                  <button type="button" onClick={() => removeTriggerSource(idx)} className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[#EF4444]" title="Remove source">
                    <IconTrash />
                  </button>
                )}
              </div>

              <Field label="Connection Type">
                <Select value={src.connection_type || "modbus_tcp"} onChange={v => updateTriggerSource(idx, { connection_type: v })} options={[
                  { value: "modbus_tcp", label: "Modbus TCP" },
                  { value: "modbus_rtu", label: "Modbus RTU (RS485)" },
                  { value: "internal", label: "Internal Variable" },
                ]} />
              </Field>

              {(src.connection_type === "modbus_tcp" || src.connection_type === "modbus_rtu") && (<>
                <Field label="Device Name">
                  <Select value={src.device_name} onChange={v => updateTriggerSource(idx, { device_name: v })} options={[{ value: "", label: "Select device…" }, ...((src.connection_type === "modbus_rtu" ? rtuDevices : tcpDevices) || []).map(d => ({ value: d.name, label: d.name }))]} />
                </Field>
                <Field label="Address Type">
                  <Select value={src.address_type || "holding_register"} onChange={v => updateTriggerSource(idx, { address_type: v })} options={[
                    { value: "coil", label: "Coil" },
                    { value: "discrete_input", label: "Discrete Input" },
                    { value: "holding_register", label: "Holding Register" },
                    { value: "input_register", label: "Input Register" },
                  ]} />
                </Field>
                <Field label="Address"><Input value={src.address} onChange={v => updateTriggerSource(idx, { address: v })} placeholder="0" /></Field>
                <Field label="Trigger Value (fires once when reached)"><Input value={src.trigger_value} onChange={v => updateTriggerSource(idx, { trigger_value: v })} placeholder="1" /></Field>
              </>)}

              {src.connection_type === "internal" && (<>
                <Field label="Internal Variable">
                  <select
                    value={src.variable_name || ""}
                    onChange={e => updateTriggerSource(idx, { variable_name: e.target.value })}
                    className="bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none focus:border-[#22C55E]/60"
                  >
                    <option value="">{internalVariablesLoading ? "Loading variables…" : "Select variable…"}</option>
                    {internalVariables.map(v => (
                      <option key={v.id} value={v.name}>{v.name} ({v.data_type})</option>
                    ))}
                  </select>
                </Field>
                <Field label="Trigger Value (fires once when reached)"><Input value={src.trigger_value} onChange={v => updateTriggerSource(idx, { trigger_value: v })} placeholder="1" /></Field>
              </>)}
            </div>
          ))}

          <button
            type="button"
            onClick={addTriggerSource}
            className="w-full h-8 rounded-lg border border-[#3B82F6]/60 text-[#3B82F6] hover:bg-[#3B82F6]/10 font-bold text-[10px] transition-colors"
          >
            + Add Source
          </button>

          <p className="text-[var(--text-muted)] text-[9px] mt-1">
            Semua source di atas OR — <b>salah satu</b> aja yang mencapai Trigger Value-nya, flow ini langsung jalan (source lain diabaikan buat siklus itu). Berguna kalau lo mau satu flow bisa dipicu dari beberapa device/register/variable berbeda tanpa bikin banyak node Device Trigger.
          </p>
        </>)}

        {node.type === "zone_inspect" && (<>
          <Field label="Camera ID"><Input value={c.camera_id} onChange={v => setLocal("camera_id", v)} placeholder="e.g. line1_cam1" /></Field>
          <Field label="ROI — drag di preview buat gambar area">
            <RoiPicker
              cameraId={c.camera_id}
              roi={c}
              onChange={({ roi_x, roi_y, roi_w, roi_h }) => {
                setLocalConfig(prev => ({ ...prev, roi_x, roi_y, roi_w, roi_h }));
              }}
            />
            <div className="grid grid-cols-2 gap-1 mt-1">
              <Input value={c.roi_x} onChange={v => setLocal("roi_x", v)} placeholder="x" />
              <Input value={c.roi_y} onChange={v => setLocal("roi_y", v)} placeholder="y" />
              <Input value={c.roi_w} onChange={v => setLocal("roi_w", v)} placeholder="width" />
              <Input value={c.roi_h} onChange={v => setLocal("roi_h", v)} placeholder="height" />
            </div>
          </Field>
          <Field label="Method">
            <Select value={c.method || "color_ratio"} onChange={v => setLocal("method", v)} options={[
              { value: "color_ratio", label: "Color Ratio" },
              { value: "border_overflow", label: "Border Overflow" },
              { value: "presence", label: "Presence (Border/Inner)" },
              { value: "bright_band", label: "Bright Band" },
              { value: "ocr", label: "OCR Text" },
            ]} />
          </Field>

          {c.method === "color_ratio" && (<>
            <Field label="Hue Min / Max"><div className="grid grid-cols-2 gap-1"><Input value={(c.method_params || {}).hue_min} onChange={v => setParam("hue_min", Number(v))} placeholder="0" /><Input value={(c.method_params || {}).hue_max} onChange={v => setParam("hue_max", Number(v))} placeholder="25" /></div></Field>
            <Field label="Saturation Min"><Input value={(c.method_params || {}).sat_min} onChange={v => setParam("sat_min", Number(v))} placeholder="70" /></Field>
            <Field label="Value Min"><Input value={(c.method_params || {}).val_min} onChange={v => setParam("val_min", Number(v))} placeholder="50" /></Field>
            <Field label="Min Ratio % (pass threshold)"><Input value={(c.method_params || {}).min_ratio_pct} onChange={v => setParam("min_ratio_pct", Number(v))} placeholder="15" /></Field>
          </>)}

          {c.method === "border_overflow" && (<>
            <Field label="White Threshold"><Input value={(c.method_params || {}).white_threshold} onChange={v => setParam("white_threshold", Number(v))} placeholder="165" /></Field>
            <Field label="Max Overflow % (pass threshold)"><Input value={(c.method_params || {}).max_overflow_pct} onChange={v => setParam("max_overflow_pct", Number(v))} placeholder="10" /></Field>
          </>)}

          {c.method === "presence" && (<>
            <Field label="White Threshold"><Input value={(c.method_params || {}).white_threshold} onChange={v => setParam("white_threshold", Number(v))} placeholder="165" /></Field>
            <Field label="Border Width (px)"><Input value={(c.method_params || {}).border_px} onChange={v => setParam("border_px", Number(v))} placeholder="6" /></Field>
            <Field label="Max Border Overflow %"><Input value={(c.method_params || {}).max_overflow_pct} onChange={v => setParam("max_overflow_pct", Number(v))} placeholder="20" /></Field>
            <Field label="Min Inside %"><Input value={(c.method_params || {}).min_inside_pct} onChange={v => setParam("min_inside_pct", Number(v))} placeholder="5" /></Field>
          </>)}

          {c.method === "bright_band" && (<>
            <Field label="Bright Value Min"><Input value={(c.method_params || {}).bright_v_min} onChange={v => setParam("bright_v_min", Number(v))} placeholder="170" /></Field>
            <Field label="Bright Saturation Max"><Input value={(c.method_params || {}).bright_s_max} onChange={v => setParam("bright_s_max", Number(v))} placeholder="100" /></Field>
            <Field label="Column Width % (center)"><Input value={(c.method_params || {}).col_pct} onChange={v => setParam("col_pct", Number(v))} placeholder="70" /></Field>
            <Field label="Max Thickness % (pass threshold)"><Input value={(c.method_params || {}).max_thickness_pct} onChange={v => setParam("max_thickness_pct", Number(v))} placeholder="5" /></Field>
          </>)}

          {c.method === "ocr" && (<>
            <Field label="Expected Text"><Input value={(c.method_params || {}).expected_text} onChange={v => setParam("expected_text", v)} placeholder="leave empty = any text" /></Field>
            <Field label="Match Mode">
              <Select value={(c.method_params || {}).match_mode || "contains"} onChange={v => setParam("match_mode", v)} options={[{ value: "contains", label: "Contains" }, { value: "exact", label: "Exact" }]} />
            </Field>
            <Field label="Min Confidence"><Input value={(c.method_params || {}).min_confidence} onChange={v => setParam("min_confidence", Number(v))} placeholder="60" /></Field>
          </>)}

          <Field label="Store value in field key"><Input value={c.target_field} onChange={v => setLocal("target_field", v)} placeholder="e.g. zone1_value" /></Field>
          <p className="text-[var(--text-muted)] text-[9px] mt-1">
            Butuh kamera yang sudah jalan (mis. lewat widget Camera Feed dengan Camera ID yang sama). OK → <b style={{ color: "#22C55E" }}>Green (True)</b>. NG / kamera belum jalan → <b style={{ color: "#EF4444" }}>Red (False)</b>.
          </p>
        </>)}

        {node.type === "count_over_time" && (<>
          <Field label="Camera ID"><Input value={c.camera_id} onChange={v => setLocal("camera_id", v)} placeholder="e.g. line1_cam1" /></Field>
          <Field label="ROI — drag di preview buat gambar area">
            <RoiPicker
              cameraId={c.camera_id}
              roi={c}
              onChange={({ roi_x, roi_y, roi_w, roi_h }) => {
                setLocalConfig(prev => ({ ...prev, roi_x, roi_y, roi_w, roi_h }));
              }}
              thresholdValue={c.method === "contour_blob" ? ((c.method_params || {}).threshold ?? 165) : undefined}
            />
            <div className="grid grid-cols-2 gap-1 mt-1">
              <Input value={c.roi_x} onChange={v => setLocal("roi_x", v)} placeholder="x" />
              <Input value={c.roi_y} onChange={v => setLocal("roi_y", v)} placeholder="y" />
              <Input value={c.roi_w} onChange={v => setLocal("roi_w", v)} placeholder="width" />
              <Input value={c.roi_h} onChange={v => setLocal("roi_h", v)} placeholder="height" />
            </div>
          </Field>
          <Field label="Method">
            <Select value={c.method || "contour_blob"} onChange={v => setLocal("method", v)} options={[
              { value: "contour_blob", label: "Contour Blob (mis. hitung bubble)" },
              { value: "color_ratio", label: "Color Ratio" },
              { value: "border_overflow", label: "Border Overflow" },
              { value: "presence", label: "Presence (Border/Inner)" },
              { value: "bright_band", label: "Bright Band" },
              { value: "ocr", label: "OCR Text" },
            ]} />
          </Field>

          {c.method === "contour_blob" && (<>
            <Field label="Threshold (brightness cutoff)"><Input value={(c.method_params || {}).threshold} onChange={v => setParam("threshold", Number(v))} placeholder="165" /></Field>
            <Field label="Contour Area Min / Max"><div className="grid grid-cols-2 gap-1"><Input value={(c.method_params || {}).min_contour} onChange={v => setParam("min_contour", Number(v))} placeholder="250" /><Input value={(c.method_params || {}).max_contour} onChange={v => setParam("max_contour", Number(v))} placeholder="3000" /></div></Field>
            <Field label="Match Distance (px)"><Input value={(c.method_params || {}).match_dist} onChange={v => setParam("match_dist", Number(v))} placeholder="70" /></Field>
            <Field label="Debounce (seconds)"><Input value={(c.method_params || {}).debounce_seconds} onChange={v => setParam("debounce_seconds", Number(v))} placeholder="0.5" /></Field>
          </>)}

          {c.method === "color_ratio" && (<>
            <Field label="Hue Min / Max"><div className="grid grid-cols-2 gap-1"><Input value={(c.method_params || {}).hue_min} onChange={v => setParam("hue_min", Number(v))} placeholder="0" /><Input value={(c.method_params || {}).hue_max} onChange={v => setParam("hue_max", Number(v))} placeholder="25" /></div></Field>
            <Field label="Saturation Min"><Input value={(c.method_params || {}).sat_min} onChange={v => setParam("sat_min", Number(v))} placeholder="70" /></Field>
            <Field label="Value Min"><Input value={(c.method_params || {}).val_min} onChange={v => setParam("val_min", Number(v))} placeholder="50" /></Field>
            <Field label="Min Ratio % (pass threshold)"><Input value={(c.method_params || {}).min_ratio_pct} onChange={v => setParam("min_ratio_pct", Number(v))} placeholder="15" /></Field>
          </>)}

          {c.method === "border_overflow" && (<>
            <Field label="White Threshold"><Input value={(c.method_params || {}).white_threshold} onChange={v => setParam("white_threshold", Number(v))} placeholder="165" /></Field>
            <Field label="Max Overflow % (pass threshold)"><Input value={(c.method_params || {}).max_overflow_pct} onChange={v => setParam("max_overflow_pct", Number(v))} placeholder="10" /></Field>
          </>)}

          {c.method === "presence" && (<>
            <Field label="White Threshold"><Input value={(c.method_params || {}).white_threshold} onChange={v => setParam("white_threshold", Number(v))} placeholder="165" /></Field>
            <Field label="Border Width (px)"><Input value={(c.method_params || {}).border_px} onChange={v => setParam("border_px", Number(v))} placeholder="6" /></Field>
            <Field label="Max Border Overflow %"><Input value={(c.method_params || {}).max_overflow_pct} onChange={v => setParam("max_overflow_pct", Number(v))} placeholder="20" /></Field>
            <Field label="Min Inside %"><Input value={(c.method_params || {}).min_inside_pct} onChange={v => setParam("min_inside_pct", Number(v))} placeholder="5" /></Field>
          </>)}

          {c.method === "bright_band" && (<>
            <Field label="Bright Value Min"><Input value={(c.method_params || {}).bright_v_min} onChange={v => setParam("bright_v_min", Number(v))} placeholder="170" /></Field>
            <Field label="Bright Saturation Max"><Input value={(c.method_params || {}).bright_s_max} onChange={v => setParam("bright_s_max", Number(v))} placeholder="100" /></Field>
            <Field label="Column Width % (center)"><Input value={(c.method_params || {}).col_pct} onChange={v => setParam("col_pct", Number(v))} placeholder="70" /></Field>
            <Field label="Max Thickness % (pass threshold)"><Input value={(c.method_params || {}).max_thickness_pct} onChange={v => setParam("max_thickness_pct", Number(v))} placeholder="5" /></Field>
          </>)}

          {c.method === "ocr" && (<>
            <Field label="Expected Text"><Input value={(c.method_params || {}).expected_text} onChange={v => setParam("expected_text", v)} placeholder="leave empty = any text" /></Field>
            <Field label="Match Mode">
              <Select value={(c.method_params || {}).match_mode || "contains"} onChange={v => setParam("match_mode", v)} options={[{ value: "contains", label: "Contains" }, { value: "exact", label: "Exact" }]} />
            </Field>
            <Field label="Min Confidence"><Input value={(c.method_params || {}).min_confidence} onChange={v => setParam("min_confidence", Number(v))} placeholder="60" /></Field>
          </>)}

          <Field label="Duration (seconds, max 15)"><Input value={c.duration} onChange={v => setLocal("duration", v)} placeholder="3" /></Field>
          <Field label="Max Count (pass threshold)"><Input value={c.max_count} onChange={v => setLocal("max_count", v)} placeholder="e.g. 4" /></Field>
          <Field label="Store count in field key"><Input value={c.target_field} onChange={v => setLocal("target_field", v)} placeholder="e.g. zone1_count" /></Field>
          <p className="text-[var(--text-muted)] text-[9px] mt-1">
            Node ini nunggu selama Duration detik sambil ngitung. Count ≤ Max Count → <b style={{ color: "#22C55E" }}>Green (True)</b>, lebih dari itu → <b style={{ color: "#EF4444" }}>Red (False)</b>.
          </p>
        </>)}

        {node.type === "custom_script" && (<>
          <Field label="Script (Python)">
            <textarea
              value={c.code ?? ""}
              onChange={e => setLocal("code", e.target.value)}
              spellCheck={false}
              rows={12}
              className="bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] font-mono rounded px-2 py-1.5 outline-none focus:border-[#F59E0B]/60 resize-y"
            />
          </Field>

          <button
            onClick={runCheck}
            disabled={checking}
            className="w-full h-7 rounded-lg border border-[#F59E0B]/50 text-[#F59E0B] hover:bg-[#F59E0B]/10 font-bold text-[10px] transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {checking ? <><div className="w-3 h-3 border-2 border-[#F59E0B] border-t-transparent rounded-full animate-spin" /> Checking…</> : "▶ Check Script"}
          </button>

          {checkResult && (
            checkResult.success ? (
              <div className="rounded-lg border border-[#22C55E]/40 bg-[#22C55E]/10 px-2 py-1.5 text-[9px] text-[#22C55E] flex flex-col gap-1">
                <span className="font-bold">✓ OK — jalan tanpa error (result = {String(checkResult.result)})</span>
                {checkResult.logs?.length > 0 && checkResult.logs.map((l, i) => <span key={i} className="text-[var(--text-muted)]">log: {l}</span>)}
                {Object.keys(checkResult.fields || {}).length > 0 && (
                  <span className="text-[var(--text-muted)]">fields: {JSON.stringify(checkResult.fields)}</span>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-2 py-1.5 text-[9px] text-[#EF4444] font-mono break-words">
                ✗ {checkResult.error}
              </div>
            )
          )}

          <p className="text-[var(--text-muted)] text-[9px] mt-1">
            Escape hatch buat logic yang gak cocok di node manapun. Script baca/tulis dict <code>fields</code>, set <code>result</code> (True/False) buat pilih output, dan bisa panggil <code>log("...")</code>. Gak ada akses file/OS/import — cuma operasi Python dasar + <code>math</code>.
          </p>
        </>)}

        {node.type === "multi_condition_gate" && (<>
          {conditions.map((cond, idx) => (
            <div key={idx} className="flex flex-col gap-1 rounded-lg border border-[var(--border-soft)] p-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Condition {idx + 1}</span>
                <button type="button" onClick={() => removeCondition(idx)} className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[#EF4444]" title="Remove condition">
                  <IconTrash />
                </button>
              </div>

              <Field label="Internal Variable">
                <select
                  value={cond.variable_name || ""}
                  onChange={e => updateCondition(idx, { variable_name: e.target.value })}
                  className="bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none focus:border-[#22C55E]/60"
                >
                  <option value="">{internalVariablesLoading ? "Loading variables…" : "Select variable…"}</option>
                  {internalVariables.map(v => (
                    <option key={v.id} value={v.name}>{v.name} ({v.data_type})</option>
                  ))}
                </select>
              </Field>

              <Field label="Operator">
                <Select value={cond.operator || "equals"} onChange={v => updateCondition(idx, { operator: v })} options={[
                  { value: "equals", label: "Equals (=)" },
                  { value: "not_equals", label: "Not Equals (≠)" },
                  { value: "greater_than", label: "Greater Than (>)" },
                  { value: "less_than", label: "Less Than (<)" },
                  { value: "greater_equal", label: "Greater or Equal (≥)" },
                  { value: "less_equal", label: "Less or Equal (≤)" },
                  { value: "between", label: "Between (range)" },
                  { value: "contains", label: "Contains" },
                ]} />
              </Field>

              {cond.operator === "between" ? (
                <Field label="Value Min / Max">
                  <div className="grid grid-cols-2 gap-1">
                    <Input value={cond.value} onChange={v => updateCondition(idx, { value: v })} placeholder="min" />
                    <Input value={cond.value2} onChange={v => updateCondition(idx, { value2: v })} placeholder="max" />
                  </div>
                </Field>
              ) : (
                <Field label="Value">
                  <Input value={cond.value} onChange={v => updateCondition(idx, { value: v })} placeholder="e.g. PASS" />
                </Field>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={addCondition}
            className="w-full h-8 rounded-lg border border-[#EAB308]/60 text-[#EAB308] hover:bg-[#EAB308]/10 font-bold text-[10px] transition-colors"
          >
            + Add Condition
          </button>

          <p className="text-[var(--text-muted)] text-[9px] mt-1">
            Semua kondisi dicek dengan AND — kalau <b>semua</b> Internal Variable memenuhi kondisinya → <b style={{ color: "#22C55E" }}>Green (True)</b>, lanjut ke node berikutnya. Kalau <b>salah satu</b> NG (atau variable-nya tidak ditemukan) → <b style={{ color: "#EF4444" }}>Red (False)</b>.
            <br />Status tiap baris Specification Table otomatis muncul di sini sebagai <code>Spec_&lt;nama_spesifikasi&gt;_Step&lt;nomor_baris&gt;_Status</code> (isinya PASS/FAIL/waiting_trigger/running). Baris ke-1 di tabel = Step1, baris ke-2 = Step2, dst.
          </p>

          <Field label="Timing">
            <Select value={c.wait_mode || "instant"} onChange={v => setLocal("wait_mode", v)} options={[
              { value: "instant", label: "Cek sekali, langsung (instant)" },
              { value: "poll", label: "Tunggu sampai terpenuhi (Wait Until Match)" },
            ]} />
          </Field>

          {c.wait_mode === "poll" && (
            <Field label="Timeout (detik)">
              <Input value={c.timeout_seconds} onChange={v => setLocal("timeout_seconds", v)} placeholder="10" />
            </Field>
          )}

          <p className="text-[var(--text-muted)] text-[9px] mt-1">
            {c.wait_mode === "poll" ? (
              <>Node ini bakal <b>ngecek berulang tiap 0.2 detik</b> sampai semua kondisi terpenuhi, atau sampai Timeout abis (baru dianggap NG). Pakai mode ini kalau variable yang dicek butuh waktu buat berubah (misal status Specification Table yang mulai dari <code>waiting_trigger</code>/<code>running</code> dan baru jadi PASS/FAIL setelah test-nya beneran selesai) — biar gate-nya gak keburu ambil keputusan pas test-nya baru mulai.</>
            ) : (
              <>Mode instant cuma ngecek SEKALI, pas node ini dijalankan — cocok kalau variable-nya udah pasti punya nilai final saat itu juga. Kalau variable-nya (misal status test) baru mulai berubah SETELAH node sebelumnya (misal Write Output yang mulai test), pakai mode "Wait Until Match" di atas, jangan instant.</>
            )}
          </p>
        </>)}

        {node.type === "write_output" && (<>
          {writeTargets.map((w, idx) => (
            <div key={idx} className="flex flex-col gap-1.5 rounded-lg border border-[var(--border-soft)] p-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Write {idx + 1}</span>
                {writeTargets.length > 1 && (
                  <button type="button" onClick={() => removeWriteTarget(idx)} className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[#EF4444]" title="Remove write">
                    <IconTrash />
                  </button>
                )}
              </div>

              <Field label="Write To">
                <Select value={w.target || "device"} onChange={v => updateWriteTarget(idx, { target: v })} options={[
                  { value: "device", label: "PLC (Modbus TCP/RTU)" },
                  { value: "internal", label: "Internal Variable" },
                ]} />
              </Field>

              {(w.target || "device") === "device" && (<>
                <Field label="Protocol">
                  <Select value={w.protocol || "tcp"} onChange={v => updateWriteTarget(idx, { protocol: v })} options={[
                    { value: "tcp", label: "Modbus TCP" },
                    { value: "rtu", label: "Modbus RTU (RS485)" },
                  ]} />
                </Field>
                <Field label="Device Name">
                  <Select value={w.device_name} onChange={v => updateWriteTarget(idx, { device_name: v })} options={[{ value: "", label: "Select device…" }, ...((w.protocol === "rtu" ? rtuDevices : tcpDevices) || []).map(d => ({ value: d.name, label: d.name }))]} />
                </Field>
                <Field label="Address Type">
                  <Select value={w.address_type || "holding_register"} onChange={v => updateWriteTarget(idx, { address_type: v })} options={[
                    { value: "coil", label: "Coil" },
                    { value: "holding_register", label: "Holding Register" },
                  ]} />
                </Field>
                <Field label="Address"><Input value={w.address} onChange={v => updateWriteTarget(idx, { address: v })} placeholder="0" /></Field>
              </>)}

              {w.target === "internal" && (
                <Field label="Internal Variable">
                  <select
                    value={w.variable_name || ""}
                    onChange={e => updateWriteTarget(idx, { variable_name: e.target.value })}
                    className="bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none focus:border-[#22C55E]/60"
                  >
                    <option value="">{internalVariablesLoading ? "Loading variables…" : "Select variable…"}</option>
                    {internalVariables.map(v => (
                      <option key={v.id} value={v.name}>{v.name} ({v.data_type})</option>
                    ))}
                  </select>
                </Field>
              )}

              <Field label="Value Source">
                <Select value={w.value_source || "static"} onChange={v => updateWriteTarget(idx, { value_source: v })} options={[
                  { value: "static", label: "Fixed Value" },
                  { value: "field_key", label: "From Field Key" },
                ]} />
              </Field>

              {(w.value_source || "static") === "static" ? (
                <Field label="Value"><Input value={w.value} onChange={v => updateWriteTarget(idx, { value: v })} placeholder="e.g. 1" /></Field>
              ) : (
                <Field label="Field Key"><Input value={w.value_field_key} onChange={v => updateWriteTarget(idx, { value_field_key: v })} placeholder="e.g. zone1_value" /></Field>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={addWriteTarget}
            className="w-full h-8 rounded-lg border border-[#22C55E]/60 text-[#22C55E] hover:bg-[#22C55E]/10 font-bold text-[10px] transition-colors"
          >
            + Add Write
          </button>

          <p className="text-[var(--text-muted)] text-[9px] mt-1">
            Semua "Write" di atas dijalankan sekaligus tiap kali node ini fire — cocok buat nulis ke beberapa Internal Variable/PLC bersamaan (mis. set 3 internal variable buat mulai 3 step test sekaligus). Sambungkan dari port <b style={{ color: "#22C55E" }}>✓ True</b> node Check/Gate (mis. Multi-Condition Gate) kalau mau nulis cuma pas kondisinya lolos. Coil nerima 1/0/true/false, Holding Register nerima angka 0-65535.
          </p>
        </>)}

        {node.type === "write_sn_list" && (<>
          <div className="rounded-lg border border-[#06B6D4]/30 bg-[#06B6D4]/5 px-2.5 py-2 text-[9px] text-[var(--text-muted)]">
            <b style={{ color: "#06B6D4" }}>CP{String(cpNumber || "").padStart(2, "0")}</b> — menulis ke SN List DB CP ini. Date/Time otomatis saat node dieksekusi.
          </div>

          {snMappings.map((m, idx) => (
            <div key={idx} className="flex flex-col gap-1.5 rounded-lg border border-[var(--border-soft)] p-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Mapping {idx + 1}</span>
                {snMappings.length > 1 && (
                  <button type="button" onClick={() => removeSnMapping(idx)} className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[#EF4444]" title="Remove mapping"><IconTrash /></button>
                )}
              </div>

              <Field label="Internal Variable">
                <select value={m.variable_name || ""} onChange={e => updateSnMapping(idx, { variable_name: e.target.value })} className="bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none focus:border-[#06B6D4]/60">
                  <option value="">{internalVariablesLoading ? "Loading variables…" : "Select variable…"}</option>
                  {internalVariables.map(v => <option key={v.id} value={v.name}>{v.name} ({v.data_type})</option>)}
                </select>
              </Field>

              <Field label="SN List Column">
                <select value={m.column_key || ""} onChange={e => updateSnMapping(idx, { column_key: e.target.value })} className="bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none focus:border-[#06B6D4]/60">
                  <option value="">{snListColumnsLoading ? "Loading columns…" : "Select column…"}</option>
                  {snListColumns.map(col => <option key={col.key} value={col.key}>{col.label || col.key} ({col.key})</option>)}
                </select>
              </Field>
            </div>
          ))}

          <button type="button" onClick={addSnMapping} className="w-full h-8 rounded-lg border border-[#06B6D4]/60 text-[#06B6D4] hover:bg-[#06B6D4]/10 font-bold text-[10px] transition-colors">
            + Add Variable → Column
          </button>
          <p className="text-[var(--text-muted)] text-[9px] mt-1">Semua mapping ditulis sebagai <b>1 row</b>. CP otomatis mengikuti flow. <b>date_time</b> dibuat otomatis oleh Logic Engine saat node dieksekusi.</p>
        </>)}

        {node.type === "timer" && (<>
          <Field label="Duration (detik)">
            <Input value={c.duration_seconds} onChange={v => setLocal("duration_seconds", v)} placeholder="1" />
          </Field>
          <p className="text-[var(--text-muted)] text-[9px] mt-1">
            Node ini cuma diam selama sekian detik (maks 120s), terus lanjut ke node berikutnya lewat port <b>next</b>. Beda sama "Wait Until Match" di Multi-Condition Gate (yang nunggu sampai kondisi tertentu terpenuhi) — Timer cuma delay tetap, gak ngecek apa-apa.
          </p>
        </>)}

        {node.type === "reset_node" && (<>
          <Field label="Mode">
            <Select value={c.mode || "selected"} onChange={v => setLocal("mode", v)} options={[
              { value: "selected", label: "Reset yang dipilih" },
              { value: "group", label: "Reset per Group" },
              { value: "all", label: "Reset SEMUA Internal Variable" },
            ]} />
          </Field>

          {c.mode === "all" && (
            <p className="text-[var(--text-muted)] text-[9px] mt-1">
              Semua Internal Variable di aplikasi di-reset sesuai data type: <b>number → 0</b>, <b>boolean → false</b>, <b>string → empty</b>. <b style={{ color: "#EF4444" }}>Ini menyentuh SEMUA Internal Variable</b>, bukan device PLC.
            </p>
          )}

          {c.mode === "group" && (<>
            <Field label="Group">
              <select
                value={c.group_name || ""}
                onChange={e => setLocal("group_name", e.target.value)}
                className="bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none focus:border-[#3B82F6]/60"
              >
                <option value="">Select group…</option>
                {logicBuilderGroups.map(g => (
                  <option key={g} value={g}>
                    {g === activeGroupName ? `★ ${g} (aktif)` : g}
                  </option>
                ))}
              </select>
              {logicBuilderGroups.length === 0 && (
                <p className="text-[#F59E0B] text-[9px] mt-1">
                  Belum ada Group di Logic Builder. Buat Group melalui Group Template terlebih dahulu.
                </p>
              )}
            </Field>
            <p className="text-[var(--text-muted)] text-[9px] mt-1">
              Reset semua Internal Variable yang di-tag Group ini (termasuk Group yang sedang aktif). Setiap variable kembali sesuai data type: <b>number → 0</b>, <b>boolean → false</b>, <b>string → empty</b>. Device PLC tidak ikut reset pada mode Group.
            </p>
            {activeGroupName && (
              <p className="text-[9px] mt-1 text-[#22C55E]">
                ★ Group yang sedang dibuka: <b>{activeGroupName}</b>
              </p>
            )}
          </>)}

          {c.mode === "selected" && (<>
            {resetTargets.map((t, idx) => (
              <div key={idx} className="flex flex-col gap-1.5 rounded-lg border border-[var(--border-soft)] p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Target {idx + 1}</span>
                  {resetTargets.length > 1 && (
                    <button type="button" onClick={() => removeResetTarget(idx)} className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[#EF4444]" title="Remove target">
                      <IconTrash />
                    </button>
                  )}
                </div>

                <Field label="Kind">
                  <Select value={t.kind || "internal"} onChange={v => updateResetTarget(idx, { kind: v })} options={[
                    { value: "internal", label: "Internal Variable" },
                    { value: "device", label: "PLC (Modbus TCP/RTU)" },
                  ]} />
                </Field>

                {t.kind === "internal" && (
                  <Field label="Internal Variable">
                    <select
                      value={t.variable_name || ""}
                      onChange={e => updateResetTarget(idx, { variable_name: e.target.value })}
                      className="bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none focus:border-[#22C55E]/60"
                    >
                      <option value="">{internalVariablesLoading ? "Loading variables…" : "Select variable…"}</option>
                      {internalVariables.map(v => (
                        <option key={v.id} value={v.name}>{v.name} ({v.data_type})</option>
                      ))}
                    </select>
                  </Field>
                )}

                {t.kind === "device" && (<>
                  <Field label="Protocol">
                    <Select value={t.protocol || "tcp"} onChange={v => updateResetTarget(idx, { protocol: v })} options={[
                      { value: "tcp", label: "Modbus TCP" },
                      { value: "rtu", label: "Modbus RTU (RS485)" },
                    ]} />
                  </Field>
                  <Field label="Device Name">
                    <Select value={t.device_name} onChange={v => updateResetTarget(idx, { device_name: v })} options={[{ value: "", label: "Select device…" }, ...((t.protocol === "rtu" ? rtuDevices : tcpDevices) || []).map(d => ({ value: d.name, label: d.name }))]} />
                  </Field>
                  <Field label="Address Type">
                    <Select value={t.address_type || "holding_register"} onChange={v => updateResetTarget(idx, { address_type: v })} options={[
                      { value: "coil", label: "Coil" },
                      { value: "holding_register", label: "Holding Register" },
                    ]} />
                  </Field>
                  <Field label="Address"><Input value={t.address} onChange={v => updateResetTarget(idx, { address: v })} placeholder="0" /></Field>
                  <div className="rounded-md border border-[#3B82F6]/30 bg-[#3B82F6]/5 px-2 py-1.5 text-[9px] text-[var(--text-muted)]">
                    Reset value: <b>Coil → false</b> · <b>Holding Register → 0</b>. Berlaku untuk Modbus TCP dan Modbus RTU.
                  </div>
                </>)}
              </div>
            ))}

            <button
              type="button"
              onClick={addResetTarget}
              className="w-full h-8 rounded-lg border border-[#3B82F6]/60 text-[#3B82F6] hover:bg-[#3B82F6]/10 font-bold text-[10px] transition-colors"
            >
              + Add Target
            </button>

            <p className="text-[var(--text-muted)] text-[9px] mt-1">
              <b>Internal Variable:</b> number → <b>0</b>, boolean → <b>false</b>, string → <b>empty</b>. <b>PLC Modbus TCP/RTU:</b> Coil → <b>false</b>, Holding Register → <b>0</b>. Reset dijalankan oleh Logic Engine saat node ini dieksekusi.
            </p>
          </>)}
        </>)}

        {node.type === "group_input" && (<>
          <p className="text-[var(--text-muted)] text-[9px]">
            Ini titik masuk Group ini. Begitu Group dipicu dari luar, eksekusi mulai dari sini — sambungkan port di bawah ke node pertama yang mau dijalankan. Cukup 1 Group Input per Group.
          </p>

          <Field label="Read Value From (opsional)">
            <Select value={c.read_source || "none"} onChange={v => setLocal("read_source", v)} options={[
              { value: "none", label: "— Gak baca apa-apa —" },
              { value: "internal", label: "Internal Variable" },
              { value: "device", label: "PLC (Modbus TCP/RTU)" },
            ]} />
          </Field>

          {c.read_source === "internal" && (
            <Field label="Internal Variable">
              <select
                value={c.variable_name || ""}
                onChange={e => setLocal("variable_name", e.target.value)}
                className="bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none focus:border-[#22C55E]/60"
              >
                <option value="">{internalVariablesLoading ? "Loading variables…" : "Select variable…"}</option>
                {internalVariables.map(v => (
                  <option key={v.id} value={v.name}>{v.name} ({v.data_type})</option>
                ))}
              </select>
            </Field>
          )}

          {c.read_source === "device" && (<>
            <Field label="Protocol">
              <Select value={c.protocol || "tcp"} onChange={v => setLocal("protocol", v)} options={[
                { value: "tcp", label: "Modbus TCP" },
                { value: "rtu", label: "Modbus RTU (RS485)" },
              ]} />
            </Field>
            <Field label="Device Name">
              <Select value={c.device_name} onChange={v => setLocal("device_name", v)} options={[{ value: "", label: "Select device…" }, ...((c.protocol === "rtu" ? rtuDevices : tcpDevices) || []).map(d => ({ value: d.name, label: d.name }))]} />
            </Field>
            <Field label="Address Type">
              <Select value={c.address_type || "holding_register"} onChange={v => setLocal("address_type", v)} options={[
                { value: "coil", label: "Coil" },
                { value: "discrete_input", label: "Discrete Input" },
                { value: "holding_register", label: "Holding Register" },
                { value: "input_register", label: "Input Register" },
              ]} />
            </Field>
            <Field label="Address"><Input value={c.address} onChange={v => setLocal("address", v)} placeholder="0" /></Field>
          </>)}

          {c.read_source !== "none" && (
            <Field label="Store value in field key"><Input value={c.field_key} onChange={v => setLocal("field_key", v)} placeholder="e.g. input_value" /></Field>
          )}
        </>)}

        {node.type === "group_output" && (<>
          <Field label="Maps to Group's outer port">
            <Select value={c.port || "next"} onChange={v => setLocal("port", v)} options={[
              { value: "next", label: "next (aksi biasa)" },
              { value: "true", label: "true (✓ kalau Group di-set \"Expose as Check\")" },
              { value: "false", label: "false (✗ kalau Group di-set \"Expose as Check\")" },
            ]} />
          </Field>
          <p className="text-[var(--text-muted)] text-[9px]">
            Sambungkan node terakhir di dalam Group ke sini buat nentuin ke port MANA hasilnya keluar di canvas luar Group. Bisa taruh beberapa Group Output sekaligus (misal satu buat "true", satu buat "false").
          </p>

          <Field label="Write Value To (opsional)">
            <Select value={c.write_target || "none"} onChange={v => setLocal("write_target", v)} options={[
              { value: "none", label: "— Gak nulis apa-apa —" },
              { value: "internal", label: "Internal Variable" },
              { value: "device", label: "PLC (Modbus TCP/RTU)" },
            ]} />
          </Field>

          {c.write_target === "device" && (<>
            <Field label="Protocol">
              <Select value={c.protocol || "tcp"} onChange={v => setLocal("protocol", v)} options={[
                { value: "tcp", label: "Modbus TCP" },
                { value: "rtu", label: "Modbus RTU (RS485)" },
              ]} />
            </Field>
            <Field label="Device Name">
              <Select value={c.device_name} onChange={v => setLocal("device_name", v)} options={[{ value: "", label: "Select device…" }, ...((c.protocol === "rtu" ? rtuDevices : tcpDevices) || []).map(d => ({ value: d.name, label: d.name }))]} />
            </Field>
            <Field label="Address Type">
              <Select value={c.address_type || "holding_register"} onChange={v => setLocal("address_type", v)} options={[
                { value: "coil", label: "Coil" },
                { value: "holding_register", label: "Holding Register" },
              ]} />
            </Field>
            <Field label="Address"><Input value={c.address} onChange={v => setLocal("address", v)} placeholder="0" /></Field>
          </>)}

          {c.write_target === "internal" && (
            <Field label="Internal Variable">
              <select
                value={c.variable_name || ""}
                onChange={e => setLocal("variable_name", e.target.value)}
                className="bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none focus:border-[#22C55E]/60"
              >
                <option value="">{internalVariablesLoading ? "Loading variables…" : "Select variable…"}</option>
                {internalVariables.map(v => (
                  <option key={v.id} value={v.name}>{v.name} ({v.data_type})</option>
                ))}
              </select>
            </Field>
          )}

          {c.write_target !== "none" && (<>
            <Field label="Value Source">
              <Select value={c.value_source || "static"} onChange={v => setLocal("value_source", v)} options={[
                { value: "static", label: "Fixed Value" },
                { value: "field_key", label: "From Field Key" },
              ]} />
            </Field>
            {(c.value_source || "static") === "static" ? (
              <Field label="Value"><Input value={c.value} onChange={v => setLocal("value", v)} placeholder="e.g. 1" /></Field>
            ) : (
              <Field label="Field Key"><Input value={c.value_field_key} onChange={v => setLocal("value_field_key", v)} placeholder="e.g. zone1_value" /></Field>
            )}
          </>)}
        </>)}

        {node.type === "subflow_call" && (<>
          <Field label="Group Template">
            <Select
              value={c.template_id || ""}
              onChange={v => {
                const found = templates.find(t => t.id === v);
                setLocal("template_id", v);
                setLocal("template_name", found?.name || v);
              }}
              options={[{ value: "", label: "— pilih Group —" }, ...templates.map(t => ({ value: t.id, label: `${t.name} (${t.node_count} node)` }))]}
            />
          </Field>

          <div className="flex items-center gap-1.5">
            <input
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              placeholder="Nama Group baru…"
              className="flex-1 h-8 px-2 rounded border border-[var(--border)] bg-[var(--bg-canvas)] text-[var(--text-primary)] text-[10px] outline-none focus:border-[#64748B]/60"
            />
            <button
              type="button"
              onClick={createGroup}
              disabled={!newGroupName.trim() || creatingGroup}
              className="h-8 px-3 rounded-lg border border-[#64748B]/60 text-[#94A3B8] hover:bg-[#64748B]/10 font-bold text-[10px] transition-colors disabled:opacity-40"
            >
              {creatingGroup ? "…" : "+ Bikin"}
            </button>
          </div>

          <button
            type="button"
            disabled={!c.template_id}
            onClick={() => onOpenGroup?.(c.template_id, c.template_name)}
            className="w-full h-8 rounded-lg bg-[#374151] hover:bg-[#4B5563] text-white font-bold text-[10px] transition-colors disabled:opacity-40"
          >
            📦 Buka Isi Group →
          </button>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={!!c.expose_check} onChange={e => setLocal("expose_check", e.target.checked)} className="w-3.5 h-3.5 accent-[#64748B]" />
            <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Expose as Check (True/False output)</span>
          </label>

          <p className="text-[var(--text-muted)] text-[9px] mt-1">
            Group nampung sekumpulan node (Device Trigger, Check, Write Output, Group lain, dll — sebanyak apapun) di dalam SATU node di canvas utama. Isi node-node di dalam Group diedit terpisah (klik "Buka Isi Group" atau double-click node-nya di canvas).
            <br /><br />
            <b>Input:</b> node di dalam Group yang gak punya sambungan masuk dari node lain di dalamnya = titik masuk (bisa lebih dari satu, semua dijalankan).
            <br /><br />
            <b>Output:</b> node di dalam Group yang port keluarnya nggak disambung ke node lain di dalam Group = otomatis nyambung ke port Group ini di canvas luar (bisa lebih dari satu port menggantung, semua ikut ke luar).
            {c.expose_check ? (
              <> Karena "Expose as Check" nyala, Group ini punya port <b style={{ color: "#22C55E" }}>✓ True</b> / <b style={{ color: "#EF4444" }}>✗ False</b> di luar — dangling <code>true</code> di dalam nyambung ke luar True, dangling <code>false</code> nyambung ke luar False. Cocok kalau isi Group-nya diakhiri node Check/Gate yang hasilnya perlu dipakai di luar Group.</>
            ) : (
              <> Sekarang Group ini cuma punya 1 port <b>next</b> di luar — kalau isi dalamnya ada node Check/Gate yang dangling True/False-nya, dua-duanya bakal ketumpuk ke port next yang sama. Nyalain "Expose as Check" di atas kalau True/False itu perlu dibedain di luar Group.</>
            )}
          </p>
        </>)}
      </div>

      <div className="p-3 border-t border-[var(--border-soft)] shrink-0">
        <button onClick={applyChanges} className="w-full h-8 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-white font-bold text-[10px] transition-colors">Apply Settings to Node</button>
      </div>
    </div>
  );
});

// ── SVG connection lines ──────────────────────────────────────────────────────
function ConnectionLines({ connections, nodes, draggingConnection, selectedEdge, onSelectEdge }) {
  const getPortPos = (nodeId, portType) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return { x: 0, y: 0 };
    const W = 180, H = 80;
    if (portType === "in") return { x: node.x + W / 2, y: node.y };
    if (portType === "true") return { x: node.x + W / 4, y: node.y + H };
    if (portType === "false") return { x: node.x + W * 3 / 4, y: node.y + H };
    return { x: node.x + W / 2, y: node.y + H };
  };

  return (
    <svg className="absolute inset-0" style={{ width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
      <defs>
        <marker id="arrow-gray" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#94A3B8" /></marker>
        <marker id="arrow-green" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#22C55E" /></marker>
        <marker id="arrow-red" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#EF4444" /></marker>
      </defs>
      {connections.map(conn => {
        const from = getPortPos(conn.fromId, conn.fromPort);
        const to = getPortPos(conn.toId, "in");
        const dx = Math.abs(to.x - from.x) * 0.5;
        const color = conn.fromPort === "true" ? "#22C55E" : conn.fromPort === "false" ? "#EF4444" : "#94A3B8";
        const arrow = conn.fromPort === "true" ? "url(#arrow-green)" : conn.fromPort === "false" ? "url(#arrow-red)" : "url(#arrow-gray)";
        const d = `M${from.x},${from.y} C${from.x},${from.y + dx} ${to.x},${to.y - dx} ${to.x},${to.y}`;
        const isSelected = conn.id === selectedEdge;
        return (
          <g key={conn.id}>
            {isSelected && (
              <path d={d} fill="none" stroke="#FBBF24" strokeWidth="6" opacity="0.35" style={{ pointerEvents: "none" }} />
            )}
            <path d={d} fill="none" stroke={isSelected ? "#FBBF24" : color} strokeWidth={isSelected ? 3 : 2} strokeDasharray={conn.fromPort === "false" ? "6 3" : "none"} markerEnd={arrow} opacity={isSelected ? 1 : 0.8}
              className="cursor-pointer hover:stroke-[3px]" style={{ pointerEvents: "visiblePainted" }}
              onClick={(e) => { e.stopPropagation(); onSelectEdge(conn.id); }} />
          </g>
        );
      })}
      {draggingConnection && (<path d={`M${draggingConnection.x1},${draggingConnection.y1} C${draggingConnection.x1},${draggingConnection.y1 + 50} ${draggingConnection.x2},${draggingConnection.y2 - 50} ${draggingConnection.x2},${draggingConnection.y2}`} fill="none" stroke="#22C55E" strokeWidth="2" strokeDasharray="4 2" opacity="0.6" />)}
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════
// FLOW EDITOR — the canvas/palette/config-panel UI, reusable for both the
// main per-CP flow and a Group's own contents. `source` says which one:
//   { kind: "cp", cpNumber }             -> GET/POST /api/logic-config/<cp>
//   { kind: "template", templateId }     -> GET/POST /api/logic-templates/<id>
// ════════════════════════════════════════════════════════════════
function FlowEditor({ source, cpNumber, onClose, onBack, tcpDevices, rtuDevices, templates, onCreateTemplate, onOpenGroup }) {
  const [nodes, setNodesRaw] = useState([]);
  const [connections, setConnectionsRaw] = useState([]);
  const [selected, setSelected] = useState([]); // array of selected node ids (multi-select)
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [dragInfo, setDragInfo] = useState(null);
  const [draggingConn, setDraggingConn] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState("");
  const [applyMsg, setApplyMsg] = useState("");
  const [paletteSearch, setPaletteSearch] = useState("");
  const [clipboard, setClipboard] = useState(null); // { nodes, connections } deep-cloned
  const [marquee, setMarquee] = useState(null); // { x, y, w, h } for the visual box
  const marqueeRef = useRef(null); // live drag data: { startX, startY, additive, baseSelected }
  const justMarqueedRef = useRef(false);
  const canvasRef = useRef(null);

  const [canvasSize, setCanvasSize] = useState({ width: 1400, height: 900 });

  const [templateMeta, setTemplateMeta] = useState({ name: "", description: "" });

  // ── Undo/redo history ───────────────────────────────────────
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncUndoRedoFlags = useCallback(() => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);

  // Snapshots the state *before* a mutation. Call this before applying a
  // change you want to be undoable.
  const pushHistory = useCallback(() => {
    undoStackRef.current.push({ nodes, connections });
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    redoStackRef.current = [];
    syncUndoRedoFlags();
  }, [nodes, connections, syncUndoRedoFlags]);

  const setNodes = useCallback((updater, opts) => {
    if (!opts?.skipHistory) pushHistory();
    setNodesRaw(updater);
  }, [pushHistory]);

  const setConnections = useCallback((updater, opts) => {
    if (!opts?.skipHistory) pushHistory();
    setConnectionsRaw(updater);
  }, [pushHistory]);

  // Combined nodes+connections mutation as a single undo step (e.g. delete,
  // paste — both arrays change together and should undo together).
  const commitFlow = useCallback((nodesUpdater, connsUpdater) => {
    pushHistory();
    if (nodesUpdater) setNodesRaw(nodesUpdater);
    if (connsUpdater) setConnectionsRaw(connsUpdater);
  }, [pushHistory]);

  const undo = useCallback(() => {
    if (!undoStackRef.current.length) return;
    const prev = undoStackRef.current.pop();
    redoStackRef.current.push({ nodes, connections });
    if (redoStackRef.current.length > 100) redoStackRef.current.shift();
    setNodesRaw(prev.nodes);
    setConnectionsRaw(prev.connections);
    setSelected([]);
    setSelectedEdge(null);
    syncUndoRedoFlags();
  }, [nodes, connections, syncUndoRedoFlags]);

  const redo = useCallback(() => {
    if (!redoStackRef.current.length) return;
    const next = redoStackRef.current.pop();
    undoStackRef.current.push({ nodes, connections });
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    setNodesRaw(next.nodes);
    setConnectionsRaw(next.connections);
    setSelected([]);
    setSelectedEdge(null);
    syncUndoRedoFlags();
  }, [nodes, connections, syncUndoRedoFlags]);

  const loadUrl = source.kind === "template" ? `${API}/api/logic-templates/${encodeURIComponent(source.templateId)}` : `${API}/api/logic-config/${source.cpNumber}`;
  const saveUrl = loadUrl;
  const flowKey = source.kind === "template" ? `template:${source.templateId}` : `cp:${source.cpNumber}`;

  // ── Load flow (CP flow or Group template) ──────────────────
  useEffect(() => {
    setLoading(true);
    fetch(loadUrl)
      .then(r => r.ok ? r.json() : { nodes: [], connections: [] })
      .then(d => {
        const loadedNodes = d.nodes || [];
        setNodesRaw(loadedNodes);
        setConnectionsRaw(d.connections || []);
        setLoading(false);
        if (source.kind === "template") {
          setTemplateMeta({ name: d.name || source.templateId, description: d.description || "" });
        }
        if (loadedNodes.length) {
          const margin = 300;
          const maxX = Math.max(...loadedNodes.map(n => n.x || 0)) + 180 + margin;
          const maxY = Math.max(...loadedNodes.map(n => n.y || 0)) + 80 + margin;
          setCanvasSize({ width: Math.max(maxX, 1400), height: Math.max(maxY, 900) });
        } else {
          setCanvasSize({ width: 1400, height: 900 });
        }
      })
      .catch(() => setLoading(false));
    setSelected([]);
    setSelectedEdge(null);
    setClipboard(null);
    undoStackRef.current = [];
    redoStackRef.current = [];
    syncUndoRedoFlags();
  }, [flowKey]);

  const ensureCanvasSize = useCallback((x, y, nodeWidth = 180, nodeHeight = 80) => {
    const margin = 300;
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

  // ── Selection helpers ────────────────────────────────────────
  const clearSelection = useCallback(() => { setSelected([]); setSelectedEdge(null); }, []);
  const selectOnly = useCallback((id) => { setSelected([id]); setSelectedEdge(null); }, []);
  const toggleSelect = useCallback((id, additive) => {
    setSelectedEdge(null);
    setSelected(sel => {
      if (!additive) return [id];
      return sel.includes(id) ? sel.filter(s => s !== id) : [...sel, id];
    });
  }, []);
  const selectAll = useCallback(() => { setSelected(nodes.map(n => n.id)); setSelectedEdge(null); }, [nodes]);
  // Selecting an edge and selecting node(s) are mutually exclusive — otherwise
  // Delete silently deletes whichever one deleteSelection checks first while
  // the *other* still looks selected on screen.
  const selectEdge = useCallback((id) => { setSelectedEdge(id); setSelected([]); }, []);

  const deleteSelection = useCallback(() => {
    if (selectedEdge) {
      commitFlow(null, cs => cs.filter(c => c.id !== selectedEdge));
      setSelectedEdge(null);
      return;
    }
    if (selected.length) {
      const ids = new Set(selected);
      commitFlow(
        ns => ns.filter(n => !ids.has(n.id)),
        cs => cs.filter(c => !ids.has(c.fromId) && !ids.has(c.toId)),
      );
      setSelected([]);
    }
  }, [selected, selectedEdge, commitFlow]);

  // ── Copy / cut / paste ───────────────────────────────────────
  const copySelection = useCallback(() => {
    if (!selected.length) return;
    const ids = new Set(selected);
    setClipboard({
      nodes: nodes.filter(n => ids.has(n.id)).map(n => structuredClone(n)),
      connections: connections.filter(c => ids.has(c.fromId) && ids.has(c.toId)).map(c => structuredClone(c)),
    });
  }, [selected, nodes, connections]);

  const pasteClipboard = useCallback(() => {
    if (!clipboard?.nodes?.length) return;
    const OFFSET = 40;
    const idMap = {};
    const newNodes = clipboard.nodes.map(n => {
      const newId = nid();
      idMap[n.id] = newId;
      return { ...structuredClone(n), id: newId, x: (n.x || 0) + OFFSET, y: (n.y || 0) + OFFSET };
    });
    const newConns = clipboard.connections.map(c => ({
      ...structuredClone(c), id: nid(), fromId: idMap[c.fromId], toId: idMap[c.toId],
    }));
    commitFlow(ns => [...ns, ...newNodes], cs => [...cs, ...newConns]);
    newNodes.forEach(n => ensureCanvasSize(n.x, n.y));
    setSelected(newNodes.map(n => n.id));
    setSelectedEdge(null);
  }, [clipboard, commitFlow, ensureCanvasSize]);

  const cutSelection = useCallback(() => {
    if (!selected.length) return;
    copySelection();
    deleteSelection();
  }, [selected, copySelection, deleteSelection]);

  // ── Keyboard shortcuts: Delete, Undo/Redo, Copy/Cut/Paste, Select All ──
  useEffect(() => {
    const h = e => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      if ((e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        deleteSelection();
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copySelection();
      } else if (mod && e.key.toLowerCase() === "x") {
        e.preventDefault();
        cutSelection();
      } else if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        pasteClipboard();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [deleteSelection, undo, redo, copySelection, cutSelection, pasteClipboard, selectAll]);

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
    ensureCanvasSize(x, y);
    selectOnly(id);
  }, [ensureCanvasSize, selectOnly, setNodes]);

  // ── Node drag (moves the whole selection together when the dragged
  //    node is part of a multi-selection) ─────────────────────
  const startNodeDrag = useCallback((e, id) => {
    if (e.button !== 0) return;
    const groupIds = selected.includes(id) ? selected : [id];
    if (groupIds !== selected) selectOnly(id);
    const startPositions = {};
    nodes.forEach(n => { if (groupIds.includes(n.id)) startPositions[n.id] = { x: n.x, y: n.y }; });
    setDragInfo({ id, startClientX: e.clientX, startClientY: e.clientY, startPositions });
  }, [nodes, selected, selectOnly]);

  useEffect(() => {
    if (!dragInfo) return;
    let historyPushed = false;
    const onMove = e => {
      const dxTotal = e.clientX - dragInfo.startClientX;
      const dyTotal = e.clientY - dragInfo.startClientY;
      if (!historyPushed) { pushHistory(); historyPushed = true; }
      setNodes(ns => ns.map(n => {
        const start = dragInfo.startPositions[n.id];
        if (!start) return n;
        return { ...n, x: Math.max(0, start.x + dxTotal), y: Math.max(0, start.y + dyTotal) };
      }), { skipHistory: true });
      // Grow the canvas for every dragged node, not just the one grabbed —
      // otherwise a grouped node that ends up further out than the anchor
      // node gets stranded outside the visible/scrollable canvas.
      Object.values(dragInfo.startPositions).forEach(start => {
        ensureCanvasSize(Math.max(0, start.x + dxTotal), Math.max(0, start.y + dyTotal));
      });
    };
    const onUp = () => setDragInfo(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragInfo, ensureCanvasSize, pushHistory]);

  // ── Marquee (box) select ───────────────────────────────────
  const startMarquee = useCallback((e) => {
    if (e.button !== 0 || e.target !== canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    marqueeRef.current = {
      startX: e.clientX - rect.left,
      startY: e.clientY - rect.top,
      additive: e.shiftKey,
      baseSelected: e.shiftKey ? selected : [],
    };
    justMarqueedRef.current = false;
  }, [selected]);

  useEffect(() => {
    const onMove = (e) => {
      if (!marqueeRef.current || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const curX = e.clientX - rect.left;
      const curY = e.clientY - rect.top;
      const { startX, startY, additive, baseSelected } = marqueeRef.current;
      const x = Math.min(startX, curX), y = Math.min(startY, curY);
      const w = Math.abs(curX - startX), h = Math.abs(curY - startY);
      if (w < 3 && h < 3) return;
      justMarqueedRef.current = true;
      setMarquee({ x, y, w, h });
      const hitIds = nodes.filter(n => {
        const el = document.getElementById(`node-${n.id}`);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const nx = r.left - rect.left, ny = r.top - rect.top;
        return nx < x + w && nx + r.width > x && ny < y + h && ny + r.height > y;
      }).map(n => n.id);
      setSelected(additive ? Array.from(new Set([...baseSelected, ...hitIds])) : hitIds);
      setSelectedEdge(null);
    };
    const onUp = () => {
      if (marqueeRef.current) { marqueeRef.current = null; setMarquee(null); }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [nodes]);

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
    // A port can fan out to multiple targets — only block re-adding the exact same edge twice.
    const dup = connections.find(c => c.fromId === draggingConn.fromId && c.fromPort === draggingConn.fromPort && c.toId === toId);
    if (!dup) setConnections(cs => [...cs, { id: nid(), fromId: draggingConn.fromId, fromPort: draggingConn.fromPort, toId }]);
    setDraggingConn(null);
  }, [draggingConn, connections, setConnections]);

  // ── Save (CP flow or Group template, depending on `source`) ──
  const save = async () => {
    setSaving(true); setSaveMsg("");
    try {
      const body = source.kind === "template"
        ? { name: templateMeta.name, description: templateMeta.description, nodes, connections }
        : { nodes, connections };
      const r = await fetch(saveUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      setSaveMsg(d.success ? "✓ Saved!" : "✗ Failed");
    } catch { setSaveMsg("✗ Network error"); }
    setSaving(false);
    setTimeout(() => setSaveMsg(""), 3000);
  };

  const updateNode = useCallback((updated) => {
    setNodes(ns => ns.map(n => n.id === updated.id ? updated : n));
  }, [setNodes]);

  const openGroupNode = useCallback((node) => {
    const templateId = node?.config?.template_id;
    if (!templateId) return;
    onOpenGroup?.(templateId, node.config?.template_name);
  }, [onOpenGroup]);

  const selectedNode = useMemo(() => (selected.length === 1 ? nodes.find(n => n.id === selected[0]) || null : null), [nodes, selected]);
  // Group Input/Output only make sense while editing a Group's own contents —
  // they'd be meaningless (and undraggable-in-practice, but hide them anyway)
  // on the main per-CP canvas.
  const isInsideGroup = source.kind === "template";
  const filteredPalette = useMemo(() => {
    const q = paletteSearch.toLowerCase();
    return NODE_TYPES
      .filter(t => isInsideGroup || (t.type !== "group_input" && t.type !== "group_output"))
      .filter(t => t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q));
  }, [paletteSearch, isInsideGroup]);
  const categories = useMemo(() => {
    const cats = {};
    filteredPalette.forEach(t => { if (!cats[t.category]) cats[t.category] = []; cats[t.category].push(t); });
    return cats;
  }, [filteredPalette]);

  const handleApplySuccess = useCallback(() => {
    setApplyMsg("✓ Applied!");
    setTimeout(() => setApplyMsg(""), 2000);
  }, []);

  const titleBadge = source.kind === "template" ? `📦 ${templateMeta.name || source.templateId}` : `CP${String(source.cpNumber).padStart(2, "0")}`;

  // ── Render (content only — ModalBackdrop/ModalPanel live in the LogicBuilder wrapper) ──
  return (
    <>
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-soft)] shrink-0" style={{ background: "var(--bg-surface-2)" }}>
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="h-7 px-2.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] text-[10px] font-bold transition-colors flex items-center gap-1">← Back</button>
          )}
          <span className="text-[#22C55E] font-black text-lg tracking-tighter">WIK</span>
          <div className="w-px h-5 bg-[var(--border)]" />
          <span className="text-[var(--text-primary)] font-bold text-sm">Logic Builder</span>
          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/30">{titleBadge}</span>
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
          <div className="flex items-center gap-1">
            <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" className="w-7 h-7 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center text-xs">↶</button>
            <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" className="w-7 h-7 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center text-xs">↷</button>
            <button onClick={copySelection} disabled={!selected.length} title="Copy (Ctrl+C)" className="w-7 h-7 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center text-xs">⧉</button>
            <button onClick={pasteClipboard} disabled={!clipboard?.nodes?.length} title="Paste (Ctrl+V)" className="w-7 h-7 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center text-xs">📋</button>
          </div>
          <div className="w-px h-5 bg-[var(--border)]" />
          <button onClick={() => { commitFlow(() => [], () => []); setSelected([]); }} className="h-7 px-3 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] text-[10px] font-bold transition-colors">Clear</button>
          <button onClick={save} disabled={saving} className="h-7 px-4 rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] text-white font-bold text-[10px] transition-colors disabled:opacity-50 flex items-center gap-1.5">{saving ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</> : "💾 Save Flow"}</button>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"><IconX /></button>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden min-h-0">
        <div className="w-48 shrink-0 border-r border-[var(--border-soft)] flex flex-col" style={{ background: "var(--bg-surface-2)" }}>
          <div className="px-3 pt-3 pb-2 shrink-0"><p className="text-[#3B82F6] text-[9px] font-bold uppercase tracking-widest mb-2">Logic Nodes</p><input value={paletteSearch} onChange={e => setPaletteSearch(e.target.value)} placeholder="Search…" className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded-lg px-2 h-7 outline-none placeholder-[var(--text-faint)] focus:border-[#3B82F6]/50" /></div>
          <div className="flex-1 overflow-y-auto px-2 pb-3 flex flex-col gap-3" style={{ scrollbarWidth: "thin", scrollbarColor: "#334155 var(--bg-surface-2)" }}>
            {NODE_TYPES.length === 0 && (
              <p className="text-[var(--text-faint)] text-[10px] px-1">No node types yet — add them in LogicBuilder.jsx.</p>
            )}
            {Object.entries(categories).map(([cat, items]) => (
              <div key={cat}>
                <p className="text-[8px] font-bold uppercase tracking-widest px-1 mb-1" style={{ color: items[0] ? NODE_TYPES.find(t => t.category === cat)?.color : "var(--text-muted)" }}>{CATEGORY_LABELS[cat]}</p>
                <div className="flex flex-col gap-1">{items.map(node => (<div key={node.type} draggable onDragStart={e => e.dataTransfer.setData("node-type", node.type)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-[var(--border-soft)] hover:border-opacity-50 cursor-grab active:cursor-grabbing transition-colors" onMouseEnter={e => e.currentTarget.style.borderColor = node.color + "60"} onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border-soft)"}><span className="text-sm w-5 text-center shrink-0">{node.icon}</span><div className="flex flex-col min-w-0"><span className="text-[var(--text-primary)] text-[10px] font-semibold leading-tight">{node.label}</span><span className="text-[var(--text-muted)] text-[8px] leading-tight truncate">{node.desc}</span></div></div>))}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-auto min-h-0 relative" style={{ background: "var(--bg-surface-2)", scrollbarWidth: "thin", scrollbarColor: "#334155 var(--bg-surface-2)" }}>
          {loading ? (<div className="flex items-center justify-center h-full gap-2 text-[#3B82F6] text-xs"><div className="w-4 h-4 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /> Loading flow…</div>) : (
            <div ref={canvasRef} onDragOver={e => e.preventDefault()} onDrop={handleDrop}
                 onMouseDown={startMarquee}
                 onClick={(e) => {
                   if (e.target !== e.currentTarget) return;
                   if (justMarqueedRef.current) { justMarqueedRef.current = false; return; }
                   clearSelection();
                 }} className="relative"
                 style={{ width: canvasSize.width, height: canvasSize.height, background: "var(--bg-surface-2)", backgroundImage: "radial-gradient(circle, var(--border-soft) 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
              {nodes.length === 0 && (<div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none"><span className="text-5xl opacity-10 mb-3">⚡</span><p className="text-[var(--text-faint)] text-sm font-mono">Drag logic nodes here to build your flow</p></div>)}
              <ConnectionLines connections={connections} nodes={nodes} draggingConnection={draggingConn} selectedEdge={selectedEdge} onSelectEdge={selectEdge} />
              {nodes.map(node => (<NodeCard key={node.id} node={node} selected={selected.includes(node.id)} onSelect={toggleSelect} onDragStart={startNodeDrag} onDelete={id => { commitFlow(ns => ns.filter(n => n.id !== id), cs => cs.filter(c => c.fromId !== id && c.toId !== id)); setSelected(sel => sel.filter(s => s !== id)); }} onPortMouseDown={startPortDrag} onPortMouseUp={finishConnection} onOpenGroup={openGroupNode} />))}
              {marquee && (
                <div className="absolute border-2 border-dashed border-[#3B82F6] bg-[#3B82F6]/10 pointer-events-none z-30"
                     style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
              )}
            </div>
          )}
        </div>
        <div className="w-64 shrink-0 border-l border-[var(--border-soft)] flex flex-col" style={{ background: "var(--bg-surface-2)" }}>
          <ConfigPanel node={selectedNode} onChange={updateNode} onApply={handleApplySuccess} tcpDevices={tcpDevices} rtuDevices={rtuDevices} templates={templates} onCreateTemplate={onCreateTemplate} onOpenGroup={onOpenGroup} cpNumber={cpNumber} activeGroupName={source.kind === "template" ? (templateMeta.name || source.templateName || source.templateId || "") : ""} />
        </div>
      </div>
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-[var(--border-soft)] shrink-0" style={{ background: "var(--bg-surface-2)" }}>
        <span className="text-[var(--text-faint)] text-[9px] font-mono">{nodes.length} node{nodes.length !== 1 ? "s" : ""} · {connections.length} connection{connections.length !== 1 ? "s" : ""}</span>
        <span className="text-[var(--text-faint)] text-[9px] font-mono">Del = delete · Ctrl+Z/Y = undo/redo · Ctrl+C/X/V = copy/cut/paste · Ctrl+A = select all · drag box = multi-select · drag port → port to connect · double-click Group = buka isinya</span>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// MAIN LOGIC BUILDER MODAL — owns the modal chrome and the "group stack"
// (which flow is currently being edited: the CP's own flow, or drilled into
// a Group's contents, possibly nested). Device lists and the Group template
// list are fetched once here and shared by every level of the stack.
// ════════════════════════════════════════════════════════════════
export default function LogicBuilder({ cpNumber, onClose }) {
  const [groupStack, setGroupStack] = useState([]); // [{ templateId, templateName }, ...]
  const [tcpDevices, setTcpDevices] = useState([]);    // Modbus TCP
  const [rtuDevices, setRtuDevices] = useState([]);    // Modbus RTU
  const [templates, setTemplates] = useState([]);      // Group templates (id/name/node_count)

  const refreshTemplates = useCallback(() => {
    fetch(`${API}/api/logic-templates`).then(r => r.ok ? r.json() : { templates: [] }).then(d => setTemplates(d.templates || [])).catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API}/api/tcp/devices`).then(r => r.ok ? r.json() : { devices: [] }).then(d => setTcpDevices(d.devices || [])).catch(() => {});
    fetch(`${API}/api/rtu/devices`).then(r => r.ok ? r.json() : { devices: [] }).then(d => setRtuDevices(d.devices || [])).catch(() => {});
    refreshTemplates();
  }, [refreshTemplates]);

  const createTemplate = useCallback(async (name) => {
    try {
      const r = await fetch(`${API}/api/logic-templates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const d = await r.json();
      if (d.success) {
        // Seed every new Group with an explicit Input -> Output pair pre-wired,
        // so opening it for the first time shows the interface instead of a
        // blank canvas — the user just inserts their real logic in between.
        try {
          await fetch(`${API}/api/logic-templates/${encodeURIComponent(d.id)}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: d.name, description: "",
              nodes: [
                { id: "gi", type: "group_input", x: 60, y: 40, config: { ...DEFAULT_NODE_CONFIG.group_input } },
                { id: "go", type: "group_output", x: 60, y: 220, config: { ...DEFAULT_NODE_CONFIG.group_output } },
              ],
              connections: [{ id: "gi_go", fromId: "gi", fromPort: "next", toId: "go" }],
            }),
          });
        } catch { /* seeding is a convenience — an empty Group still works fine */ }
        refreshTemplates();
        return { id: d.id, name: d.name };
      }
    } catch { /* ignore — button just won't populate a new template */ }
    return null;
  }, [refreshTemplates]);

  const openGroup = useCallback((templateId, templateName) => {
    setGroupStack(stack => [...stack, { templateId, templateName }]);
  }, []);

  const backOneLevel = useCallback(() => {
    setGroupStack(stack => stack.slice(0, -1));
  }, []);

  const top = groupStack[groupStack.length - 1];
  const source = top ? { kind: "template", templateId: top.templateId } : { kind: "cp", cpNumber };

  return (
    <ModalBackdrop className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm font-sans">
      <ModalPanel className="flex flex-col rounded-2xl overflow-hidden border border-[var(--border)] shadow-2xl" style={{ width: "min(98vw, 1700px)", height: "min(96vh, 900px)", background: "var(--bg-surface)" }}>
        <FlowEditor
          key={top ? `template:${top.templateId}` : `cp:${cpNumber}`}
          source={source}
          cpNumber={cpNumber}
          onClose={onClose}
          onBack={top ? backOneLevel : undefined}
          tcpDevices={tcpDevices}
          rtuDevices={rtuDevices}
          templates={templates}
          onCreateTemplate={createTemplate}
          onOpenGroup={openGroup}
        />
      </ModalPanel>
    </ModalBackdrop>
  );
}