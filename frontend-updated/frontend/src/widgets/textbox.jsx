// src/widgets/textbox.jsx
//
// Universal HMI / Futuristic Text Box
// - TextBoxDef            palette entry
// - TextBoxPreview        Page Builder canvas preview
// - TextBoxPropertyPanel  property panel
// - RuntimeTextBox        Dynamic CP Page runtime
//
// BASE PROGRAM COMPATIBILITY:
// Keep the existing exports and runtime contract so PageBuilder.jsx,
// DynamicCPPage.jsx and widgets/index.js do not need to change.

import React from "react";
import { useInternalVariables } from "../hooks/useInternalVariables";

import {
  PropInput,
  PropSection,
  TEXTBOX_ICONS,
  getVisual,
  DEFAULT_VISUAL,
} from "./shared";

// ────────────────────────────────────────────────────────────────
// FRAME STYLES
// Designed as clean industrial/HUD frames rather than decorative
// random shapes. All frames use the same SVG renderer.
// ────────────────────────────────────────────────────────────────

export const TEXTBOX_FRAME_STYLES = [
  { value: "standard", label: "Standard" },
  { value: "cyber", label: "Cyber HUD" },
  { value: "bracket", label: "Corner Bracket" },
  { value: "chamfer", label: "Chamfer" },
  { value: "hex", label: "Hex HUD" },
  { value: "angular", label: "Angular HUD" },
  { value: "double", label: "Double Line" },
  { value: "corner", label: "Corner Lines" },
  { value: "title", label: "Title Frame" },
  { value: "capsule", label: "Capsule" },
  { value: "terminal", label: "Terminal" },
  { value: "scan", label: "Scan Frame" },
];

export const TEXTBOX_FRAME_PRESETS = [
  { value: "cyan", label: "Cyber Cyan", color: "#00E5FF" },
  { value: "blue", label: "Digital Blue", color: "#38BDF8" },
  { value: "green", label: "Industrial Green", color: "#39FF88" },
  { value: "amber", label: "Warning Amber", color: "#FFB020" },
  { value: "red", label: "Alarm Red", color: "#FF4058" },
  { value: "white", label: "Clean White", color: "#DCEBFF" },
  { value: "custom", label: "Custom", color: "" },
];

const FRAME_PRESET_COLORS = {
  cyan: "#00E5FF",
  blue: "#38BDF8",
  green: "#39FF88",
  amber: "#FFB020",
  red: "#FF4058",
  white: "#DCEBFF",
};

const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, Number(value)));

// Numeric TextBox values are displayed with exactly 3 digits
// after the decimal point. The underlying stored value remains numeric.
const formatTextBoxNumber = (value) => {
  if (value === undefined || value === null || value === "") return value;

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;

  return numeric.toFixed(3);
};

const resolveFrameColor = (p) => {
  if (p.framePreset === "custom") return p.frameColor || "#00E5FF";
  return (
    p.frameColor ||
    FRAME_PRESET_COLORS[p.framePreset || "cyan"] ||
    "#00E5FF"
  );
};

// Clean frame geometries.
// ViewBox is always 0..100 so the frame scales correctly with the widget.
const getFrameGeometry = (style, cut = 10) => {
  const c = clamp(cut, 4, 24);

  switch (style) {
    case "cyber":
      return {
        path: `
          M 2 16
          L 16 2
          L 70 2
          L 76 8
          L 98 8
          L 98 84
          L 84 98
          L 30 98
          L 24 92
          L 2 92
          Z
        `,
        accent: [
          "M 18 2 L 26 2",
          "M 76 8 L 90 8",
          "M 84 98 L 92 90",
          "M 2 84 L 2 72",
        ],
      };

    case "bracket":
      return {
        path: `
          M 24 2 H 4 V 22
          M 76 2 H 96 V 22
          M 4 78 V 98 H 24
          M 96 78 V 98 H 76
        `,
        accent: [],
      };

    case "chamfer":
      return {
        path: `
          M ${c} 2
          H ${100 - c}
          L 98 ${c}
          V ${100 - c}
          L ${100 - c} 98
          H ${c}
          L 2 ${100 - c}
          V ${c}
          Z
        `,
        accent: [],
      };

    case "hex":
      return {
        path: `
          M 14 2
          H 86
          L 98 20
          V 80
          L 86 98
          H 14
          L 2 80
          V 20
          Z
        `,
        accent: [
          "M 22 2 H 40",
          "M 60 98 H 78",
        ],
      };

    case "angular":
      return {
        path: `
          M 2 20
          L 20 2
          H 82
          L 98 18
          V 82
          L 82 98
          H 18
          L 2 82
          Z
        `,
        accent: [
          "M 32 2 H 50",
          "M 50 98 H 68",
        ],
      };

    case "double":
      return {
        path: `
          M 2 14
          L 14 2
          H 86
          L 98 14
          V 86
          L 86 98
          H 14
          L 2 86
          Z
        `,
        inner: `
          M 6 17
          L 17 6
          H 83
          L 94 17
          V 83
          L 83 94
          H 17
          L 6 83
          Z
        `,
        accent: [],
      };

    case "corner":
      return {
        path: `
          M 30 2 H 2 V 30
          M 70 2 H 98 V 30
          M 2 70 V 98 H 30
          M 98 70 V 98 H 70
        `,
        accent: [],
      };

    case "title":
      return {
        path: `
          M 2 20 V 4 H 98 V 96 H 2 V 80
        `,
        accent: [
          "M 12 20 H 42",
          "M 58 20 H 88",
          "M 12 96 H 32",
          "M 68 96 H 88",
        ],
        titleBar: true,
      };

    case "capsule":
      return {
        capsule: true,
        path: "",
        accent: [],
      };

    case "terminal":
      return {
        path: `
          M 12 2 H 88
          M 2 12 V 88
          M 12 98 H 88
          M 98 12 V 88
        `,
        accent: [
          "M 2 24 V 12 H 14",
          "M 86 2 H 98 V 14",
          "M 2 86 V 98 H 14",
          "M 86 98 H 98 V 86",
        ],
      };

    case "scan":
      return {
        path: `
          M 18 2 H 82
          M 98 18 V 82
          M 82 98 H 18
          M 2 82 V 18
        `,
        accent: [
          "M 4 8 H 32",
          "M 68 92 H 96",
        ],
      };

    default:
      return null;
  }
};

// ────────────────────────────────────────────────────────────────
// PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

export const textboxDef = {
  type: "textbox",
  label: "Text Box",
  icon: "T",
  desc: "Universal futuristic HMI text display",

  defaultProps: {
    text: "TEXT",
    defaultText: "TEXT",
    variable: "",

    // TEXT MODE
    // static = fixed text, read = display from the selected source,
    // write = user input written to the selected source (Internal Variable or TCP/IP).
    textMode: "read",
    writeTrigger: "enter",
    dataType: "number",

    // HMI input method for Write mode.
    // popup = touch-friendly HMI keypad/keyboard, native = browser input.
    inputMethod: "popup",

    // Fixed numeric display precision.
    decimalPlaces: 3,

    // CALCULATION
    // Each item can come from an Internal Variable or TCP/IP address.
    calculationFormula: "",
    calculationResultVariable: "",
    calculationInputs: [],

    // DATA SOURCE
    // Internal Variable, TCP/IP, or COM/RS232.
    inputSource: "tcp",
    device: "",
    addressType: "holding_register",
    address: "",
    sourceDevice: "",

    // READ TRIGGER
    readTriggerSource: "realtime",
    readTriggerVariable: "",
    readTriggerDevice: "",
    readTriggerAddressType: "coil",
    readTriggerAddress: "",
    readTriggerValue: 1,

    // Icon
    icon: "",
    iconPosition: "left",
    iconVerticalAlign: "center",
    iconSize: 20,
    iconGap: 8,
    iconOffsetX: 0,
    iconOffsetY: 0,

    // Text
    fontSize: 18,
    fontWeight: "600",
    textColor: "#FFFFFF",
    iconColor: "#FFFFFF",
    textAlign: "center",
    verticalAlign: "center",
    textOffsetX: 0,
    textOffsetY: 0,

    // Existing/basic appearance
    backgroundColor: "transparent",
    borderColor: "transparent",
    borderWidth: 0,
    radius: 6,
    padding: 8,
    width: 220,
    height: 60,
    rotation: 0,

    // Futuristic frame
    frameStyle: "standard",
    framePreset: "cyan",
    frameColor: "#00E5FF",
    frameWidth: 1.5,
    frameOpacity: 1,
    cornerSize: 10,
    frameBackground: "rgba(3, 18, 30, 0.88)",
    frameBackgroundOpacity: 0.88,

    // Effects
    frameGlow: false,
    glowIntensity: 18,
    innerGlow: false,
    scanEffect: false,
    scanSpeed: 2,

    // Decorative controls
    showFrameAccent: true,
    showFrameDots: false,

    visual: { ...DEFAULT_VISUAL },
  },
};

