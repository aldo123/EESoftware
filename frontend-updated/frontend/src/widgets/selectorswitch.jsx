// src/widgets/selectorswitch.jsx
//
// Everything about the "selectorswitch" widget lives in this one file:
//   - selectorSwitchDef            palette entry (label/icon/desc/defaultProps) for the Page Builder sidebar
//   - SelectorSwitchPreview        how it looks on the Page Builder canvas (design-time)
//   - SelectorSwitchPropertyPanel  the property panel shown when this widget is selected
//   - RuntimeSelectorSwitch        how it looks/behaves on the live Dynamic CP Page
//
// A multi-position switch (e.g. AUTO / MANUAL / OFF) — reads the current
// position from a Holding Register or Internal Variable, and writes the
// new position's value back when the operator clicks a different segment.
// Same read+write-same-address pattern as Text Box's Write mode.
import { useInternalVariables } from "../hooks/useInternalVariables";
import { PropInput, PropSection, DEFAULT_VISUAL } from "./shared";

// ────────────────────────────────────────────────────────────────
//  PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

export const selectorSwitchDef = {
  type: "selectorswitch",
  label: "Selector Switch",
  icon: "⎌",
  desc: "Multi-position switch (e.g. AUTO / MANUAL / OFF)",
  defaultProps: {
    dataSource: "device",
    addressType: "holding_register",
    device: "",
    address: "",
    internalVariable: "",

    positions: [
      { label: "AUTO", value: 0 },
      { label: "MANUAL", value: 1 },
      { label: "OFF", value: 2 },
    ],

    orientation: "horizontal", // "horizontal" | "vertical"
    title: "MODE",
    showTitle: true,

    activeColor: "var(--accent-cyan)",
    inactiveColor: "var(--panel-mid)",
    textColor: "#FFFFFF",

    // Builder preview only.
    builderState: 0,

    width: 240,
    height: 70,
    visual: { ...DEFAULT_VISUAL },
  },
};

// ────────────────────────────────────────────────────────────────
//  SHARED SURFACE
// ────────────────────────────────────────────────────────────────

