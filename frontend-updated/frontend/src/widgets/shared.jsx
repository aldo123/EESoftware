// src/widgets/shared.jsx
// Shared design system, icon libraries, and small UI helpers used by
// every widget module (button, light, shape, textbox, gauge, linechart,
// manualcontrol, calibration, timinglimit).
// Both the Page Builder (design-time) and Dynamic CP Page (runtime)
// import from this single source of truth so visuals never drift apart.
import { useState } from "react";

// ──────────────────────────────────────────────────────────────────
//  HMI DESIGN SYSTEM - THEME & VISUAL PROPS
// ──────────────────────────────────────────────────────────────────

export const THEME_PRESETS = {
  "wik_cyan": {
    accent: "var(--accent-cyan)", background: "var(--panel-canvas)", border: "var(--panel-mid)", text: "#FFFFFF", secondary: "var(--panel-line)", success: "var(--accent-green-neon)", warning: "var(--accent-orange)", danger: "var(--accent-red-bright)"
  },
  "industrial_blue": {
    accent: "var(--accent-blue)", background: "var(--panel-canvas)", border: "var(--bg-hover)", text: "var(--text-primary)", secondary: "var(--text-secondary)", success: "var(--accent-green)", warning: "var(--accent-orange-alt)", danger: "var(--accent-red)"
  },
  "emerald": {
    accent: "var(--accent-green)", background: "var(--status-green-bg)", border: "var(--status-green-solid)", text: "#FFFFFF", secondary: "var(--swatch-sage)", success: "var(--accent-green-neon)", warning: "var(--accent-orange)", danger: "var(--accent-red-bright)"
  },
  "amber": {
    accent: "var(--accent-orange)", background: "var(--status-orange-bg)", border: "var(--status-orange-bg)", text: "#FFFFFF", secondary: "var(--swatch-tan)", success: "var(--accent-green-neon)", warning: "var(--accent-orange)", danger: "var(--accent-red-bright)"
  },
  "red_alert": {
    accent: "var(--accent-red)", background: "var(--status-red-bg)", border: "var(--status-red-bg)", text: "var(--accent-red-soft)", secondary: "var(--swatch-rose)", success: "var(--accent-green)", warning: "var(--accent-orange)", danger: "var(--accent-red)"
  }
};

export const DEFAULT_VISUAL = {
  theme: "wik_cyan",
  accentColor: "var(--accent-cyan)",
  backgroundColor: "var(--panel-canvas)",
  borderColor: "var(--panel-mid)",
  textColor: "#FFFFFF",
  secondaryTextColor: "var(--panel-line)",
  borderWidth: 1,
  borderRadius: 12,
  glow: true,
  glowIntensity: 18
};


export const getVisual = (props) => {
  if (!props.visual) return { ...DEFAULT_VISUAL, ...(props.color ? { accentColor: props.color } : {}) };
  const themeColors = THEME_PRESETS[props.visual.theme] || THEME_PRESETS["wik_cyan"];
  return { ...DEFAULT_VISUAL, ...themeColors, ...props.visual };
};


// ──────────────────────────────────────────────────────────────────
//  GRID / ID HELPERS (Page Builder only)
// ──────────────────────────────────────────────────────────────────

export const GRID = 5;
export const snap = (v) => Math.round(v / GRID) * GRID;
let _uid = 1;
export const uid = () => `w${Date.now()}_${_uid++}`;

// ──────────────────────────────────────────────────────────────────
//  ICON LIBRARIES
// ──────────────────────────────────────────────────────────────────

