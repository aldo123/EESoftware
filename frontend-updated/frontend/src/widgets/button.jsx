// src/widgets/button.jsx
//
// Everything about the "button" widget lives in this one file:
//   - ButtonDef            palette entry (label/icon/desc/defaultProps) for the Page Builder sidebar
//   - ButtonPreview        how it looks on the Page Builder canvas (design-time)
//   - ButtonPropertyPanel  the property panel shown when this widget is selected
//   - RuntimeButton        how it looks/behaves on the live Dynamic CP Page
//
import { BUTTON_ADDRESS_TYPES, PropInput, PropSection, getVisual, DEFAULT_VISUAL } from "./shared";

// ────────────────────────────────────────────────────────────────
//  PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

export const buttonDef = {
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
  };

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

export function ButtonPreview({ widget }) {
  const p = widget.props || {};

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

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function ButtonPropertyPanel({ p, set, availableDevices = [] }) {
  const isOn = p.builderState === 1;

  return (
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
  );
}

// ────────────────────────────────────────────────────────────────
//  DYNAMIC CP PAGE — RUNTIME
// ────────────────────────────────────────────────────────────────

export function RuntimeButton({ widget, value, onChange }) {
  const p = widget.props || {};
  const v = getVisual(p);
  const variant = p.variant || "neon";
  const isOn = Number(value) === 1;

  const handleToggle = () => {
    onChange?.(isOn ? 0 : 1);
  };

  const onBg = p.onBackground || v.accentColor || "var(--accent-cyan)";
  const offBg = p.offBackground || v.backgroundColor || "var(--bg-canvas)";
  const onBorder = p.onBorder || v.accentColor || "var(--accent-cyan)";
  const offBorder = p.offBorder || v.borderColor || "var(--panel-mid)";
  const onText = p.onTextColor || v.textColor || "#FFFFFF";
  const offText = p.offTextColor || v.secondaryTextColor || "var(--panel-line)";
  const label = isOn ? (p.labelOn || "ON") : (p.labelOff || "OFF");
  const fontSize = p.fontSize || 18;

  let btnStyle = {
    background: isOn ? onBg : offBg,
    border: `${v.borderWidth || 1}px solid ${isOn ? onBorder : offBorder}`,
    boxShadow: isOn ? `0 0 ${v.glowIntensity || 18}px ${onBg}` : "none",
    textColor: isOn ? onText : offText,
    showLed: variant === "neon"
  };

  if (variant === "neon") {
    btnStyle.background = `linear-gradient(135deg, ${v.backgroundColor || "var(--panel-canvas)"}, ${isOn ? onBg : offBg})`;
  }

  return (
    <div className="absolute" style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}>
      <button
        onClick={handleToggle}
        className="w-full h-full rounded-xl flex flex-col items-center justify-center relative overflow-hidden transition-all duration-300 active:scale-[0.97]"
        style={{
          background: btnStyle.background,
          border: btnStyle.border,
          boxShadow: btnStyle.boxShadow,
          borderRadius: v.borderRadius ?? 12
        }}
      >
        {btnStyle.showLed && (
          <div
            className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full transition-all duration-300"
            style={{
              background: isOn ? onBg : offBg,
              boxShadow: isOn ? `0 0 8px ${onBg}` : "none"
            }}
          />
        )}
        <span
          className="font-bold uppercase tracking-widest"
          style={{
            color: btnStyle.textColor,
            fontSize,
            textShadow: isOn ? `0 0 12px ${onBg}` : "none"
          }}
        >
          {label}
        </span>
      </button>
    </div>
  );
}