function SelectorSwitchSurface({ p, activeValue, onSelect }) {
  const positions = Array.isArray(p.positions) && p.positions.length > 0
    ? p.positions
    : [{ label: "ON", value: 1 }, { label: "OFF", value: 0 }];

  const vertical = p.orientation === "vertical";
  const activeColor = p.activeColor || "var(--accent-cyan)";
  const inactiveColor = p.inactiveColor || "var(--panel-mid)";
  const textColor = p.textColor || "#FFFFFF";

  return (
    <div className="w-full h-full flex flex-col gap-1.5">
      {p.showTitle !== false && (
        <span className="text-[9px] font-bold uppercase tracking-widest text-center" style={{ color: textColor }}>
          {p.title || "MODE"}
        </span>
      )}
      <div
        className={`flex-1 flex ${vertical ? "flex-col" : "flex-row"} rounded-lg overflow-hidden border`}
        style={{ borderColor: inactiveColor }}
      >
        {positions.map((pos, i) => {
          const isActive = Number(activeValue) === Number(pos.value);
          return (
            <button
              key={`${pos.value}-${i}`}
              type="button"
              onClick={() => onSelect?.(pos.value)}
              className="flex-1 flex items-center justify-center text-[10px] font-bold uppercase tracking-wider transition-all duration-200"
              style={{
                background: isActive ? activeColor : "transparent",
                color: isActive ? "#052E16" : textColor,
                boxShadow: isActive ? `0 0 10px ${activeColor}66 inset` : "none",
                borderRight: !vertical && i < positions.length - 1 ? `1px solid ${inactiveColor}` : "none",
                borderBottom: vertical && i < positions.length - 1 ? `1px solid ${inactiveColor}` : "none",
              }}
            >
              {pos.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

export function SelectorSwitchPreview({ widget }) {
  const p = widget.props || {};
  return (
    <div className="w-full h-full overflow-visible p-1">
      <SelectorSwitchSurface p={p} activeValue={p.builderState ?? 0} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function SelectorSwitchPropertyPanel({ p, set, availableDevices = [] }) {
  const {
    variables: internalVariables,
    loading: internalVariablesLoading,
    error: internalVariablesError,
  } = useInternalVariables();

  const positions = Array.isArray(p.positions) ? p.positions : [];

  const updatePosition = (idx, patch) => {
    const next = positions.map((pos, i) => (i === idx ? { ...pos, ...patch } : pos));
    set("positions", next);
  };

  const addPosition = () => {
    set("positions", [...positions, { label: `POS ${positions.length + 1}`, value: positions.length }]);
  };

  const removePosition = (idx) => {
    set("positions", positions.filter((_, i) => i !== idx));
  };

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
            <PropInput
              label="Address"
              value={p.address || ""}
              onChange={(v) => set("address", v)}
              placeholder="D100 / M100"
            />
            <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
              Selector Switch reads and writes the same Holding Register.
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
      </PropSection>

      <PropSection title="Positions">
        {positions.map((pos, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <input
              value={pos.label ?? ""}
              onChange={(e) => updatePosition(idx, { label: e.target.value })}
              placeholder="Label"
              className="flex-1 h-8 px-2 rounded border border-[var(--border)] bg-[var(--bg-canvas)] text-[var(--text-primary)] text-[10px] outline-none focus:border-[var(--accent-green)]/60"
            />
            <input
              type="number"
              value={pos.value ?? 0}
              onChange={(e) => updatePosition(idx, { value: Number(e.target.value) })}
              placeholder="Value"
              className="w-16 h-8 px-2 rounded border border-[var(--border)] bg-[var(--bg-canvas)] text-[var(--text-primary)] text-[10px] outline-none focus:border-[var(--accent-green)]/60"
            />
            <button
              type="button"
              onClick={() => removePosition(idx)}
              className="w-8 h-8 rounded border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent-red)] hover:border-[var(--accent-red)]/60 text-xs"
              title="Remove position"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addPosition}
          className="w-full h-8 rounded-lg border border-[var(--accent-green)] text-[var(--accent-green)] text-[9px] font-semibold"
        >
          + Add Position
        </button>
      </PropSection>

      <PropSection title="Simulation State">
        <PropInput
          label="Active Position"
          options={positions.map((pos) => ({ value: pos.value, label: pos.label }))}
          value={p.builderState ?? (positions[0]?.value ?? 0)}
          onChange={(v) => set("builderState", Number(v))}
        />
        <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
          Builder preview only. Runtime value comes from the bound variable/device.
        </div>
      </PropSection>

      <PropSection title="Appearance">
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
          label="Show Title"
          type="checkbox"
          value={p.showTitle !== false}
          onChange={(v) => set("showTitle", v)}
        />
        {p.showTitle !== false && (
          <PropInput
            label="Title"
            value={p.title || "MODE"}
            onChange={(v) => set("title", v)}
          />
        )}
        <PropInput
          label="Active Color"
          type="color"
          value={p.activeColor || "var(--accent-cyan)"}
          onChange={(v) => set("activeColor", v)}
        />
        <PropInput
          label="Inactive Color"
          type="color"
          value={p.inactiveColor || "var(--panel-mid)"}
          onChange={(v) => set("inactiveColor", v)}
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

export function RuntimeSelectorSwitch({ widget, value, onChange }) {
  const p = widget.props || {};
  const positions = Array.isArray(p.positions) && p.positions.length > 0
    ? p.positions
    : [{ label: "ON", value: 1 }, { label: "OFF", value: 0 }];

  const activeValue = value === undefined || value === null || value === ""
    ? (positions[0]?.value ?? 0)
    : value;

  return (
    <div
      className="absolute p-1"
      style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}
    >
      <SelectorSwitchSurface p={p} activeValue={activeValue} onSelect={(v) => onChange?.(v)} />
    </div>
  );
}