// Lightweight Unicode icon set: no external icon package required.
export const TEXTBOX_ICONS = [
  { value: "", label: "None", icon: "" },
  { value: "⚙", label: "Settings", icon: "⚙" },
  { value: "✓", label: "Success", icon: "✓" },
  { value: "✕", label: "Error", icon: "✕" },
  { value: "⚠", label: "Warning", icon: "⚠" },
  { value: "ℹ", label: "Info", icon: "ℹ" },
  { value: "●", label: "Status", icon: "●" },
  { value: "○", label: "Off", icon: "○" },
  { value: "▶", label: "Run", icon: "▶" },
  { value: "■", label: "Stop", icon: "■" },
  { value: "↻", label: "Refresh", icon: "↻" },
  { value: "↻", label: "Reset", icon: "↻" },
  { value: "⏸", label: "Pause", icon: "⏸" },
  { value: "⏱", label: "Timer", icon: "⏱" },
  { value: "🔧", label: "Maintenance", icon: "🔧" },
  { value: "🛠", label: "Tools", icon: "🛠" },
  { value: "🔒", label: "Lock", icon: "🔒" },
  { value: "🔓", label: "Unlock", icon: "🔓" },
  { value: "🔑", label: "Key", icon: "🔑" },
  { value: "📦", label: "Material", icon: "📦" },
  { value: "📋", label: "Checklist", icon: "📋" },
  { value: "📝", label: "Document", icon: "📝" },
  { value: "📊", label: "Chart", icon: "📊" },
  { value: "📈", label: "Trend", icon: "📈" },
  { value: "💾", label: "Save", icon: "💾" },
  { value: "🗑", label: "Delete", icon: "🗑" },
  { value: "🔍", label: "Search", icon: "🔍" },
  { value: "🔔", label: "Alarm", icon: "🔔" },
  { value: "💡", label: "Light", icon: "💡" },
  { value: "⚡", label: "Power", icon: "⚡" },
  { value: "🔌", label: "Electrical", icon: "🔌" },
  { value: "🌡", label: "Temperature", icon: "🌡" },
  { value: "💧", label: "Water", icon: "💧" },
  { value: "💨", label: "Air", icon: "💨" },
  { value: "🔄", label: "Cycle", icon: "🔄" },
  { value: "⬆", label: "Up", icon: "⬆" },
  { value: "⬇", label: "Down", icon: "⬇" },
  { value: "⬅", label: "Left", icon: "⬅" },
  { value: "➡", label: "Right", icon: "➡" },
  { value: "🏠", label: "Home", icon: "🏠" },
  { value: "👤", label: "User", icon: "👤" },
  { value: "🔴", label: "Red", icon: "🔴" },
  { value: "🟢", label: "Green", icon: "🟢" },
  { value: "🟡", label: "Yellow", icon: "🟡" },
  { value: "🔵", label: "Blue", icon: "🔵" },
  { value: "⭕", label: "Circle", icon: "⭕" },
  { value: "✓", label: "Pass", icon: "✓" },
  { value: "✗", label: "NG", icon: "✗" },
  { value: "⚙️", label: "Machine", icon: "⚙️" },
];


// Used by Page Builder and persisted in widget.props.gaugeType.
// Runtime renders the same type using the same GaugeTypeIcon below.
export const GAUGE_TYPES = [
  { value: "temp", label: "Temperature", icon: "🌡", unit: "°C" },
  { value: "power", label: "Power", icon: "⚡", unit: "kW" },
  { value: "water", label: "Water", icon: "💧", unit: "L/min" },
  { value: "pressure", label: "Pressure", icon: "◉", unit: "bar" },
  { value: "flow", label: "Flow", icon: "➜", unit: "L/min" },
  { value: "level", label: "Level", icon: "▥", unit: "%" },
  { value: "speed", label: "Speed", icon: "◔", unit: "RPM" },
  { value: "current", label: "Current", icon: "∿", unit: "A" },
];


/*
 * Shared Modbus address types.
 * Keep these values identical with the runtime/API:
 *   coil            -> FC01 read / FC05 write
 *   discrete_input  -> FC02 read
 *   holding_register-> FC03 read / FC06 or FC16 write
 *   input_register  -> FC04 read
 */