// ────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────

const getHorizontalPosition = (position) => {
  if (position === "left") return "left";
  if (position === "right") return "right";
  return "center";
};

const getVerticalPosition = (position) => {
  if (position === "top") return "top";
  if (position === "bottom") return "bottom";
  return "center";
};

const getTranslateForPosition = (horizontal, vertical) => {
  const x =
    horizontal === "left" ? "0%" :
    horizontal === "right" ? "0%" :
    "-50%";

  const y =
    vertical === "top" ? "0%" :
    vertical === "bottom" ? "0%" :
    "-50%";

  return `translate(${x}, ${y})`;
};

// ────────────────────────────────────────────────────────────────
// SHARED SURFACE
// Preview and Runtime intentionally use the exact same renderer.
// ────────────────────────────────────────────────────────────────

function TextBoxSurface({ p, textValue, preview = false }) {
  const visual = getVisual(p);

  const frameStyle = p.frameStyle || "standard";
  const frameColor = resolveFrameColor(p);
  const frameWidth = Math.max(0.5, Number(p.frameWidth ?? 1.5));
  const frameOpacity = clamp(p.frameOpacity ?? 1, 0, 1);
  const cornerSize = clamp(p.cornerSize ?? 10, 4, 24);

  // Futuristic frames must NOT paint a rectangular background outside
  // their actual frame geometry. Background is rendered/clipped separately
  // inside the frame shape below.
  const background =
    frameStyle === "standard"
      ? (p.backgroundColor ?? "transparent")
      : "transparent";

  const borderColor =
    frameStyle === "standard"
      ? (p.borderColor || "transparent")
      : "transparent";

  const borderWidth =
    frameStyle === "standard"
      ? Math.max(0, Number(p.borderWidth ?? 0))
      : 0;

  const radius = Math.max(0, Number(p.radius ?? 6));
  const padding = Math.max(0, Number(p.padding ?? 8));
  const rotation = Number(p.rotation ?? 0);

  const textColor = p.textColor || visual.textColor || "#FFFFFF";
  const iconColor = p.iconColor || textColor;

  const fontSize = Number(p.fontSize ?? 18);
  const fontWeight = p.fontWeight || "600";
  const textAlign = p.textAlign || "center";
  const verticalAlign = p.verticalAlign || "center";

  const icon = p.icon || "";
  const iconPosition = p.iconPosition || "left";
  const iconVerticalAlign = p.iconVerticalAlign || "center";
  const iconSize = Number(p.iconSize ?? 20);

  // IMPORTANT:
  // Text and icon are now completely independent.
  // Example:
  //   textAlign = center
  //   iconPosition = right
  // -> text remains exactly centered while icon stays at the right.
  const textOffsetX = Number(p.textOffsetX ?? 0);
  const textOffsetY = Number(p.textOffsetY ?? 0);
  const iconOffsetX = Number(p.iconOffsetX ?? 0);
  const iconOffsetY = Number(p.iconOffsetY ?? 0);

  const glowEnabled = p.frameGlow === true;
  const glowIntensity = clamp(p.glowIntensity ?? 18, 0, 60);

  const frame = getFrameGeometry(frameStyle, cornerSize);

  const shadow =
    glowEnabled
      ? `0 0 ${glowIntensity}px ${frameColor}55, inset 0 0 ${
          Math.max(4, glowIntensity * 0.45)
        }px ${frameColor}16`
      : p.innerGlow
        ? `inset 0 0 ${Math.max(4, glowIntensity * 0.45)}px ${frameColor}18`
        : "none";

  const outerStyle = {
    position: "relative",
    width: "100%",
    height: "100%",
    background,
    border: `${borderWidth}px solid ${borderColor}`,
    borderRadius:
      frameStyle === "capsule" ? "999px" : `${radius}px`,
    transform: `rotate(${rotation}deg)`,
    boxSizing: "border-box",
    overflow: "hidden",
    boxShadow: shadow,
  };

  const horizontalText =
    textAlign === "left"
      ? "left"
      : textAlign === "right"
        ? "right"
        : "center";

  const verticalText =
    verticalAlign === "top"
      ? "top"
      : verticalAlign === "bottom"
        ? "bottom"
        : "center";

  const textPositionStyle = {
    position: "absolute",
    left: 0,
    right: 0,
    top:
      verticalText === "top"
        ? padding
        : verticalText === "bottom"
          ? "auto"
          : "50%",
    bottom:
      verticalText === "bottom"
        ? padding
        : verticalText === "top"
          ? "auto"
          : "auto",
    transform:
      verticalText === "center"
        ? `translateY(-50%) translateX(${textOffsetX}px)`
        : `translateX(${textOffsetX}px)`,
    marginTop: verticalText === "top" ? textOffsetY : 0,
    marginBottom: verticalText === "bottom" ? -textOffsetY : 0,
    padding: `0 ${padding}px`,
    boxSizing: "border-box",
    textAlign: horizontalText,
    pointerEvents: "none",
    zIndex: 4,
  };

  const textStyle = {
    display: "block",
    width: "100%",
    color: textColor,
    fontSize: `${fontSize}px`,
    fontWeight,
    lineHeight: 1.2,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    textShadow: glowEnabled
      ? `0 0 ${Math.max(3, glowIntensity * 0.45)}px ${textColor}55`
      : "none",
  };

  const iconHorizontal = getHorizontalPosition(iconPosition);
  const iconVertical = getVerticalPosition(iconVerticalAlign);

  const iconPositionStyle = {
    position: "absolute",
    zIndex: 4,
    pointerEvents: "none",
    ...(iconHorizontal === "left"
      ? { left: padding }
      : iconHorizontal === "right"
        ? { right: padding }
        : { left: "50%" }),
    ...(iconVertical === "top"
      ? { top: padding }
      : iconVertical === "bottom"
        ? { bottom: padding }
        : { top: "50%" }),
    transform:
      getTranslateForPosition(iconHorizontal, iconVertical) +
      ` translate(${iconOffsetX}px, ${iconOffsetY}px)`,
  };

  const iconStyle = {
    color: iconColor,
    fontSize: `${iconSize}px`,
    lineHeight: 1,
    display: "block",
    textShadow: glowEnabled
      ? `0 0 ${Math.max(3, glowIntensity * 0.5)}px ${iconColor}66`
      : "none",
  };

  const filterId =
    `textbox-glow-${p.__runtimeId || p.id || "preview"}`.replace(
      /[^a-zA-Z0-9_-]/g,
      ""
    );

  return (
    <div style={outerStyle}>
      {/* subtle futuristic background */}
      {frameStyle !== "standard" && (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.035), transparent 28%, transparent 72%, rgba(0,0,0,0.22))",
            }}
          />

          <div
            style={{
              position: "absolute",
              left: "10%",
              right: "10%",
              top: 0,
              height: 1,
              background: `linear-gradient(90deg, transparent, ${frameColor}66, transparent)`,
              pointerEvents: "none",
            }}
          />
        </>
      )}

      {/* Futuristic frame background
          IMPORTANT: the background is clipped to the actual frame shape.
          Nothing is painted outside the visible frame line. */}
      {frameStyle !== "standard" && frame && !frame.capsule && frame.path && (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            overflow: "visible",
            zIndex: 0,
          }}
        >
          <path
            d={frame.path}
            fill={p.frameBackground || "rgba(3, 18, 30, 0.88)"}
            fillOpacity={clamp(p.frameBackgroundOpacity ?? 0.88, 0, 1)}
          />
        </svg>
      )}

      {/* Futuristic frame */}
      {frameStyle !== "standard" && frame && (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            overflow: "visible",
            zIndex: 2,
          }}
        >
          <defs>
            <filter
              id={filterId}
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
            >
              <feGaussianBlur stdDeviation="1.6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {glowEnabled && (
            <path
              d={frame.path}
              fill="none"
              stroke={frameColor}
              strokeWidth={frameWidth * 3}
              strokeOpacity="0.20"
              strokeLinejoin="round"
              strokeLinecap="round"
              filter={`url(#${filterId})`}
              vectorEffect="non-scaling-stroke"
            />
          )}

          <path
            d={frame.path}
            fill="none"
            stroke={frameColor}
            strokeWidth={frameWidth}
            strokeOpacity={frameOpacity}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {frame.inner && (
            <path
              d={frame.inner}
              fill="none"
              stroke={frameColor}
              strokeWidth={Math.max(0.5, frameWidth * 0.45)}
              strokeOpacity={frameOpacity * 0.38}
              vectorEffect="non-scaling-stroke"
            />
          )}

          {p.showFrameAccent !== false &&
            frame.accent?.map((d, i) => (
              <path
                key={`accent-${i}`}
                d={d}
                fill="none"
                stroke={frameColor}
                strokeWidth={Math.max(1, frameWidth * 1.15)}
                strokeOpacity={frameOpacity}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
        </svg>
      )}

      {/* Capsule frame
          The dark/background fill is clipped to the capsule itself.
          The rectangular area outside the capsule stays fully transparent. */}
      {frameStyle === "capsule" && (
        <>
          {/* Background opacity affects ONLY the capsule background. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "999px",
              background:
                p.frameBackground || "rgba(3, 18, 30, 0.88)",
              opacity: clamp(p.frameBackgroundOpacity ?? 0.88, 0, 1),
              boxSizing: "border-box",
              zIndex: 0,
              pointerEvents: "none",
            }}
          />

          {/* Frame opacity affects ONLY the capsule frame. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              border: `${frameWidth}px solid ${frameColor}`,
              borderRadius: "999px",
              boxSizing: "border-box",
              opacity: frameOpacity,
              boxShadow: glowEnabled
                ? `0 0 ${glowIntensity}px ${frameColor}55, inset 0 0 ${
                    Math.max(4, glowIntensity * 0.4)
                  }px ${frameColor}18`
                : "none",
              zIndex: 2,
              pointerEvents: "none",
            }}
          />
        </>
      )}

      {/* Title-frame micro bar */}
      {frameStyle === "title" && (
        <div
          style={{
            position: "absolute",
            top: 5,
            left: "50%",
            transform: "translateX(-50%)",
            width: "28%",
            minWidth: 45,
            height: 3,
            background: frameColor,
            opacity: frameOpacity,
            boxShadow: glowEnabled ? `0 0 8px ${frameColor}` : "none",
            zIndex: 3,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Decorative dots */}
      {p.showFrameDots === true && frameStyle !== "standard" && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 12,
            display: "flex",
            gap: 4,
            zIndex: 5,
            pointerEvents: "none",
          }}
        >
          {[0, 1, 2].map((n) => (
            <span
              key={n}
              style={{
                width: 3,
                height: 3,
                borderRadius: "50%",
                background: frameColor,
                opacity: frameOpacity * (1 - n * 0.2),
                boxShadow: glowEnabled
                  ? `0 0 5px ${frameColor}`
                  : "none",
              }}
            />
          ))}
        </div>
      )}

      {/* Scan effect */}
      {p.scanEffect === true && frameStyle !== "standard" && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: 1,
            zIndex: 6,
            pointerEvents: "none",
            background: `linear-gradient(90deg, transparent, ${frameColor}, transparent)`,
            boxShadow: `0 0 8px ${frameColor}`,
            animation: `textboxScan ${
              Math.max(0.5, Number(p.scanSpeed ?? 2))
            }s linear infinite`,
          }}
        />
      )}

      {/* TEXT: independent position */}
      <div style={textPositionStyle}>
        <span style={textStyle}>{textValue}</span>
      </div>

      {/* ICON: independent position */}
      {icon && (
        <div style={iconPositionStyle}>
          <span style={iconStyle}>{icon}</span>
        </div>
      )}

      {p.scanEffect === true && (
        <style>
          {`
            @keyframes textboxScan {
              0% { transform: translateY(0); opacity: 0; }
              8% { opacity: 0.7; }
              92% { opacity: 0.7; }
              100% { transform: translateY(100%); opacity: 0; }
            }
          `}
        </style>
      )}

      {preview && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            borderRadius:
              frameStyle === "capsule" ? "999px" : `${radius}px`,
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

export function TextBoxPreview({ widget }) {
  const p = widget.props || {};

  return (
    <div className="relative w-full h-full overflow-visible">
      <TextBoxSurface
        p={p}
        textValue={p.defaultText ?? p.text ?? "TEXT"}
        preview
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function TextBoxPropertyPanel({ p, set, availableDevices = [] }) {
  const {
    variables: internalVariables,
    loading: internalVariablesLoading,
  } = useInternalVariables();

  const internalVariableOptions = internalVariables.map((item) => ({
    value: item.name,
    label: `${item.name} (${item.data_type || "string"})`,
  }));

  return (
    <>
      <PropSection title="Text Mode">
        <PropInput
          label="Mode"
          options={[
            { value: "static", label: "Static Text" },
            { value: "read", label: "Read / Display" },
            { value: "write", label: "Input + Write" },
            { value: "calculation", label: "Calculation" },
          ]}
          value={p.textMode || "read"}
          onChange={(v) => set("textMode", v)}
        />

        <PropInput
          label="Default Text"
          value={p.defaultText ?? ""}
          onChange={(v) => set("defaultText", v)}
          placeholder="Shown when no runtime value is available"
        />

        {p.textMode === "write" && (
          <PropInput
            label="Write Data Type"
            options={[
              { value: "number", label: "Number" },
              { value: "integer", label: "Integer" },
              { value: "boolean", label: "Boolean / 0-1" },
              { value: "text", label: "Text / String" },
            ]}
            value={p.dataType || "number"}
            onChange={(v) => set("dataType", v)}
          />
        )}

        {p.textMode === "write" && (
          <>
            <PropInput
              label="Write Trigger"
              options={[
                { value: "enter", label: "Enter Key" },
                { value: "blur", label: "When Focus Leaves" },
              ]}
              value={p.writeTrigger || "enter"}
              onChange={(v) => set("writeTrigger", v)}
            />

            <div className="text-[8px] text-[var(--text-dim)] mt-1">
              Write mode writes to the selected source. TCP/IP writes to Coil/Holding Register; Internal Variable writes by variable name.
            </div>

            <PropInput
              label="Input Method"
              options={[
                { value: "popup", label: "HMI Popup Keypad" },
                { value: "native", label: "Native Keyboard" },
              ]}
              value={p.inputMethod || "popup"}
              onChange={(v) => set("inputMethod", v)}
            />

            <div className="text-[8px] text-[var(--text-dim)] mt-1">
              Popup mode opens a touch-friendly numeric keypad or character keyboard when the Text Box is tapped.
            </div>
          </>
        )}
      </PropSection>

      {(p.textMode === "read" || p.textMode === "write") && (
        <PropSection title="Data Source">
          <PropInput
            label="Source"
            options={[
              { value: "internal", label: "Internal Variable" },
              { value: "tcp", label: "TCP / IP" },
              { value: "com", label: "COM / RS232" },
            ]}
            value={p.inputSource || "tcp"}
            onChange={(v) => set("inputSource", v)}
          />

          <div className="text-[8px] text-[var(--text-dim)] mt-1">
            {String(p.inputSource || "tcp").toLowerCase() === "internal"
              ? "Internal variable: read/write by variable name inside the HMI runtime."
              : String(p.inputSource || "tcp").toLowerCase() === "tcp"
                ? "TCP/IP: read from PLC and, in Write mode, write to Coil or Holding Register."
                : "COM/RS232: read/display source."}
          </div>

          {String(p.inputSource || "tcp").toLowerCase() === "internal" && (
            <>
              <PropInput
                label="Variable Name"
                options={[
                  {
                    value: "",
                    label: internalVariablesLoading
                      ? "Loading internal variables..."
                      : "Select variable...",
                  },
                  ...internalVariableOptions,
                ]}
                value={p.variable || ""}
                onChange={(v) => set("variable", v)}
              />

              <div className="text-[8px] text-[var(--text-dim)] mt-1">
                Read and Write use a variable stored in internalvariable.db.
              </div>
            </>
          )}

          {p.textMode === "read" && (
            <div className="mt-2 p-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)]">
              <div className="text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-2">
                Read Trigger
              </div>
              <PropInput
                label="Trigger Source"
                options={[
                  { value: "plc", label: "PLC / TCP" },
                  { value: "internal", label: "Internal Variable" },
                  { value: "realtime", label: "Realtime Event" },
                ]}
                value={p.readTriggerSource ?? "realtime"}
                onChange={(v) => set("readTriggerSource", v)}
              />
              {p.readTriggerSource === "internal" && (
                <PropInput
                  label="Trigger Variable"
                  options={[
                    {
                      value: "",
                      label: internalVariablesLoading
                        ? "Loading internal variables..."
                        : "Select trigger variable...",
                    },
                    ...internalVariableOptions,
                  ]}
                  value={p.readTriggerVariable ?? ""}
                  onChange={(v) => set("readTriggerVariable", v)}
                />
              )}
              {p.readTriggerSource === "plc" && (
                <>
                  <div>
                    <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
                      Trigger Device
                    </label>
                    <select
                      value={p.readTriggerDevice ?? ""}
                      onChange={(e) => set("readTriggerDevice", e.target.value)}
                      className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none focus:border-[var(--accent-green)]"
                    >
                      <option value="">Select TCP device...</option>
                      {availableDevices
                        .filter((dev) => {
                          const type = String(
                            dev?.type ??
                            dev?.Type ??
                            ""
                          ).trim().toUpperCase();

                          return type === "TCP";
                        })
                        .map((dev) => {
                          const deviceName =
                            dev?.name ??
                            dev?.["Device Name"] ??
                            dev?.device_name ??
                            "";

                          if (!deviceName) return null;

                          return (
                            <option
                              key={`read-trigger-tcp-${deviceName}`}
                              value={deviceName}
                            >
                              {deviceName}
                              {dev?.connection
                                ? ` — ${dev.connection}`
                                : ""}
                              {dev?.connected === false
                                ? " — Disconnected"
                                : ""}
                            </option>
                          );
                        })}
                    </select>

                    {availableDevices.filter((dev) => {
                      const type = String(
                        dev?.type ??
                        dev?.Type ??
                        ""
                      ).trim().toUpperCase();

                      return type === "TCP";
                    }).length === 0 && (
                      <div className="text-[8px] text-[var(--accent-amber)] mt-1">
                        No TCP device configured.
                      </div>
                    )}

                    <div className="text-[8px] text-[var(--text-dim)] mt-1">
                      Trigger Device uses the same connected TCP device list as
                      the main TCP/IP Data Source.
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <PropInput
                      label="Trigger Address"
                      value={p.readTriggerAddress ?? ""}
                      onChange={(v) => set("readTriggerAddress", v)}
                      placeholder="M100 / Coil 100"
                    />
                    <PropInput
                      label="Address Type"
                      options={[
                        { value: "coil", label: "Coil" },
                        { value: "discrete_input", label: "Discrete Input" },
                        { value: "holding_register", label: "Holding Register" },
                        { value: "input_register", label: "Input Register" },
                      ]}
                      value={p.readTriggerAddressType ?? "coil"}
                      onChange={(v) => set("readTriggerAddressType", v)}
                    />
                  </div>
                  <PropInput
                    label="Trigger Value"
                    type="number"
                    value={p.readTriggerValue ?? 1}
                    onChange={(v) =>
                      set("readTriggerValue", v === "" ? "" : Number(v))
                    }
                  />
                </>
              )}
              <div className="text-[8px] text-[var(--text-dim)] mt-1">
                Read trigger berasal dari PLC, Internal Variable, atau Realtime Event.
              </div>
            </div>
          )}

          {(String(p.inputSource || "tcp").toLowerCase() === "tcp" ||
            String(p.inputSource || "").toLowerCase() === "tcpip" ||
            String(p.inputSource || "").toLowerCase() === "tcp/ip") && (
            <>
              <div>
                <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
                  TCP / IP Device
                </label>
                <select
                  value={p.device || ""}
                  onChange={(e) => set("device", e.target.value)}
                  className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none focus:border-[var(--accent-green)]"
                >
                  <option value="">Select device...</option>
                  {availableDevices
                    .filter((dev) => String(dev?.type || "").toUpperCase() === "TCP")
                    .map((dev) => (
                      <option key={`${dev.type || "TCP"}-${dev.name}`} value={dev.name}>
                        {dev.name}{dev.connection ? ` — ${dev.connection}` : ""}
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <PropInput
                  label="Address"
                  value={p.address || ""}
                  onChange={(v) => set("address", v)}
                  placeholder="HR9 / Coil 9"
                />
                <PropInput
                  label="Address Type"
                  options={[
                    { value: "coil", label: "Coil" },
                    { value: "holding_register", label: "Holding Register" },
                    { value: "discrete_input", label: "Discrete Input" },
                    { value: "input_register", label: "Input Register" },
                  ]}
                  value={p.addressType || "holding_register"}
                  onChange={(v) => set("addressType", v)}
                />
              </div>
            </>
          )}

          {String(p.inputSource || "").toLowerCase() === "com" && (
            <div>
              <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
                COM / RS232 Device
              </label>
              <select
                value={p.sourceDevice || ""}
                onChange={(e) => set("sourceDevice", e.target.value)}
                className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none focus:border-[var(--accent-green)]"
              >
                <option value="">Select COM / RS232 device...</option>
                {availableDevices
                  .filter((dev) => {
                    const type = String(
                      dev?.type ??
                      dev?.Type ??
                      ""
                    ).trim().toUpperCase();

                    return (
                      type === "COM" ||
                      type === "RS232" ||
                      type === "SERIAL" ||
                      type === "MODBUS_RTU"
                    );
                  })
                  .map((dev) => (
                    <option
                      key={`${dev.type || dev.Type || "RS232"}-${dev.name || dev["Device Name"] || dev.port || dev["COM Port"]}`}
                      value={dev.name || dev["Device Name"] || dev.device_name || dev.port || dev["COM Port"] || ""}
                    >
                      {(dev.name ||
                        dev["Device Name"] ||
                        dev.device_name ||
                        dev.port ||
                        dev["COM Port"] ||
                        "RS232")}
                      {dev.connection ? ` — ${dev.connection}` : ""}
                      {dev.connected === false ? " — Disconnected" : ""}
                    </option>
                  ))}
              </select>

              {availableDevices.filter((dev) => {
                const type = String(
                  dev?.type ??
                  dev?.Type ??
                  ""
                ).trim().toUpperCase();

                return (
                  type === "COM" ||
                  type === "RS232" ||
                  type === "SERIAL" ||
                  type === "MODBUS_RTU"
                );
              }).length === 0 && (
                <div className="text-[8px] text-[var(--accent-amber)] mt-1">
                  No COM / RS232 device configured.
                </div>
              )}
            </div>
          )}

          {p.textMode === "write" && String(p.inputSource || "tcp").toLowerCase() === "com" && (
            <div className="text-[8px] text-[var(--accent-amber)] mt-1">
              COM / RS232 write is not supported by Text Box. Use Internal Variable or TCP / IP.
            </div>
          )}
        </PropSection>
      )}

      {p.textMode === "calculation" && (
        <PropSection title="Calculation">
          <PropInput
            label="Formula"
            value={p.calculationFormula || ""}
            onChange={(v) => set("calculationFormula", v)}
            placeholder="Example: (Temperature + Offset) / Pressure"
          />

          <PropInput
            label="Result Variable"
            options={[
              {
                value: "",
                label: internalVariablesLoading
                  ? "Loading internal variables..."
                  : "Select result variable...",
              },
              ...internalVariableOptions,
            ]}
            value={p.calculationResultVariable || ""}
            onChange={(v) => set("calculationResultVariable", v)}
          />

          <div className="text-[8px] text-[var(--text-dim)] mt-1 mb-2">
            Use the Alias names below in the formula. Internal Variable sources and the Result Variable are selected from internalvariable.db. Supported operators:
            +, -, *, /, %, and parentheses.
          </div>

          {(Array.isArray(p.calculationInputs) ? p.calculationInputs : []).map((item, index) => {
            const itemValue = item || {};
            const updateItem = (patch) => {
              const next = Array.isArray(p.calculationInputs)
                ? [...p.calculationInputs]
                : [];
              next[index] = { ...itemValue, ...patch };
              set("calculationInputs", next);
            };

            const removeItem = () => {
              const next = Array.isArray(p.calculationInputs)
                ? p.calculationInputs.filter((_, i) => i !== index)
                : [];
              set("calculationInputs", next);
            };

            return (
              <div
                key={itemValue.id || `calc-input-${index}`}
                className="mb-2 p-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)]"
              >
                <div className="grid grid-cols-2 gap-2">
                  <PropInput
                    label="Alias"
                    value={itemValue.alias || ""}
                    onChange={(v) => updateItem({ alias: v })}
                    placeholder="Temperature"
                  />

                  <PropInput
                    label="Source"
                    options={[
                      { value: "internal", label: "Internal Variable" },
                      { value: "tcp", label: "TCP / IP" },
                    ]}
                    value={itemValue.sourceType || "internal"}
                    onChange={(v) => updateItem({ sourceType: v })}
                  />
                </div>

                {(itemValue.sourceType || "internal") === "internal" ? (
                  <PropInput
                    label="Variable Name"
                    options={[
                      {
                        value: "",
                        label: internalVariablesLoading
                          ? "Loading internal variables..."
                          : "Select variable...",
                      },
                      ...internalVariableOptions,
                    ]}
                    value={itemValue.variable || ""}
                    onChange={(v) => updateItem({ variable: v })}
                  />
                ) : (
                  <>
                    <div>
                      <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
                        TCP / IP Device
                      </label>
                      <select
                        value={itemValue.device || ""}
                        onChange={(e) => updateItem({ device: e.target.value })}
                        className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none focus:border-[var(--accent-green)]"
                      >
                        <option value="">Select device...</option>
                        {availableDevices
                          .filter((dev) => String(dev?.type || "").toUpperCase() === "TCP")
                          .map((dev) => (
                            <option key={`${dev.type || "TCP"}-${dev.name}`} value={dev.name}>
                              {dev.name}{dev.connection ? ` — ${dev.connection}` : ""}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <PropInput
                        label="Address"
                        value={itemValue.address ?? ""}
                        onChange={(v) => updateItem({ address: v })}
                        placeholder="9"
                      />
                      <PropInput
                        label="Address Type"
                        options={[
                          { value: "coil", label: "Coil" },
                          { value: "discrete_input", label: "Discrete Input" },
                          { value: "holding_register", label: "Holding Register" },
                          { value: "input_register", label: "Input Register" },
                        ]}
                        value={itemValue.addressType || "holding_register"}
                        onChange={(v) => updateItem({ addressType: v })}
                      />
                    </div>
                  </>
                )}

                <button
                  type="button"
                  onClick={removeItem}
                  className="mt-2 px-2 py-1 text-[9px] rounded border border-[var(--accent-red)] text-[var(--accent-red)]"
                >
                  Remove Source
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => {
              const next = Array.isArray(p.calculationInputs)
                ? [...p.calculationInputs]
                : [];
              next.push({
                id: `calc_${Date.now()}_${next.length}`,
                alias: `Source${next.length + 1}`,
                sourceType: "internal",
                variable: "",
                device: "",
                addressType: "holding_register",
                address: "",
              });
              set("calculationInputs", next);
            }}
            className="w-full h-8 rounded border border-[var(--accent-green)] text-[var(--accent-green)] text-[9px] font-semibold"
          >
            + Add Calculation Source
          </button>

          <div className="mt-2 text-[8px] text-[var(--text-dim)]">
            Example: Temperature + Offset, (Speed * Ratio) / 60
          </div>
        </PropSection>
      )}

      <PropSection title="Icon">
        <PropInput
          label="Icon"
          options={TEXTBOX_ICONS.map((item) => ({
            value: item.value,
            label: item.icon ? `${item.icon}  ${item.label}` : item.label,
          }))}
          value={p.icon || ""}
          onChange={(v) => set("icon", v)}
        />

        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Horizontal"
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Center" },
              { value: "right", label: "Right" },
            ]}
            value={p.iconPosition || "left"}
            onChange={(v) => set("iconPosition", v)}
          />

          <PropInput
            label="Vertical"
            options={[
              { value: "top", label: "Top" },
              { value: "center", label: "Center" },
              { value: "bottom", label: "Bottom" },
            ]}
            value={p.iconVerticalAlign || "center"}
            onChange={(v) => set("iconVerticalAlign", v)}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Icon Size"
            type="number"
            min={8}
            max={80}
            value={p.iconSize ?? 20}
            onChange={(v) => set("iconSize", (v === "" ? "" : Number(v)))}
          />

          <PropInput
            label="Icon Gap"
            type="number"
            min={0}
            max={40}
            value={p.iconGap ?? 8}
            onChange={(v) => set("iconGap", (v === "" ? "" : Number(v)))}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Offset X"
            type="number"
            min={-500}
            max={500}
            value={p.iconOffsetX ?? 0}
            onChange={(v) => set("iconOffsetX", (v === "" ? "" : Number(v)))}
          />

          <PropInput
            label="Offset Y"
            type="number"
            min={-500}
            max={500}
            value={p.iconOffsetY ?? 0}
            onChange={(v) => set("iconOffsetY", (v === "" ? "" : Number(v)))}
          />
        </div>
      </PropSection>

      <PropSection title="Text Appearance">
        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Font Size"
            type="number"
            min={8}
            max={100}
            value={p.fontSize ?? 18}
            onChange={(v) => set("fontSize", (v === "" ? "" : Number(v)))}
          />

          <PropInput
            label="Weight"
            options={[
              { value: "400", label: "Normal" },
              { value: "500", label: "Medium" },
              { value: "600", label: "Semi Bold" },
              { value: "700", label: "Bold" },
            ]}
            value={p.fontWeight || "600"}
            onChange={(v) => set("fontWeight", v)}
          />
        </div>

        <PropInput
          label="Text Color"
          type="color"
          value={p.textColor || "#FFFFFF"}
          onChange={(v) => set("textColor", v)}
        />

        <PropInput
          label="Icon Color"
          type="color"
          value={p.iconColor || "#FFFFFF"}
          onChange={(v) => set("iconColor", v)}
        />
      </PropSection>

      <PropSection title="Frame Style">
        <PropInput
          label="Style"
          options={TEXTBOX_FRAME_STYLES}
          value={p.frameStyle || "standard"}
          onChange={(v) => set("frameStyle", v)}
        />

        {p.frameStyle && p.frameStyle !== "standard" && (
          <>
            <PropInput
              label="Color Preset"
              options={TEXTBOX_FRAME_PRESETS.map((item) => ({
                value: item.value,
                label: item.label,
              }))}
              value={p.framePreset || "cyan"}
              onChange={(v) => {
                set("framePreset", v);
                if (v !== "custom" && FRAME_PRESET_COLORS[v]) {
                  set("frameColor", FRAME_PRESET_COLORS[v]);
                }
              }}
            />

            <PropInput
              label="Frame Color"
              type="color"
              value={resolveFrameColor(p)}
              onChange={(v) => {
                set("framePreset", "custom");
                set("frameColor", v);
              }}
            />

            <div className="grid grid-cols-2 gap-2">
              <PropInput
                label="Frame Width"
                type="number"
                min={0.5}
                max={8}
                step={0.5}
                value={p.frameWidth ?? 1.5}
                onChange={(v) => set("frameWidth", (v === "" ? "" : Number(v)))}
              />

              <PropInput
                label="Corner Size"
                type="number"
                min={4}
                max={24}
                value={p.cornerSize ?? 10}
                onChange={(v) => set("cornerSize", (v === "" ? "" : Number(v)))}
              />
            </div>

            <PropInput
              label="Background"
              type="color"
              value={(() => {
                const value = p.frameBackground;
                if (typeof value !== "string" || !value.trim()) return "#03121E";
                const match = value.trim().match(/^#([0-9a-fA-F]{6})$/);
                return match ? `#${match[1]}` : "#03121E";
              })()}
              onChange={(v) => set("frameBackground", v)}
            />

            <PropInput
              label="Background Opacity"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={p.frameBackgroundOpacity ?? 0.88}
              onChange={(v) => set("frameBackgroundOpacity", (v === "" ? "" : Number(v)))}
            />

            <PropInput
              label="Frame Opacity"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={p.frameOpacity ?? 1}
              onChange={(v) => set("frameOpacity", (v === "" ? "" : Number(v)))}
            />
          </>
        )}
      </PropSection>

      <PropSection title="Effects">
        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Glow"
            options={[
              { value: false, label: "Off" },
              { value: true, label: "On" },
            ]}
            value={p.frameGlow === true}
            onChange={(v) => set("frameGlow", v === true || v === "true")}
          />

          <PropInput
            label="Inner Glow"
            options={[
              { value: false, label: "Off" },
              { value: true, label: "On" },
            ]}
            value={p.innerGlow === true}
            onChange={(v) => set("innerGlow", v === true || v === "true")}
          />
        </div>

        <PropInput
          label="Glow Intensity"
          type="number"
          min={0}
          max={60}
          value={p.glowIntensity ?? 18}
          onChange={(v) => set("glowIntensity", (v === "" ? "" : Number(v)))}
        />

        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Frame Accent"
            options={[
              { value: true, label: "Show" },
              { value: false, label: "Hide" },
            ]}
            value={p.showFrameAccent !== false}
            onChange={(v) => set("showFrameAccent", v !== false && v !== "false")}
          />

          <PropInput
            label="Frame Dots"
            options={[
              { value: false, label: "Hide" },
              { value: true, label: "Show" },
            ]}
            value={p.showFrameDots === true}
            onChange={(v) => set("showFrameDots", v === true || v === "true")}
          />
        </div>

        <PropInput
          label="Scan Effect"
          options={[
            { value: false, label: "Off" },
            { value: true, label: "On" },
          ]}
          value={p.scanEffect === true}
          onChange={(v) => set("scanEffect", v === true || v === "true")}
        />

        {p.scanEffect === true && (
          <PropInput
            label="Scan Speed (s)"
            type="number"
            min={0.5}
            max={10}
            step={0.5}
            value={p.scanSpeed ?? 2}
            onChange={(v) => set("scanSpeed", (v === "" ? "" : Number(v)))}
          />
        )}
      </PropSection>

      <PropSection title="Basic Layout">
        <PropInput
          label="Padding"
          type="number"
          min={0}
          max={60}
          value={p.padding ?? 8}
          onChange={(v) => set("padding", (v === "" ? "" : Number(v)))}
        />

        {(!p.frameStyle || p.frameStyle === "standard") && (
          <>
            <PropInput
              label="Background"
              type="color"
              value={p.backgroundColor || "#000000"}
              onChange={(v) => set("backgroundColor", v)}
            />

            <PropInput
              label="Border"
              type="color"
              value={p.borderColor || "#333333"}
              onChange={(v) => set("borderColor", v)}
            />

            <div className="grid grid-cols-2 gap-2">
              <PropInput
                label="Border Width"
                type="number"
                min={0}
                max={20}
                value={p.borderWidth ?? 0}
                onChange={(v) => set("borderWidth", (v === "" ? "" : Number(v)))}
              />

              <PropInput
                label="Radius"
                type="number"
                min={0}
                max={50}
                value={p.radius ?? 6}
                onChange={(v) => set("radius", (v === "" ? "" : Number(v)))}
              />
            </div>
          </>
        )}

        <PropInput
          label="Rotation"
          type="number"
          min={-360}
          max={360}
          value={p.rotation ?? 0}
          onChange={(v) => set("rotation", (v === "" ? "" : Number(v)))}
        />
      </PropSection>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// HMI INPUT POPUP
// Touch-friendly keypad / character keyboard used by RuntimeTextBox.
// ────────────────────────────────────────────────────────────────

function HMIInputPopup({
  open,
  dataType,
  value,
  cursorPosition,
  onCursorChange,
  onChange,
  onCommit,
  onCancel,
}) {
  const [shift, setShift] = React.useState(false);

  if (!open) return null;

  const isNumber = dataType === "number";
  const isInteger = dataType === "integer";
  const isBoolean = dataType === "boolean";
  const isText = dataType === "text";

  const append = (char) => {
    const current = String(value ?? "");
    const position = Math.max(0, Math.min(
      Number(cursorPosition ?? current.length),
      current.length
    ));

    if ((isNumber || isInteger) && char === ".") {
      if (isInteger || current.includes(".")) return;
    }

    if ((isNumber || isInteger) && char === "-") {
      if (current.includes("-")) return;
      if (position !== 0) return;
    }

    // Avoid leading zero clutter for numeric values.
    if ((isNumber || isInteger) && char >= "0" && char <= "9") {
      if (position === 0 && current === "0") {
        onCursorChange(1);
        return;
      }
      if (position === 1 && current === "-0") {
        const next = `-${char}${current.slice(position)}`;
        onChange(next);
        onCursorChange(2);
        return;
      }
    }

    const next = current.slice(0, position) + char + current.slice(position);
    onChange(next);
    onCursorChange(position + char.length);
  };

  const moveLeft = () => {
    const current = String(value ?? "");
    onCursorChange(Math.max(0, Number(cursorPosition ?? current.length) - 1));
  };

  const moveRight = () => {
    const current = String(value ?? "");
    onCursorChange(Math.min(current.length, Number(cursorPosition ?? current.length) + 1));
  };

  const backspace = () => {
    const current = String(value ?? "");
    const position = Number(cursorPosition ?? current.length);
    if (position <= 0) return;

    const next = current.slice(0, position - 1) + current.slice(position);
    onChange(next);
    onCursorChange(position - 1);
  };

  const clear = () => {
    onChange("");
    onCursorChange(0);
  };

  // Place the cursor by clicking/tapping directly on the displayed text.
  // Uses a hidden measurement canvas so proportional/monospace fonts,
  // zoom and different display widths remain accurate.
  const placeCursorFromClick = (event) => {
    const element = event.currentTarget;
    const text = String(value ?? "");

    if (!text.length) {
      onCursorChange(0);
      return;
    }

    const rect = element.getBoundingClientRect();
    if (!rect.width) return;

    const x = Math.max(
      0,
      Math.min(rect.width, event.clientX - rect.left)
    );

    const computed = window.getComputedStyle(element);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) return;

    context.font = [
      computed.fontStyle,
      computed.fontVariant,
      computed.fontWeight,
      computed.fontSize,
      computed.fontFamily
    ].join(" ");

    // Text is centered in the display.
    const totalWidth = context.measureText(text).width;
    const startX = Math.max(0, (rect.width - totalWidth) / 2);
    const textX = Math.max(0, Math.min(totalWidth, x - startX));

    let bestIndex = 0;
    let bestDistance = Infinity;

    for (let i = 0; i <= text.length; i += 1) {
      const before = text.slice(0, i);
      const width = context.measureText(before).width;
      const distance = Math.abs(width - textX);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    onCursorChange(bestIndex);
  };

  const keyBase =
    "h-11 min-h-[44px] rounded border border-[rgba(0,229,255,0.28)] " +
    "bg-[rgba(7,24,38,0.96)] text-white font-mono text-base font-semibold " +
    "active:bg-[rgba(0,229,255,0.22)] active:border-[rgba(0,229,255,0.9)] " +
    "transition-colors select-none touch-manipulation";

  const arrowKey =
    "h-11 min-h-[44px] rounded border border-[rgba(0,229,255,0.55)] " +
    "bg-[rgba(0,229,255,0.16)] text-[#00E5FF] font-mono text-lg font-bold " +
    "active:bg-[rgba(0,229,255,0.30)] active:border-[#00E5FF] " +
    "transition-colors select-none touch-manipulation";

  const actionKey =
    "h-11 min-h-[44px] rounded border border-[rgba(0,229,255,0.42)] " +
    "bg-[rgba(0,229,255,0.10)] text-[#00E5FF] font-mono text-xs font-bold " +
    "active:bg-[rgba(0,229,255,0.24)] active:border-[#00E5FF] " +
    "transition-colors select-none touch-manipulation";

  const commitValue = (nextValue) => {
    onChange(nextValue);
    // Let React paint the last key before the async write begins.
    setTimeout(() => onCommit(nextValue), 0);
  };

  const renderNumberPad = () => (
    <div className="grid grid-cols-4 gap-2">
      {["7", "8", "9", "⌫",
        "4", "5", "6", "CLR",
        "1", "2", "3", ...(isInteger ? ["−"] : ["."]),
        "0", isInteger ? "−" : "00", "←", "→",
        "CANCEL", "ENTER"
      ].map((key, index) => {
        const isEnter = key === "ENTER";
        const isCancel = key === "CANCEL";
        const isClear = key === "CLR";
        const isBack = key === "⌫";
        const isMinus = key === "−";
        const isDot = key === ".";
        const isZeroZero = key === "00";

        return (
          <button
            key={`${key}-${index}`}
            type="button"
            className={
              key === "←" || key === "→"
                ? arrowKey
                : isEnter || isCancel || isClear || isBack
                  ? actionKey
                  : keyBase
            }
            onClick={() => {
              if (isEnter) return commitValue(String(value ?? ""));
              if (isCancel) return onCancel();
              if (isClear) return clear();
              if (isBack) return backspace();
              if (key === "←") return moveLeft();
              if (key === "→") return moveRight();
              if (isMinus) return append("-");
              if (isDot) return append(".");
              if (isZeroZero) return append("00");
              append(key);
            }}
          >
            {key}
          </button>
        );
      })}
    </div>
  );

  const renderBooleanPad = () => (
    <div className="grid grid-cols-2 gap-3">
      <button
        type="button"
        className={keyBase}
        onClick={() => commitValue("1")}
      >
        ON
      </button>
      <button
        type="button"
        className={keyBase}
        onClick={() => commitValue("0")}
      >
        OFF
      </button>
      <button
        type="button"
        className={actionKey}
        onClick={onCancel}
      >
        CANCEL
      </button>
    </div>
  );

  const alphaRows = [
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
    ["Z", "X", "C", "V", "B", "N", "M"],
  ];


  const renderTextPad = () => (
    <div className="space-y-2">
      {alphaRows.map((row, rowIndex) => (
        <div key={`alpha-${rowIndex}`} className="flex gap-1.5">
          {row.map((key) => {
            const displayedKey = shift ? key : key.toLowerCase();

            return (
              <button
                key={key}
                type="button"
                className={`${keyBase} flex-1 min-w-0`}
                onClick={() => {
                  // Shift/uppercase stays active until the SHIFT button
                  // is pressed again. This is intentional for HMI use:
                  // operator can type several uppercase characters in a row.
                  append(displayedKey);
                }}
              >
                {displayedKey}
              </button>
            );
          })}
        </div>
      ))}

      <div className="grid grid-cols-7 gap-2">
        <button
          type="button"
          className={shift ? arrowKey : actionKey}
          onClick={() => setShift(v => !v)}
          aria-label={shift ? "Switch to lowercase" : "Switch to uppercase"}
          title={shift ? "UPPERCASE ON - press again for lowercase" : "UPPERCASE OFF - press for uppercase"}
        >
          {shift ? "⇧ ABC" : "⇧ abc"}
        </button>

        <button type="button" className={arrowKey} onClick={moveLeft}>
          ←
        </button>

        <button type="button" className={arrowKey} onClick={moveRight}>
          →
        </button>

        <button
          type="button"
          className={actionKey}
          onClick={() => append(" ")}
        >
          SPACE
        </button>

        <button type="button" className={actionKey} onClick={backspace}>
          ⌫
        </button>

        <button type="button" className={actionKey} onClick={clear}>
          CLR
        </button>

        <button
          type="button"
          className={actionKey}
          onClick={() => commitValue(String(value ?? ""))}
        >
          ENTER
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          className={actionKey}
          onClick={() => append("0")}
        >
          0
        </button>

        <button type="button" className={actionKey} onClick={onCancel}>
          CANCEL
        </button>
      </div>
    </div>
  );

  const title = isBoolean
    ? "SELECT STATE"
    : isText
      ? "ENTER TEXT"
      : isInteger
        ? "ENTER INTEGER"
        : "ENTER VALUE";

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-3"
      style={{
        background: "rgba(0,0,0,0.68)",
        backdropFilter: "blur(3px)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-full max-w-[520px] rounded-xl border border-[rgba(0,229,255,0.58)] bg-[#06131f] p-3 sm:p-4"
        style={{
          boxShadow:
            "0 0 30px rgba(0,229,255,0.16), inset 0 0 28px rgba(0,229,255,0.035)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-[11px] font-bold tracking-[0.18em] text-[#00E5FF]">
            {title}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="w-9 h-9 rounded border border-[rgba(255,64,88,0.45)] text-[#FF4058] font-mono text-sm"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div
          className="mb-3 min-h-[54px] rounded-lg border border-[rgba(0,229,255,0.34)] bg-[#020a11] px-3 py-2 flex items-center justify-center"
          style={{
            boxShadow: "inset 0 0 18px rgba(0,229,255,0.055)",
          }}
        >
          <div
            className="w-full text-center text-2xl sm:text-3xl font-mono font-semibold text-white break-all"
            onMouseDown={placeCursorFromClick}
            onTouchStart={(event) => {
              const touch = event.touches?.[0];
              if (!touch) return;

              placeCursorFromClick({
                currentTarget: event.currentTarget,
                clientX: touch.clientX,
                clientY: touch.clientY,
              });
            }}
            style={{
              minHeight: "40px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflowWrap: "anywhere",
            }}
          >
            {(() => {
              const current = String(value ?? "");
              const position = Math.max(
                0,
                Math.min(
                  Number(cursorPosition ?? current.length),
                  current.length
                )
              );

              if (!current) {
                return (
                  <span className="inline-flex items-center text-white/30">
                    <span>INPUT</span>
                    <span
                      className="ml-1 inline-block w-[2px] h-8 bg-[#00E5FF] animate-pulse"
                      aria-hidden="true"
                    />
                  </span>
                );
              }

              const before = current.slice(0, position);
              const after = current.slice(position);

              return (
                <span
                  className="inline-flex items-center max-w-full"
                  style={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  <span>{before}</span>
                  <span
                    className="inline-block w-[2px] h-8 mx-[1px] bg-[#00E5FF] animate-pulse shrink-0"
                    style={{
                      boxShadow: "0 0 8px rgba(0,229,255,0.9)",
                    }}
                    aria-label={`Cursor position ${position + 1}`}
                  />
                  <span>{after}</span>
                </span>
              );
            })()}
          </div>
        </div>

        <div className="mb-2 text-center text-[8px] font-mono tracking-wider text-[#00E5FF]/70">
          CURSOR&nbsp; {Math.min(
            Number(cursorPosition ?? String(value ?? "").length) + 1,
            String(value ?? "").length + 1
          )}
          &nbsp;/&nbsp; {String(value ?? "").length + 1}
        </div>

        {isBoolean
          ? renderBooleanPad()
          : isText
            ? renderTextPad()
            : renderNumberPad()}

        <div className="mt-3 text-center text-[8px] font-mono tracking-wider text-white/35">
          HMI TOUCH INPUT • {dataType.toUpperCase()}
        </div>
      </div>
    </div>
  );
}

export function RuntimeTextBox({ widget, value, onWrite }) {
  const p = widget.props || {};
  const mode = p.textMode || "read";
  const fallback = p.defaultText ?? p.text ?? "TEXT";

  // Number and Calculation TextBoxes always show 3 decimal places.
  // Static text is never altered.
  const shouldFormatNumber =
    mode === "calculation" ||
    p.dataType === "number";

  const displayValue = shouldFormatNumber
    ? formatTextBoxNumber(value)
    : value;

  const externalValue =
    displayValue === undefined || displayValue === null
      ? fallback
      : String(displayValue);

  const [draft, setDraft] = React.useState(externalValue);
  const [focused, setFocused] = React.useState(false);
  const [popupOpen, setPopupOpen] = React.useState(false);
  const [cursorPosition, setCursorPosition] = React.useState(
    String(externalValue ?? "").length
  );

  // Static/read always follow the external value.
  // Write mode follows PLC read-back whenever the user is not editing.
  React.useEffect(() => {
    if ((!focused && !popupOpen) || mode !== "write") {
      setDraft(externalValue);
    }
  }, [externalValue, focused, popupOpen, mode]);

  const commit = React.useCallback(
    async (nextValue = draft) => {
      if (mode !== "write" || !onWrite) return;
      await onWrite(nextValue);
    },
    [draft, mode, onWrite]
  );

  const openPopup = React.useCallback(() => {
    if (mode !== "write") return;
    const next = String(externalValue ?? "");
    setDraft(next);
    setCursorPosition(next.length);
    setFocused(true);
    setPopupOpen(true);
  }, [externalValue, mode]);

  const runtimeProps = {
    ...p,
    __runtimeId:
      widget.id ||
      `${widget.x || 0}-${widget.y || 0}-${p.frameStyle || "standard"}`,
  };

  if (mode === "static") {
    return (
      <div
        className="absolute"
        style={{
          left: widget.x,
          top: widget.y,
          width: p.width,
          height: p.height,
          overflow: "visible",
        }}
      >
        <TextBoxSurface
          p={runtimeProps}
          textValue={fallback}
          preview={false}
        />
      </div>
    );
  }

  if (mode === "calculation") {
    return (
      <div
        className="absolute"
        style={{
          left: widget.x,
          top: widget.y,
          width: p.width,
          height: p.height,
          overflow: "visible",
        }}
      >
        <TextBoxSurface
          p={runtimeProps}
          textValue={externalValue}
          preview={false}
        />
      </div>
    );
  }

  if (mode === "read") {
    return (
      <div
        className="absolute"
        style={{
          left: widget.x,
          top: widget.y,
          width: p.width,
          height: p.height,
          overflow: "visible",
        }}
      >
        <TextBoxSurface
          p={runtimeProps}
          textValue={externalValue}
          preview={false}
        />
      </div>
    );
  }

  // WRITE mode: popup HMI keypad is the default touch interface.
  // Native mode keeps the previous browser keyboard behavior.
  return (
    <>
      <div
        className="absolute"
        style={{
          left: widget.x,
          top: widget.y,
          width: p.width,
          height: p.height,
          overflow: "visible",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
          }}
        >
          <TextBoxSurface
            p={runtimeProps}
            textValue={p.inputMethod === "native" ? "" : draft}
            preview={false}
          />

          {p.inputMethod === "native" ? (
            <input
              value={draft}
              onFocus={() => setFocused(true)}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (p.writeTrigger !== "blur" && e.key === "Enter") {
                  e.preventDefault();
                  commit();
                  e.currentTarget.blur();
                }
              }}
              onBlur={() => {
                setFocused(false);
                if (p.writeTrigger === "blur") commit();
              }}
              className="absolute inset-0 w-full h-full bg-transparent border-0 outline-none"
              step={p.dataType === "number" ? "0.001" : undefined}
              style={{
                color: p.textColor || "#FFFFFF",
                fontSize: `${Number(p.fontSize ?? 18)}px`,
                fontWeight: p.fontWeight || "600",
                textAlign: p.textAlign || "center",
                padding: `${Number(p.padding ?? 8)}px`,
                boxSizing: "border-box",
              }}
              type={
                p.dataType === "number" || p.dataType === "integer"
                  ? "number"
                  : "text"
              }
            />
          ) : (
            <button
              type="button"
              aria-label="Open HMI input keypad"
              onClick={openPopup}
              className="absolute inset-0 w-full h-full cursor-pointer bg-transparent border-0 outline-none"
            />
          )}
        </div>
      </div>

      {p.inputMethod !== "native" && (
        <HMIInputPopup
          open={popupOpen}
          dataType={p.dataType || "number"}
          value={draft}
          cursorPosition={cursorPosition}
          onCursorChange={setCursorPosition}
          onChange={(nextValue) => {
            setDraft(nextValue);
          }}
          onCommit={async (nextValue) => {
            setPopupOpen(false);
            setFocused(false);
            await commit(nextValue);
          }}
          onCancel={() => {
            setPopupOpen(false);
            setFocused(false);
            setDraft(externalValue);
            setCursorPosition(String(externalValue ?? "").length);
          }}
        />
      )}
    </>
  )
}