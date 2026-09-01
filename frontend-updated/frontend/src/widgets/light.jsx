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
    variable: "Light1",

    // Used by both PLC and Internal Variable modes.
    valueOn: 1,
    valueOff: 0,

    shape: "circle",
    showLabel: true,

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

export function LightPreview({ widget }) {
  const p = widget.props || {};

  const isOn = p.builderState === 1;
  const shape = p.shape || "circle";

  const onColor = p.onColor || "var(--accent-cyan)";
  const offColor = p.offColor || "var(--border-soft)";
  const currentColor = isOn ? onColor : offColor;

  const label = p.label || "STATUS";
  const showLabel = p.showLabel !== false;

  return (
    <div
      className={`w-full h-full flex items-center justify-center ${
        showLabel ? "gap-4" : ""
      }`}
    >
      <div
        className={`transition-all duration-300 ${
          shape === "circle" ? "rounded-full" : "rounded-md"
        }`}
        style={{
          width: 36,
          height: 36,
          background: `radial-gradient(circle at 35% 35%, ${
            isOn ? onColor : "var(--panel-line)"
          }, ${currentColor})`,
          boxShadow: isOn
            ? `0 0 24px ${onColor}, inset 0 -2px 4px rgba(0,0,0,0.4)`
            : "inset 0 2px 6px rgba(0,0,0,0.6)",
          border: `1px solid ${
            isOn ? onColor : "var(--border-soft)"
          }`,
        }}
      />

      {showLabel && (
        <span
          className="font-bold uppercase tracking-widest text-sm"
          style={{
            color: isOn ? onColor : "var(--text-dim)",
            textShadow: isOn
              ? `0 0 12px ${onColor}`
              : "none",
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function LightPropertyPanel({
  p,
  set,
  availableDevices = [],
}) {
  const isOn = p.builderState === 1;

  const {
    variables: internalVariables = [],
    loading: internalVariablesLoading = false,
  } = useInternalVariables();

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
          value={p.readTarget || "tcp"}
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
            value={p.variable || ""}
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
              onChange={(v) => set("valueOn", Number(v))}
            />

            <PropInput
              label="Value OFF"
              type="number"
              value={p.valueOff ?? 0}
              onChange={(v) => set("valueOff", Number(v))}
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
                  value={p.device || ""}
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
                value={p.address || ""}
                onChange={(v) => set("address", v)}
                placeholder="D100 / M100"
              />
            </div>
          </PropSection>

          <PropSection title="Address Type">
            <PropInput
              label="Address Type"
              options={LIGHT_ADDRESS_TYPES}
              value={p.addressType || "coil"}
              onChange={(v) => set("addressType", v)}
            />
          </PropSection>

          <PropSection title="Data Binding">
            <PropInput
              label="Variable"
              value={p.variable || ""}
              onChange={(v) => set("variable", v)}
            />

            <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
              Light is READ only. It supports Coil, Discrete
              Input, Holding Register and Input Register.
            </div>

            <div className="grid grid-cols-2 gap-2">
              <PropInput
                label="Value ON"
                type="number"
                value={p.valueOn ?? 1}
                onChange={(v) =>
                  set("valueOn", Number(v))
                }
              />

              <PropInput
                label="Value OFF"
                type="number"
                value={p.valueOff ?? 0}
                onChange={(v) =>
                  set("valueOff", Number(v))
                }
              />
            </div>
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

      <PropSection title="Light">
        <PropInput
          label="Shape"
          options={[
            { value: "circle", label: "Circle" },
            { value: "square", label: "Square" },
          ]}
          value={p.shape || "circle"}
          onChange={(v) => set("shape", v)}
        />

        <PropInput
          label="Show Label"
          type="checkbox"
          value={p.showLabel !== false}
          onChange={(v) => set("showLabel", v)}
        />

        {p.showLabel !== false && (
          <PropInput
            label="Label"
            value={p.label || "STATUS"}
            onChange={(v) => set("label", v)}
          />
        )}
      </PropSection>

      <PropSection title="ON State Appearance">
        <PropInput
          label="Color ON"
          type="color"
          value={p.onColor || "var(--accent-cyan)"}
          onChange={(v) => set("onColor", v)}
        />
      </PropSection>

      <PropSection title="OFF State Appearance">
        <PropInput
          label="Color OFF"
          type="color"
          value={p.offColor || "var(--border-soft)"}
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

  const {
    getValue: getInternalValue,
  } = useInternalVariables();

  const readTarget =
    p.readTarget === "internal"
      ? "internal"
      : "tcp";

  const variableName = String(
    p.variable || ""
  ).trim();

  // IMPORTANT:
  // Internal Variable mode does NOT use the PLC `value` prop.
  // It reads directly from the shared internal-variable cache.
  const runtimeValue =
    readTarget === "internal"
      ? getInternalValue(
          variableName,
          p.valueOff ?? 0
        )
      : value;

  const valueOn = p.valueOn ?? 1;

  const isOn =
    runtimeValue === true ||
    Number(runtimeValue) === Number(valueOn) ||
    String(runtimeValue).toLowerCase() === "true" ||
    String(runtimeValue).toLowerCase() === "on";

  const onColor =
    p.onColor ||
    v.accentColor ||
    "var(--accent-cyan)";

  const offColor =
    p.offColor ||
    "var(--border-soft)";

  const showLabel = p.showLabel !== false;

  return (
    <div
      className="absolute flex items-center justify-center"
      style={{
        left: widget.x,
        top: widget.y,
        width: p.width,
        height: p.height,
      }}
    >
      <div
        className="transition-all duration-300"
        style={{
          width: 36,
          height: 36,
          borderRadius:
            p.shape === "square" ? 6 : "50%",

          background: isOn
            ? `radial-gradient(circle at 35% 35%, #FFFFFF, ${onColor} 42%, ${onColor})`
            : offColor,

          border: `1px solid ${
            isOn ? onColor : v.borderColor
          }`,

          boxShadow: isOn
            ? `0 0 24px ${onColor}, inset 0 -2px 4px rgba(0,0,0,0.4)`
            : "inset 0 2px 6px rgba(0,0,0,0.6)",
        }}
      />

      {showLabel && (
        <span
          className="ml-4 font-bold uppercase tracking-widest text-sm"
          style={{
            color: isOn
              ? onColor
              : v.secondaryTextColor,

            textShadow: isOn
              ? `0 0 12px ${onColor}`
              : "none",
          }}
        >
          {p.label || "STATUS"}
        </span>
      )}
    </div>
  );
}