// Component-specific Modbus address capabilities.
//
// BUTTON = WRITE only:
//   - Coil            -> FC05
//   - Holding Register -> FC06 / FC16
//
// LIGHT = READ:
//   - Coil             -> FC01
//   - Discrete Input   -> FC02
//   - Holding Register -> FC03
//   - Input Register   -> FC04
//
// GAUGE = READ numeric value:
//   - Holding Register -> FC03 only
export const BUTTON_ADDRESS_TYPES = [
  { value: "coil", label: "Coil (FC05 Write)" },
  { value: "holding_register", label: "Holding Register (FC06 / FC16 Write)" },
];


export const LIGHT_ADDRESS_TYPES = [
  { value: "coil", label: "Coil (FC01 Read)" },
  { value: "discrete_input", label: "Discrete Input (FC02 Read)" },
  { value: "holding_register", label: "Holding Register (FC03 Read)" },
  { value: "input_register", label: "Input Register (FC04 Read)" },
];


export const GAUGE_ADDRESS_TYPES = [
  { value: "holding_register", label: "Holding Register (FC03 Read)" },
];


export const LINECHART_ADDRESS_TYPES = [
  { value: "coil", label: "Coil (FC01 Read)" },
  { value: "discrete_input", label: "Discrete Input (FC02 Read)" },
  { value: "holding_register", label: "Holding Register (FC03 Read)" },
  { value: "input_register", label: "Input Register (FC04 Read)" },
];


export const LINECHART_SERIES_COLORS = [
  "var(--accent-cyan)",
  "var(--accent-red)",
  "var(--accent-green)",
  "var(--accent-orange)",
];


