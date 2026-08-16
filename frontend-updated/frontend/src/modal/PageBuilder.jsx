// src/modal/PageBuilder.jsx
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { API } from "../service/api";
import { ModalBackdrop, ModalPanel } from "../components/motion";

// ──────────────────────────────────────────────────────────────────
//  HMI DESIGN SYSTEM - THEME & VISUAL PROPS
// ──────────────────────────────────────────────────────────────────

const THEME_PRESETS = {
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

const DEFAULT_VISUAL = {
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

// ── GAUGE TYPE / ICON LIBRARY ────────────────────────────────────────
// Used by Page Builder and persisted in widget.props.gaugeType.
// Runtime can render the same type using its own SVG icon renderer.
const GAUGE_TYPES = [
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
const BUTTON_ADDRESS_TYPES = [
  { value: "coil", label: "Coil (FC05 Write)" },
  { value: "holding_register", label: "Holding Register (FC06 / FC16 Write)" },
];

const LIGHT_ADDRESS_TYPES = [
  { value: "coil", label: "Coil (FC01 Read)" },
  { value: "discrete_input", label: "Discrete Input (FC02 Read)" },
  { value: "holding_register", label: "Holding Register (FC03 Read)" },
  { value: "input_register", label: "Input Register (FC04 Read)" },
];

const GAUGE_ADDRESS_TYPES = [
  { value: "holding_register", label: "Holding Register (FC03 Read)" },
];

const LINECHART_ADDRESS_TYPES = [
  { value: "coil", label: "Coil (FC01 Read)" },
  { value: "discrete_input", label: "Discrete Input (FC02 Read)" },
  { value: "holding_register", label: "Holding Register (FC03 Read)" },
  { value: "input_register", label: "Input Register (FC04 Read)" },
];

const LINECHART_SERIES_COLORS = [
  "var(--accent-cyan)",
  "var(--accent-red)",
  "var(--accent-green)",
  "var(--accent-orange)",
];

const createLineChartSeries = (index = 0) => ({
  id: `series_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
  label: index === 0 ? "REALTIME" : `SERIES ${index + 1}`,
  device: "",
  addressType: "holding_register",
  address: "",
  color: LINECHART_SERIES_COLORS[index % LINECHART_SERIES_COLORS.length],
  enabled: true,
});


function GaugeTypeIcon({ type = "temp", color = "var(--accent-cyan)", size = 28 }) {
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


// 🔴 DUA KOMPONEN DENGAN VARIABLE (BUKAN FIELDKEY)
const COMPONENT_TYPES = [
  {
    type: "button",
    label: "Button",
    icon: "◉",
    desc: "Toggle button that writes a variable",
    defaultProps: {
      addressType: "coil",
      device: "",
      address: "",
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
      addressType: "coil",
      device: "",
      address: "",
      label: "STATUS",
      variable: "Light1", // 🔴 UBAH KE variable
      shape: "circle",
      showLabel: true,
      onColor: "var(--accent-cyan)",
      offColor: "var(--border-soft)",
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
      fill: "var(--panel-mid)",
      borderColor: "var(--accent-cyan)",
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
  {
    type: "gauge",
    label: "Gauge",
    icon: "◔",
    desc: "Industrial analog value gauge",
    defaultProps: {
      addressType: "holding_register",
      device: "",
      address: "",
      variable: "",
      simulationValue: 50,

      // Gauge semantic type / icon
      gaugeType: "temp",
      title: "TEMPERATURE",
      unit: "°C",

      // Value range
      min: 0,
      max: 100,
      decimals: 1,

      // Visual behavior
      showValue: true,
      showScale: true,
      showMinMax: true,
      showIcon: true,
      showTitle: true,
      titleSize: 10,
      iconSize: 25,

      // Needle / arc
      startAngle: -135,
      endAngle: 135,
      trackColor: "var(--panel-mid)",
      progressColor: "var(--accent-cyan)",
      backgroundColor: "var(--panel-canvas)",
      textColor: "#FFFFFF",
      iconColor: "var(--accent-cyan)",
      unitColor: "var(--accent-cyan)",
      labelColor: "var(--panel-line)",
      glow: true,

      width: 220,
      height: 190,
      visual: { ...DEFAULT_VISUAL }
    }
  },
  {
    type: "linechart",
    label: "Line Chart",
    icon: "📈",
    desc: "Realtime industrial process trend",
    defaultProps: {
      title: "PROCESS TREND",
      unit: "",

      // Trend history
      historySeconds: 60,
      sampleInterval: 500,

      // Trend trigger
      // When enabled: trigger = 1 starts recording, trigger = 0 stops recording.
      triggerEnabled: false,
      triggerDevice: "",
      triggerAddressType: "holding_register",
      triggerAddress: "",
      triggerStartValue: 1,
      triggerStopValue: 0,
      clearHistoryOnStart: true,

      // Y axis
      autoScale: true,
      yMin: 0,
      yMax: 100,
      decimals: 1,

      // Display
      showGrid: true,
      showLegend: true,
      showCurrentValue: true,
      showTimeAxis: true,

      // Appearance
      backgroundColor: "var(--panel-canvas)",
      borderColor: "var(--panel-mid)",
      gridColor: "var(--panel-mid)",
      textColor: "#FFFFFF",
      labelColor: "var(--panel-line)",
      lineWidth: 1.8,

      // Start with one realtime series. Additional series can be added from the property panel.
      series: [
        createLineChartSeries(0),
      ],

      width: 420,
      height: 220,
      visual: { ...DEFAULT_VISUAL },
    },
  }

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

    const currentBg = isOn ? (p.onBackground || "var(--accent-cyan)") : (p.offBackground || "var(--bg-canvas)");
    const currentBorder = isOn ? (p.onBorder || "var(--accent-cyan)") : (p.offBorder || "var(--panel-mid)");
    const currentText = isOn ? (p.onTextColor || "#FFFFFF") : (p.offTextColor || "var(--panel-line)");
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
      btnStyle.background = `linear-gradient(135deg, var(--panel-canvas), ${currentBorder})`;
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
                background: isOn ? currentBg : "var(--bg-canvas)",
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
    const onColor = p.onColor || "var(--accent-cyan)";
    const offColor = p.offColor || "var(--border-soft)";
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
            background: `radial-gradient(circle at 35% 35%, ${isOn ? onColor : 'var(--panel-line)'}, ${currentColor})`,
            boxShadow: isOn ? `0 0 24px ${onColor}, inset 0 -2px 4px rgba(0,0,0,0.4)` : `inset 0 2px 6px rgba(0,0,0,0.6)`,
            border: `1px solid ${isOn ? onColor : 'var(--border-soft)'}`
          }}
        />

        {/* LABEL (Jika diaktifkan) */}
        {showLabel && (
          <span
            className="font-bold uppercase tracking-widest text-sm"
            style={{
              color: isOn ? onColor : "var(--text-dim)",
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
    const borderColor = p.borderColor || "var(--accent-cyan)";
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

    const textJustify =
      textAlign === "left" ? "flex-start" :
      textAlign === "right" ? "flex-end" : "center";

    return (
      <div
        className="relative w-full h-full"
        style={{
          background: backgroundColor,
          border: `${borderWidth}px solid ${borderColor}`,
          borderRadius: `${radius}px`,
          padding: `${padding}px`,
          transform: `rotate(${rotation}deg)`,
          boxSizing: "border-box",
          overflow: "hidden"
        }}
      >
        <div
          className="absolute inset-0 flex items-center pointer-events-none"
          style={{
            justifyContent: textJustify,
            padding: `${padding}px`,
            boxSizing: "border-box"
          }}
        >
          <span
            style={{
              color: textColor,
              fontSize: `${fontSize}px`,
              fontWeight,
              lineHeight: 1.2,
              textAlign,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word"
            }}
          >
            {textValue}
          </span>
        </div>

        {icon && iconPosition === "left" && (
          <div
            className="absolute inset-y-0 left-0 flex items-center pointer-events-none"
            style={{ paddingLeft: `${padding}px` }}
          >
            <span style={{
              color: iconColor,
              fontSize: `${iconSize}px`,
              lineHeight: 1
            }}>
              {icon}
            </span>
          </div>
        )}

        {icon && iconPosition === "right" && (
          <div
            className="absolute inset-y-0 right-0 flex items-center pointer-events-none"
            style={{ paddingRight: `${padding}px` }}
          >
            <span style={{
              color: iconColor,
              fontSize: `${iconSize}px`,
              lineHeight: 1
            }}>
              {icon}
            </span>
          </div>
        )}

        {icon && iconPosition === "center" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span style={{
              color: iconColor,
              fontSize: `${iconSize}px`,
              lineHeight: 1
            }}>
              {icon}
            </span>
          </div>
        )}
      </div>
    );
  }

  // ── PREVIEW LINE CHART ─────────────────────────────────────────────
  if (type === "linechart") {
    const series = Array.isArray(p.series)
      ? p.series.filter(s => s && s.enabled !== false)
      : [];

    /*
     * Industrial trend-card preview.
     * NOTE:
     * - This only changes the Page Builder preview appearance.
     * - Data binding, trigger logic, history, series configuration and
     *   runtime behavior are intentionally untouched.
     */
    const W = 720;
    const H = 220;

    // Layout based on the reference HMI style:
    // left = Y axis, center = trend plot, right = realtime/value panel.
    const left = 48;
    const plotRight = 500;
    const separatorX = 520;
    const right = 18;
    const top = 52;
    const bottom = 28;
    const chartW = plotRight - left;
    const chartH = H - top - bottom;
    const previewPoints = 52;

    const chartId = `lineChart-${widget.id || "preview"}`;

    // Keep the preview data synthetic; this is only to make the builder
    // visually represent a realistic industrial trend.
    const previewSeries = series.map((s, seriesIndex) => {
      const points = Array.from({ length: previewPoints }, (_, i) => {
        let value;

        if (seriesIndex === 0) {
          // Low steady area -> small disturbance -> sharp process step.
          if (i < 14) {
            value = 28 + Math.sin(i * 0.45) * 0.8;
          } else if (i < 17) {
            value = 28 + (i - 14) * 1.4;
          } else if (i < 31) {
            value = 30 + Math.sin(i * 0.32) * 0.7;
          } else if (i < 35) {
            value = 30 + (i - 31) * 18;
          } else {
            value = 92 + Math.sin(i * 0.22) * 1.8 + (i - 35) * 0.05;
          }
        } else if (seriesIndex === 1) {
          // Secondary signal with a different industrial step profile.
          if (i < 7) {
            value = 4 + Math.sin(i * 0.8) * 2;
          } else if (i < 11) {
            value = 70 + Math.sin(i * 0.55) * 7;
          } else if (i < 23) {
            value = 0;
          } else if (i < 38) {
            value = 48 + Math.sin(i * 0.3) * 3;
          } else if (i < 43) {
            value = 18 + Math.sin(i * 0.5) * 4;
          } else if (i < 48) {
            value = 52 + Math.sin(i * 0.28) * 4;
          } else {
            value = 0;
          }
        } else {
          value =
            50 +
            Math.sin(i * 0.24 + seriesIndex) * (8 + seriesIndex * 2) +
            Math.sin(i * 0.07 + seriesIndex) * 4;
        }

        return value;
      });

      return { ...s, points };
    });

    const allValues = previewSeries.flatMap(s => s.points);
    let min = p.autoScale !== false
      ? Math.min(...allValues)
      : Number(p.yMin ?? 0);
    let max = p.autoScale !== false
      ? Math.max(...allValues)
      : Number(p.yMax ?? 100);

    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max) || max <= min) max = min + 1;

    if (p.autoScale !== false) {
      const range = max - min;
      const pad = Math.max(1, range * 0.10);
      min -= pad;
      max += pad;
    }

    const yFor = value =>
      top + chartH - ((value - min) / (max - min)) * chartH;

    const pointsFor = values =>
      values
        .map((value, index) => {
          const x =
            left +
            (index / Math.max(1, values.length - 1)) * chartW;
          return `${x},${yFor(value)}`;
        })
        .join(" ");

    const decimals = Math.max(0, Number(p.decimals ?? 1));
    const currentValues = previewSeries.map(
      s => s.points[s.points.length - 1]
    );

    const background = p.backgroundColor || "var(--panel-canvas)";
    const borderColor = p.borderColor || "var(--panel-mid)";
    const gridColor = p.gridColor || "var(--panel-mid)";
    const textColor = p.textColor || "#FFFFFF";
    const labelColor = p.labelColor || "var(--panel-line)";
    const unit = p.unit || "";

    const formatValue = value =>
      Number(value).toFixed(decimals);

    const gridRatios = [0, 0.25, 0.5, 0.75, 1];

    return (
      <div
        className="w-full h-full overflow-hidden rounded-xl"
        style={{
          background: `
            radial-gradient(circle at 24% 40%, rgba(0,191,255,0.055), transparent 35%),
            linear-gradient(180deg, var(--panel-canvas) 0%, ${background} 100%)
          `,
          border: `1px solid ${borderColor}`,
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.025), 0 0 18px rgba(0,0,0,0.22)",
          boxSizing: "border-box",
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-full"
          preserveAspectRatio="none"
        >
          <defs>
            <filter
              id={`${chartId}-glow`}
              x="-50%"
              y="-100%"
              width="200%"
              height="300%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            <linearGradient
              id={`${chartId}-panel`}
              x1="0"
              y1="0"
              x2="1"
              y2="0"
            >
              <stop offset="0%" stopColor="var(--panel-mid)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="var(--panel-canvas)" stopOpacity="0.72" />
            </linearGradient>
          </defs>

          {/* ───────── HEADER ───────── */}
          <text
            x="48"
            y="22"
            fill={textColor}
            fontSize="11"
            fontWeight="700"
            letterSpacing="0.9"
          >
            {(p.title || "PROCESS TREND").toUpperCase()}
          </text>

          {/* Unit at the upper-left of the trend plot */}
          {unit && (
            <text
              x="10"
              y="28"
              fill={labelColor}
              fontSize="8"
              fontWeight="600"
            >
              {unit}
            </text>
          )}

          {/* Small industrial status badge */}
          <g transform="translate(585 9)">
            <rect
              x="0"
              y="0"
              width="106"
              height="22"
              rx="7"
              fill="var(--status-green-bg)"
              fillOpacity="0.88"
              stroke="var(--status-green-solid)"
              strokeWidth="0.6"
            />
            <path
              d="M10 12 L13 12 L15 7 L18 16 L21 10 L24 12 L29 12"
              fill="none"
              stroke="var(--accent-green-neon)"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text
              x="34"
              y="14"
              fill="var(--accent-green-neon-2)"
              fontSize="8"
              fontWeight="700"
              letterSpacing="0.5"
            >
              REALTIME
            </text>
            <text
              x="92"
              y="14"
              fill="var(--accent-green-neon)"
              fontSize="9"
              fontWeight="800"
            >
              +
            </text>
          </g>

          {/* ───────── TREND GRID ───────── */}
          {p.showGrid !== false &&
            gridRatios.map((ratio, index) => {
              const y = top + chartH - ratio * chartH;
              return (
                <line
                  key={`h-${index}`}
                  x1={left}
                  y1={y}
                  x2={plotRight}
                  y2={y}
                  stroke={gridColor}
                  strokeWidth="0.65"
                  strokeDasharray="2 5"
                  opacity={index === 0 ? 0.9 : 0.72}
                />
              );
            })}

          {p.showGrid !== false &&
            gridRatios.map((ratio, index) => {
              const x = left + ratio * chartW;
              return (
                <line
                  key={`v-${index}`}
                  x1={x}
                  y1={top}
                  x2={x}
                  y2={top + chartH}
                  stroke={gridColor}
                  strokeWidth="0.65"
                  strokeDasharray="2 5"
                  opacity="0.62"
                />
              );
            })}

          {/* ───────── Y AXIS LABELS ───────── */}
          {gridRatios.map((ratio, index) => {
            const value = max - ratio * (max - min);
            const y = top + ratio * chartH + 2.5;

            return (
              <text
                key={`ylabel-${index}`}
                x="38"
                y={y}
                textAnchor="end"
                fill={labelColor}
                fontSize="7"
                fontWeight={index === 0 || index === 4 ? "600" : "500"}
              >
                {formatValue(value)}
              </text>
            );
          })}

          {/* Axis baseline */}
          <line
            x1={left}
            y1={top + chartH}
            x2={plotRight}
            y2={top + chartH}
            stroke="var(--panel-line)"
            strokeWidth="0.8"
            opacity="0.85"
          />

          {/* ───────── LINE SERIES ───────── */}
          {previewSeries.map((s, index) => {
            const color =
              s.color || LINECHART_SERIES_COLORS[index % 4];

            return (
              <g key={s.id}>
                {p.glow !== false && (
                  <polyline
                    points={pointsFor(s.points)}
                    fill="none"
                    stroke={color}
                    strokeWidth={Number(p.lineWidth ?? 1.8) + 2.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.16"
                    filter={`url(#${chartId}-glow)`}
                  />
                )}

                <polyline
                  points={pointsFor(s.points)}
                  fill="none"
                  stroke={color}
                  strokeWidth={Number(p.lineWidth ?? 1.8)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.98"
                />

                {/* Current-value marker */}
                {p.showCurrentValue !== false && (
                  <circle
                    cx={plotRight}
                    cy={yFor(s.points[s.points.length - 1])}
                    r="2.2"
                    fill={color}
                    stroke="var(--panel-canvas)"
                    strokeWidth="1"
                  />
                )}
              </g>
            );
          })}

          {/* ───────── TIME AXIS ───────── */}
          {p.showTimeAxis !== false && (
            <>
              <text
                x={left}
                y={H - 7}
                fill={labelColor}
                fontSize="7"
              >
                0s
              </text>
              <text
                x={left + chartW / 2}
                y={H - 7}
                textAnchor="middle"
                fill={labelColor}
                fontSize="7"
              >
                {Math.round((p.historySeconds || 60) / 2)}s
              </text>
              <text
                x={plotRight}
                y={H - 7}
                textAnchor="end"
                fill={labelColor}
                fontSize="7"
              >
                {p.historySeconds || 60}s
              </text>
            </>
          )}

          {/* ───────── RIGHT INFORMATION PANEL ───────── */}
          <rect
            x={separatorX}
            y="0"
            width={W - separatorX}
            height={H}
            fill={`url(#${chartId}-panel)`}
          />

          <line
            x1={separatorX}
            y1="36"
            x2={separatorX}
            y2={H - 15}
            stroke="var(--panel-line)"
            strokeWidth="0.8"
          />

          {p.showLegend !== false &&
            previewSeries.map((s, index) => {
              const color =
                s.color || LINECHART_SERIES_COLORS[index % 4];
              const y = 62 + index * 28;

              return (
                <g key={`legend-${s.id}`}>
                  <line
                    x1={separatorX + 20}
                    y1={y - 3}
                    x2={separatorX + 36}
                    y2={y - 3}
                    stroke={color}
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <text
                    x={separatorX + 43}
                    y={y}
                    fill="var(--text-soft)"
                    fontSize="8"
                    fontWeight="600"
                    letterSpacing="0.35"
                  >
                    {(s.label || `SERIES ${index + 1}`).toUpperCase()}
                  </text>
                </g>
              );
            })}

          {p.showCurrentValue !== false &&
            previewSeries.map((s, index) => {
              const color =
                s.color || LINECHART_SERIES_COLORS[index % 4];
              const y = 92 + index * 57;

              return (
                <g key={`value-${s.id}`}>
                  <text
                    x={separatorX + 20}
                    y={y - 19}
                    fill="var(--text-soft)"
                    fontSize="8"
                    fontWeight="500"
                    letterSpacing="0.4"
                  >
                    {(s.label || `SERIES ${index + 1}`).toUpperCase()}
                  </text>

                  <text
                    x={separatorX + 20}
                    y={y + 5}
                    fill={color}
                    fontSize="20"
                    fontWeight="500"
                    letterSpacing="-0.4"
                  >
                    {formatValue(currentValues[index])}
                  </text>

                  {unit && (
                    <text
                      x={separatorX + 92}
                      y={y + 4}
                      fill={color}
                      fontSize="8"
                      fontWeight="600"
                    >
                      {unit}
                    </text>
                  )}

                  {index < previewSeries.length - 1 && (
                    <line
                      x1={separatorX + 20}
                      y1={y + 23}
                      x2={W - 18}
                      y2={y + 23}
                      stroke="var(--panel-line)"
                      strokeWidth="0.7"
                    />
                  )}
                </g>
              );
            })}

          {/* Empty-series state */}
          {previewSeries.length === 0 && (
            <text
              x={left + chartW / 2}
              y={top + chartH / 2}
              textAnchor="middle"
              fill={labelColor}
              fontSize="9"
              letterSpacing="0.7"
            >
              NO ACTIVE SERIES
            </text>
          )}
        </svg>
      </div>
    );
  }

  // ── PREVIEW GAUGE ─────────────────────────────────────────────────
  if (type === "gauge") {
    const min = Number(p.min ?? 0);
    const maxRaw = Number(p.max ?? 100);
    const max = maxRaw === min ? min + 1 : maxRaw;

    const previewValue = Math.min(
      max,
      Math.max(min, Number(p.simulationValue ?? min))
    );

    const progress = (previewValue - min) / (max - min);
    const start = Number(p.startAngle ?? -135);
    const end = Number(p.endAngle ?? 135);
    const angle = start + progress * (end - start);

    const unit = p.unit || "";
    const decimals = Math.max(0, Number(p.decimals ?? 0));
    const title = p.title || "VALUE";
    const gaugeType = p.gaugeType || "temp";

    const accent = p.progressColor || "var(--accent-cyan)";
    const track = p.trackColor || "var(--panel-line)";
    const textColor = p.textColor || "#FFFFFF";
    const labelColor = p.labelColor || "var(--panel-line)";
    const needleColor = p.needleColor || "#FFFFFF";

    const gaugeId = `dialGauge-${widget.id || "preview"}`;
    const cx = 100;
    const cy = 108;

    // Main arc radius and inner decorative radius.
    const radius = 72;

    const polar = (a, r = radius) => {
      const rad = (a - 90) * Math.PI / 180;
      return {
        x: cx + r * Math.cos(rad),
        y: cy + r * Math.sin(rad)
      };
    };

    const arcPath = (a1, a2, r = radius) => {
      const s = polar(a1, r);
      const e = polar(a2, r);
      const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
      const sweep = a2 > a1 ? 1 : 0;
      return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} ${sweep} ${e.x} ${e.y}`;
    };

    const needlePoint = polar(angle, 56);

    return (
      <div className="w-full h-full flex items-center justify-center overflow-hidden">
        <svg
          viewBox="0 0 200 200"
          className="w-full h-full"
          style={{ overflow: "visible" }}
        >
          <defs>
            <filter
              id={gaugeId}
              x="-70%"
              y="-70%"
              width="240%"
              height="240%"
            >
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            <linearGradient
              id={`${gaugeId}-arc`}
              x1="0%"
              y1="100%"
              x2="100%"
              y2="0%"
            >
              <stop offset="0%" stopColor={accent} stopOpacity="0.72" />
              <stop offset="100%" stopColor={accent} />
            </linearGradient>

            <radialGradient id={`${gaugeId}-face`} cx="50%" cy="45%" r="70%">
              <stop offset="0%" stopColor={p.backgroundColor || "var(--panel-mid)"} />
              <stop offset="72%" stopColor={p.backgroundColor || "var(--panel-canvas)"} />
              <stop offset="100%" stopColor={p.backgroundColor || "var(--panel-canvas)"} />
            </radialGradient>

            <filter
              id={`${gaugeId}-glow`}
              x="-100%"
              y="-100%"
              width="300%"
              height="300%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur stdDeviation="5" result="blur1" />
              <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur2" />
              <feMerge>
                <feMergeNode in="blur1" />
                <feMergeNode in="blur2" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Dark instrument face */}
          <circle
            cx={cx}
            cy={cy}
            r="88"
            fill={`url(#${gaugeId}-face)`}
            stroke={p.borderColor || "var(--panel-mid)"}
            strokeWidth="1"
          />

          {/* Outer technical ring */}
          <path
            d={arcPath(start, end, 84)}
            fill="none"
            stroke="var(--panel-line)"
            strokeWidth="2"
            strokeDasharray="1 4"
          />

          {/* Main inactive arc */}
          <path
            d={arcPath(start, end, 72)}
            fill="none"
            stroke={track}
            strokeWidth="15"
            strokeLinecap="round"
          />

          {/* Soft halo behind active arc */}
          {p.glow !== false && (
            <path
              d={arcPath(start, angle, 72)}
              fill="none"
              stroke={accent}
              strokeWidth="22"
              strokeLinecap="round"
              opacity="0.28"
              filter={`url(#${gaugeId}-glow)`}
            />
          )}

          {/* Active colored arc */}
          <path
            d={arcPath(start, angle, 72)}
            fill="none"
            stroke={`url(#${gaugeId}-arc)`}
            strokeWidth="15"
            strokeLinecap="round"
            filter={p.glow !== false ? `url(#${gaugeId}-glow)` : undefined}
          />

          {/* Inner arc highlight */}
          <path
            d={arcPath(start, angle, 64)}
            fill="none"
            stroke={accent}
            strokeWidth="1.5"
            opacity="0.28"
          />

          {/* Dense industrial ticks */}
          {p.showScale !== false && Array.from({ length: 41 }, (_, i) => {
            const t = i / 40;
            const a = start + t * (end - start);

            const outer = polar(a, 86);
            const inner = polar(a, i % 5 === 0 ? 78 : 82);

            return (
              <line
                key={i}
                x1={outer.x}
                y1={outer.y}
                x2={inner.x}
                y2={inner.y}
                stroke={t <= progress ? accent : labelColor}
                strokeWidth={i % 5 === 0 ? 1.7 : 0.8}
                opacity={t <= progress ? 0.95 : 0.42}
              />
            );
          })}

          {/* Major scale values */}
          {p.showScale !== false && [0, 0.25, 0.5, 0.75, 1].map((t, i) => {
            const a = start + t * (end - start);
            const pos = polar(a, 89);
            const val = min + t * (max - min);

            return (
              <text
                key={i}
                x={pos.x}
                y={pos.y + 2}
                textAnchor="middle"
                fill={t <= progress ? accent : labelColor}
                fontSize="6.5"
                fontWeight="600"
              >
                {Number(val).toFixed(decimals > 0 ? 0 : 0)}
              </text>
            );
          })}

          {/* Gauge header — icon LEFT of title, locked as one centered group */}
          {(p.showIcon !== false || p.showTitle !== false) && (
            <g transform={`translate(${cx} 88)`}>
              {(() => {
                const iconSize = Math.max(12, Number(p.iconSize ?? 18));
                const titleSize = Math.max(7, Number(p.titleSize ?? 8));
                const gap = Math.max(4, Number(p.iconGap ?? 7));

                // SVG text width is approximate, so use a conservative estimate
                // and center the COMPLETE icon + title group around x=0.
                const titleWidth = p.showTitle !== false
                  ? Math.max(24, String(title).length * titleSize * 0.60)
                  : 0;
                const iconWidth = p.showIcon !== false ? iconSize : 0;
                const totalWidth = iconWidth + (iconWidth && titleWidth ? gap : 0) + titleWidth;
                const left = -totalWidth / 2;

                return (
                  <g>
                    {p.showIcon !== false && (
                      <g transform={`translate(${left} ${-iconSize / 2})`}>
                        <GaugeTypeIcon
                          type={gaugeType}
                          color={p.iconColor || accent}
                          size={iconSize}
                        />
                      </g>
                    )}

                    {p.showTitle !== false && (
                      <text
                        x={left + iconWidth + (iconWidth ? gap : 0) + titleWidth / 2}
                        y={0}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={textColor}
                        fontSize={titleSize}
                        fontWeight="700"
                        letterSpacing="0.7"
                      >
                        {title}
                      </text>
                    )}
                  </g>
                );
              })()}
            </g>
          )}

          {/* Value */}
          {p.showValue !== false && (
            <text
              x={cx}
              y="132"
              textAnchor="middle"
              fill={textColor}
              fontSize="20"
              fontWeight="700"
              letterSpacing="-0.4"
            >
              {previewValue.toFixed(decimals)}
            </text>
          )}

          {/* Unit - same size as title */}
          <text
            x={cx}
            y="145"
            textAnchor="middle"
            fill={p.unitColor || accent}
            fontSize={Number(p.titleSize ?? 8)}
            fontWeight="600"
            letterSpacing="1.1"
          >
            {unit}
          </text>

          {/* Bottom technical labels */}
          {p.showMinMax !== false && (
            <>
              <text
                x="31"
                y="172"
                textAnchor="middle"
                fill={labelColor}
                fontSize="6.5"
              >
                MIN {min}
              </text>

              <text
                x="169"
                y="172"
                textAnchor="middle"
                fill={labelColor}
                fontSize="6.5"
              >
                MAX {max}
              </text>
            </>
          )}
        </svg>
      </div>
    );
  }

  return <div className="text-[10px] text-[var(--text-muted)]">Empty Component</div>;
}

