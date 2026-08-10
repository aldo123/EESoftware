// src/modal/PageBuilder.jsx
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { API } from "../service/api";

// ──────────────────────────────────────────────────────────────────
//  HMI DESIGN SYSTEM - THEME & VISUAL PROPS
// ──────────────────────────────────────────────────────────────────

const THEME_PRESETS = {
  "wik_cyan": {
    accent: "#00BFFF", background: "#07111F", border: "#123B5A", text: "#FFFFFF", secondary: "#7F9DB8", success: "#39FF88", warning: "#FFB020", danger: "#FF3B4D"
  },
  "industrial_blue": {
    accent: "#3B82F6", background: "#080E1A", border: "#1E3A5F", text: "#E2E8F0", secondary: "#94A3B8", success: "#22C55E", warning: "#F59E0B", danger: "#EF4444"
  },
  "emerald": {
    accent: "#22C55E", background: "#07150F", border: "#155E3A", text: "#FFFFFF", secondary: "#8BA99A", success: "#39FF88", warning: "#FFB020", danger: "#FF3B4D"
  },
  "amber": {
    accent: "#FFB020", background: "#181107", border: "#654B15", text: "#FFFFFF", secondary: "#B6A27A", success: "#39FF88", warning: "#FFB020", danger: "#FF3B4D"
  },
  "red_alert": {
    accent: "#EF4444", background: "#1A0C0C", border: "#5F1A1A", text: "#FCA5A5", secondary: "#A66E6E", success: "#22C55E", warning: "#FFB020", danger: "#EF4444"
  }
};

const DEFAULT_VISUAL = {
  theme: "wik_cyan",
  accentColor: "#00BFFF",
  backgroundColor: "#07111F",
  borderColor: "#123B5A",
  textColor: "#FFFFFF",
  secondaryTextColor: "#7F9DB8",
  borderWidth: 1,
  borderRadius: 12,
  glow: true,
  glowIntensity: 18
};

const getVisual = (props) => {
  if (!props.visual) return { ...DEFAULT_VISUAL, ...(props.color ? { accentColor: props.color } : {}) };
  const themeColors = THEME_PRESETS[props.visual.theme] || THEME_PRESETS["wik_cyan"];
  return { ...DEFAULT_VISUAL, ...themeColors, ...props.visual };
};

// ──────────────────────────────────────────────────────────────────
//  END OF DESIGN SYSTEM
// ──────────────────────────────────────────────────────────────────

const GRID = 5;
const CANVAS_PRESETS = [{ label: "Optimal (1260x800)", width: 1260, height: 800 }];