export const createLineChartSeries = (index = 0) => ({
  id: `series_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
  label: index === 0 ? "REALTIME" : `SERIES ${index + 1}`,
  device: "",
  addressType: "holding_register",
  address: "",
  color: LINECHART_SERIES_COLORS[index % LINECHART_SERIES_COLORS.length],
  enabled: true,
});


// ──────────────────────────────────────────────────────────────────
//  GAUGE ICON RENDERER (shared by Page Builder preview + Dynamic Page runtime)
// ──────────────────────────────────────────────────────────────────

export function GaugeTypeIcon({ type = "temp", color = "var(--accent-cyan)", size = 28 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };

  if (type === "power") return (
    <svg {...common}>
      <path d="M12 2v8" />
      <path d="M7.05 4.93a9 9 0 1 0 9.9 0" />
      <path d="M12 12l-2 4h3l-1 6 4-7h-3l2-3z" />
    </svg>
  );

  if (type === "water") return (
    <svg {...common}>
      <path d="M12 2.8S6.5 9.3 6.5 13.5a5.5 5.5 0 0 0 11 0C17.5 9.3 12 2.8 12 2.8z" />
      <path d="M9 14.5c.4 1.2 1.3 2 2.8 2.3" />
    </svg>
  );

  if (type === "pressure") return (
    <svg {...common}>
      <circle cx="12" cy="13" r="8" />
      <path d="M7.5 13a4.5 4.5 0 0 1 9 0" />
      <path d="M12 13l3.2-3.2" />
      <path d="M5 5l1.7 1.7M19 5l-1.7 1.7" />
    </svg>
  );

  if (type === "flow") return (
    <svg {...common}>
      <path d="M3 7h12" />
      <path d="m11 4 4 3-4 3" />
      <path d="M21 17H9" />
      <path d="m13 14-4 3 4 3" />
      <path d="M4 12h5" />
    </svg>
  );

  if (type === "level") return (
    <svg {...common}>
      <path d="M7 3v18M17 3v18" />
      <path d="M7 7h10M7 17h10" />
      <path d="M9.5 12c1.2-1.2 1.8-1.2 3 0s1.8 1.2 3 0" />
    </svg>
  );

  if (type === "speed") return (
    <svg {...common}>
      <path d="M4.5 16a8 8 0 1 1 15 0" />
      <path d="M12 12l4-4" />
      <path d="M6 18h12" />
    </svg>
  );

  if (type === "current") return (
    <svg {...common}>
      <path d="M7 3v7a5 5 0 0 0 10 0V3" />
      <path d="M9 21h6M12 15v6M9 3h6" />
    </svg>
  );

  return (
    <svg {...common}>
      <path d="M14 14.7V5a2 2 0 0 0-4 0v9.7a4.5 4.5 0 1 0 4 0z" />
      <path d="M12 11v6" />
    </svg>
  );
}


// ──────────────────────────────────────────────────────────────────
//  SMALL SVG ICONS (Page Builder UI chrome)
// ──────────────────────────────────────────────────────────────────

export function IconX() { return (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>); }

export function IconTrash() { return (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" /></svg>); }

export function IconDupe() { return (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>); }


// ──────────────────────────────────────────────────────────────────
//  PROPERTY PANEL FORM CONTROLS (Page Builder UI chrome)
// ──────────────────────────────────────────────────────────────────

export function PropInput({ label, value, onChange, type = "text", options, min, max }) {
  return (<div className="flex flex-col gap-0.5"><span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">{label}</span>
    {options ? (<select value={value} onChange={e => onChange(e.target.value)} className="bg-[var(--bg-canvas)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none focus:border-[var(--accent-green)]/60">{options.map(o => (<option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>))}</select>) :
      type === "checkbox" ? (<label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} className="accent-[var(--accent-green)]" /><span className="text-[10px] text-[var(--text-primary)]">{label}</span></label>) :
        type === "color" ? (<div className="flex items-center gap-2"><input type="color" value={value} onChange={e => onChange(e.target.value)} className="w-7 h-7 rounded cursor-pointer bg-transparent border border-[var(--border)]" /><input type="text" value={value} onChange={e => onChange(e.target.value)} className="flex-1 bg-[var(--bg-canvas)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none font-mono" /></div>) :
          (<input type={type} value={value} min={min} max={max} onChange={e => onChange(type === "number" ? Number(e.target.value) : e.target.value)} className="bg-[var(--bg-canvas)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none focus:border-[var(--accent-green)]/60" />)}
  </div>);
}

export function IconPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = TEXTBOX_ICONS.find(i => i.value === value) || TEXTBOX_ICONS[0];

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex-1 h-8 rounded border border-[var(--border)] bg-[var(--bg-canvas)] text-[var(--text-primary)] flex items-center gap-2 px-2 hover:border-[var(--accent-green)]/60 transition-colors"
        >
          <span className="w-6 h-6 flex items-center justify-center text-lg">
            {selected.icon || "—"}
          </span>
          <span className="text-[10px] text-[var(--text-soft)]">
            {selected.label}
          </span>
          <span className="ml-auto text-[var(--text-dim)]">⌄</span>
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="w-8 h-8 rounded border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--border-soft)]"
            title="Remove icon"
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-[100] left-0 right-0 mt-1 p-2 rounded-lg border border-[var(--border)] bg-[var(--panel-canvas)] shadow-2xl">
          <div className="grid grid-cols-6 gap-1 max-h-48 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {TEXTBOX_ICONS.map((item, index) => (
              <button
                key={`${item.label}-${index}`}
                type="button"
                title={item.label}
                onClick={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
                className="h-8 rounded flex items-center justify-center text-base border border-transparent hover:border-[var(--accent-green)]/50 hover:bg-[var(--border-soft)] transition-colors"
                style={{
                  background: value === item.value ? "rgba(34,197,94,0.12)" : "transparent",
                  color: value === item.value ? "var(--accent-green)" : "var(--text-soft)"
                }}
              >
                {item.icon || "—"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


export function PropSection({ title, children }) { return (<div className="flex flex-col gap-2 pb-3 border-b border-[var(--border-soft)]"><span className="text-[9px] font-bold text-[var(--accent-green)] uppercase tracking-widest pt-2">{title}</span>{children}</div>); }


// ──────────────────────────────────────────────────────────────────
//  ICON-POPUP WIDGETS (Manual Control / Calibration / Timing & Limit)
//
// These three widget types share the exact same shape: a small icon
// button on the canvas that, at runtime, opens a popup modal listing
// a configurable set of PLC-bound parameters (numeric value, boolean
// toggle, or momentary "jog" button). The per-widget files
// (manualcontrol.jsx / calibration.jsx / timinglimit.jsx) only supply
// the default title/icon/color — all the actual editor UI and popup
// behavior lives here so it never drifts between the three.
// ──────────────────────────────────────────────────────────────────

export const PARAM_KIND_OPTIONS = [
  { value: "value", label: "Value (Read/Write)" },
  { value: "boolean", label: "Boolean (Toggle)" },
  { value: "jog", label: "Jog Button (Momentary)" },
];

export const PARAM_VALUE_ADDRESS_TYPES = [
  { value: "holding_register", label: "Holding Register (Read/Write)" },
  { value: "input_register", label: "Input Register (Read only)" },
];

export const PARAM_BOOL_ADDRESS_TYPES = [
  { value: "coil", label: "Coil (Read/Write)" },
  { value: "discrete_input", label: "Discrete Input (Read only)" },
];

export const PARAM_JOG_ADDRESS_TYPES = [
  { value: "coil", label: "Coil (Write)" },
  { value: "holding_register", label: "Holding Register (Write)" },
];

let _paramFieldSeq = 1;
export const createParamField = (kind = "value", index = 0) => ({
  id: `field_${Date.now()}_${_paramFieldSeq++}`,
  label: kind === "jog" ? `Jog ${index + 1}` : `Param ${index + 1}`,
  kind,
  device: "",
  addressType: kind === "value" ? "holding_register" : "coil",
  address: "",
  min: 0,
  max: 100,
  step: 1,
  unit: "",
});

// Property-panel editor for the field list — add/remove/configure each
// parameter row. Shared by Manual Control, Calibration, and Timing & Limit.
export function ParamFieldsEditor({ fields, onChange, availableDevices = [] }) {
  const list = Array.isArray(fields) ? fields : [];

  const updateField = (idx, key, val) => {
    const next = [...list];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  };

  const removeField = (idx) => onChange(list.filter((_, i) => i !== idx));
  const addField = (kind) => onChange([...list, createParamField(kind, list.length)]);

  return (
    <div className="flex flex-col gap-2">
      {list.map((field, idx) => {
        const addressOptions =
          field.kind === "jog" ? PARAM_JOG_ADDRESS_TYPES :
          field.kind === "boolean" ? PARAM_BOOL_ADDRESS_TYPES :
          PARAM_VALUE_ADDRESS_TYPES;

        return (
          <div key={field.id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-canvas)] p-2.5 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 pb-1 border-b border-[var(--border-soft)]">
              <span className="text-[9px] text-[var(--text-primary)] font-bold truncate">{field.label || `FIELD ${idx + 1}`}</span>
              <button
                type="button"
                onClick={() => removeField(idx)}
                className="w-6 h-6 rounded border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent-red)] hover:border-[var(--accent-red)]/60 hover:bg-[var(--status-red-bg)] text-[11px] transition-colors"
                title="Remove field"
              >
                ×
              </button>
            </div>

            <PropInput label="Label" value={field.label || ""} onChange={v => updateField(idx, "label", v)} />
            <PropInput label="Kind" options={PARAM_KIND_OPTIONS} value={field.kind || "value"} onChange={v => updateField(idx, "kind", v)} />

            <div>
              <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
                Device
              </label>
              <select
                value={field.device || ""}
                onChange={e => updateField(idx, "device", e.target.value)}
                className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none focus:border-[var(--accent-green)]"
              >
                <option value="">Select device...</option>
                {availableDevices
                  .filter(dev => String(dev.type || "").toUpperCase() === "TCP")
                  .map(dev => (
                    <option key={`${dev.type || "TCP"}-${dev.name}`} value={dev.name}>
                      {dev.name}{dev.connection ? ` — ${dev.connection}` : ""}
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <PropInput
                label="Address Type"
                options={addressOptions}
                value={field.addressType || addressOptions[0].value}
                onChange={v => updateField(idx, "addressType", v)}
              />
              <PropInput
                label="Address"
                value={field.address ?? ""}
                onChange={v => updateField(idx, "address", v)}
                placeholder="0 / 10 / 100"
              />
            </div>

            {field.kind === "value" && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <PropInput label="Min" type="number" value={field.min ?? 0} onChange={v => updateField(idx, "min", Number(v))} />
                  <PropInput label="Max" type="number" value={field.max ?? 100} onChange={v => updateField(idx, "max", Number(v))} />
                  <PropInput label="Step" type="number" value={field.step ?? 1} onChange={v => updateField(idx, "step", Number(v))} />
                </div>
                <PropInput label="Unit" value={field.unit || ""} onChange={v => updateField(idx, "unit", v)} />
              </>
            )}
          </div>
        );
      })}

      {list.length === 0 && (
        <p className="text-[var(--text-faint)] text-[9px] text-center py-2">
          Belum ada parameter. Tambahkan salah satu tipe di bawah.
        </p>
      )}

      <div className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={() => addField("value")}
          className="h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] text-[var(--accent-green)] text-[9px] font-bold hover:bg-[var(--border-soft)] transition-colors"
        >
          + VALUE
        </button>
        <button
          type="button"
          onClick={() => addField("boolean")}
          className="h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] text-[var(--accent-green)] text-[9px] font-bold hover:bg-[var(--border-soft)] transition-colors"
        >
          + TOGGLE
        </button>
        <button
          type="button"
          onClick={() => addField("jog")}
          className="h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] text-[var(--accent-green)] text-[9px] font-bold hover:bg-[var(--border-soft)] transition-colors"
        >
          + JOG
        </button>
      </div>
    </div>
  );
}

// Page Builder canvas preview shared by all icon-popup widgets.
export function IconTriggerPreview({ widget, glyph }) {
  const p = widget.props || {};
  const accent = p.accentColor || "var(--accent-cyan)";
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-1.5 rounded-xl"
      style={{
        background: p.backgroundColor || "var(--panel-canvas)",
        border: `1px solid ${p.borderColor || "var(--panel-mid)"}`,
      }}
    >
      <span className="text-2xl" style={{ color: accent }}>{p.icon || glyph}</span>
      <span
        className="text-[10px] font-bold uppercase tracking-wider text-center px-1"
        style={{ color: p.textColor || "#FFFFFF" }}
      >
        {p.title || "Untitled"}
      </span>
    </div>
  );
}

// One row inside the popup for a "value" kind field: shows the live PLC
// value (when not being edited) and commits a new value on blur/Enter.
function ParamValueRow({ field, current, onCommit }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const displayValue = editing ? draft : (current === undefined || current === null ? "" : current);

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--text-secondary)] text-xs">{field.label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={displayValue}
          placeholder="--"
          min={field.min}
          max={field.max}
          step={field.step || 1}
          onFocus={() => { setEditing(true); setDraft(String(current ?? "")); }}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft !== "" && !Number.isNaN(Number(draft))) onCommit(Number(draft));
          }}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
          className="w-20 h-8 bg-[var(--bg-surface)] border border-[var(--border)] focus:border-[var(--accent-green)]/60 text-[var(--text-primary)] text-xs rounded-lg px-2 outline-none text-right"
        />
        {field.unit && <span className="text-[var(--text-muted)] text-[10px] w-8">{field.unit}</span>}
      </div>
    </div>
  );
}

/*
 * Runtime icon button + popup modal, shared by Manual Control, Calibration,
 * and Timing & Limit.
 *
 * `plc` is a small bundle passed down from DynamicCPPage.jsx:
 *   { tcpValues, writeTCPValue, getTCPDevice, normalizeType }
 * Each configured field is bound under key `${widget.id}:${field.id}`,
 * registered by DynamicCPPage's PLC-binding effect exactly like Line
 * Chart series bindings.
 */
export function IconTriggerRuntime({ widget, glyph, plc, onOpenPage }) {
  const p = widget.props || {};
  const [open, setOpen] = useState(false);
  const accent = p.accentColor || "var(--accent-cyan)";
  const fields = Array.isArray(p.fields) ? p.fields : [];
  const pageTarget = widget.type === "manualcontrol" ? "manual" : widget.type === "calibration" ? "calibration" : null;
  const { tcpValues = {}, writeTCPValue, getTCPDevice, normalizeType } = plc || {};

  const bindingId = (field) => `${widget.id}:${field.id}`;
  const readValue = (field) => tcpValues[bindingId(field)];

  const writeValueTo = async (field, value) => {
    const device = getTCPDevice ? getTCPDevice(field.device) : null;
    if (!device || !writeTCPValue) return;
    const addressType = normalizeType ? normalizeType(field.addressType) : field.addressType;
    try {
      await writeTCPValue({
        widgetId: bindingId(field),
        device,
        addressType,
        address: field.address,
        value,
      });
    } catch (e) {
      console.error(`[${widget.type}] write failed for ${field.label}:`, e);
    }
  };

  return (
    <div className="absolute" style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}>
      <button
        onClick={() => {
          if (onOpenPage && pageTarget) {
            onOpenPage(pageTarget);
            return;
          }
          setOpen(true);
        }}
        className="w-full h-full flex flex-col items-center justify-center gap-1.5 rounded-xl transition-transform active:scale-[0.97]"
        style={{
          background: p.backgroundColor || "var(--panel-canvas)",
          border: `1px solid ${p.borderColor || "var(--panel-mid)"}`,
        }}
      >
        <span className="text-2xl" style={{ color: accent }}>{p.icon || glyph}</span>
        <span
          className="text-[10px] font-bold uppercase tracking-wider text-center px-1"
          style={{ color: p.textColor || "#FFFFFF" }}
        >
          {p.title || "Untitled"}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="rounded-2xl border border-[var(--border)] shadow-2xl flex flex-col overflow-hidden"
            style={{
              width: Math.max(360, Number(p.popupWidth) || 420),
              maxHeight: "80vh",
              background: "var(--bg-surface-2)",
            }}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
              <div className="flex items-center gap-2">
                <span className="text-lg" style={{ color: accent }}>{p.icon || glyph}</span>
                <span className="text-[var(--text-primary)] font-bold text-sm">{p.title || "Untitled"}</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
              {fields.length === 0 && (
                <p className="text-[var(--text-faint)] text-xs text-center py-6">
                  Belum ada parameter. Tambahkan field di Page Builder.
                </p>
              )}

              {fields.map(field => {
                if (field.kind === "jog") {
                  return (
                    <button
                      key={field.id}
                      onMouseDown={() => writeValueTo(field, 1)}
                      onMouseUp={() => writeValueTo(field, 0)}
                      onMouseLeave={() => writeValueTo(field, 0)}
                      onTouchStart={() => writeValueTo(field, 1)}
                      onTouchEnd={() => writeValueTo(field, 0)}
                      className="h-11 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors select-none"
                      style={{ background: accent, color: "#052E16" }}
                    >
                      {field.label || "Jog"}
                    </button>
                  );
                }

                if (field.kind === "boolean") {
                  const isOn = Number(readValue(field)) === 1;
                  return (
                    <div key={field.id} className="flex items-center justify-between gap-3">
                      <span className="text-[var(--text-secondary)] text-xs">{field.label}</span>
                      <button
                        onClick={() => writeValueTo(field, isOn ? 0 : 1)}
                        className="h-8 px-4 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors"
                        style={{
                          background: isOn ? accent : "var(--border-soft)",
                          color: isOn ? "#052E16" : "var(--text-secondary)",
                        }}
                      >
                        {isOn ? "ON" : "OFF"}
                      </button>
                    </div>
                  );
                }

                return (
                  <ParamValueRow
                    key={field.id}
                    field={field}
                    current={readValue(field)}
                    onCommit={(val) => writeValueTo(field, val)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}