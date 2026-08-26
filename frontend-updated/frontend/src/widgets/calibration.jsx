// src/widgets/calibration.jsx
//
// "Calibration" icon-popup widget.
//   - calibrationDef            palette entry for the Page Builder sidebar
//   - CalibrationPreview        design-time canvas preview
//   - CalibrationPropertyPanel  property panel (title/icon/color + field list)
//   - RuntimeCalibration        icon button + popup on the live Dynamic CP Page
//
import {
  createParamField,
  IconTriggerPreview,
  IconTriggerRuntime,
  ParamFieldsEditor,
  PropInput,
  PropSection,
  DEFAULT_VISUAL,
} from "./shared";

// ────────────────────────────────────────────────────────────────
//  PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

export const calibrationDef = {
  type: "calibration",
  label: "Calibration",
  icon: "🎯",
  desc: "Icon popup untuk parameter kalibrasi",
  defaultProps: {
    title: "Calibration",
    icon: "🎯",
    accentColor: "var(--accent-orange)",
    backgroundColor: "var(--panel-canvas)",
    borderColor: "var(--panel-mid)",
    textColor: "#FFFFFF",
    popupWidth: 380,
    fields: [
      { ...createParamField("value", 0), label: "Offset X", unit: "mm" },
      { ...createParamField("value", 1), label: "Offset Y", unit: "mm" },
    ],
    width: 140,
    height: 110,
    visual: { ...DEFAULT_VISUAL },
  },
};

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

export function CalibrationPreview({ widget }) {
  return <IconTriggerPreview widget={widget} glyph="🎯" />;
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function CalibrationPropertyPanel({ p, set, availableDevices = [] }) {
  return (
    <>
      <PropSection title="Popup">
        <PropInput label="Title" value={p.title || "Calibration"} onChange={v => set("title", v)} />
        <PropInput label="Icon" value={p.icon || "🎯"} onChange={v => set("icon", v)} />
        <PropInput
          label="Popup Width"
          type="number"
          min={280}
          max={800}
          value={p.popupWidth ?? 380}
          onChange={v => set("popupWidth", Number(v))}
        />
      </PropSection>

      <PropSection title="Appearance">
        <PropInput label="Accent" type="color" value={p.accentColor || "var(--accent-orange)"} onChange={v => set("accentColor", v)} />
        <PropInput label="Background" type="color" value={p.backgroundColor || "var(--panel-canvas)"} onChange={v => set("backgroundColor", v)} />
        <PropInput label="Border" type="color" value={p.borderColor || "var(--panel-mid)"} onChange={v => set("borderColor", v)} />
        <PropInput label="Text" type="color" value={p.textColor || "#FFFFFF"} onChange={v => set("textColor", v)} />
      </PropSection>

      <PropSection title="Parameter Kalibrasi">
        <ParamFieldsEditor
          fields={p.fields}
          onChange={v => set("fields", v)}
          availableDevices={availableDevices}
        />
      </PropSection>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
//  DYNAMIC CP PAGE — RUNTIME
// ────────────────────────────────────────────────────────────────

export function RuntimeCalibration({ widget, plc, onOpenPage }) {
  return <IconTriggerRuntime widget={widget} glyph="🎯" plc={plc} onOpenPage={onOpenPage} />;
}