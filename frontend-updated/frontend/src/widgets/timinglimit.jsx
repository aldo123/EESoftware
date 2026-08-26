// src/widgets/timinglimit.jsx
//
// "Timing & Limit" icon-popup widget.
//   - timinglimitDef            palette entry for the Page Builder sidebar
//   - TimingLimitPreview        design-time canvas preview
//   - TimingLimitPropertyPanel  property panel (title/icon/color + field list)
//   - RuntimeTimingLimit        icon button + popup on the live Dynamic CP Page
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

export const timinglimitDef = {
  type: "timinglimit",
  label: "Timing & Limit",
  icon: "⏱",
  desc: "Icon popup untuk parameter timing dan limit",
  defaultProps: {
    title: "Timing & Limit",
    icon: "⏱",
    accentColor: "var(--accent-green)",
    backgroundColor: "var(--panel-canvas)",
    borderColor: "var(--panel-mid)",
    textColor: "#FFFFFF",
    popupWidth: 380,
    fields: [
      { ...createParamField("value", 0), label: "Cycle Time", unit: "ms" },
      { ...createParamField("value", 1), label: "Max Limit" },
      { ...createParamField("value", 2), label: "Min Limit" },
    ],
    width: 140,
    height: 110,
    visual: { ...DEFAULT_VISUAL },
  },
};

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

export function TimingLimitPreview({ widget }) {
  return <IconTriggerPreview widget={widget} glyph="⏱" />;
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function TimingLimitPropertyPanel({ p, set, availableDevices = [] }) {
  return (
    <>
      <PropSection title="Popup">
        <PropInput label="Title" value={p.title || "Timing & Limit"} onChange={v => set("title", v)} />
        <PropInput label="Icon" value={p.icon || "⏱"} onChange={v => set("icon", v)} />
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
        <PropInput label="Accent" type="color" value={p.accentColor || "var(--accent-green)"} onChange={v => set("accentColor", v)} />
        <PropInput label="Background" type="color" value={p.backgroundColor || "var(--panel-canvas)"} onChange={v => set("backgroundColor", v)} />
        <PropInput label="Border" type="color" value={p.borderColor || "var(--panel-mid)"} onChange={v => set("borderColor", v)} />
        <PropInput label="Text" type="color" value={p.textColor || "#FFFFFF"} onChange={v => set("textColor", v)} />
      </PropSection>

      <PropSection title="Parameter Timing / Limit">
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

export function RuntimeTimingLimit({ widget, plc }) {
  return <IconTriggerRuntime widget={widget} glyph="⏱" plc={plc} />;
}