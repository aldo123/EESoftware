// src/widgets/progressbar.jsx
//
// Everything about the "progressbar" widget lives in this one file:
//   - progressBarDef            palette entry (label/icon/desc/defaultProps) for the Page Builder sidebar
//   - ProgressBarPreview        how it looks on the Page Builder canvas (design-time)
//   - ProgressBarPropertyPanel  the property panel shown when this widget is selected
//   - RuntimeProgressBar        how it looks/behaves on the live Dynamic CP Page
//
// A numeric READ widget (same PLC address type as Gauge — Holding Register
// only) that shows a linear fill bar instead of a dial — for tank level,
// cycle progress, or any 0..100-style value where a straight bar reads
// faster than a circular gauge.
import { useInternalVariables } from "../hooks/useInternalVariables";
import { GAUGE_ADDRESS_TYPES, PropInput, PropSection, DEFAULT_VISUAL } from "./shared";

// ────────────────────────────────────────────────────────────────
//  PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

export const progressBarDef = {
  type: "progressbar",
  label: "Progress Bar",
  icon: "▬",
  desc: "Linear level/progress bar for a PLC or Internal Variable value",
  defaultProps: {
    dataSource: "device",
    addressType: "holding_register",
    device: "",
    address: "",
    internalVariable: "",

    simulationValue: 50,

    title: "LEVEL",
    unit: "%",
    min: 0,
    max: 100,
    decimals: 0,

    orientation: "horizontal", // "horizontal" | "vertical"
    showTitle: true,
    showValue: true,

    barColor: "var(--accent-cyan)",
    trackColor: "var(--panel-mid)",
    textColor: "#FFFFFF",
    titleColor: "var(--text-dim)",

    width: 260,
    height: 44,
    visual: { ...DEFAULT_VISUAL },
  },
};

// ────────────────────────────────────────────────────────────────
//  SHARED SURFACE
// ────────────────────────────────────────────────────────────────

