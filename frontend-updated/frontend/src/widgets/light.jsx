// src/widgets/light.jsx
//
// Everything about the "light" widget lives in this one file:
//   - LightDef            palette entry
//   - LightPreview        Page Builder canvas preview
//   - LightPropertyPanel  property panel
//   - RuntimeLight        live Dynamic CP runtime
//
// Read sources:
//   tcp      = PLC/device/address binding
//   internal = shared Internal Variable cache/database
//

import {
  LIGHT_ADDRESS_TYPES,
  PropInput,
  PropSection,
  getVisual,
  DEFAULT_VISUAL,
} from "./shared";
import { useInternalVariables } from "../hooks/useInternalVariables";

// ────────────────────────────────────────────────────────────────
// PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

export const lightDef = {
  type: "light",
  label: "Indicator Light",
  icon: "💡",
  desc: "Status light that reads a PLC or Internal Variable",
  defaultProps: {
    readTarget: "tcp",

    addressType: "coil",
    device: "",
    address: "",

    label: "STATUS",

    // Used by both PLC and Internal Variable modes.
    valueOn: 1,
    valueOff: 0,

    

    // State-specific text
    onLabel: "ON",
    offLabel: "OFF",
    labelFontSize: 8,
    labelCase: "uppercase",
    onFontColor: "#FFFFFF",
    offFontColor: "#FFFFFF",
    labelAlign: "center",
    backgroundOpacity: 1,

    // Badge is always multi-state. Each state maps an input value
    // to its own label and solid color.
    badgeStates: [
      { value: 0, label: "WAITING", color: "#F59E0B", fontColor: "#FFFFFF" },
      { value: 1, label: "PASS", color: "#22C55E", fontColor: "#FFFFFF" },
      { value: 2, label: "FAIL", color: "#EF4444", fontColor: "#FFFFFF" },
    ],

    onColor: "var(--accent-cyan)",
    offColor: "var(--border-soft)",

    width: 120,
    height: 60,

    visual: { ...DEFAULT_VISUAL },

    simulation: {
      enabled: true,
      mode: "manual",
    },

    builderState: 0,
  },
};

// ────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────

const getDeviceName = (device) =>
  String(
    device?.name ??
      device?.["Device Name"] ??
      device?.device_name ??
      device?.port ??
      device?.["COM Port"] ??
      ""
  ).trim();

const getDeviceType = (device) =>
  String(device?.type ?? device?.Type ?? "")
    .trim()
    .toUpperCase();

const isTcpDevice = (device) => {
  const type = getDeviceType(device);
  return type === "TCP" || type === "TCP/IP" || type === "MODBUS_TCP";
};

// ────────────────────────────────────────────────────────────────
// PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────


const getLightDisplayMode = (p) => {
  const mode = String(p.displayMode ?? "").toLowerCase();
  if (mode === "pill") return "pill";
  if (mode === "badge") return "badge";
  if (mode === "square") return "square";
  return "led";
};

const getLightStateText = (p, isOn) => {
  const raw = isOn
    ? (p.onLabel ?? p.label ?? "ON")
    : (p.offLabel ?? p.label ?? "OFF");

  const value = String(raw);
  const casing = String(p.labelCase ?? "uppercase").toLowerCase();

  if (casing === "lowercase") return value.toLowerCase();
  if (casing === "capitalize") {
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }
  if (casing === "normal") return value;
  return value.toUpperCase();
};

const getBadgeState = (p, runtimeValue) => {
  const states = Array.isArray(p.badgeStates) ? p.badgeStates : [];
  if (!states.length) return null;

  const raw = runtimeValue == null ? "" : String(runtimeValue).trim();
  const num = Number(raw);

  return (
    states.find((state) => {
      const target = state?.value;
      if (target == null) return false;
      if (String(target).trim() === raw) return true;
      return Number.isFinite(num) && Number.isFinite(Number(target))
        ? num === Number(target)
        : false;
    }) || null
  );
};