function PropInput({ label, value, onChange, type = "text", options, min, max }) {
  return (<div className="flex flex-col gap-0.5"><span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">{label}</span>
    {options ? (<select value={value} onChange={e => onChange(e.target.value)} className="bg-[var(--bg-canvas)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none focus:border-[var(--accent-green)]/60">{options.map(o => (<option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>))}</select>) :
      type === "checkbox" ? (<label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} className="accent-[var(--accent-green)]" /><span className="text-[10px] text-[var(--text-primary)]">{label}</span></label>) :
        type === "color" ? (<div className="flex items-center gap-2"><input type="color" value={value} onChange={e => onChange(e.target.value)} className="w-7 h-7 rounded cursor-pointer bg-transparent border border-[var(--border)]" /><input type="text" value={value} onChange={e => onChange(e.target.value)} className="flex-1 bg-[var(--bg-canvas)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none font-mono" /></div>) :
          (<input type={type} value={value} min={min} max={max} onChange={e => onChange(type === "number" ? Number(e.target.value) : e.target.value)} className="bg-[var(--bg-canvas)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none focus:border-[var(--accent-green)]/60" />)}
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

function PropSection({ title, children }) { return (<div className="flex flex-col gap-2 pb-3 border-b border-[var(--border-soft)]"><span className="text-[9px] font-bold text-[var(--accent-green)] uppercase tracking-widest pt-2">{title}</span>{children}</div>); }

// ── PROPERTY PANEL ──────────────────────────────────────────────
function PropertyPanel({ widget, onChange, onDelete, onDuplicate, canvasWidth, canvasHeight, availableDevices = [] }) {
  if (!widget) return (<div className="flex flex-col items-center justify-center h-full text-center px-4"><span className="text-3xl opacity-20 mb-2">🖱</span><p className="text-[var(--text-muted)] text-[10px]">Click a widget on the canvas to edit its properties</p></div>);
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

  return (<div className="flex flex-col h-full overflow-hidden"><div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-soft)] shrink-0"><div className="flex items-center gap-2"><span className="text-base">◻</span><span className="text-[var(--text-primary)] font-bold text-xs capitalize">{type || 'Unknown'}</span></div><div className="flex items-center gap-1"><button onClick={onDuplicate} title="Duplicate" className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-blue)] hover:bg-[var(--bg-hover)] transition-colors"><IconDupe /></button><button onClick={onDelete} title="Delete" className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-red)] hover:bg-[var(--status-red-bg)]/20 transition-colors"><IconTrash /></button></div></div><div className="flex-1 overflow-y-auto px-3 flex flex-col gap-0" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--border) var(--bg-canvas)" }}>

    <PropSection title="Position & Size"><div className="grid grid-cols-2 gap-2">
      <PropInput label="X" type="number" min={0} value={x} onChange={handleXChange} />
      <PropInput label="Y" type="number" min={0} value={y} onChange={handleYChange} />
      <PropInput label="Width" type="number" min={40} value={p.width} onChange={v => set("width", snap(v))} />
      <PropInput label="Height" type="number" min={24} value={p.height} onChange={v => set("height", snap(v))} />
    </div></PropSection>

    {/* ── BUTTON SETTINGS ───────────────────────────────────────────── */}
    {type === "button" && (
      <>

        <PropSection title="Device / Address">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
                Device
              </label>
              <select
                value={p.device || ""}
                onChange={e => set("device", e.target.value)}
                className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none focus:border-[var(--accent-green)]"
              >
                <option value="">Select device...</option>
                {availableDevices
                  .filter(dev => String(dev.type || "").toUpperCase() === "TCP")
                  .map((dev) => (
                    <option
                      key={`${dev.type || "TCP"}-${dev.name}`}
                      value={dev.name}
                    >
                      {dev.name}{dev.connection ? ` — ${dev.connection}` : ""}
                    </option>
                  ))}
              </select>
            </div>
            <PropInput
              label="Address"
              value={p.address || ""}
              onChange={v => set("address", v)}
              placeholder="D100 / M100"
            />
          </div>
        </PropSection>
                <PropSection title="Address Type">
          <PropInput
              label="Address Type"
              options={BUTTON_ADDRESS_TYPES}
              value={p.addressType || "coil"}
              onChange={v => set("addressType", v)}
            />
        </PropSection>

<PropSection title="Data Binding">
          <PropInput
            label="Variable"
            value={p.variable || ""}
            onChange={v => set("variable", v)}
          />
          <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
            Button is WRITE only. Use Coil or Holding Register.
            Discrete Input and Input Register are intentionally not available because they are read-only.
          </div>
          <div className="grid grid-cols-2 gap-2">
            <PropInput
              label="Value ON"
              type="number"
              value={p.valueOn ?? 1}
              onChange={v => set("valueOn", Number(v))}
            />
            <PropInput
              label="Value OFF"
              type="number"
              value={p.valueOff ?? 0}
              onChange={v => set("valueOff", Number(v))}
            />
          </div>
        </PropSection>

        <PropSection title="Simulation State">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => set("builderState", 1)}
              className="h-8 rounded-lg border text-[9px] font-bold transition-all"
              style={{
                background: isOn ? "var(--accent-cyan)" : "var(--bg-canvas)",
                borderColor: isOn ? "var(--accent-cyan)" : "var(--border)",
                color: isOn ? "var(--panel-canvas)" : "var(--text-dim)",
                boxShadow: isOn ? "0 0 12px rgba(0,191,255,0.25)" : "none"
              }}
            >
              ● ON
            </button>
            <button
              type="button"
              onClick={() => set("builderState", 0)}
              className="h-8 rounded-lg border text-[9px] font-bold transition-all"
              style={{
                background: !isOn ? "var(--border-soft)" : "var(--bg-canvas)",
                borderColor: !isOn ? "var(--text-dim)" : "var(--border)",
                color: !isOn ? "#FFFFFF" : "var(--text-dim)"
              }}
            >
              ○ OFF
            </button>
          </div>
          <div className="text-[8px] text-[var(--text-dim)] mt-1">
            Builder preview only. Runtime value comes from the bound variable/device.
          </div>
        </PropSection>

        <PropSection title="Button">
          <div className="grid grid-cols-2 gap-2">
            <PropInput
              label="Label ON"
              value={p.labelOn || "BUTTON ON"}
              onChange={v => set("labelOn", v)}
            />
            <PropInput
              label="Label OFF"
              value={p.labelOff || "BUTTON OFF"}
              onChange={v => set("labelOff", v)}
            />
          </div>

          <PropInput
            label="Variant"
            options={[
              { value: "neon", label: "Neon" },
              { value: "solid", label: "Solid" }
            ]}
            value={p.variant || "neon"}
            onChange={v => set("variant", v)}
          />

          <PropInput
            label="Font Size"
            type="number"
            min={8}
            max={48}
            value={p.fontSize ?? 18}
            onChange={v => set("fontSize", Number(v))}
          />
        </PropSection>

        <PropSection title="ON State Appearance">
          <PropInput
            label="Background"
            type="color"
            value={p.onBackground || "var(--accent-cyan)"}
            onChange={v => set("onBackground", v)}
          />
          <PropInput
            label="Border"
            type="color"
            value={p.onBorder || "var(--accent-cyan)"}
            onChange={v => set("onBorder", v)}
          />
          <PropInput
            label="Text"
            type="color"
            value={p.onTextColor || "#FFFFFF"}
            onChange={v => set("onTextColor", v)}
          />
        </PropSection>

        <PropSection title="OFF State Appearance">
          <PropInput
            label="Background"
            type="color"
            value={p.offBackground || "var(--bg-canvas)"}
            onChange={v => set("offBackground", v)}
          />
          <PropInput
            label="Border"
            type="color"
            value={p.offBorder || "var(--panel-mid)"}
            onChange={v => set("offBorder", v)}
          />
          <PropInput
            label="Text"
            type="color"
            value={p.offTextColor || "var(--panel-line)"}
            onChange={v => set("offTextColor", v)}
          />
        </PropSection>
      </>
    )}

    {/* ── LIGHT SETTINGS ─────────────────────────────────────────────── */}
    {type === "light" && (
      <>

        <PropSection title="Device / Address">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
                Device
              </label>
              <select
                value={p.device || ""}
                onChange={e => set("device", e.target.value)}
                className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none focus:border-[var(--accent-green)]"
              >
                <option value="">Select device...</option>
                {availableDevices
                  .filter(dev => String(dev.type || "").toUpperCase() === "TCP")
                  .map((dev) => (
                    <option
                      key={`${dev.type || "TCP"}-${dev.name}`}
                      value={dev.name}
                    >
                      {dev.name}{dev.connection ? ` — ${dev.connection}` : ""}
                    </option>
                  ))}
              </select>
            </div>
            <PropInput
              label="Address"
              value={p.address || ""}
              onChange={v => set("address", v)}
              placeholder="D100 / M100"
            />
          </div>
        </PropSection>
                <PropSection title="Address Type">
          <PropInput
              label="Address Type"
              options={LIGHT_ADDRESS_TYPES}
              value={p.addressType || "coil"}
              onChange={v => set("addressType", v)}
            />
        </PropSection>

<PropSection title="Data Binding">
          <PropInput
            label="Variable"
            value={p.variable || ""}
            onChange={v => set("variable", v)}
          />
          <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
            Light is READ only. It supports Coil, Discrete Input, Holding Register and Input Register.
            Runtime converts the read value to ON/OFF using Value ON / Value OFF.
          </div>
          <div className="grid grid-cols-2 gap-2">
            <PropInput
              label="Value ON"
              type="number"
              value={p.valueOn ?? 1}
              onChange={v => set("valueOn", Number(v))}
            />
            <PropInput
              label="Value OFF"
              type="number"
              value={p.valueOff ?? 0}
              onChange={v => set("valueOff", Number(v))}
            />
          </div>
        </PropSection>

        <PropSection title="Simulation State">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => set("builderState", 1)}
              className="h-8 rounded-lg border text-[9px] font-bold transition-all"
              style={{
                background: isOn ? "var(--accent-cyan)" : "var(--bg-canvas)",
                borderColor: isOn ? "var(--accent-cyan)" : "var(--border)",
                color: isOn ? "var(--panel-canvas)" : "var(--text-dim)",
                boxShadow: isOn ? "0 0 12px rgba(0,191,255,0.25)" : "none"
              }}
            >
              ● ON
            </button>
            <button
              type="button"
              onClick={() => set("builderState", 0)}
              className="h-8 rounded-lg border text-[9px] font-bold transition-all"
              style={{
                background: !isOn ? "var(--border-soft)" : "var(--bg-canvas)",
                borderColor: !isOn ? "var(--text-dim)" : "var(--border)",
                color: !isOn ? "#FFFFFF" : "var(--text-dim)"
              }}
            >
              ○ OFF
            </button>
          </div>
          <div className="text-[8px] text-[var(--text-dim)] mt-1">
            Builder preview only. Runtime value comes from the bound variable/device.
          </div>
        </PropSection>

        <PropSection title="Light">
          <PropInput
            label="Shape"
            options={[
              { value: "circle", label: "Circle" },
              { value: "square", label: "Square" }
            ]}
            value={p.shape || "circle"}
            onChange={v => set("shape", v)}
          />
          <PropInput
            label="Show Label"
            type="checkbox"
            value={p.showLabel !== false}
            onChange={v => set("showLabel", v)}
          />
          {p.showLabel !== false && (
            <PropInput
              label="Label"
              value={p.label || "STATUS"}
              onChange={v => set("label", v)}
            />
          )}
        </PropSection>

        <PropSection title="ON State Appearance">
          <PropInput
            label="Color ON"
            type="color"
            value={p.onColor || "var(--accent-cyan)"}
            onChange={v => set("onColor", v)}
          />
        </PropSection>

        <PropSection title="OFF State Appearance">
          <PropInput
            label="Color OFF"
            type="color"
            value={p.offColor || "var(--border-soft)"}
            onChange={v => set("offColor", v)}
          />
        </PropSection>
      </>
    )}

    {/* ── TEXT BOX SETTINGS ──────────────────────────────────────────── */}
    {type === "textbox" && (
      <>
        <PropSection title="Data Binding">
          <PropInput
            label="Variable"
            value={p.variable || ""}
            onChange={v => set("variable", v)}
          />
          <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
            When a variable is assigned, runtime displays its current value.
          </div>
          <PropInput
            label="Default Text"
            value={p.text || "TEXT"}
            onChange={v => set("text", v)}
          />
        </PropSection>

        <PropSection title="Icon">
          <PropInput
            label="Icon"
            options={TEXTBOX_ICONS.map(item => ({
              value: item.value,
              label: item.icon ? `${item.icon}  ${item.label}` : item.label
            }))}
            value={p.icon || ""}
            onChange={v => set("icon", v)}
          />
          <PropInput
            label="Position"
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Center" },
              { value: "right", label: "Right" }
            ]}
            value={p.iconPosition || "left"}
            onChange={v => set("iconPosition", v)}
          />
          <div className="grid grid-cols-2 gap-2">
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
          </div>
        </PropSection>

        <PropSection title="Text">
          <div className="grid grid-cols-2 gap-2">
            <PropInput
              label="Font Size"
              type="number"
              min={8}
              max={72}
              value={p.fontSize ?? 18}
              onChange={v => set("fontSize", Number(v))}
            />
            <PropInput
              label="Weight"
              options={[
                { value: "400", label: "Normal" },
                { value: "500", label: "Medium" },
                { value: "600", label: "Semi Bold" },
                { value: "700", label: "Bold" }
              ]}
              value={p.fontWeight || "600"}
              onChange={v => set("fontWeight", v)}
            />
          </div>

          <PropInput
            label="Alignment"
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
          <PropInput
            label="Icon Color"
            type="color"
            value={p.iconColor || "#FFFFFF"}
            onChange={v => set("iconColor", v)}
          />
          <PropInput
            label="Background"
            type="color"
            value={p.backgroundColor || "var(--panel-canvas)"}
            onChange={v => set("backgroundColor", v)}
          />
          <PropInput
            label="Border"
            type="color"
            value={p.borderColor || "var(--panel-mid)"}
            onChange={v => set("borderColor", v)}
          />
          <div className="grid grid-cols-2 gap-2">
            <PropInput
              label="Border Width"
              type="number"
              min={0}
              max={20}
              value={p.borderWidth ?? 0}
              onChange={v => set("borderWidth", Number(v))}
            />
            <PropInput
              label="Radius"
              type="number"
              min={0}
              max={50}
              value={p.radius ?? 6}
              onChange={v => set("radius", Number(v))}
            />
          </div>
          <PropInput
            label="Padding"
            type="number"
            min={0}
            max={40}
            value={p.padding ?? 8}
            onChange={v => set("padding", Number(v))}
          />
        </PropSection>
      </>
    )}

    {type === "linechart" && (
      <>
        <PropSection title="Chart">
          <PropInput
            label="Title"
            value={p.title || "PROCESS TREND"}
            onChange={v => set("title", v)}
          />
          <PropInput
            label="Unit"
            value={p.unit || ""}
            onChange={v => set("unit", v)}
          />
          <div className="grid grid-cols-2 gap-2">
            <PropInput
              label="Max Duration (sec)"
              type="number"
              min={5}
              max={3600}
              value={p.historySeconds ?? 60}
              onChange={v => set("historySeconds", Number(v))}
            />
            <PropInput
              label="Sample (ms)"
              type="number"
              min={100}
              max={5000}
              value={p.sampleInterval ?? 500}
              onChange={v => set("sampleInterval", Number(v))}
            />
          </div>
          <PropInput
            label="Decimals"
            type="number"
            min={0}
            max={4}
            value={p.decimals ?? 1}
            onChange={v => set("decimals", Number(v))}
          />
        </PropSection>

        <PropSection title="Y Axis">
          <PropInput
            label="Auto Scale"
            type="checkbox"
            value={p.autoScale !== false}
            onChange={v => set("autoScale", v)}
          />
          {p.autoScale === false && (
            <div className="grid grid-cols-2 gap-2">
              <PropInput
                label="Min"
                type="number"
                value={p.yMin ?? 0}
                onChange={v => set("yMin", Number(v))}
              />
              <PropInput
                label="Max"
                type="number"
                value={p.yMax ?? 100}
                onChange={v => set("yMax", Number(v))}
              />
            </div>
          )}
        </PropSection>

        <PropSection title="Trend Trigger">
          <div className="text-[8px] text-[var(--text-dim)] leading-relaxed">
            When enabled, the configured trigger address controls the trend: value 1 starts recording and value 0 stops recording.
          </div>

          <PropInput
            label="Enable Trigger"
            type="checkbox"
            value={p.triggerEnabled === true}
            onChange={v => set("triggerEnabled", v)}
          />

          <div>
            <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
              Trigger Device
            </label>
            <select
              value={p.triggerDevice || ""}
              onChange={e => set("triggerDevice", e.target.value)}
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

          <PropInput
            label="Trigger Address Type"
            options={LINECHART_ADDRESS_TYPES}
            value={p.triggerAddressType || "holding_register"}
            onChange={v => set("triggerAddressType", v)}
          />

          <PropInput
            label="Trigger Address"
            value={p.triggerAddress ?? ""}
            onChange={v => set("triggerAddress", v)}
            placeholder="0 / 10 / 100"
          />

          <div className="grid grid-cols-2 gap-2">
            <PropInput
              label="Start Value"
              type="number"
              value={p.triggerStartValue ?? 1}
              onChange={v => set("triggerStartValue", Number(v))}
            />
            <PropInput
              label="Stop Value"
              type="number"
              value={p.triggerStopValue ?? 0}
              onChange={v => set("triggerStopValue", Number(v))}
            />
          </div>

          <PropInput
            label="Clear History On Start"
            type="checkbox"
            value={p.clearHistoryOnStart !== false}
            onChange={v => set("clearHistoryOnStart", v)}
          />
        </PropSection>

        <PropSection title="Realtime Series">
          <div className="text-[8px] text-[var(--text-dim)]">
            One realtime signal is shown by default. Add more PLC series only when needed.
          </div>

          {(Array.isArray(p.series) ? p.series : []).map((series, index) => {
            const updateSeries = (key, value) => {
              const next = [...(Array.isArray(p.series) ? p.series : [])];
              next[index] = { ...next[index], [key]: value };
              set("series", next);
            };

            return (
              <div
                key={series.id || `series-${index}`}
                className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-canvas)] p-2.5 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-2 pb-1 border-b border-[var(--border-soft)]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: series.color || LINECHART_SERIES_COLORS[index % 4], boxShadow: `0 0 7px ${series.color || LINECHART_SERIES_COLORS[index % 4]}` }}
                    />
                    <div className="min-w-0">
                      <div className="text-[9px] text-[var(--text-primary)] font-bold truncate">SERIES {index + 1}</div>
                      <div className="text-[7px] text-[var(--text-dim)] uppercase tracking-wider">Realtime PLC signal</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="flex items-center gap-1.5 cursor-pointer text-[8px] text-[var(--text-soft)]">
                      <input
                        type="checkbox"
                        checked={series.enabled !== false}
                        onChange={e => updateSeries("enabled", e.target.checked)}
                        className="accent-[var(--accent-green)]"
                      />
                      ON
                    </label>
                    {(Array.isArray(p.series) ? p.series : []).length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...(Array.isArray(p.series) ? p.series : [])];
                          next.splice(index, 1);
                          set("series", next);
                        }}
                        className="w-6 h-6 rounded border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent-red)] hover:border-[var(--accent-red)]/60 hover:bg-[var(--status-red-bg)] text-[11px] transition-colors"
                        title="Remove series"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                <PropInput
                  label="Label"
                  value={series.label || `SERIES ${index + 1}`}
                  onChange={v => updateSeries("label", v)}
                />

                <div>
                  <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
                    Device
                  </label>
                  <select
                    value={series.device || ""}
                    onChange={e => updateSeries("device", e.target.value)}
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

                <PropInput
                  label="Address Type"
                  options={LINECHART_ADDRESS_TYPES}
                  value={series.addressType || "holding_register"}
                  onChange={v => updateSeries("addressType", v)}
                />

                <PropInput
                  label="Address"
                  value={series.address ?? ""}
                  onChange={v => updateSeries("address", v)}
                  placeholder="0 / 10 / 100"
                />

                <PropInput
                  label="Line Color"
                  type="color"
                  value={series.color || LINECHART_SERIES_COLORS[index % 4]}
                  onChange={v => updateSeries("color", v)}
                />
              </div>
            );
          })}

          {(Array.isArray(p.series) ? p.series : []).length < 4 && (
            <button
              type="button"
              onClick={() => {
                const current = Array.isArray(p.series) ? p.series : [];
                set("series", [...current, createLineChartSeries(current.length)]);
              }}
              className="h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] text-[var(--accent-green)] text-[9px] font-bold hover:bg-[var(--border-soft)] transition-colors"
            >
              + ADD SERIES
            </button>
          )}
        </PropSection>

        <PropSection title="Display">
          <PropInput
            label="Show Grid"
            type="checkbox"
            value={p.showGrid !== false}
            onChange={v => set("showGrid", v)}
          />
          <PropInput
            label="Show Legend"
            type="checkbox"
            value={p.showLegend !== false}
            onChange={v => set("showLegend", v)}
          />
          <PropInput
            label="Show Current Value"
            type="checkbox"
            value={p.showCurrentValue !== false}
            onChange={v => set("showCurrentValue", v)}
          />
          <PropInput
            label="Show Time Axis"
            type="checkbox"
            value={p.showTimeAxis !== false}
            onChange={v => set("showTimeAxis", v)}
          />
        </PropSection>

        <PropSection title="Appearance">
          <div className="flex flex-col gap-2">

            <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-canvas)] p-2">
              <PropInput
                label="Background"
                type="color"
                value={p.backgroundColor || "var(--panel-canvas)"}
                onChange={v => set("backgroundColor", v)}
              />
            </div>

            <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-canvas)] p-2">
              <PropInput
                label="Border"
                type="color"
                value={p.borderColor || "var(--panel-mid)"}
                onChange={v => set("borderColor", v)}
              />
            </div>

            <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-canvas)] p-2">
              <PropInput
                label="Grid"
                type="color"
                value={p.gridColor || "var(--panel-mid)"}
                onChange={v => set("gridColor", v)}
              />
            </div>

            <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-canvas)] p-2">
              <PropInput
                label="Axis Text"
                type="color"
                value={p.labelColor || "var(--panel-line)"}
                onChange={v => set("labelColor", v)}
              />
            </div>

            <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-canvas)] p-2">
              <PropInput
                label="Chart Text"
                type="color"
                value={p.textColor || "#FFFFFF"}
                onChange={v => set("textColor", v)}
              />
            </div>

            <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-canvas)] p-2">
              <PropInput
                label="Line Width"
                type="number"
                min={1}
                max={5}
                step={0.1}
                value={p.lineWidth ?? 1.8}
                onChange={v => set("lineWidth", Number(v))}
              />
            </div>

          </div>
        </PropSection>
      </>
    )}

    {type === "gauge" && (
      <>


        <PropSection title="Device / Address">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
                Device
              </label>
              <select
                value={p.device || ""}
                onChange={e => set("device", e.target.value)}
                className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none focus:border-[var(--accent-green)]"
              >
                <option value="">Select device...</option>
                {availableDevices
                  .filter(dev => String(dev.type || "").toUpperCase() === "TCP")
                  .map((dev) => (
                    <option
                      key={`${dev.type || "TCP"}-${dev.name}`}
                      value={dev.name}
                    >
                      {dev.name}{dev.connection ? ` — ${dev.connection}` : ""}
                    </option>
                  ))}
              </select>
            </div>
            <PropInput
              label="Address"
              value={p.address || ""}
              onChange={v => set("address", v)}
              placeholder="D100 / M100"
            />
          </div>
        </PropSection>
                <PropSection title="Address Type">
          <PropInput
              label="Address Type"
              options={GAUGE_ADDRESS_TYPES}
              value={p.addressType || "holding_register"}
              onChange={v => set("addressType", v)}
            />
        </PropSection>

<PropSection title="Data Binding">
          <PropInput
            label="Variable"
            value={p.variable || ""}
            onChange={v => set("variable", v)}
          />
          <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
            Gauge is READ only and uses Holding Register only.
            Runtime reads the Holding Register numeric value and binds it to the gauge.
          </div>
        </PropSection>

        <PropSection title="Gauge Type & Header">
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
              Instrument
            </span>

            <div className="grid grid-cols-2 gap-1.5">
              {GAUGE_TYPES.map(item => {
                const active = (p.gaugeType || "temp") === item.value;

                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => set("gaugeType", item.value)}
                    className="h-9 rounded-lg border flex items-center gap-2 px-2 text-left transition-all"
                    style={{
                      background: active ? "rgba(0,191,255,0.10)" : "var(--bg-canvas)",
                      borderColor: active ? "var(--accent-cyan)" : "var(--border)",
                      color: active ? "#FFFFFF" : "var(--text-secondary)",
                      boxShadow: active ? "0 0 10px rgba(0,191,255,0.12)" : "none"
                    }}
                  >
                    <span
                      className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                      style={{
                        background: active ? "rgba(0,191,255,0.12)" : "var(--panel-canvas)",
                        color: active ? "var(--accent-cyan)" : "var(--text-dim)"
                      }}
                    >
                      <GaugeTypeIcon
                        type={item.value}
                        color={active ? "var(--accent-cyan)" : "var(--text-dim)"}
                        size={17}
                      />
                    </span>

                    <span className="text-[9px] font-bold truncate">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <PropInput
            label="Title"
            value={p.title || "VALUE"}
            onChange={v => set("title", v)}
          />

          <PropInput
            label="Unit"
            value={p.unit || ""}
            onChange={v => set("unit", v)}
          />
          <div className="text-[8px] text-[var(--text-dim)] -mt-1">
            Suggested: {GAUGE_TYPES.find(g => g.value === (p.gaugeType || "temp"))?.unit || ""}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <PropInput
              label="Icon Size"
              type="number"
              min={12}
              max={48}
              value={p.iconSize ?? 25}
              onChange={v => set("iconSize", Number(v))}
            />

            <PropInput
              label="Title Size"
              type="number"
              min={7}
              max={24}
              value={p.titleSize ?? 10}
              onChange={v => set("titleSize", Number(v))}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <PropInput
              label="Show Icon"
              type="checkbox"
              value={p.showIcon !== false}
              onChange={v => set("showIcon", v)}
            />

            <PropInput
              label="Show Title"
              type="checkbox"
              value={p.showTitle !== false}
              onChange={v => set("showTitle", v)}
            />
          </div>
        </PropSection>

        <PropSection title="Value Range">
          <div className="grid grid-cols-2 gap-2">
            <PropInput
              label="Min"
              type="number"
              value={p.min ?? 0}
              onChange={v => set("min", Number(v))}
            />

            <PropInput
              label="Max"
              type="number"
              value={p.max ?? 100}
              onChange={v => set("max", Number(v))}
            />
          </div>

          <PropInput
            label="Decimals"
            type="number"
            min={0}
            max={4}
            value={p.decimals ?? 1}
            onChange={v => set("decimals", Number(v))}
          />
        </PropSection>

        <PropSection title="Simulation State">
          <PropInput
            label="Value"
            type="number"
            value={p.simulationValue ?? p.min ?? 0}
            min={Number(p.min ?? 0)}
            max={Number(p.max ?? 100)}
            onChange={v => set("simulationValue", Number(v))}
          />

          <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
            Builder preview only. Runtime value will come from the bound variable.
          </div>
        </PropSection>

        <PropSection title="Display">
          <PropInput
            label="Show Value"
            type="checkbox"
            value={p.showValue !== false}
            onChange={v => set("showValue", v)}
          />

          <PropInput
            label="Show Scale"
            type="checkbox"
            value={p.showScale !== false}
            onChange={v => set("showScale", v)}
          />

          <PropInput
            label="Show Min / Max"
            type="checkbox"
            value={p.showMinMax !== false}
            onChange={v => set("showMinMax", v)}
          />

          <PropInput
            label="Glow"
            type="checkbox"
            value={p.glow !== false}
            onChange={v => set("glow", v)}
          />
        </PropSection>

        <PropSection title="Appearance">
          <PropInput
            label="Gauge Background"
            type="color"
            value={p.backgroundColor || "var(--panel-canvas)"}
            onChange={v => set("backgroundColor", v)}
          />

          <PropInput
            label="Gauge Border"
            type="color"
            value={p.borderColor || "var(--panel-mid)"}
            onChange={v => set("borderColor", v)}
          />

          <PropInput
            label="Progress Color"
            type="color"
            value={p.progressColor || "var(--accent-cyan)"}
            onChange={v => set("progressColor", v)}
          />

          <PropInput
            label="Track Color"
            type="color"
            value={p.trackColor || "var(--panel-mid)"}
            onChange={v => set("trackColor", v)}
          />

          <PropInput
            label="Text / Value Color"
            type="color"
            value={p.textColor || "#FFFFFF"}
            onChange={v => set("textColor", v)}
          />

          <PropInput
            label="Icon Color"
            type="color"
            value={p.iconColor || p.progressColor || "var(--accent-cyan)"}
            onChange={v => set("iconColor", v)}
          />

          <PropInput
            label="Unit Color"
            type="color"
            value={p.unitColor || p.progressColor || "var(--accent-cyan)"}
            onChange={v => set("unitColor", v)}
          />

          <PropInput
            label="Tick / Scale Color"
            type="color"
            value={p.labelColor || "var(--panel-line)"}
            onChange={v => set("labelColor", v)}
          />
        </PropSection>
      </>
    )}


    {type === "gauge" && (
      <>


        <PropSection title="Device / Address">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
                Device
              </label>
              <select
                value={p.device || ""}
                onChange={e => set("device", e.target.value)}
                className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none focus:border-[var(--accent-green)]"
              >
                <option value="">Select device...</option>
                {availableDevices
                  .filter(dev => String(dev.type || "").toUpperCase() === "TCP")
                  .map((dev) => (
                    <option
                      key={`${dev.type || "TCP"}-${dev.name}`}
                      value={dev.name}
                    >
                      {dev.name}{dev.connection ? ` — ${dev.connection}` : ""}
                    </option>
                  ))}
              </select>
            </div>
            <PropInput
              label="Address"
              value={p.address || ""}
              onChange={v => set("address", v)}
              placeholder="D100 / M100"
            />
          </div>
        </PropSection>
                <PropSection title="Address Type">
          <PropInput
              label="Address Type"
              options={GAUGE_ADDRESS_TYPES}
              value={p.addressType || "holding_register"}
              onChange={v => set("addressType", v)}
            />
        </PropSection>

<PropSection title="Data Binding">
          <PropInput
            label="Variable"
            value={p.variable || ""}
            onChange={v => set("variable", v)}
          />
          <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
            Gauge is READ only and uses Holding Register only.
            Runtime reads the Holding Register numeric value and binds it to the gauge.
          </div>
        </PropSection>

        <PropSection title="Gauge Type & Header">
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
              Instrument
            </span>

            <div className="grid grid-cols-2 gap-1.5">
              {GAUGE_TYPES.map(item => {
                const active = (p.gaugeType || "temp") === item.value;

                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => set("gaugeType", item.value)}
                    className="h-9 rounded-lg border flex items-center gap-2 px-2 text-left transition-all"
                    style={{
                      background: active ? "rgba(0,191,255,0.10)" : "var(--bg-canvas)",
                      borderColor: active ? "var(--accent-cyan)" : "var(--border)",
                      color: active ? "#FFFFFF" : "var(--text-secondary)",
                      boxShadow: active ? "0 0 10px rgba(0,191,255,0.12)" : "none"
                    }}
                  >
                    <span
                      className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                      style={{
                        background: active ? "rgba(0,191,255,0.12)" : "var(--panel-canvas)",
                        color: active ? "var(--accent-cyan)" : "var(--text-dim)"
                      }}
                    >
                      <GaugeTypeIcon
                        type={item.value}
                        color={active ? "var(--accent-cyan)" : "var(--text-dim)"}
                        size={17}
                      />
                    </span>

                    <span className="text-[9px] font-bold truncate">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <PropInput
            label="Title"
            value={p.title || "VALUE"}
            onChange={v => set("title", v)}
          />

          <PropInput
            label="Unit"
            value={p.unit || ""}
            onChange={v => set("unit", v)}
          />
          <div className="text-[8px] text-[var(--text-dim)] -mt-1">
            Suggested: {GAUGE_TYPES.find(g => g.value === (p.gaugeType || "temp"))?.unit || ""}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <PropInput
              label="Icon Size"
              type="number"
              min={12}
              max={48}
              value={p.iconSize ?? 25}
              onChange={v => set("iconSize", Number(v))}
            />

            <PropInput
              label="Title Size"
              type="number"
              min={7}
              max={24}
              value={p.titleSize ?? 10}
              onChange={v => set("titleSize", Number(v))}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <PropInput
              label="Show Icon"
              type="checkbox"
              value={p.showIcon !== false}
              onChange={v => set("showIcon", v)}
            />

            <PropInput
              label="Show Title"
              type="checkbox"
              value={p.showTitle !== false}
              onChange={v => set("showTitle", v)}
            />
          </div>
        </PropSection>

        <PropSection title="Value Range">
          <div className="grid grid-cols-2 gap-2">
            <PropInput
              label="Min"
              type="number"
              value={p.min ?? 0}
              onChange={v => set("min", Number(v))}
            />

            <PropInput
              label="Max"
              type="number"
              value={p.max ?? 100}
              onChange={v => set("max", Number(v))}
            />
          </div>

          <PropInput
            label="Decimals"
            type="number"
            min={0}
            max={4}
            value={p.decimals ?? 1}
            onChange={v => set("decimals", Number(v))}
          />
        </PropSection>

        <PropSection title="Simulation State">
          <PropInput
            label="Value"
            type="number"
            value={p.simulationValue ?? p.min ?? 0}
            min={Number(p.min ?? 0)}
            max={Number(p.max ?? 100)}
            onChange={v => set("simulationValue", Number(v))}
          />

          <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
            Builder preview only. Runtime value will come from the bound variable.
          </div>
        </PropSection>

        <PropSection title="Display">
          <PropInput
            label="Show Value"
            type="checkbox"
            value={p.showValue !== false}
            onChange={v => set("showValue", v)}
          />

          <PropInput
            label="Show Scale"
            type="checkbox"
            value={p.showScale !== false}
            onChange={v => set("showScale", v)}
          />

          <PropInput
            label="Show Min / Max"
            type="checkbox"
            value={p.showMinMax !== false}
            onChange={v => set("showMinMax", v)}
          />

          <PropInput
            label="Glow"
            type="checkbox"
            value={p.glow !== false}
            onChange={v => set("glow", v)}
          />
        </PropSection>

        <PropSection title="Appearance">
          <PropInput
            label="Gauge Background"
            type="color"
            value={p.backgroundColor || "var(--panel-canvas)"}
            onChange={v => set("backgroundColor", v)}
          />

          <PropInput
            label="Gauge Border"
            type="color"
            value={p.borderColor || "var(--panel-mid)"}
            onChange={v => set("borderColor", v)}
          />

          <PropInput
            label="Progress Color"
            type="color"
            value={p.progressColor || "var(--accent-cyan)"}
            onChange={v => set("progressColor", v)}
          />

          <PropInput
            label="Track Color"
            type="color"
            value={p.trackColor || "var(--panel-mid)"}
            onChange={v => set("trackColor", v)}
          />

          <PropInput
            label="Text / Value Color"
            type="color"
            value={p.textColor || "#FFFFFF"}
            onChange={v => set("textColor", v)}
          />

          <PropInput
            label="Icon Color"
            type="color"
            value={p.iconColor || p.progressColor || "var(--accent-cyan)"}
            onChange={v => set("iconColor", v)}
          />

          <PropInput
            label="Unit Color"
            type="color"
            value={p.unitColor || p.progressColor || "var(--accent-cyan)"}
            onChange={v => set("unitColor", v)}
          />

          <PropInput
            label="Tick / Scale Color"
            type="color"
            value={p.labelColor || "var(--panel-line)"}
            onChange={v => set("labelColor", v)}
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
            value={p.fill || "var(--panel-mid)"}
            onChange={v => set("fill", v)}
          />
          <PropInput
            label="Border"
            type="color"
            value={p.borderColor || "var(--accent-cyan)"}
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

export default function PageBuilder({ cpNumber, onClose, availableDevices = [] }) {
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
    <ModalBackdrop className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm font-sans">
      <ModalPanel className="flex flex-col rounded-2xl overflow-hidden border border-[var(--border)] shadow-2xl" style={{ width: "min(98vw, 1800px)", height: "min(96vh, 900px)", background: "var(--panel-canvas)" }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-soft)] shrink-0" style={{ background: "var(--bg-surface-2)" }}>
          <div className="flex items-center gap-3">
            <span className="text-[var(--accent-green)] font-black text-lg tracking-tighter">WIK</span>
            <div className="w-px h-5 bg-[var(--border)]" />
            <span className="text-[var(--text-primary)] font-bold text-sm">Page Builder</span>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[var(--accent-green)]/15 text-[var(--accent-green)] border border-[var(--accent-green)]/30">CP{String(cpNumber).padStart(2, "0")}</span>
          </div>
          <div className="flex items-center gap-2">
            <select value={canvasPreset.width} onChange={e => { const newPreset = CANVAS_PRESETS.find(p => p.width === Number(e.target.value)); if (newPreset) setCanvasPreset(newPreset); }} className="bg-[var(--border-soft)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded px-2 h-7 outline-none cursor-pointer">{CANVAS_PRESETS.map(p => (<option key={p.width} value={p.width}>{p.label}</option>))}</select>
            {saveMsg && <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${saveMsg.startsWith("✓") ? "text-[var(--accent-green)] bg-[var(--accent-green)]/10" : "text-[var(--accent-red)] bg-[var(--accent-red)]/10"}`}>{saveMsg}</span>}
            <button onClick={clearCanvas} className="h-7 px-3 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--border-soft)] text-[10px] font-bold transition-colors">Clear</button>
            <button onClick={save} disabled={saving} className="h-7 px-4 rounded-lg bg-[var(--accent-green)] hover:bg-[var(--accent-green-dark)] text-[var(--status-green-bg)] font-bold text-[10px] transition-colors disabled:opacity-50 flex items-center gap-1.5">{saving ? <><div className="w-3 h-3 border-2 border-[var(--status-green-bg)] border-t-transparent rounded-full animate-spin" /> Saving…</> : "💾 Save Layout"}</button>
            <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border-soft)] transition-colors"><IconX /></button>
          </div>
        </div>
        <div className="flex flex-1 overflow-hidden min-h-0">
          <div className="shrink-0 border-r border-[var(--border-soft)] flex flex-col" style={{ width: 272, background: "var(--bg-canvas)" }}>
            <div className="px-3 pt-3 pb-2 shrink-0"><p className="text-[var(--accent-green)] text-[9px] font-bold uppercase tracking-widest mb-2">Components</p><input value={paletteSearch} onChange={e => setPaletteSearch(e.target.value)} placeholder="Search…" className="w-full bg-[var(--border-soft)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded-lg px-2 h-7 outline-none placeholder-[var(--border)] focus:border-[var(--accent-green)]/50" /></div>
            <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-1.5 mt-2" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--border) var(--bg-canvas)" }}>
              {filteredPalette.map(comp => (
                <div
                  key={comp.type}
                  draggable
                  onDragStart={e => e.dataTransfer.setData("component-type", comp.type)}
                  className="relative flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--border-soft)]/40 bg-[var(--bg-canvas)]/50 hover:border-[var(--accent-green)]/40 hover:bg-[var(--border-soft)] cursor-grab active:cursor-grabbing transition-all duration-200 group overflow-hidden shadow-sm hover:shadow-md"
                >
                  {/* Aksen garis di sebelah kiri saat hover */}
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[var(--accent-green)] scale-y-0 group-hover:scale-y-100 transition-transform duration-200 origin-center rounded-r-sm shadow-[0_0_8px_var(--accent-green)]" />

                  {/* Wadah Ikon */}
                  <div className="w-8 h-8 rounded bg-[var(--panel-canvas)] border border-[var(--border-soft)] group-hover:border-[var(--accent-green)]/50 flex items-center justify-center text-[var(--accent-green)] shrink-0 transition-all duration-200 group-hover:shadow-[0_0_10px_rgba(34,197,94,0.15)] group-hover:scale-105">
                    <span className="text-sm">{comp.icon}</span>
                  </div>

                  {/* Teks Label & Deskripsi */}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[var(--text-primary)] text-[11px] font-bold tracking-wide leading-tight group-hover:text-[var(--text-primary)] transition-colors">
                      {comp.label}
                    </span>
                    <span className="text-[var(--text-dim)] text-[9px] leading-tight truncate group-hover:text-[var(--text-secondary)] transition-colors mt-0.5">
                      {comp.desc}
                    </span>
                  </div>

                  {/* Ikon Drag (Grip) yang muncul saat hover */}
                  <div className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] group-hover:text-[var(--accent-green)]/70 transition-opacity mr-1 shrink-0">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="5" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="9" cy="19" r="1.5" />
                      <circle cx="15" cy="5" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="15" cy="19" r="1.5" />
                    </svg>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div ref={canvasContainerRef} className="flex-1 min-w-0 overflow-hidden min-h-0 flex items-center justify-center px-8 py-4" style={{ background: "var(--panel-canvas)" }}>
            {loading ? (<div className="flex items-center gap-2 text-[var(--accent-green)] text-xs mt-20"><div className="w-4 h-4 border-2 border-[var(--accent-green)] border-t-transparent rounded-full animate-spin" /> Loading layout…</div>) : (
              <div style={{ width: displayWidth, height: displayHeight, position: "relative", flex: "0 0 auto" }}>
                <div ref={canvasRef} onDragOver={e => e.preventDefault()} onDrop={handleCanvasDrop} onClick={() => setSelected(null)} className="relative origin-top-left" style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})`, background: "var(--bg-canvas)", border: "1px solid var(--border-soft)", borderRadius: 8, backgroundImage: "radial-gradient(circle, var(--border-soft) 1px, transparent 1px)", backgroundSize: `${GRID * 2}px ${GRID * 2}px` }}>
                  {widgets.length === 0 && (<div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none"><span className="text-4xl opacity-10 mb-2">🖱</span><p className="text-[var(--border-soft)] text-sm font-mono">Drag components here</p></div>)}
                  {widgets.map(widget => {
                    const isSel = widget.id === selected;
                    return (<div key={widget.id} id={`widget-${widget.id}`} onMouseDown={e => startDrag(e, widget.id)} onClick={e => { e.stopPropagation(); setSelected(widget.id); }} className="absolute select-none" style={{ left: widget.x, top: widget.y, width: widget.props.width, height: widget.props.height, cursor: dragInfo?.id === widget.id ? "grabbing" : "grab", outline: isSel ? "2px solid var(--accent-green)" : "1px solid transparent", outlineOffset: 2, borderRadius: 6, zIndex: isSel ? 10 : 1 }}><div className="w-full h-full overflow-hidden" style={{ borderRadius: 6 }}><WidgetPreview widget={widget} onUpdate={handleWidgetUpdate} /></div>{isSel && <div className="absolute -top-5 left-0 flex items-center gap-1 pointer-events-none"><span className="text-[var(--accent-green)] text-[9px] font-bold bg-[var(--panel-canvas)] px-1.5 py-0.5 rounded font-mono capitalize">{widget.type}</span></div>}{isSel && <div onMouseDown={e => startResize(e, widget.id)} className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize" style={{ background: "var(--accent-green)", borderRadius: "2px 0 4px 0", zIndex: 20 }} />}</div>);
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="shrink-0 border-l border-[var(--border-soft)] flex flex-col" style={{ width: 296, background: "var(--bg-canvas)" }}>
            <PropertyPanel
              widget={selectedWidget}
              onChange={updated => setWidgets(ws => ws.map(w => w.id === updated.id ? updated : w))}
              onDelete={() => { setWidgets(ws => ws.filter(w => w.id !== selected)); setSelected(null); }}
              onDuplicate={() => { if (!selectedWidget) return; const newId = uid(); let newX = selectedWidget.x + 16, newY = selectedWidget.y + 16; const maxX = CANVAS_W - selectedWidget.props.width, maxY = CANVAS_H - selectedWidget.props.height; newX = Math.min(newX, maxX); newY = Math.min(newY, maxY); const clone = { ...selectedWidget, id: newId, x: newX, y: newY }; setWidgets(ws => [...ws, clone]); setSelected(newId); }}
              canvasWidth={CANVAS_W}
              canvasHeight={CANVAS_H}
               availableDevices={availableDevices}
            />
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-[var(--border-soft)] shrink-0" style={{ background: "var(--panel-canvas)" }}>
          <span className="text-[var(--border)] text-[9px] font-mono">{widgets.length} widget{widgets.length !== 1 ? "s" : ""} · Canvas {CANVAS_W}×{CANVAS_H}px · Grid {GRID}px</span>
          {selectedWidget && <span className="text-[var(--text-muted)] text-[9px] font-mono">x:{selectedWidget.x} y:{selectedWidget.y} · {selectedWidget.props.width}×{selectedWidget.props.height}</span>}
          <span className="text-[var(--border)] text-[9px] font-mono">Del = delete · drag to move · ↘ to resize</span>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}