// ── TEXT BOX ICON LIBRARY ──────────────────────────────────────────
// Lightweight Unicode icon set: no external icon package required.
const TEXTBOX_ICONS = [
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

// 🔴 DUA KOMPONEN DENGAN VARIABLE (BUKAN FIELDKEY)
const COMPONENT_TYPES = [
  {
    type: "button",
    label: "Button",
    icon: "◉",
    desc: "Toggle button that writes a variable",
    defaultProps: {
      labelOn: "BUTTON ON",
      labelOff: "BUTTON OFF",
      variable: "Button1", // 🔴 UBAH KE variable
      variant: "neon",
      fontSize: 18,
      width: 180,
      height: 60,
      visual: { ...DEFAULT_VISUAL },
      // Simulation System
      simulation: {
        enabled: true,
        mode: "manual"
      },
      // State preview di builder
      builderState: 0
    }
  },
  {
    type: "light", 
    label: "Indicator Light", 
    icon: "💡",
    desc: "Status light that reads a variable",
    defaultProps: {
      label: "STATUS",
      variable: "Light1", // 🔴 UBAH KE variable
      shape: "circle",
      showLabel: true,
      onColor: "#00BFFF",
      offColor: "#1E293B",
      width: 120,
      height: 60,
      visual: { ...DEFAULT_VISUAL },
      // Simulation System
      simulation: {
        enabled: true,
        mode: "manual"
      },
      // State preview di builder
      builderState: 0
    }
  },
  {
    type: "shape",
    label: "Shape",
    icon: "◇",
    desc: "Basic graphic shape",
    defaultProps: {
      shapeType: "rectangle",
      fill: "#123B5A",
      borderColor: "#00BFFF",
      borderWidth: 1,
      radius: 8,
      rotation: 0,
      width: 160,
      height: 80,
      visual: { ...DEFAULT_VISUAL }
    }
  },
  {
    type: "textbox",
    label: "Text Box",
    icon: "T",
    desc: "Static text display",
    defaultProps: {
      text: "TEXT",
      variable: "",
      icon: "",
      iconPosition: "left",
      iconSize: 20,
      iconGap: 8,
      fontSize: 18,
      fontWeight: "600",
      textColor: "#FFFFFF",
      iconColor: "#FFFFFF",
      textAlign: "center",
      verticalAlign: "center",
      backgroundColor: "transparent",
      borderColor: "transparent",
      borderWidth: 0,
      radius: 6,
      padding: 8,
      width: 220,
      height: 60,
      rotation: 0,
      visual: { ...DEFAULT_VISUAL }
    }
  },
];

const snap = (v) => Math.round(v / GRID) * GRID;
let _uid = 1;
const uid = () => `w${Date.now()}_${_uid++}`;

function IconX() { return (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>); }
function IconTrash() { return (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" /></svg>); }
function IconDupe() { return (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>); }

// ── WIDGET PREVIEW ──────────────────────────────────────────────
function WidgetPreview({ widget, onUpdate }) {
  const { type, props: p } = widget;

  // ── PREVIEW BUTTON ──────────────────────────────────────────────
  if (type === "button") {
    const isOn = p.builderState === 1;
    const variant = p.variant || "neon";

    const currentBg = isOn ? (p.onBackground || "#00BFFF") : (p.offBackground || "#0F172A");
    const currentBorder = isOn ? (p.onBorder || "#00BFFF") : (p.offBorder || "#123B5A");
    const currentText = isOn ? (p.onTextColor || "#FFFFFF") : (p.offTextColor || "#7F9DB8");
    const currentLabel = isOn ? (p.labelOn || "ON") : (p.labelOff || "OFF");
    const fontSize = p.fontSize || 18;

    let btnStyle = {
      background: currentBg,
      border: `${1}px solid ${currentBorder}`,
      boxShadow: isOn ? `0 0 18px ${currentBg}` : "none",
      textColor: currentText,
      showLed: variant === "neon"
    };

    if (variant === "neon") {
      btnStyle.background = `linear-gradient(135deg, #07111F, ${currentBorder})`;
      btnStyle.boxShadow = isOn ? `0 0 18px ${currentBg}` : "none";
    }

    return (
      <div className="w-full h-full relative">
        <div
          className="w-full h-full rounded-xl flex flex-col items-center justify-center relative overflow-hidden transition-all duration-300"
          style={{
            background: btnStyle.background,
            border: btnStyle.border,
            boxShadow: btnStyle.boxShadow,
            borderRadius: 12
          }}
        >
          {btnStyle.showLed && (
            <div
              className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full transition-all duration-300"
              style={{
                background: isOn ? currentBg : "#0F172A",
                boxShadow: isOn ? `0 0 8px ${currentBg}` : "none"
              }}
            />
          )}
          <span
            className="font-bold uppercase tracking-widest"
            style={{
              color: btnStyle.textColor,
              fontSize: fontSize,
              textShadow: isOn ? `0 0 12px ${currentBg}` : "none"
            }}
          >
            {currentLabel}
          </span>
        </div>
      </div>
    );
  }

  // ── PREVIEW LIGHT INDICATOR ──────────────────────────────────────
  if (type === "light") {
    // 🔴 LOGIKA VARIABLE ENGINE: Jika nilai 1 = ON, selain itu OFF
    const isOn = p.builderState === 1;
    const shape = p.shape || "circle";
    const onColor = p.onColor || "#00BFFF";
    const offColor = p.offColor || "#1E293B";
    const currentColor = isOn ? onColor : offColor;
    const label = p.label || "STATUS";
    const showLabel = p.showLabel !== false;

    return (
      <div className={`w-full h-full flex items-center justify-center ${showLabel ? 'gap-4' : ''}`}>
        {/* LAMPU INDICATOR */}
        <div
          className={`transition-all duration-300 ${shape === 'circle' ? 'rounded-full' : 'rounded-md'}`}
          style={{
            width: 36,
            height: 36,
            background: `radial-gradient(circle at 35% 35%, ${isOn ? onColor : '#2A3A5A'}, ${currentColor})`,
            boxShadow: isOn ? `0 0 24px ${onColor}, inset 0 -2px 4px rgba(0,0,0,0.4)` : `inset 0 2px 6px rgba(0,0,0,0.6)`,
            border: `1px solid ${isOn ? onColor : '#1E293B'}`
          }}
        />

        {/* LABEL (Jika diaktifkan) */}
        {showLabel && (
          <span
            className="font-bold uppercase tracking-widest text-sm"
            style={{
              color: isOn ? onColor : "#64748B",
              textShadow: isOn ? `0 0 12px ${onColor}` : "none"
            }}
          >
            {label}
          </span>
        )}
      </div>
    );
  }

  // ── PREVIEW SHAPE ─────────────────────────────────────────────────
  if (type === "shape") {
    const shapeType = p.shapeType || "rectangle";
    const fill = p.fill || "transparent";
    const borderColor = p.borderColor || "#00BFFF";
    const borderWidth = Math.max(0, Number(p.borderWidth ?? 1));
    const radius = Math.max(0, Number(p.radius ?? 8));
    const rotation = Number(p.rotation ?? 0);

    const baseStyle = {
      width: "100%",
      height: "100%",
      background: fill,
      border: `${borderWidth}px solid ${borderColor}`,
      transform: `rotate(${rotation}deg)`,
      transition: "all 0.2s ease"
    };

    if (shapeType === "circle") {
      return (
        <div className="w-full h-full flex items-center justify-center overflow-visible">
          <div
            style={{
              ...baseStyle,
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              boxSizing: "border-box"
            }}
          />
        </div>
      );
    }

    if (shapeType === "ellipse") {
      return (
        <div className="w-full h-full flex items-center justify-center overflow-visible">
          <div
            style={{
              ...baseStyle,
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              boxSizing: "border-box"
            }}
          />
        </div>
      );
    }

    if (shapeType === "line") {
      return (
        <div className="w-full h-full flex items-center justify-center">
          <div
            style={{
              width: "100%",
              height: Math.max(1, borderWidth),
              background: borderColor,
              transform: `rotate(${rotation}deg)`,
              transformOrigin: "center"
            }}
          />
        </div>
      );
    }

    if (shapeType === "triangle") {
      return (
        <div className="w-full h-full flex items-center justify-center">
          <div
            style={{
              width: "100%",
              height: "100%",
              background: fill,
              clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)",
              transform: `rotate(${rotation}deg)`,
              boxSizing: "border-box"
            }}
          />
        </div>
      );
    }

    return (
      <div
        className="w-full h-full"
        style={{
          ...baseStyle,
          borderRadius: `${radius}px`,
          boxSizing: "border-box"
        }}
      />
    );
  }

  // ── PREVIEW TEXT BOX ──────────────────────────────────────────────
  if (type === "textbox") {
    const textValue = p.text ?? "TEXT";
    const icon = p.icon || "";
    const iconPosition = p.iconPosition || "left";
    const iconSize = Number(p.iconSize ?? 20);
    const iconGap = Number(p.iconGap ?? 8);
    const fontSize = Number(p.fontSize ?? 18);
    const fontWeight = p.fontWeight || "600";
    const textColor = p.textColor || "#FFFFFF";
    const iconColor = p.iconColor || textColor;
    const textAlign = p.textAlign || "center";
    const backgroundColor = p.backgroundColor || "transparent";
    const borderColor = p.borderColor || "transparent";
    const borderWidth = Math.max(0, Number(p.borderWidth ?? 0));
    const radius = Math.max(0, Number(p.radius ?? 6));
    const padding = Math.max(0, Number(p.padding ?? 8));
    const rotation = Number(p.rotation ?? 0);

    const justifyContent =
      textAlign === "left" ? "flex-start" :
      textAlign === "right" ? "flex-end" : "center";

    const alignItems = "center";

    const isIconCentered = iconPosition === "center";
    const isVerticalIcon = iconPosition === "top" || iconPosition === "bottom";

    return (
      <div
        className="w-full h-full flex"
        style={{
          alignItems,
          justifyContent,
          background: backgroundColor,
          border: `${borderWidth}px solid ${borderColor}`,
          borderRadius: `${radius}px`,
          padding: `${padding}px`,
          transform: `rotate(${rotation}deg)`,
          boxSizing: "border-box",
          overflow: "hidden"
        }}
      >
        {isIconCentered ? (
          // Center icon is independent of text alignment.
          <div className="relative w-full h-full flex items-center justify-center">
            <span
              style={{
                color: iconColor,
                fontSize: `${iconSize}px`,
                lineHeight: 1,
                flexShrink: 0
              }}
            >
              {icon}
            </span>

            <span
              className="absolute inset-0 flex items-center"
              style={{
                justifyContent: justifyContent,
                color: textColor,
                fontSize: `${fontSize}px`,
                fontWeight,
                lineHeight: 1.2,
                textAlign,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                pointerEvents: "none"
              }}
            >
              {textValue}
            </span>
          </div>
        ) : (
          <div
            className="flex w-full h-full"
            style={{
              flexDirection: isVerticalIcon ? "column" : "row",
              alignItems: isVerticalIcon ? "center" : "center",
              justifyContent: justifyContent,
              gap: `${iconGap}px`
            }}
          >
            {(iconPosition === "left" || iconPosition === "top") && icon && (
              <span
                style={{
                  color: iconColor,
                  fontSize: `${iconSize}px`,
                  lineHeight: 1,
                  flexShrink: 0
                }}
              >
                {icon}
              </span>
            )}

            <span
              style={{
                color: textColor,
                fontSize: `${fontSize}px`,
                fontWeight,
                lineHeight: 1.2,
                textAlign,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                flexShrink: 0
              }}
            >
              {textValue}
            </span>

            {(iconPosition === "right" || iconPosition === "bottom") && icon && (
              <span
                style={{
                  color: iconColor,
                  fontSize: `${iconSize}px`,
                  lineHeight: 1,
                  flexShrink: 0
                }}
              >
                {icon}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  return <div className="text-[10px] text-[#475569]">Empty Component</div>;
}

function PropInput({ label, value, onChange, type = "text", options, min, max }) {
  return (<div className="flex flex-col gap-0.5"><span className="text-[9px] font-bold text-[#475569] uppercase tracking-wider">{label}</span>
    {options ? (<select value={value} onChange={e => onChange(e.target.value)} className="bg-[#0F172A] border border-[#334155] text-white text-[10px] rounded px-2 h-7 outline-none focus:border-[#22C55E]/60">{options.map(o => (<option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>))}</select>) :
      type === "checkbox" ? (<label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} className="accent-[#22C55E]" /><span className="text-[10px] text-white">{label}</span></label>) :
        type === "color" ? (<div className="flex items-center gap-2"><input type="color" value={value} onChange={e => onChange(e.target.value)} className="w-7 h-7 rounded cursor-pointer bg-transparent border border-[#334155]" /><input type="text" value={value} onChange={e => onChange(e.target.value)} className="flex-1 bg-[#0F172A] border border-[#334155] text-white text-[10px] rounded px-2 h-7 outline-none font-mono" /></div>) :
          (<input type={type} value={value} min={min} max={max} onChange={e => onChange(type === "number" ? Number(e.target.value) : e.target.value)} className="bg-[#0F172A] border border-[#334155] text-white text-[10px] rounded px-2 h-7 outline-none focus:border-[#22C55E]/60" />)}
  </div>);
}

function IconPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = TEXTBOX_ICONS.find(i => i.value === value) || TEXTBOX_ICONS[0];

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex-1 h-8 rounded border border-[#334155] bg-[#0F172A] text-white flex items-center gap-2 px-2 hover:border-[#22C55E]/60 transition-colors"
        >
          <span className="w-6 h-6 flex items-center justify-center text-lg">
            {selected.icon || "—"}
          </span>
          <span className="text-[10px] text-[#CBD5E1]">
            {selected.label}
          </span>
          <span className="ml-auto text-[#64748B]">⌄</span>
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="w-8 h-8 rounded border border-[#334155] text-[#64748B] hover:text-white hover:bg-[#1E293B]"
            title="Remove icon"
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-[100] left-0 right-0 mt-1 p-2 rounded-lg border border-[#334155] bg-[#0B1120] shadow-2xl">
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
                className="h-8 rounded flex items-center justify-center text-base border border-transparent hover:border-[#22C55E]/50 hover:bg-[#1E293B] transition-colors"
                style={{
                  background: value === item.value ? "rgba(34,197,94,0.12)" : "transparent",
                  color: value === item.value ? "#22C55E" : "#CBD5E1"
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

function PropSection({ title, children }) { return (<div className="flex flex-col gap-2 pb-3 border-b border-[#1E293B]"><span className="text-[9px] font-bold text-[#22C55E] uppercase tracking-widest pt-2">{title}</span>{children}</div>); }

// ── PROPERTY PANEL ──────────────────────────────────────────────
function PropertyPanel({ widget, onChange, onDelete, onDuplicate, canvasWidth, canvasHeight }) {
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

  const isOn = p.builderState === 1;

  return (<div className="flex flex-col h-full overflow-hidden"><div className="flex items-center justify-between px-3 py-2.5 border-b border-[#1E293B] shrink-0"><div className="flex items-center gap-2"><span className="text-base">◻</span><span className="text-white font-bold text-xs capitalize">{type || 'Unknown'}</span></div><div className="flex items-center gap-1"><button onClick={onDuplicate} title="Duplicate" className="w-6 h-6 rounded flex items-center justify-center text-[#475569] hover:text-[#3B82F6] hover:bg-[#1E3A5F] transition-colors"><IconDupe /></button><button onClick={onDelete} title="Delete" className="w-6 h-6 rounded flex items-center justify-center text-[#475569] hover:text-[#EF4444] hover:bg-[#7F1D1D]/20 transition-colors"><IconTrash /></button></div></div><div className="flex-1 overflow-y-auto px-3 flex flex-col gap-0" style={{ scrollbarWidth: "thin", scrollbarColor: "#334155 #0F172A" }}>

    <PropSection title="Position & Size"><div className="grid grid-cols-2 gap-2">
      <PropInput label="X" type="number" min={0} value={x} onChange={handleXChange} />
      <PropInput label="Y" type="number" min={0} value={y} onChange={handleYChange} />
      <PropInput label="Width" type="number" min={40} value={p.width} onChange={v => set("width", snap(v))} />
      <PropInput label="Height" type="number" min={24} value={p.height} onChange={v => set("height", snap(v))} />
    </div></PropSection>

    {type !== "shape" && type !== "textbox" && (
      <>
    {/* 🔴 SIMULATION STATE (WRITE TO VARIABLE) */}
    <PropSection title="Simulation State">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[8px] font-bold uppercase tracking-widest text-[#22C55E]">● VARIABLE WRITER</span>
      </div>
      <div className="flex gap-2 mb-2">
        <button
          onClick={() => set("builderState", 1)}
          className="flex-1 h-8 rounded-lg border text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer"
          style={{
            background: isOn ? "linear-gradient(135deg, #00BFFF, #0077AA)" : "#0F172A",
            borderColor: isOn ? "#00BFFF" : "#334155",
            color: isOn ? "#FFFFFF" : "#64748B",
            boxShadow: isOn ? "0 0 14px rgba(0,191,255,0.45)" : "none"
          }}
        >
          ● ON (1)
        </button>
        <button
          onClick={() => set("builderState", 0)}
          className="flex-1 h-8 rounded-lg border text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer"
          style={{
            background: !isOn ? "#1E293B" : "#0F172A",
            borderColor: !isOn ? "#64748B" : "#334155",
            color: !isOn ? "#FFFFFF" : "#64748B",
            boxShadow: !isOn ? "0 0 10px rgba(100,116,139,0.25)" : "none"
          }}
        >
          ○ OFF (0)
        </button>
      </div>
      <div
        className="text-[9px] font-mono px-2 py-1.5 rounded border flex items-center justify-between"
        style={{
          background: isOn ? "rgba(0,191,255,0.08)" : "rgba(100,116,139,0.08)",
          borderColor: isOn ? "rgba(0,191,255,0.25)" : "#1E293B",
          color: isOn ? "#00BFFF" : "#64748B"
        }}
      >
        <span>Variable Value:</span>
        <span className="font-bold">{isOn ? 1 : 0}</span>
      </div>
    </PropSection>

      </>
    )}

    {/* ── BUTTON SETTINGS ──────────────────────────────────────────── */}
    {type === "button" && (
      <>
        <PropSection title="Data Binding">
          <PropInput label="Variable Name" value={p.variable} onChange={v => set("variable", v)} />
        </PropSection>

        <PropSection title="Variant & Text">
          <PropInput label="Variant" options={[
            { value: "neon", label: "Neon" },
            { value: "solid", label: "Solid" }
          ]} value={p.variant} onChange={v => set("variant", v)} />
          <PropInput label="Font Size" type="number" min={8} max={48} value={p.fontSize || 18} onChange={v => set("fontSize", Number(v))} />
        </PropSection>

        <PropSection title="ON State Appearance">
          <PropInput label="Label (ON)" value={p.labelOn} onChange={v => set("labelOn", v)} />
          <PropInput label="Background (ON)" type="color" value={p.onBackground || "#00BFFF"} onChange={v => set("onBackground", v)} />
          <PropInput label="Border (ON)" type="color" value={p.onBorder || "#00BFFF"} onChange={v => set("onBorder", v)} />
          <PropInput label="Text (ON)" type="color" value={p.onTextColor || "#FFFFFF"} onChange={v => set("onTextColor", v)} />
        </PropSection>

        <PropSection title="OFF State Appearance">
          <PropInput label="Label (OFF)" value={p.labelOff} onChange={v => set("labelOff", v)} />
          <PropInput label="Background (OFF)" type="color" value={p.offBackground || "#0F172A"} onChange={v => set("offBackground", v)} />
          <PropInput label="Border (OFF)" type="color" value={p.offBorder || "#123B5A"} onChange={v => set("offBorder", v)} />
          <PropInput label="Text (OFF)" type="color" value={p.offTextColor || "#7F9DB8"} onChange={v => set("offTextColor", v)} />
        </PropSection>
      </>
    )}

    {/* ── LIGHT INDICATOR SETTINGS ──────────────────────────────────── */}
    {type === "light" && (
      <>
        <PropSection title="Data Binding">
          <PropInput label="Variable Name" value={p.variable} onChange={v => set("variable", v)} />
        </PropSection>

        <PropSection title="Shape & Label">
          <PropInput label="Shape" options={[
            { value: "circle", label: "Circle" },
            { value: "square", label: "Square" }
          ]} value={p.shape} onChange={v => set("shape", v)} />
          <PropInput label="Show Label" type="checkbox" value={p.showLabel !== false} onChange={v => set("showLabel", v)} />
          {p.showLabel !== false && <PropInput label="Label Text" value={p.label} onChange={v => set("label", v)} />}
        </PropSection>

        <PropSection title="ON State Appearance">
          <PropInput label="Color (ON)" type="color" value={p.onColor || "#00BFFF"} onChange={v => set("onColor", v)} />
        </PropSection>

        <PropSection title="OFF State Appearance">
          <PropInput label="Color (OFF)" type="color" value={p.offColor || "#1E293B"} onChange={v => set("offColor", v)} />
        </PropSection>
      </>
    )}

    {type === "textbox" && (
      <>
        <PropSection title="Data Binding">
          <PropInput
            label="Variable"
            value={p.variable || ""}
            onChange={v => set("variable", v)}
          />
          <div className="text-[8px] text-[#64748B] mt-0.5">
            Text is read from the Logic Builder variable.
          </div>
        </PropSection>

        <PropSection title="Text">
          <PropInput label="Default Text" value={p.text ?? "TEXT"} onChange={v => set("text", v)} />
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold text-[#475569] uppercase tracking-wider">Icon</span>
            <IconPicker value={p.icon || ""} onChange={v => set("icon", v)} />
          </div>
          {p.icon && (
            <>
              <PropInput
                label="Icon Position"
                options={[
                  { value: "left", label: "Left" },
                  { value: "center", label: "Center" },
                  { value: "right", label: "Right" },
                  { value: "top", label: "Top" },
                  { value: "bottom", label: "Bottom" }
                ]}
                value={p.iconPosition || "left"}
                onChange={v => set("iconPosition", v)}
              />
              <PropInput
                label="Icon Size"
                type="number"
                min={8}
                max={64}
                value={p.iconSize ?? 20}
                onChange={v => set("iconSize", Number(v))}
              />
              <PropInput
                label="Icon Gap"
                type="number"
                min={0}
                max={40}
                value={p.iconGap ?? 8}
                onChange={v => set("iconGap", Number(v))}
              />
            </>
          )}
          <PropInput
            label="Font Size"
            type="number"
            min={8}
            max={96}
            value={p.fontSize ?? 18}
            onChange={v => set("fontSize", Number(v))}
          />
          <PropInput
            label="Font Weight"
            options={[
              { value: "400", label: "Regular" },
              { value: "500", label: "Medium" },
              { value: "600", label: "Semi Bold" },
              { value: "700", label: "Bold" },
              { value: "800", label: "Extra Bold" }
            ]}
            value={p.fontWeight || "600"}
            onChange={v => set("fontWeight", v)}
          />
        </PropSection>

        <PropSection title="Alignment">
          <PropInput
            label="Horizontal"
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Center" },
              { value: "right", label: "Right" }
            ]}
            value={p.textAlign || "center"}
            onChange={v => set("textAlign", v)}
          />

        </PropSection>

        <PropSection title="Appearance">
          <PropInput
            label="Text Color"
            type="color"
            value={p.textColor || "#FFFFFF"}
            onChange={v => set("textColor", v)}
          />
          {p.icon && (
            <PropInput
              label="Icon Color"
              type="color"
              value={p.iconColor || "#FFFFFF"}
              onChange={v => set("iconColor", v)}
            />
          )}
          <PropInput
            label="Background"
            type="color"
            value={p.backgroundColor === "transparent" ? "#07111F" : (p.backgroundColor || "#07111F")}
            onChange={v => set("backgroundColor", v)}
          />
          <PropInput
            label="Border"
            type="color"
            value={p.borderColor === "transparent" ? "#07111F" : (p.borderColor || "#07111F")}
            onChange={v => set("borderColor", v)}
          />
          <PropInput
            label="Border Width"
            type="number"
            min={0}
            max={10}
            value={p.borderWidth ?? 0}
            onChange={v => set("borderWidth", Number(v))}
          />
          <PropInput
            label="Corner Radius"
            type="number"
            min={0}
            max={50}
            value={p.radius ?? 6}
            onChange={v => set("radius", Number(v))}
          />
          <PropInput
            label="Padding"
            type="number"
            min={0}
            max={40}
            value={p.padding ?? 8}
            onChange={v => set("padding", Number(v))}
          />
          <PropInput
            label="Rotation"
            type="number"
            min={-360}
            max={360}
            value={p.rotation ?? 0}
            onChange={v => set("rotation", Number(v))}
          />
        </PropSection>
      </>
    )}

    {type === "shape" && (
      <>
        <PropSection title="Shape">
          <PropInput
            label="Type"
            options={[
              { value: "rectangle", label: "Rectangle" },
              { value: "circle", label: "Circle" },
              { value: "ellipse", label: "Ellipse" },
              { value: "triangle", label: "Triangle" },
              { value: "line", label: "Line" }
            ]}
            value={p.shapeType || "rectangle"}
            onChange={v => set("shapeType", v)}
          />

          {(p.shapeType === "rectangle" || !p.shapeType) && (
            <PropInput
              label="Corner Radius"
              type="number"
              min={0}
              max={100}
              value={p.radius ?? 8}
              onChange={v => set("radius", Number(v))}
            />
          )}

          <PropInput
            label="Rotation"
            type="number"
            min={-360}
            max={360}
            value={p.rotation ?? 0}
            onChange={v => set("rotation", Number(v))}
          />
        </PropSection>

        <PropSection title="Appearance">
          <PropInput
            label="Fill"
            type="color"
            value={p.fill || "#123B5A"}
            onChange={v => set("fill", v)}
          />
          <PropInput
            label="Border"
            type="color"
            value={p.borderColor || "#00BFFF"}
            onChange={v => set("borderColor", v)}
          />
          <PropInput
            label="Border Width"
            type="number"
            min={0}
            max={20}
            value={p.borderWidth ?? 1}
            onChange={v => set("borderWidth", Number(v))}
          />
        </PropSection>
      </>
    )}

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

  const handleWidgetUpdate = useCallback((updatedWidget) => {
    setWidgets(prevWidgets =>
      prevWidgets.map(w => (w.id === updatedWidget.id ? updatedWidget : w))
    );
  }, []);

  useEffect(() => {
    if (!cpNumber) { setLoading(false); return; }
    fetch(`${API}/api/page-config/${cpNumber}`)
      .then(r => r.ok ? r.json() : { widgets: [] })
      .then(d => { setWidgets(d.widgets || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [cpNumber]);

  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const updateScale = () => {
      const availableWidth = Math.max(0, container.clientWidth - 16);
      const availableHeight = Math.max(0, container.clientHeight - 16);

      // Canvas keeps its fixed logical size (CANVAS_W × CANVAS_H).
      // Only its display scale changes to fit the available viewport.
      const widthScale = availableWidth / CANVAS_W;
      const heightScale = availableHeight / CANVAS_H;
      const newScale = Math.max(0.4, Math.min(1, widthScale, heightScale));

      setScale(prev => Math.abs(prev - newScale) < 0.001 ? prev : newScale);
    };

    updateScale();

    const observer = new ResizeObserver(updateScale);
    observer.observe(container);

    return () => observer.disconnect();
  }, [CANVAS_W, CANVAS_H]);

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
    const needsVariable = Object.prototype.hasOwnProperty.call(def.defaultProps, "variable");
    setWidgets(ws => [...ws, { id, type: def.type, x, y, props: { ...def.defaultProps, ...(needsVariable ? { variable: `Var_${id}` } : {}), width: Math.min(def.defaultProps.width, CANVAS_W - x), height: Math.min(def.defaultProps.height, CANVAS_H - y) } }]);
    setSelected(id);
  }, [scale, CANVAS_W, CANVAS_H]);

  const startDrag = useCallback((e, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const w = document.getElementById(`widget-${id}`);
    if (!w) return;
    const rect = w.getBoundingClientRect();
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
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30">CP{String(cpNumber).padStart(2, "0")}</span>
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
          <div className="shrink-0 border-r border-[#1E293B] flex flex-col" style={{ width: 272, background: "#0F172A" }}>
            <div className="px-3 pt-3 pb-2 shrink-0"><p className="text-[#22C55E] text-[9px] font-bold uppercase tracking-widest mb-2">Components</p><input value={paletteSearch} onChange={e => setPaletteSearch(e.target.value)} placeholder="Search…" className="w-full bg-[#1E293B] border border-[#334155] text-white text-[10px] rounded-lg px-2 h-7 outline-none placeholder-[#334155] focus:border-[#22C55E]/50" /></div>
            <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-1.5 mt-2" style={{ scrollbarWidth: "thin", scrollbarColor: "#334155 #0F172A" }}>
              {filteredPalette.map(comp => (
                <div
                  key={comp.type}
                  draggable
                  onDragStart={e => e.dataTransfer.setData("component-type", comp.type)}
                  className="relative flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[#1E293B]/40 bg-[#0F172A]/50 hover:border-[#22C55E]/40 hover:bg-[#1E293B] cursor-grab active:cursor-grabbing transition-all duration-200 group overflow-hidden shadow-sm hover:shadow-md"
                >
                  {/* Aksen garis di sebelah kiri saat hover */}
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#22C55E] scale-y-0 group-hover:scale-y-100 transition-transform duration-200 origin-center rounded-r-sm shadow-[0_0_8px_#22C55E]" />

                  {/* Wadah Ikon */}
                  <div className="w-8 h-8 rounded bg-[#07111F] border border-[#1E293B] group-hover:border-[#22C55E]/50 flex items-center justify-center text-[#22C55E] shrink-0 transition-all duration-200 group-hover:shadow-[0_0_10px_rgba(34,197,94,0.15)] group-hover:scale-105">
                    <span className="text-sm">{comp.icon}</span>
                  </div>

                  {/* Teks Label & Deskripsi */}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[#E2E8F0] text-[11px] font-bold tracking-wide leading-tight group-hover:text-white transition-colors">
                      {comp.label}
                    </span>
                    <span className="text-[#64748B] text-[9px] leading-tight truncate group-hover:text-[#94A3B8] transition-colors mt-0.5">
                      {comp.desc}
                    </span>
                  </div>

                  {/* Ikon Drag (Grip) yang muncul saat hover */}
                  <div className="opacity-0 group-hover:opacity-100 text-[#475569] group-hover:text-[#22C55E]/70 transition-opacity mr-1 shrink-0">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="5" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="9" cy="19" r="1.5" />
                      <circle cx="15" cy="5" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="15" cy="19" r="1.5" />
                    </svg>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div ref={canvasContainerRef} className="flex-1 min-w-0 overflow-hidden min-h-0 flex items-center justify-center px-8 py-4" style={{ background: "#080E1A" }}>
            {loading ? (<div className="flex items-center gap-2 text-[#22C55E] text-xs mt-20"><div className="w-4 h-4 border-2 border-[#22C55E] border-t-transparent rounded-full animate-spin" /> Loading layout…</div>) : (
              <div style={{ width: displayWidth, height: displayHeight, position: "relative", flex: "0 0 auto" }}>
                <div ref={canvasRef} onDragOver={e => e.preventDefault()} onDrop={handleCanvasDrop} onClick={() => setSelected(null)} className="relative origin-top-left" style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})`, background: "#0F172A", border: "1px solid #1E293B", borderRadius: 8, backgroundImage: "radial-gradient(circle, #1E293B 1px, transparent 1px)", backgroundSize: `${GRID * 2}px ${GRID * 2}px` }}>
                  {widgets.length === 0 && (<div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none"><span className="text-4xl opacity-10 mb-2">🖱</span><p className="text-[#1E293B] text-sm font-mono">Drag components here</p></div>)}
                  {widgets.map(widget => {
                    const isSel = widget.id === selected;
                    return (<div key={widget.id} id={`widget-${widget.id}`} onMouseDown={e => startDrag(e, widget.id)} onClick={e => { e.stopPropagation(); setSelected(widget.id); }} className="absolute select-none" style={{ left: widget.x, top: widget.y, width: widget.props.width, height: widget.props.height, cursor: dragInfo?.id === widget.id ? "grabbing" : "grab", outline: isSel ? "2px solid #22C55E" : "1px solid transparent", outlineOffset: 2, borderRadius: 6, zIndex: isSel ? 10 : 1 }}><div className="w-full h-full overflow-hidden" style={{ borderRadius: 6 }}><WidgetPreview widget={widget} onUpdate={handleWidgetUpdate} /></div>{isSel && <div className="absolute -top-5 left-0 flex items-center gap-1 pointer-events-none"><span className="text-[#22C55E] text-[9px] font-bold bg-[#0B1120] px-1.5 py-0.5 rounded font-mono capitalize">{widget.type}</span></div>}{isSel && <div onMouseDown={e => startResize(e, widget.id)} className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize" style={{ background: "#22C55E", borderRadius: "2px 0 4px 0", zIndex: 20 }} />}</div>);
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="shrink-0 border-l border-[#1E293B] flex flex-col" style={{ width: 296, background: "#0F172A" }}>
            <PropertyPanel
              widget={selectedWidget}
              onChange={updated => setWidgets(ws => ws.map(w => w.id === updated.id ? updated : w))}
              onDelete={() => { setWidgets(ws => ws.filter(w => w.id !== selected)); setSelected(null); }}
              onDuplicate={() => { if (!selectedWidget) return; const newId = uid(); let newX = selectedWidget.x + 16, newY = selectedWidget.y + 16; const maxX = CANVAS_W - selectedWidget.props.width, maxY = CANVAS_H - selectedWidget.props.height; newX = Math.min(newX, maxX); newY = Math.min(newY, maxY); const clone = { ...selectedWidget, id: newId, x: newX, y: newY }; setWidgets(ws => [...ws, clone]); setSelected(newId); }}
              canvasWidth={CANVAS_W}
              canvasHeight={CANVAS_H}
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