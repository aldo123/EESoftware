// src/widgets/alarmbanner.jsx
//
// Everything about the "alarmbanner" widget lives in this one file:
//   - alarmBannerDef            palette entry (label/icon/desc/defaultProps) for the Page Builder sidebar
//   - AlarmBannerPreview        how it looks on the Page Builder canvas (design-time)
//   - AlarmBannerPropertyPanel  the property panel shown when this widget is selected
//   - RuntimeAlarmBanner        how it looks/behaves on the live Dynamic CP Page
//
// A boolean READ widget (same PLC address types as Indicator Light) that
// shows a full-width banner instead of a small lamp — for surfacing an
// active alarm/warning condition prominently on an HMI page.
import { useInternalVariables } from "../hooks/useInternalVariables";
import { LIGHT_ADDRESS_TYPES, PropInput, PropSection, DEFAULT_VISUAL } from "./shared";

// ────────────────────────────────────────────────────────────────
//  PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

export const alarmBannerDef = {
  type: "alarmbanner",
  label: "Alarm Banner",
  icon: "⚠",
  desc: "Blinking alarm/warning banner from a PLC or Internal Variable",
  defaultProps: {
    // Data source: "device" = TCP/IP, "internal" = shared Internal Variable.
    dataSource: "device",
    addressType: "discrete_input",
    device: "",
    address: "",
    internalVariable: "",

    // Read value of 1 = active unless Invert is on.
    invert: false,

    title: "ALARM",
    activeMessage: "Alarm Active — Check Machine",
    idleMessage: "System Normal",

    activeColor: "#EF4444",
    idleColor: "#22C55E",
    textColor: "#FFFFFF",
    blink: true,

    // Builder-only preview toggle (mirrors Light's builderState).
    builderState: 0,

    width: 480,
    height: 56,
    visual: { ...DEFAULT_VISUAL },
  },
};

// ────────────────────────────────────────────────────────────────
//  SHARED SURFACE
// ────────────────────────────────────────────────────────────────

function AlarmBannerSurface({ p, active }) {
  const activeColor = p.activeColor || "#EF4444";
  const idleColor = p.idleColor || "#22C55E";
  const textColor = p.textColor || "#FFFFFF";
  const color = active ? activeColor : idleColor;
  const title = p.title || "ALARM";
  const message = active
    ? (p.activeMessage || "Alarm Active")
    : (p.idleMessage || "System Normal");

  return (
    <div
      className="w-full h-full flex items-center gap-3 px-4 rounded-lg"
      style={{
        background: `${color}22`,
        border: `1px solid ${color}66`,
        boxShadow: active && p.blink !== false ? `0 0 16px ${color}55` : "none",
        animation: active && p.blink !== false ? "alarmBannerPulse 1s ease-in-out infinite" : "none",
      }}
    >
      <span
        className="text-xl shrink-0"
        style={{ color, filter: active ? `drop-shadow(0 0 6px ${color})` : "none" }}
      >
        {active ? "⚠" : "✓"}
      </span>
      <div className="flex flex-col min-w-0 leading-tight">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>
          {title}
        </span>
        <span className="text-xs font-semibold truncate" style={{ color: textColor }}>
          {message}
        </span>
      </div>

      {active && p.blink !== false && (
        <style>
          {`
            @keyframes alarmBannerPulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.55; }
            }
          `}
        </style>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

export function AlarmBannerPreview({ widget }) {
  const p = widget.props || {};
  const active = p.builderState === 1;
  return (
    <div className="w-full h-full overflow-visible">
      <AlarmBannerSurface p={p} active={active} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function AlarmBannerPropertyPanel({ p, set, availableDevices = [] }) {
  const {
    variables: internalVariables,
    loading: internalVariablesLoading,
    error: internalVariablesError,
  } = useInternalVariables();

  const isActive = p.builderState === 1;

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
                options={LIGHT_ADDRESS_TYPES}
                value={p.addressType || "discrete_input"}
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

        <PropInput
          label="Invert (0 = Active)"
          type="checkbox"
          value={p.invert === true}
          onChange={(v) => set("invert", v)}
        />
        <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
          Alarm Banner is READ only. A read value of 1 means active (or 0 if Invert is on).
        </div>
      </PropSection>

      <PropSection title="Simulation State">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => set("builderState", 1)}
            className="h-8 rounded-lg border text-[9px] font-bold transition-all"
            style={{
              background: isActive ? "#EF444422" : "var(--bg-canvas)",
              borderColor: isActive ? "#EF4444" : "var(--border)",
              color: isActive ? "#EF4444" : "var(--text-dim)",
            }}
          >
            ⚠ Active
          </button>
          <button
            type="button"
            onClick={() => set("builderState", 0)}
            className="h-8 rounded-lg border text-[9px] font-bold transition-all"
            style={{
              background: !isActive ? "var(--border-soft)" : "var(--bg-canvas)",
              borderColor: !isActive ? "var(--text-dim)" : "var(--border)",
              color: !isActive ? "#FFFFFF" : "var(--text-dim)",
            }}
          >
            ✓ Normal
          </button>
        </div>
      </PropSection>

      <PropSection title="Messages">
        <PropInput
          label="Title"
          value={p.title || "ALARM"}
          onChange={(v) => set("title", v)}
        />
        <PropInput
          label="Active Message"
          value={p.activeMessage || ""}
          onChange={(v) => set("activeMessage", v)}
        />
        <PropInput
          label="Idle Message"
          value={p.idleMessage || ""}
          onChange={(v) => set("idleMessage", v)}
        />
      </PropSection>

      <PropSection title="Appearance">
        <PropInput
          label="Active Color"
          type="color"
          value={p.activeColor || "#EF4444"}
          onChange={(v) => set("activeColor", v)}
        />
        <PropInput
          label="Idle Color"
          type="color"
          value={p.idleColor || "#22C55E"}
          onChange={(v) => set("idleColor", v)}
        />
        <PropInput
          label="Text Color"
          type="color"
          value={p.textColor || "#FFFFFF"}
          onChange={(v) => set("textColor", v)}
        />
        <PropInput
          label="Blink When Active"
          type="checkbox"
          value={p.blink !== false}
          onChange={(v) => set("blink", v)}
        />
      </PropSection>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
//  DYNAMIC CP PAGE — RUNTIME
// ────────────────────────────────────────────────────────────────

export function RuntimeAlarmBanner({ widget, value }) {
  const p = widget.props || {};
  const raw = Number(value) === 1;
  const active = p.invert === true ? !raw : raw;

  return (
    <div
      className="absolute"
      style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}
    >
      <AlarmBannerSurface p={p} active={active} />
    </div>
  );
}
