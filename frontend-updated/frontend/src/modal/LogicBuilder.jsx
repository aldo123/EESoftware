// src/modal/LogicBuilder.jsx
import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react";
import { API } from "../service/api";
import { ModalBackdrop, ModalPanel } from "../components/motion";

// ── Node type definitions ─────────────────────────────────────────────────────
// Add new node types here one at a time:
//   { type: "my_node", category: "check" | "data" | "action" | "trigger",
//     color: "#RRGGBB", icon: "🔧", label: "My Node", desc: "..." }
// then give it a default config below and a config panel block in <ConfigPanel>.
// "check" category nodes get true/false output ports (see NodeCard's `hasTrue`).
const NODE_TYPES = [
  { type: "device_trigger", category: "trigger", color: "#3B82F6", icon: "📡", label: "Device Trigger", desc: "Start a flow from RS232 / Modbus TCP / Modbus RTU" },
  { type: "zone_inspect", category: "check", color: "#8B5CF6", icon: "🔍", label: "Zone Inspect", desc: "Inspect a camera ROI (vision engine)" },
  { type: "count_over_time", category: "check", color: "#8B5CF6", icon: "⏱", label: "Count Over Time", desc: "Count detections in a camera ROI over N seconds" },
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

// ── Node default configs ──────────────────────────────────────────────────────
// Keyed by node `type`. Add one entry per new node type.
const DEFAULT_NODE_CONFIG = {
  device_trigger: {
    connection_type: "rs232", device: "",
    device_name: "", address_type: "holding_register", address: "0", trigger_value: "1",
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
};

// ── Node card component ────────────────────────────────────────────────────
// "check" category nodes get true/false output ports; everything else gets a
// single generic "next" port. A node type that needs different ports again
// (e.g. Switch's dynamic per-case ports) should extend this the same way the
// old version did, keyed off `node.type` — not hardcoded here.
const NodeCard = memo(function NodeCard({ node, selected, onSelect, onDragStart, onDelete, onPortMouseDown, onPortMouseUp }) {
  const def = NODE_TYPES.find(t => t.type === node.type);
  if (!def) return null;
  const hasTrue = def.category === "check";

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
      </div>

      <div onMouseUp={e => { e.stopPropagation(); onPortMouseUp(node.id, "in"); }} className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-[#475569] hover:border-[#22C55E] bg-[#0B1120] cursor-crosshair transition-colors z-20" />
      {hasTrue ? (
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
const ConfigPanel = memo(function ConfigPanel({ node, onChange, onApply, commDevices = [], tcpDevices = [], rtuDevices = [] }) {
  const [localConfig, setLocalConfig] = useState({});

  useEffect(() => {
    setLocalConfig(node?.config || {});
  }, [node?.id]);

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

  const applyChanges = () => {
    onChange({ ...node, config: localConfig });
    if (onApply) onApply();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border-soft)] shrink-0">
        <span className="text-base">{def?.icon}</span>
        <span className="text-[var(--text-primary)] font-bold text-xs">{def?.label || node.type}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3" style={{ scrollbarWidth: "thin", scrollbarColor: "#334155 var(--bg-surface-2)" }}>
        {node.type === "device_trigger" && (<>
          <Field label="Connection Type">
            <Select value={c.connection_type || "rs232"} onChange={v => setLocal("connection_type", v)} options={[
              { value: "rs232", label: "RS232 (Scanner)" },
              { value: "modbus_tcp", label: "Modbus TCP" },
              { value: "modbus_rtu", label: "Modbus RTU (RS485)" },
            ]} />
          </Field>

          {(c.connection_type || "rs232") === "rs232" && (
            <Field label="Scanner Device">
              <Select value={c.device} onChange={v => setLocal("device", v)} options={[{ value: "", label: "Select device…" }, ...commDevices.map(d => ({ value: d.name, label: `${d.name} (${d.port || ""})` }))]} />
            </Field>
          )}

          {(c.connection_type === "modbus_tcp" || c.connection_type === "modbus_rtu") && (<>
            <Field label="Device Name">
              <Select value={c.device_name} onChange={v => setLocal("device_name", v)} options={[{ value: "", label: "Select device…" }, ...((c.connection_type === "modbus_rtu" ? rtuDevices : tcpDevices) || []).map(d => ({ value: d.name, label: d.name }))]} />
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
            <Field label="Trigger Value (fires once when reached)"><Input value={c.trigger_value} onChange={v => setLocal("trigger_value", v)} placeholder="1" /></Field>
            <p className="text-[var(--text-muted)] text-[9px] mt-1">Register ini dibaca terus-menerus di background (tiap 0.3 detik). Flow jalan sekali tiap kali nilainya BARU mencapai Trigger Value (naik dari nilai lain), bukan tiap kali dibaca.</p>
          </>)}

          <Field label="Store value in field key"><Input value={c.fieldKey} onChange={v => setLocal("fieldKey", v)} placeholder="e.g. product_sn" /></Field>
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
      </div>

      <div className="p-3 border-t border-[var(--border-soft)] shrink-0">
        <button onClick={applyChanges} className="w-full h-8 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-white font-bold text-[10px] transition-colors">Apply Settings to Node</button>
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
    if (portType === "in") return { x: node.x + W / 2, y: node.y };
    if (portType === "true") return { x: node.x + W / 4, y: node.y + H };
    if (portType === "false") return { x: node.x + W * 3 / 4, y: node.y + H };
    return { x: node.x + W / 2, y: node.y + H };
  };

  return (
    <svg className="absolute inset-0" style={{ width: "100%", height: "100%", overflow: "visible" }}>
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
        return <path key={conn.id} d={d} fill="none" stroke={color} strokeWidth="2" strokeDasharray={conn.fromPort === "false" ? "6 3" : "none"} markerEnd={arrow} opacity="0.8"
          className="cursor-pointer hover:stroke-[3px]"
          onClick={(e) => { e.stopPropagation(); onSelectEdge(conn.id); }} />;
      })}
      {draggingConnection && (<path d={`M${draggingConnection.x1},${draggingConnection.y1} C${draggingConnection.x1},${draggingConnection.y1 + 50} ${draggingConnection.x2},${draggingConnection.y2 - 50} ${draggingConnection.x2},${draggingConnection.y2}`} fill="none" stroke="#22C55E" strokeWidth="2" strokeDasharray="4 2" opacity="0.6" />)}
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
  const [paletteSearch, setPaletteSearch] = useState("");
  const canvasRef = useRef(null);

  const [canvasSize, setCanvasSize] = useState({ width: 1400, height: 900 });

  const [commDevices, setCommDevices] = useState([]); // RS232
  const [tcpDevices, setTcpDevices] = useState([]);    // Modbus TCP
  const [rtuDevices, setRtuDevices] = useState([]);    // Modbus RTU

  // ── Load flow for this CP ──────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/logic-config/${cpNumber}`)
      .then(r => r.ok ? r.json() : { nodes: [], connections: [] })
      .then(d => {
        const loadedNodes = d.nodes || [];
        setNodes(loadedNodes);
        setConnections(d.connections || []);
        setLoading(false);
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
  }, [cpNumber]);

  // ── Device lists for the Device Trigger node's config panel ──
  useEffect(() => {
    fetch(`${API}/api/rs232/devices`).then(r => r.ok ? r.json() : { devices: [] }).then(d => setCommDevices(d.devices || [])).catch(() => {});
    fetch(`${API}/api/tcp/devices`).then(r => r.ok ? r.json() : { devices: [] }).then(d => setTcpDevices(d.devices || [])).catch(() => {});
    fetch(`${API}/api/rtu/devices`).then(r => r.ok ? r.json() : { devices: [] }).then(d => setRtuDevices(d.devices || [])).catch(() => {});
  }, []);

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
    // A port can fan out to multiple targets — only block re-adding the exact same edge twice.
    const dup = connections.find(c => c.fromId === draggingConn.fromId && c.fromPort === draggingConn.fromPort && c.toId === toId);
    if (!dup) setConnections(cs => [...cs, { id: nid(), fromId: draggingConn.fromId, fromPort: draggingConn.fromPort, toId }]);
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
    <ModalBackdrop className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm font-sans">
      <ModalPanel className="flex flex-col rounded-2xl overflow-hidden border border-[var(--border)] shadow-2xl" style={{ width: "min(98vw, 1700px)", height: "min(96vh, 900px)", background: "var(--bg-surface)" }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-soft)] shrink-0" style={{ background: "var(--bg-surface-2)" }}>
          <div className="flex items-center gap-3">
            <span className="text-[#22C55E] font-black text-lg tracking-tighter">WIK</span>
            <div className="w-px h-5 bg-[var(--border)]" />
            <span className="text-[var(--text-primary)] font-bold text-sm">Logic Builder</span>
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
            <button onClick={() => { setNodes([]); setConnections([]); setSelected(null); }} className="h-7 px-3 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] text-[10px] font-bold transition-colors">Clear</button>
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
              <div ref={canvasRef} onDragOver={e => e.preventDefault()} onDrop={handleDrop} onClick={(e) => { if (e.target === e.currentTarget) { setSelected(null); setSelectedEdge(null); } }} className="relative"
                   style={{ width: canvasSize.width, height: canvasSize.height, background: "var(--bg-surface-2)", backgroundImage: "radial-gradient(circle, var(--border-soft) 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
                {nodes.length === 0 && (<div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none"><span className="text-5xl opacity-10 mb-3">⚡</span><p className="text-[var(--text-faint)] text-sm font-mono">Drag logic nodes here to build your flow</p></div>)}
                <ConnectionLines connections={connections} nodes={nodes} draggingConnection={draggingConn} onSelectEdge={setSelectedEdge} />
                {nodes.map(node => (<NodeCard key={node.id} node={node} selected={node.id === selected} onSelect={setSelected} onDragStart={startNodeDrag} onDelete={id => { setNodes(ns => ns.filter(n => n.id !== id)); setConnections(cs => cs.filter(c => c.fromId !== id && c.toId !== id)); if (selected === id) setSelected(null); }} onPortMouseDown={startPortDrag} onPortMouseUp={finishConnection} />))}
              </div>
            )}
          </div>
          <div className="w-64 shrink-0 border-l border-[var(--border-soft)] flex flex-col" style={{ background: "var(--bg-surface-2)" }}>
            <ConfigPanel node={selectedNode} onChange={updateNode} onApply={handleApplySuccess} commDevices={commDevices} tcpDevices={tcpDevices} rtuDevices={rtuDevices} />
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-[var(--border-soft)] shrink-0" style={{ background: "var(--bg-surface-2)" }}>
          <span className="text-[var(--text-faint)] text-[9px] font-mono">{nodes.length} node{nodes.length !== 1 ? "s" : ""} · {connections.length} connection{connections.length !== 1 ? "s" : ""}</span>
          <span className="text-[var(--text-faint)] text-[9px] font-mono">Del = delete node · drag port → port to connect</span>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