function ProgressBarSurface({ p, value }) {
  const min = Number(p.min ?? 0);
  const maxRaw = Number(p.max ?? 100);
  const max = maxRaw === min ? min + 1 : maxRaw;

  const clamped = Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));
  const pct = ((clamped - min) / (max - min)) * 100;

  const vertical = p.orientation === "vertical";
  const barColor = p.barColor || "var(--accent-cyan)";
  const trackColor = p.trackColor || "var(--panel-mid)";
  const textColor = p.textColor || "#FFFFFF";
  const titleColor = p.titleColor || "var(--text-dim)";
  const decimals = Math.max(0, Number(p.decimals ?? 0));
  const unit = p.unit || "";

  return (
    <div className={`w-full h-full flex ${vertical ? "flex-row items-end" : "flex-col justify-center"} gap-1.5`}>
      {(p.showTitle !== false || p.showValue !== false) && !vertical && (
        <div className="flex items-center justify-between px-0.5">
          {p.showTitle !== false && (
            <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: titleColor }}>
              {p.title || "LEVEL"}
            </span>
          )}
          {p.showValue !== false && (
            <span className="text-xs font-bold" style={{ color: textColor }}>
              {clamped.toFixed(decimals)}{unit}
            </span>
          )}
        </div>
      )}

      <div
        className="relative overflow-hidden rounded-full"
        style={{
          background: trackColor,
          width: vertical ? "40%" : "100%",
          height: vertical ? "100%" : "100%",
          flex: vertical ? "0 0 auto" : "1 1 auto",
        }}
      >
        <div
          className="absolute left-0 bottom-0 rounded-full transition-all duration-300"
          style={{
            background: barColor,
            boxShadow: `0 0 8px ${barColor}66`,
            width: vertical ? "100%" : `${pct}%`,
            height: vertical ? `${pct}%` : "100%",
          }}
        />
      </div>

      {vertical && (p.showTitle !== false || p.showValue !== false) && (
        <div className="flex flex-col justify-between h-full py-0.5">
          {p.showValue !== false && (
            <span className="text-xs font-bold" style={{ color: textColor }}>
              {clamped.toFixed(decimals)}{unit}
            </span>
          )}
          {p.showTitle !== false && (
            <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: titleColor }}>
              {p.title || "LEVEL"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

export function ProgressBarPreview({ widget }) {
  const p = widget.props || {};
  return (
    <div className="w-full h-full overflow-visible p-1">
      <ProgressBarSurface p={p} value={p.simulationValue ?? p.min ?? 0} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function ProgressBarPropertyPanel({ p, set, availableDevices = [] }) {
  const {
    variables: internalVariables,
    loading: internalVariablesLoading,
    error: internalVariablesError,
  } = useInternalVariables();

  return (
    <>
      <PropSection title="Data Source">
        <PropInput
          label="Source"
          options={[
            { label: "TCP/IP Device", value: "device" },
            { label: "Internal Variable", value: "internal" },
          ]}
          value={p.dataSource || "device"}
          onChange={(v) => set("dataSource", v)}
        />

        {(p.dataSource || "device") === "device" && (
          <>
            <div>
              <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
                Device
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
                placeholder="D100 / M100"
              />
              <PropInput
                label="Address Type"
                options={GAUGE_ADDRESS_TYPES}
                value={p.addressType || "holding_register"}
                onChange={(v) => set("addressType", v)}
              />
            </div>
          </>
        )}

        {(p.dataSource || "device") === "internal" && (
          <div>
            <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
              Internal Variable
            </label>
            <select
              value={p.internalVariable || ""}
              onChange={(e) => set("internalVariable", e.target.value)}
              className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none focus:border-[var(--accent-green)]"
            >
              <option value="">
                {internalVariablesLoading ? "Loading variables..." : "Select variable..."}
              </option>
              {internalVariables.map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name} ({item.data_type})
                </option>
              ))}
            </select>
            {internalVariablesError && (
              <div className="text-[8px] text-red-400 mt-1">{internalVariablesError}</div>
            )}
          </div>
        )}

        <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
          Progress Bar is READ only. TCP/IP mode supports Holding Register.
        </div>
      </PropSection>

      <PropSection title="Simulation Value">
        <PropInput
          label="Value"
          type="number"
          value={p.simulationValue ?? p.min ?? 0}
          min={Number(p.min ?? 0)}
          max={Number(p.max ?? 100)}
          onChange={(v) => set("simulationValue", Number(v))}
        />
        <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
          Builder preview only. Runtime value comes from the bound variable.
        </div>
      </PropSection>

      <PropSection title="Bar">
        <PropInput
          label="Orientation"
          options={[
            { value: "horizontal", label: "Horizontal" },
            { value: "vertical", label: "Vertical" },
          ]}
          value={p.orientation || "horizontal"}
          onChange={(v) => set("orientation", v)}
        />
        <PropInput
          label="Title"
          value={p.title || "LEVEL"}
          onChange={(v) => set("title", v)}
        />
        <PropInput
          label="Unit"
          value={p.unit || ""}
          onChange={(v) => set("unit", v)}
        />
        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Min"
            type="number"
            value={p.min ?? 0}
            onChange={(v) => set("min", Number(v))}
          />
          <PropInput
            label="Max"
            type="number"
            value={p.max ?? 100}
            onChange={(v) => set("max", Number(v))}
          />
        </div>
        <PropInput
          label="Decimals"
          type="number"
          min={0}
          max={4}
          value={p.decimals ?? 0}
          onChange={(v) => set("decimals", Number(v))}
        />
        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Show Title"
            type="checkbox"
            value={p.showTitle !== false}
            onChange={(v) => set("showTitle", v)}
          />
          <PropInput
            label="Show Value"
            type="checkbox"
            value={p.showValue !== false}
            onChange={(v) => set("showValue", v)}
          />
        </div>
      </PropSection>

      <PropSection title="Appearance">
        <PropInput
          label="Bar Color"
          type="color"
          value={p.barColor || "var(--accent-cyan)"}
          onChange={(v) => set("barColor", v)}
        />
        <PropInput
          label="Track Color"
          type="color"
          value={p.trackColor || "var(--panel-mid)"}
          onChange={(v) => set("trackColor", v)}
        />
        <PropInput
          label="Text Color"
          type="color"
          value={p.textColor || "#FFFFFF"}
          onChange={(v) => set("textColor", v)}
        />
      </PropSection>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
//  DYNAMIC CP PAGE — RUNTIME
// ────────────────────────────────────────────────────────────────

export function RuntimeProgressBar({ widget, value }) {
  const p = widget.props || {};
  const resolved = value === undefined || value === null || value === ""
    ? (p.simulationValue ?? p.min ?? 0)
    : value;

  return (
    <div
      className="absolute p-1"
      style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}
    >
      <ProgressBarSurface p={p} value={resolved} />
    </div>
  );
}
