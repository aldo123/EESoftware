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

    

    // State-specific text
    onLabel: "ON",
    offLabel: "OFF",
    labelFontSize: 8,
    labelFontWeight: 800,
    labelCase: "uppercase",
    onFontColor: "#FFFFFF",
    offFontColor: "#FFFFFF",
    labelAlign: "center",

    // Futuristic appearance
    lightSize: 44,
    glowEnabled: true,
    glowIntensity: 1,
    glowSize: 24,
    pulseEnabled: false,
    pulseSpeed: 1.5,
    flashEnabled: false,
    flashSpeed: 2,
    innerGlow: true,
    highlightEnabled: true,
    ringEnabled: true,
    ringWidth: 1,
    ringColor: "",
    pillRadius: 999,
    badgeBorderWidth: 1,
    backgroundOpacity: 1,

    onColor: "var(--accent-cyan)",
    offColor: "var(--border-soft)",
    offGlowEnabled: false,
    offGlowIntensity: 0.25,

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

const LIGHT_ANIMATION_STYLE = `
@keyframes lightFuturisticPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.055); }
}
@keyframes lightFuturisticFlash {
  0%, 44%, 100% { opacity: 1; }
  50%, 54% { opacity: .2; }
}
`;

const getLightDisplayMode = (p) => {
  const mode = String(p.displayMode ?? "").toLowerCase();
  if (mode === "text") return "text";
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

const LightVisual = ({ p, isOn, preview = false }) => {
  const mode = getLightDisplayMode(p);

  const onColor = p.onColor || "var(--accent-cyan)";
  const offColor = p.offColor || "var(--border-soft)";
  const stateColor = isOn ? onColor : offColor;

  const fontColor = isOn
    ? (p.onFontColor || "#FFFFFF")
    : (p.offFontColor || "#FFFFFF");

  const text = getLightStateText(p, isOn);
  const fontSize = Math.max(5, Number(p.labelFontSize ?? 8));
  const fontWeight = Number(p.labelFontWeight ?? 800);

  const glowSize = Math.max(0, Number(p.glowSize ?? 24));
  const glowIntensity = Math.max(0, Number(p.glowIntensity ?? 1));
  const offIntensity = Math.max(0, Number(p.offGlowIntensity ?? 0.25));

  const shouldGlow =
    p.glowEnabled !== false &&
    (isOn || p.offGlowEnabled === true);

  const animation = [
    p.pulseEnabled && isOn
      ? `lightFuturisticPulse ${Math.max(0.2, Number(p.pulseSpeed ?? 1.5))}s ease-in-out infinite`
      : "",
    p.flashEnabled && isOn
      ? `lightFuturisticFlash ${Math.max(0.2, Number(p.flashSpeed ?? 2))}s linear infinite`
      : "",
  ].filter(Boolean).join(", ") || "none";

  const commonTextStyle = {
    color: fontColor,
    fontSize: `${fontSize}px`,
    fontWeight,
    lineHeight: 1,
    letterSpacing: p.labelCase === "normal" ? "0.01em" : "0.06em",
    textAlign: p.labelAlign || "center",
    textShadow: isOn
      ? `0 0 7px ${onColor}, 0 1px 2px rgba(0,0,0,.9)`
      : "0 1px 2px rgba(0,0,0,.9)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  if (mode === "text") {
    return (
      <div
        className="flex items-center justify-center w-full h-full"
        style={{
          animation,
          opacity: Number(p.backgroundOpacity ?? 1),
        }}
      >
        <span style={commonTextStyle}>{text}</span>
      </div>
    );
  }

  const isPill = mode === "pill";
  const isBadge = mode === "badge";
  const isSquare = mode === "square";

  // IMPORTANT:
  // The widget itself is resizable by Page Builder through p.width/p.height.
  // Do not keep the visual locked to a small fixed lightSize, otherwise
  // the selection box grows while the actual Light stays small.
  const widgetWidth = Math.max(20, Number(p.width ?? 120));
  const widgetHeight = Math.max(20, Number(p.height ?? 60));
  const configuredSize = Math.max(20, Number(p.lightSize ?? 44));

  // For LED / Square, fill the available widget area while preserving
  // the configured light size as a minimum/reference.
  const baseSize = Math.max(
    configuredSize,
    Math.min(widgetWidth, widgetHeight)
  );

  const width = isPill
    ? Math.max(64, widgetWidth)
    : isBadge
      ? Math.max(70, widgetWidth)
      : Math.max(20, Math.min(widgetWidth, widgetHeight, baseSize));

  const height = isPill || isBadge
    ? Math.max(28, widgetHeight)
    : Math.max(20, Math.min(widgetWidth, widgetHeight, baseSize));

  const borderRadius = isPill
    ? `${Number(p.pillRadius ?? 999)}px`
    : isBadge
      ? "7px"
      : isSquare
        ? "7px"
        : "50%";

  const gradient = isOn
    ? `radial-gradient(circle at 32% 28%, #FFFFFF 0%, ${onColor} 20%, ${onColor} 62%, color-mix(in srgb, ${onColor} 55%, #000) 100%)`
    : `radial-gradient(circle at 35% 30%, ${offColor}, color-mix(in srgb, ${offColor} 62%, #000) 100%)`;

  const boxShadow = shouldGlow
    ? `0 0 ${glowSize}px rgba(0,229,255,${Math.min(1, glowIntensity * (isOn ? .9 : offIntensity))})${p.innerGlow !== false ? ", inset 0 0 10px rgba(255,255,255,.22)" : ""}`
    : p.innerGlow !== false
      ? "inset 0 2px 7px rgba(0,0,0,.6)"
      : "none";

  return (
    <div
      className="relative flex items-center justify-center"
      style={{
        width,
        height,
        borderRadius,
        background: isPill || isBadge
          ? `linear-gradient(180deg, color-mix(in srgb, ${stateColor} 25%, #0A1018), color-mix(in srgb, ${stateColor} 12%, #05090D))`
          : gradient,
        border: `${Math.max(0, Number(p.ringWidth ?? 1))}px solid ${
          p.ringEnabled !== false
            ? (p.ringColor || stateColor)
            : "transparent"
        }`,
        boxShadow,
        animation,
        opacity: Number(p.backgroundOpacity ?? 1),
        overflow: "hidden",
      }}
    >
      {p.highlightEnabled !== false && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: "12%",
            top: "8%",
            width: "38%",
            height: "22%",
            borderRadius: "50%",
            background: "rgba(255,255,255,.72)",
            filter: "blur(2px)",
            opacity: isOn ? 1 : .18,
            transform: "rotate(-25deg)",
          }}
        />
      )}

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
      <style>{LIGHT_ANIMATION_STYLE}</style>
      <div
        className="w-full h-full flex items-center justify-center"
        style={{
          width: "100%",
          height: "100%",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <LightVisual p={p} isOn={isOn} preview />
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

          <PropSection title="Data Binding">
            <PropInput
              label="Variable"
              value={p.variable ?? ""}
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
                  set("valueOn", v === "" ? "" : Number(v))
                }
              />

              <PropInput
                label="Value OFF"
                type="number"
                value={p.valueOff ?? 0}
                onChange={(v) =>
                  set("valueOff", v === "" ? "" : Number(v))
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


      <PropSection title="Display / State Text">
        <PropInput
          label="Display Mode"
          options={[
            { value: "led", label: "LED / Circle" },
            { value: "square", label: "Square" },
            { value: "pill", label: "Pill" },
            { value: "badge", label: "Badge" },
            { value: "text", label: "Text Only" },
          ]}
          value={p.displayMode ?? "led"}
          onChange={(v) => set("displayMode", v)}
        />

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

            <div className="grid grid-cols-2 gap-2">
              <PropInput
                label="Font Size"
                type="number"
                min={5}
                max={80}
                value={p.labelFontSize ?? 8}
                onChange={(v) => set("labelFontSize", v === "" ? "" : Number(v))}
              />

              <PropInput
                label="Font Weight"
                type="number"
                min={100}
                max={900}
                step={100}
                value={p.labelFontWeight ?? 800}
                onChange={(v) => set("labelFontWeight", v === "" ? "" : Number(v))}
              />
            </div>

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
      </PropSection>

      <PropSection title="Futuristic Appearance">
        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Light Size"
            type="number"
            min={20}
            max={300}
            value={p.lightSize ?? 44}
            onChange={(v) => set("lightSize", v === "" ? "" : Number(v))}
          />

          <PropInput
            label="Background Opacity"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={p.backgroundOpacity ?? 1}
            onChange={(v) => set("backgroundOpacity", v === "" ? "" : Number(v))}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Glow"
            type="checkbox"
            value={p.glowEnabled !== false}
            onChange={(v) => set("glowEnabled", v)}
          />
          <PropInput
            label="Inner Glow"
            type="checkbox"
            value={p.innerGlow !== false}
            onChange={(v) => set("innerGlow", v)}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Glow Size"
            type="number"
            min={0}
            max={120}
            value={p.glowSize ?? 24}
            onChange={(v) => set("glowSize", v === "" ? "" : Number(v))}
          />
          <PropInput
            label="Glow Intensity"
            type="number"
            min={0}
            max={2}
            step={0.05}
            value={p.glowIntensity ?? 1}
            onChange={(v) => set("glowIntensity", v === "" ? "" : Number(v))}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Pulse"
            type="checkbox"
            value={p.pulseEnabled === true}
            onChange={(v) => set("pulseEnabled", v)}
          />
          <PropInput
            label="Flash"
            type="checkbox"
            value={p.flashEnabled === true}
            onChange={(v) => set("flashEnabled", v)}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Pulse Speed"
            type="number"
            min={0.2}
            max={10}
            step={0.1}
            value={p.pulseSpeed ?? 1.5}
            onChange={(v) => set("pulseSpeed", v === "" ? "" : Number(v))}
          />
          <PropInput
            label="Flash Speed"
            type="number"
            min={0.2}
            max={10}
            step={0.1}
            value={p.flashSpeed ?? 2}
            onChange={(v) => set("flashSpeed", v === "" ? "" : Number(v))}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Highlight"
            type="checkbox"
            value={p.highlightEnabled !== false}
            onChange={(v) => set("highlightEnabled", v)}
          />
          <PropInput
            label="Outer Ring"
            type="checkbox"
            value={p.ringEnabled !== false}
            onChange={(v) => set("ringEnabled", v)}
          />
        </div>

        <PropInput
          label="Ring Color"
          type="color"
          value={p.ringColor || p.onColor || "#00E5FF"}
          onChange={(v) => set("ringColor", v)}
        />
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

  const valueOn = p.valueOn ?? 1;

  const isOn =
    runtimeValue === true ||
    Number(runtimeValue) === Number(valueOn) ||
    String(runtimeValue).toLowerCase() === "true" ||
    String(runtimeValue).toLowerCase() === "on";

  return (
    <>
      <style>{LIGHT_ANIMATION_STYLE}</style>
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
        <LightVisual p={p} isOn={isOn} />
      </div>
    </>
  );
}