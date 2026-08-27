// src/widgets/manualcontrol.jsx
//
// "Manual Control" icon-popup widget.
//   - manualcontrolDef            palette entry for the Page Builder sidebar
//   - ManualControlPreview        design-time canvas preview
//   - ManualControlPropertyPanel  property panel (title/icon/color + field list)
//   - RuntimeManualControl        icon button + popup on the live Dynamic CP Page
//
import {
  createParamField,
  IconTriggerPreview,
  IconTriggerRuntime,
  PropInput,
  PropSection,
  DEFAULT_VISUAL,
} from "./shared";

// ────────────────────────────────────────────────────────────────
//  PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

export const manualcontrolDef = {
  type: "manualcontrol",
  label: "Manual Control",
  icon: "🕹",
  desc: "Icon popup untuk jog / kontrol manual",
  defaultProps: {
    title: "Manual Control",
    icon: "🕹",
    accentColor: "var(--accent-cyan)",
    backgroundColor: "var(--panel-canvas)",
    borderColor: "transparent",
    textColor: "#FFFFFF",
    popupWidth: 380,
    fields: [
      { ...createParamField("jog", 0), label: "Jog Forward" },
      { ...createParamField("jog", 1), label: "Jog Reverse" },
    ],
    width: 140,
    height: 110,
    visual: { ...DEFAULT_VISUAL },
  },
};

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

export function ManualControlPreview({ widget }) {
  return <IconTriggerPreview widget={widget} glyph="🕹" />;
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function ManualControlPropertyPanel({ p, set }) {
  return (
    <>
      <PropSection title="Popup">
        <PropInput label="Title" value={p.title || "Manual Control"} onChange={v => set("title", v)} />
        <PropInput label="Icon" value={p.icon || "🕹"} onChange={v => set("icon", v)} />
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
        <PropInput label="Accent" type="color" value={p.accentColor || "var(--accent-cyan)"} onChange={v => set("accentColor", v)} />
        <PropInput label="Background" type="color" value={p.backgroundColor || "var(--panel-canvas)"} onChange={v => set("backgroundColor", v)} />
        <PropInput label="Text" type="color" value={p.textColor || "#FFFFFF"} onChange={v => set("textColor", v)} />
      </PropSection>

    </>
  );
}

// ────────────────────────────────────────────────────────────────
//  DYNAMIC CP PAGE — RUNTIME
// ────────────────────────────────────────────────────────────────

export function RuntimeManualControl({ widget, plc, onOpenPage }) {
  return <IconTriggerRuntime widget={widget} glyph="🕹" plc={plc} onOpenPage={onOpenPage} />;
}