const LightVisual = ({ p, isOn, preview = false, runtimeValue }) => {
  const mode = getLightDisplayMode(p);

  const onColor = p.onColor || "var(--accent-cyan)";
  const offColor = p.offColor || "var(--border-soft)";

  const badgeState =
    mode === "badge" ? getBadgeState(p, runtimeValue) : null;

  const stateColor = badgeState?.color || (isOn ? onColor : offColor);

  const fontColor = badgeState?.fontColor || (
    isOn
      ? (p.onFontColor || "#FFFFFF")
      : (p.offFontColor || "#FFFFFF")
  );

  const text = badgeState?.label ?? getLightStateText(p, isOn);
  const fontSize = Math.max(5, Number(p.labelFontSize ?? 8));

  const commonTextStyle = {
    color: fontColor,
    fontSize: `${fontSize}px`,
    lineHeight: 1,
    letterSpacing: p.labelCase === "normal" ? "0.01em" : "0.06em",
    textAlign: p.labelAlign || "center",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const isPill = mode === "pill";
  const isBadge = mode === "badge";
  const isSquare = mode === "square";

  const widgetWidth = Math.max(20, Number(p.width ?? 120));
  const widgetHeight = Math.max(20, Number(p.height ?? 60));

  const width = isPill
    ? Math.max(64, widgetWidth)
    : isBadge
      ? Math.max(70, widgetWidth)
      : Math.max(20, Math.min(widgetWidth, widgetHeight));

  const height = isPill || isBadge
    ? Math.max(28, widgetHeight)
    : Math.max(20, Math.min(widgetWidth, widgetHeight));

  const borderRadius = isPill
    ? "999px"
    : isBadge
      ? "7px"
      : isSquare
        ? "7px"
        : "50%";

  const transparency = Math.max(
    0,
    Math.min(1, Number(p.backgroundOpacity ?? 1))
  );

  return (
    <div
      className="relative flex items-center justify-center"
      style={{
        width,
        height,
        borderRadius,
        overflow: "hidden",
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          borderRadius: "inherit",
          background: stateColor,
          opacity: transparency,
        }}
      />

      {p.showLabel !== false && (
        <span
          className="absolute inset-0 flex items-center justify-center px-2 pointer-events-none"
          style={commonTextStyle}
        >
          {text}
        </span>
      )}
    </div>
  );
};

export function LightPreview({ widget }) {
  const p = widget.props || {};
  const isOn = p.builderState === 1;

  return (
    <>
      <div
        className="w-full h-full flex items-center justify-center"
        style={{
          width: "100%",
          height: "100%",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <LightVisual p={p} isOn={isOn} preview runtimeValue={p.builderState} />
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function LightPropertyPanel({
  p,
  set,
  availableDevices = [],
  cpNumber = "",
}) {
  const isOn = p.builderState === 1;

  const {
    variables: internalVariables = [],
    loading: internalVariablesLoading = false,
  } = useInternalVariables(cpNumber);

  // Page Builder scope: only Internal Variables belonging to the active CP
  // are available in the Read Target selector.
  const tcpDevices = (
    Array.isArray(availableDevices)
      ? availableDevices
      : []
  ).filter(isTcpDevice);

  return (
    <>
      <PropSection title="Read Target">
        <PropInput
          label="Read Target"
          options={[
            { value: "tcp", label: "TCP / PLC" },
            { value: "internal", label: "Internal Variable" },
          ]}
          value={p.readTarget ?? "tcp"}
          onChange={(v) => {
            set("readTarget", v);

            // Internal mode does not use PLC binding.
            if (v === "internal") {
              set("device", "");
              set("address", "");
            }
          }}
        />
      </PropSection>

      {p.readTarget === "internal" ? (
        <PropSection title="Internal Variable">
          <PropInput
            label="Variable"
            options={[
              {
                value: "",
                label: internalVariablesLoading
                  ? "Loading variables..."
                  : "Select internal variable...",
              },
              ...internalVariables.map((variable) => ({
                value: variable.name,
                label: `${variable.name}${
                  variable.data_type
                    ? ` — ${variable.data_type}`
                    : ""
                }`,
              })),
            ]}
            value={p.variable ?? ""}
            onChange={(v) => set("variable", v)}
          />

          <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
            Reads the selected Internal Variable directly. PLC
            Device, Address and Address Type are not used.
          </div>

          <div className="grid grid-cols-2 gap-2">
            <PropInput
              label="Value ON"
              type="number"
              value={p.valueOn ?? 1}
              onChange={(v) => set("valueOn", v === "" ? "" : Number(v))}
            />

            <PropInput
              label="Value OFF"
              type="number"
              value={p.valueOff ?? 0}
              onChange={(v) => set("valueOff", v === "" ? "" : Number(v))}
            />
          </div>
        </PropSection>
      ) : (
        <>
          <PropSection title="Device / Address">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
                  Device
                </label>

                <select
                  value={p.device ?? ""}
                  onChange={(e) =>
                    set("device", e.target.value)
                  }
                  className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none focus:border-[var(--accent-green)]"
                >
                  <option value="">
                    Select device...
                  </option>

                  {tcpDevices.map((dev) => {
                    const name = getDeviceName(dev);

                    if (!name) return null;

                    return (
                      <option
                        key={`${getDeviceType(dev)}-${name}`}
                        value={name}
                      >
                        {name}
                        {dev.connection
                          ? ` — ${dev.connection}`
                          : ""}
                      </option>
                    );
                  })}
                </select>
              </div>

              <PropInput
                label="Address"
                value={p.address ?? ""}
                onChange={(v) => set("address", v)}
                placeholder="D100 / M100"
              />
            </div>
          </PropSection>

          <PropSection title="Address Type">
            <PropInput
              label="Address Type"
              options={LIGHT_ADDRESS_TYPES}
              value={p.addressType ?? "coil"}
              onChange={(v) => set("addressType", v)}
            />
          </PropSection>

          
        </>
      )}

      <PropSection title="Simulation State">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => set("builderState", 1)}
            className="h-8 rounded-lg border text-[9px] font-bold transition-all"
            style={{
              background: isOn
                ? "var(--accent-cyan)"
                : "var(--bg-canvas)",
              borderColor: isOn
                ? "var(--accent-cyan)"
                : "var(--border)",
              color: isOn
                ? "var(--panel-canvas)"
                : "var(--text-dim)",
              boxShadow: isOn
                ? "0 0 12px rgba(0,191,255,0.25)"
                : "none",
            }}
          >
            ● ON
          </button>

          <button
            type="button"
            onClick={() => set("builderState", 0)}
            className="h-8 rounded-lg border text-[9px] font-bold transition-all"
            style={{
              background: !isOn
                ? "var(--border-soft)"
                : "var(--bg-canvas)",
              borderColor: !isOn
                ? "var(--text-dim)"
                : "var(--border)",
              color: !isOn
                ? "#FFFFFF"
                : "var(--text-dim)",
            }}
          >
            ○ OFF
          </button>
        </div>

        <div className="text-[8px] text-[var(--text-dim)] mt-1">
          Builder preview only. Runtime reads from the
          selected Internal Variable or PLC/device binding.
        </div>
      </PropSection>


      <PropSection title="Display / State">
        <PropInput
          label="Display Mode"
          options={[
            { value: "led", label: "LED / Circle" },
            { value: "square", label: "Square" },
            { value: "pill", label: "Pill" },
            { value: "badge", label: "Badge — Multi-State" },
          ]}
          value={p.displayMode ?? "led"}
          onChange={(v) => set("displayMode", v)}
        />

        {p.displayMode === "badge" ? (
          <div className="mt-2 space-y-2">
            <div className="rounded-md border border-[var(--border-soft)] bg-[var(--bg-secondary)] px-2.5 py-2">
              <div className="text-[8px] font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-1">
                Multi-State Badge
              </div>
              <div className="text-[8px] leading-3 text-[var(--text-dim)]">
                Badge automatically uses multiple states. Add as many states as needed.
              </div>
            </div>

            <div className="rounded-md border border-[var(--border-soft)] overflow-hidden">
              <div className="grid grid-cols-[40px_minmax(0,1fr)_42px_42px_24px] gap-1.5 px-2 py-1.5 bg-[var(--bg-tertiary)] border-b border-[var(--border-soft)]">
                <span className="text-[7px] font-semibold text-[var(--text-dim)] uppercase">Value</span>
                <span className="text-[7px] font-semibold text-[var(--text-dim)] uppercase">Label</span>
                <span className="text-[7px] font-semibold text-[var(--text-dim)] uppercase">Color</span>
                <span className="text-[7px] font-semibold text-[var(--text-dim)] uppercase">Font</span>
                <span />
              </div>

              {(p.badgeStates || []).map((state, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[40px_minmax(0,1fr)_42px_42px_24px] gap-1.5 items-center px-2 py-1.5 border-b border-[var(--border-soft)] last:border-b-0"
                >
                  <input
                    type="text"
                    value={state.value ?? ""}
                    onChange={(e) => {
                      const next = [...(p.badgeStates || [])];
                      const raw = e.target.value;
                      next[index] = {
                        ...next[index],
                        value: raw === "" ? "" : (Number.isNaN(Number(raw)) ? raw : Number(raw)),
                      };
                      set("badgeStates", next);
                    }}
                    className="w-full h-6 px-1.5 rounded border border-[var(--border-soft)] bg-[var(--bg-primary)] text-[9px] font-mono text-[var(--text-primary)] outline-none"
                  />

                  <input
                    type="text"
                    value={state.label ?? ""}
                    onChange={(e) => {
                      const next = [...(p.badgeStates || [])];
                      next[index] = { ...next[index], label: e.target.value };
                      set("badgeStates", next);
                    }}
                    className="w-full h-6 px-1.5 rounded border border-[var(--border-soft)] bg-[var(--bg-primary)] text-[9px] text-[var(--text-primary)] outline-none"
                  />

                  <input
                    type="color"
                    value={state.color || "#FFFFFF"}
                    onChange={(e) => {
                      const next = [...(p.badgeStates || [])];
                      next[index] = { ...next[index], color: e.target.value };
                      set("badgeStates", next);
                    }}
                    className="w-8 h-6 p-0.5 rounded border border-[var(--border-soft)] bg-[var(--bg-primary)] cursor-pointer"
                    title="Badge background color"
                  />

                  <input
                    type="color"
                    value={state.fontColor || "#FFFFFF"}
                    onChange={(e) => {
                      const next = [...(p.badgeStates || [])];
                      next[index] = { ...next[index], fontColor: e.target.value };
                      set("badgeStates", next);
                    }}
                    className="w-8 h-6 p-0.5 rounded border border-[var(--border-soft)] bg-[var(--bg-primary)] cursor-pointer"
                    title="Badge font color"
                  />

                  <button
                    type="button"
                    onClick={() => {
                      set(
                        "badgeStates",
                        (p.badgeStates || []).filter((_, i) => i !== index)
                      );
                    }}
                    className="w-6 h-6 rounded border border-[var(--border-soft)] text-[11px] text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                    title="Remove state"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                const states = p.badgeStates || [];
                set("badgeStates", [
                  ...states,
                  {
                    value: states.length,
                    label: "NEW STATE",
                    color: "#FFFFFF",
                    fontColor: "#000000",
                  },
                ]);
              }}
              className="w-full h-7 rounded-md border border-[var(--border-soft)] bg-[var(--bg-secondary)] text-[8px] font-semibold uppercase tracking-wider text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            >
              + Add State
            </button>
          </div>
        ) : (
          <>
            <PropInput
              label="Show Text"
              type="checkbox"
              value={p.showLabel !== false}
              onChange={(v) => set("showLabel", v)}
            />

            {p.showLabel !== false && (
              <>
                <PropInput
                  label="ON Label"
                  value={p.onLabel ?? "ON"}
                  onChange={(v) => set("onLabel", v)}
                  placeholder="RUNNING / READY / ACTIVE"
                />

                <PropInput
                  label="OFF Label"
                  value={p.offLabel ?? "OFF"}
                  onChange={(v) => set("offLabel", v)}
                  placeholder="STOP / IDLE / ERROR"
                />

                <PropInput
                  label="Font Size"
                  type="number"
                  min={5}
                  max={80}
                  value={p.labelFontSize ?? 8}
                  onChange={(v) => set("labelFontSize", v === "" ? "" : Number(v))}
                />

                <PropInput
                  label="Text Case"
                  options={[
                    { value: "uppercase", label: "UPPERCASE" },
                    { value: "lowercase", label: "lowercase" },
                    { value: "capitalize", label: "Capitalize" },
                    { value: "normal", label: "Normal" },
                  ]}
                  value={p.labelCase ?? "uppercase"}
                  onChange={(v) => set("labelCase", v)}
                />

                <PropInput
                  label="ON Font Color"
                  type="color"
                  value={p.onFontColor ?? "#FFFFFF"}
                  onChange={(v) => set("onFontColor", v)}
                />

                <PropInput
                  label="OFF Font Color"
                  type="color"
                  value={p.offFontColor ?? "#FFFFFF"}
                  onChange={(v) => set("offFontColor", v)}
                />
              </>
            )}
          </>
        )}
      </PropSection>

      <PropSection title="Background Transparency">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider">
              Transparency
            </label>
            <span className="text-[9px] font-bold font-mono text-[var(--text-primary)]">
              {Math.round(
                (1 - Number(p.backgroundOpacity ?? 1)) * 100
              )}%
            </span>
          </div>

          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(
              (1 - Number(p.backgroundOpacity ?? 1)) * 100
            )}
            onChange={(e) => {
              const transparency = Math.max(
                0,
                Math.min(100, Number(e.target.value))
              );
              set("backgroundOpacity", 1 - transparency / 100);
            }}
            className="w-full h-1.5 accent-[var(--accent-green)] cursor-pointer"
            aria-label="Background transparency"
          />

          <div className="flex justify-between text-[7px] text-[var(--text-dim)] font-mono">
            <span>0% SOLID</span>
            <span>100% TRANSPARENT</span>
          </div>
        </div>
      </PropSection>

      <PropSection title="ON State Appearance">
        <PropInput
          label="Color ON"
          type="color"
          value={p.onColor ?? "var(--accent-cyan)"}
          onChange={(v) => set("onColor", v)}
        />
      </PropSection>

      <PropSection title="OFF State Appearance">
        <PropInput
          label="Color OFF"
          type="color"
          value={p.offColor ?? "var(--border-soft)"}
          onChange={(v) => set("offColor", v)}
        />
      </PropSection>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// DYNAMIC CP PAGE — RUNTIME
// ────────────────────────────────────────────────────────────────

export function RuntimeLight({ widget, value }) {
  const p = widget.props || {};
  const v = getVisual(p);

  const { getValue: getInternalValue } = useInternalVariables();

  const readTarget = p.readTarget === "internal" ? "internal" : "tcp";
  const variableName = String(p.variable || "").trim();

  const runtimeValue =
    readTarget === "internal"
      ? getInternalValue(variableName, p.valueOff ?? 0)
      : value;

  const badgeRuntimeValue = runtimeValue;

  const valueOn = p.valueOn ?? 1;

  const isOn =
    runtimeValue === true ||
    Number(runtimeValue) === Number(valueOn) ||
    String(runtimeValue).toLowerCase() === "true" ||
    String(runtimeValue).toLowerCase() === "on";

  return (
    <>
      <div
        className="absolute flex items-center justify-center"
        style={{
          left: widget.x,
          top: widget.y,
          width: Number(p.width ?? 120),
          height: Number(p.height ?? 60),
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <LightVisual p={p} isOn={isOn} runtimeValue={badgeRuntimeValue} />
      </div>
    </>
  );
}