// src/widgets/slider.jsx
//
// Everything about the "slider" widget lives in this one file:
//   - sliderDef            palette entry for the Page Builder sidebar
//   - SliderPreview        how it looks on the Page Builder canvas (design-time)
//   - SliderPropertyPanel  the property panel shown when this widget is selected
//   - RuntimeSlider        how it looks/behaves on the live Dynamic CP Page
//
// An operator-adjustable numeric Internal Variable: label + value pill on top, a range input,
// min / max captions underneath. The variable is written when the operator RELEASES the handle
// (not on every pixel of the drag). Pair it with a Logic Builder node that reads the variable
// (e.g. "Count Over Time" → Live tuning) to tune a process from the page.
import { useEffect, useRef, useState } from "react";
import { useInternalVariables } from "../hooks/useInternalVariables";
import { PropInput, PropSection, DEFAULT_VISUAL } from "./shared";

// ────────────────────────────────────────────────────────────────
//  PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

export const sliderDef = {
  type: "slider",
  label: "Slider",
  icon: "🎚",
  desc: "Operator-adjustable numeric Internal Variable",
  defaultProps: {
    variable: "",
    label: "Value",
    min: 0,
    max: 100,
    step: 1,
    simulationValue: 50,
    locked: false,
    fontSize: 15,
    accentColor: "#00C896",
    labelColor: "#8E8E93",
    trackColor: "#38383A",
    width: 420,
    height: 76,
    visual: { ...DEFAULT_VISUAL },
  },
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Same thumb styling as the original Bubble Tester adjustment panel.
const SLIDER_CSS = `
.wik-slider { -webkit-appearance: none; appearance: none; width: 100%; background: transparent; outline: none; margin: 0; }
.wik-slider::-webkit-slider-runnable-track { height: var(--wik-track); border-radius: 999px; }
.wik-slider::-webkit-slider-thumb {
  -webkit-appearance: none; width: var(--wik-thumb); height: var(--wik-thumb); border-radius: 50%;
  background: var(--wik-accent); margin-top: calc((var(--wik-track) - var(--wik-thumb)) / 2); cursor: pointer;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wik-accent) 20%, transparent); transition: box-shadow .15s;
}
.wik-slider:hover::-webkit-slider-thumb { box-shadow: 0 0 0 5px color-mix(in srgb, var(--wik-accent) 30%, transparent); }
.wik-slider:disabled::-webkit-slider-thumb { background: #48484A; box-shadow: none; cursor: not-allowed; }
`;

// ────────────────────────────────────────────────────────────────
//  SHARED SURFACE
// ────────────────────────────────────────────────────────────────

function SliderSurface({ p, value, onChange, onCommit, disabled }) {
  const min = Number(p.min ?? 0);
  const maxRaw = Number(p.max ?? 100);
  const max = maxRaw <= min ? min + 1 : maxRaw;
  const step = Number(p.step) > 0 ? Number(p.step) : 1;
  const accent = p.accentColor || "#00C896";
  const labelColor = p.labelColor || "#8E8E93";
  const trackColor = p.trackColor || "#38383A";
  const fs = Number(p.fontSize ?? 15);
  const trackH = Math.max(4, Math.round(fs * 0.34));
  const thumb = Math.round(fs * 1.35);

  const v = clamp(Number.isFinite(Number(value)) ? Number(value) : min, min, max);
  const pct = ((v - min) / (max - min)) * 100;

  return (
    <div
      className="w-full h-full flex flex-col justify-center select-none"
      style={{
        "--wik-accent": accent, "--wik-track": `${trackH}px`, "--wik-thumb": `${thumb}px`,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
      }}
    >
      <style>{SLIDER_CSS}</style>
      <div className="flex items-center justify-between" style={{ marginBottom: fs * 0.5 }}>
        <span style={{ fontSize: fs, color: labelColor, fontWeight: 500 }}>{p.label || "Value"}</span>
        <span
          style={{
            fontSize: fs, fontWeight: 700, fontFamily: "monospace", minWidth: fs * 3.5, textAlign: "center",
            padding: `${fs * 0.16}px ${fs * 0.66}px`, borderRadius: 5,
            color: disabled ? labelColor : accent,
            background: disabled ? "transparent" : `color-mix(in srgb, ${accent} 15%, transparent)`,
            border: `0.5px solid ${disabled ? "transparent" : `color-mix(in srgb, ${accent} 30%, transparent)`}`,
          }}
        >
          {v}
        </span>
      </div>

      <input
        type="range"
        className="wik-slider"
        min={min}
        max={max}
        step={step}
        value={v}
        disabled={disabled}
        onChange={(e) => onChange?.(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number(e.currentTarget.value))}
        onKeyUp={(e) => onCommit?.(Number(e.currentTarget.value))}
        onBlur={(e) => onCommit?.(Number(e.currentTarget.value))}
        style={{
          borderRadius: 999, height: Math.max(trackH, thumb),
          backgroundImage: disabled
            ? "none"
            : `linear-gradient(to right, ${accent} ${pct}%, ${trackColor} ${pct}%)`,
          backgroundSize: `100% ${trackH}px`, backgroundRepeat: "no-repeat", backgroundPosition: "center",
          backgroundColor: disabled ? trackColor : "transparent",
          opacity: disabled ? 0.4 : 1, cursor: disabled ? "not-allowed" : "pointer",
          touchAction: "none",
        }}
      />

      <div className="flex items-center justify-between" style={{ marginTop: fs * 0.25, fontSize: fs * 0.75, color: labelColor, opacity: 0.65 }}>
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

export function SliderPreview({ widget }) {
  const p = widget.props || {};
  return (
    <div className="w-full h-full overflow-visible pointer-events-none">
      <SliderSurface p={p} value={p.simulationValue ?? p.min ?? 0} disabled={p.locked === true} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function SliderPropertyPanel({ p, set }) {
  const { variables = [], loading } = useInternalVariables();
  const numeric = variables.filter((v) => String(v.data_type || "").toLowerCase() === "number");

  return (
    <>
      <PropSection title="Variable">
        <div>
          <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
            Internal Variable (number)
          </label>
          <select
            value={p.variable || ""}
            onChange={(e) => set("variable", e.target.value)}
            className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none focus:border-[var(--accent-green)]"
          >
            <option value="">{loading ? "Loading variables..." : "Select variable..."}</option>
            {numeric.map((v) => (
              <option key={v.id} value={v.name}>{v.name}</option>
            ))}
          </select>
        </div>
        <div className="text-[8px] text-[var(--text-dim)]">
          Written when the operator releases the handle. Only Number variables are listed.
        </div>
      </PropSection>

      <PropSection title="Range">
        <PropInput label="Label" value={p.label || ""} onChange={(v) => set("label", v)} />
        <div className="grid grid-cols-3 gap-2">
          <PropInput label="Min" type="number" value={p.min ?? 0} onChange={(v) => set("min", Number(v))} />
          <PropInput label="Max" type="number" value={p.max ?? 100} onChange={(v) => set("max", Number(v))} />
          <PropInput label="Step" type="number" min={0} value={p.step ?? 1} onChange={(v) => set("step", Number(v))} />
        </div>
        <PropInput label="Builder preview value" type="number" value={p.simulationValue ?? 50} onChange={(v) => set("simulationValue", Number(v))} />
        <PropInput label="Locked (read-only)" type="checkbox" value={p.locked === true} onChange={(v) => set("locked", v)} />
      </PropSection>

      <PropSection title="Appearance">
        <PropInput label="Font Size" type="number" min={8} max={60} value={p.fontSize ?? 15} onChange={(v) => set("fontSize", Number(v))} />
        <PropInput label="Accent" type="color" value={p.accentColor || "#00C896"} onChange={(v) => set("accentColor", v)} />
        <PropInput label="Label Color" type="color" value={p.labelColor || "#8E8E93"} onChange={(v) => set("labelColor", v)} />
        <PropInput label="Track Color" type="color" value={p.trackColor || "#38383A"} onChange={(v) => set("trackColor", v)} />
      </PropSection>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
//  DYNAMIC CP PAGE — RUNTIME
// ────────────────────────────────────────────────────────────────

export function RuntimeSlider({ widget }) {
  const p = widget.props || {};
  const { getValue, setValue } = useInternalVariables();
  const stored = p.variable ? getValue(p.variable) : undefined;

  const [drag, setDrag] = useState(null);       // value while the handle is being moved
  const lastCommitted = useRef(null);

  // Leave drag mode once the stored value caught up (or after a moment, if the write failed).
  useEffect(() => {
    if (drag === null) return undefined;
    if (Number(stored) === Number(drag)) { setDrag(null); return undefined; }
    const t = setTimeout(() => setDrag(null), 1500);
    return () => clearTimeout(t);
  }, [stored, drag]);

  const commit = (next) => {
    if (!p.variable || p.locked === true) return;
    if (lastCommitted.current === next && Number(stored) === next) return;
    lastCommitted.current = next;
    try {
      Promise.resolve(setValue(p.variable, next)).catch((e) =>
        console.error("[RuntimeSlider] write failed:", e));
    } catch (e) {
      console.error("[RuntimeSlider] write failed:", e);
    }
  };

  const shown = drag !== null ? drag : (stored === undefined ? (p.simulationValue ?? p.min ?? 0) : stored);

  return (
    <div className="absolute" style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}>
      <SliderSurface
        p={p}
        value={shown}
        disabled={p.locked === true || !p.variable}
        onChange={setDrag}
        onCommit={commit}
      />
    </div>
  );
}
