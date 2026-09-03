// src/widgets/button.jsx

// Button widget:
// - Palette definition
// - Page Builder preview
// - Property panel
// - Dynamic CP runtime
//
// Actions:
//   write    = toggle/write one configured variable/address
//   navigate = go to another page
//   reset    = set multiple selected Internal Variables and/or TCP addresses to 0

import { useEffect, useState } from "react";
import { useInternalVariables } from "../hooks/useInternalVariables";
import { API } from "../service/api";
import {
  BUTTON_ADDRESS_TYPES,
  PropInput,
  PropSection,
  getVisual,
  DEFAULT_VISUAL,
} from "./shared";

// Automatically discover every image in src/assets/button-images.
// No individual image import is required.
const BUTTON_ASSETS = import.meta.glob(
  "../assets/button-images/*.{png,jpg,jpeg,webp,gif,svg}",
  {
    eager: true,
    query: "?url",
    import: "default",
  }
);

const getButtonAssets = () =>
  Object.entries(BUTTON_ASSETS)
    .map(([filePath, url]) => ({
      filePath,
      url,
      name: filePath.split("/").pop() || filePath,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

const BUTTON_IMAGE_CACHE = new Map();

const preloadButtonImage = (url) => {
  if (!url || typeof Image === "undefined") return Promise.resolve();

  const cached = BUTTON_IMAGE_CACHE.get(url);
  if (cached) return cached;

  const promise = new Promise((resolve) => {
    const img = new Image();
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      resolve(img);
    };

    img.onload = finish;
    img.onerror = finish;
    img.src = url;

    if (typeof img.decode === "function") {
      img.decode().then(finish).catch(() => {});
    }
  });

  BUTTON_IMAGE_CACHE.set(url, promise);
  return promise;
};

// -----------------------------------------------------------------------------
// Custom button-image fitting
//
// Many small PNG button icons contain transparent padding. For example, a
// 32x32 image may contain the actual toggle graphic only in rows 8..24.
// width/height: 100% alone cannot remove that transparent padding, so the
// visible graphic appears smaller than the Button widget.
//
// We automatically trim transparent pixels from PNG/SVG/WebP/etc. images,
// cache the result, and then stretch the trimmed image to the complete Button
// Width x Height. Opaque images are left unchanged.
// -----------------------------------------------------------------------------
const BUTTON_FITTED_IMAGE_CACHE = new Map();

const cropTransparentImage = (url) => {
  if (!url || typeof Image === "undefined") return Promise.resolve(url);

  const cached = BUTTON_FITTED_IMAGE_CACHE.get(url);
  if (cached) return cached;

  const promise = new Promise((resolve) => {
    const img = new Image();
    let finished = false;

    const done = (result) => {
      if (finished) return;
      finished = true;
      resolve(result || url);
    };

    img.onload = () => {
      try {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;

        if (!width || !height) {
          done(url);
          return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          done(url);
          return;
        }

        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const pixels = ctx.getImageData(0, 0, width, height);
        const data = pixels.data;

        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;

        // Detect visible pixels by alpha. A tiny threshold avoids treating
        // almost-invisible anti-aliasing noise as a real image boundary.
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const alpha = data[(y * width + x) * 4 + 3];

            if (alpha > 8) {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }

        // Fully transparent image or already-tight image.
        if (maxX < 0 || maxY < 0) {
          done(url);
          return;
        }

        const cropWidth = maxX - minX + 1;
        const cropHeight = maxY - minY + 1;

        if (minX === 0 && minY === 0 && cropWidth === width && cropHeight === height) {
          done(url);
          return;
        }

        const cropped = document.createElement("canvas");
        cropped.width = cropWidth;
        cropped.height = cropHeight;

        const croppedCtx = cropped.getContext("2d");
        if (!croppedCtx) {
          done(url);
          return;
        }

        croppedCtx.clearRect(0, 0, cropWidth, cropHeight);
        croppedCtx.drawImage(
          canvas,
          minX,
          minY,
          cropWidth,
          cropHeight,
          0,
          0,
          cropWidth,
          cropHeight
        );

        done(cropped.toDataURL("image/png"));
      } catch (error) {
        console.warn("[Button] Unable to auto-fit custom image:", error);
        done(url);
      }
    };

    img.onerror = () => done(url);
    img.src = url;
  });

  BUTTON_FITTED_IMAGE_CACHE.set(url, promise);
  return promise;
};

const useFittedButtonImage = (storedValue) => {
  const sourceUrl = resolveButtonAsset(storedValue);
  const [fittedUrl, setFittedUrl] = useState(sourceUrl);

  useEffect(() => {
    let cancelled = false;

    if (!sourceUrl) {
      setFittedUrl("");
      return () => {
        cancelled = true;
      };
    }

    // Show the original immediately, then replace it with the auto-cropped
    // version as soon as the cached/processed image is ready.
    setFittedUrl(sourceUrl);

    cropTransparentImage(sourceUrl).then((result) => {
      if (!cancelled && result) {
        setFittedUrl(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [sourceUrl]);

  return fittedUrl;
};

const RESET_TCP_ADDRESS_TYPES = [
  { value: "coil", label: "Coil" },
  { value: "holding_register", label: "Holding Register" },
];

const normalizeResetTargets = (targets) =>
  Array.isArray(targets)
    ? targets.filter(Boolean).map((target, index) => ({
        id:
          target.id ||
          `reset_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
        type: target.type === "tcp" ? "tcp" : "internal",
        variable: String(target.variable || ""),
        device: String(target.device || ""),
        addressType: String(target.addressType || "holding_register"),
        address: String(target.address ?? ""),
      }))
    : [];

const createResetTarget = (type = "internal") => ({
  id: `reset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  type,
  variable: "",
  device: "",
  addressType: "holding_register",
  address: "",
});

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
  String(device?.type ?? device?.Type ?? "").trim().toUpperCase();

const isTcpDevice = (device) => {
  const type = getDeviceType(device);
  return type === "TCP" || type === "TCP/IP" || type === "MODBUS_TCP";
};

const toTcpWriteValue = (addressType) =>
  String(addressType || "").toLowerCase() === "coil" ? false : 0;

const resolveButtonAsset = (storedValue) => {
  if (!storedValue) return "";
  const value = String(storedValue);

  if (
    value.startsWith("data:") ||
    value.startsWith("blob:") ||
    value.startsWith("http://") ||
    value.startsWith("https://")
  ) {
    return value;
  }

  const normalized = value.replace(/^\.?\/?assets\//, "").replace(/^\//, "");
  const assets = getButtonAssets();

  const match = assets.find((asset) => {
    const path = asset.filePath.replace(/^\.\.?\//, "");
    return (
      asset.name === value ||
      asset.name === normalized.split("/").pop() ||
      path === normalized ||
      path.endsWith(normalized)
    );
  });

  return match?.url || value;
};

// Shared button background opacity.
// Supports values 0..1 and also percentage-like values 0..100.
const getBackgroundOpacity = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  if (n > 1) return Math.max(0, Math.min(100, n)) / 100;
  return Math.max(0, Math.min(1, n));
};

const withAlpha = (color, opacity) => {
  const c = String(color || "").trim();
  const a = getBackgroundOpacity(opacity);

  // CSS variables cannot reliably be converted to rgba().
  // color-mix() works with CSS variables and normal CSS colors.
  return `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)`;
};

// ────────────────────────────────────────────────────────────────
// PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

export const buttonDef = {
  type: "button",
  label: "Button",
  icon: "◉",
  desc: "Write, reset selected values, or navigate to a page",
  defaultProps: {
    addressType: "coil",
    device: "",
    address: "",
    labelOn: "BUTTON ON",
    labelOff: "BUTTON OFF",
    showLabel: true,
    // One shared background transparency for both ON and OFF states.
    // 0 = fully transparent, 1 = fully opaque.
    backgroundOpacity: 1,
    

    // Button behavior: write | navigate | reset
    action: "write",

    // Write behavior
    buttonType: "toggle",
    writeTarget: "tcp",

    targetPage: "",

    // Reset action:
    // [
    //   { type: "internal", variable: "VarA" },
    //   { type: "tcp", device: "PLC1", addressType: "holding_register", address: "100" }
    // ]
    resetTargets: [],
    resetLabel: "RESET",

    valueOn: 1,
    valueOff: 0,

    variant: "neon",
    fontSize: 18,
    width: 180,
    height: 60,

    // Custom state images.
    // When configured, these images replace the normal ON/OFF button
    // appearance in both Builder preview and Runtime.
    onImage: "",
    offImage: "",
    imageFit: "fill",
    imageOverlay: true,

    visual: { ...DEFAULT_VISUAL },

    // Simulation System
    simulation: {
      enabled: true,
      mode: "manual",
    },

    // State preview di builder
    builderState: 0,
  },
};

// ────────────────────────────────────────────────────────────────
// PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

export function ButtonPreview({ widget }) {
  const p = widget.props || {};

  preloadButtonImage(resolveButtonAsset(p.onImage));
  preloadButtonImage(resolveButtonAsset(p.offImage));

  const currentImage = p.builderState === 1 ? p.onImage : p.offImage;
  const fittedImage = useFittedButtonImage(currentImage);

  const isReset = p.action === "reset";
  const isOn = !isReset && p.builderState === 1;
  const variant = p.variant || "neon";

  const backgroundOpacity = getBackgroundOpacity(p.backgroundOpacity ?? 1);
  const currentBg = isReset
    ? p.offBackground || "var(--bg-canvas)"
    : isOn
      ? p.onBackground || "var(--accent-cyan)"
      : p.offBackground || "var(--bg-canvas)";
  const currentBgTransparent = withAlpha(currentBg, backgroundOpacity);

  const currentBorder = isReset
    ? p.offBorder || "var(--panel-mid)"
    : isOn
      ? p.onBorder || "var(--accent-cyan)"
      : p.offBorder || "var(--panel-mid)";
  const currentBorderTransparent = withAlpha(currentBorder, backgroundOpacity);

  const currentText = isReset
    ? p.offTextColor || "var(--panel-line)"
    : isOn
      ? p.onTextColor || "#FFFFFF"
      : p.offTextColor || "var(--panel-line)";

  const currentLabel = isReset
    ? p.resetLabel || "RESET"
    : isOn
      ? p.labelOn || "ON"
      : p.labelOff || "OFF";

  const fontSize = p.fontSize || 18;

  let btnStyle = {
    background: currentBgTransparent,
    border: `${1}px solid ${currentBorderTransparent}`,
    boxShadow: isOn ? `0 0 18px ${currentBgTransparent}` : "none",
    textColor: currentText,
    showLed: variant === "neon" && !isReset,
  };

  if (variant === "neon") {
    btnStyle.background = `linear-gradient(135deg, color-mix(in srgb, var(--panel-canvas) ${Math.round((1 - backgroundOpacity) * 100)}%, transparent), ${currentBgTransparent})`;
    btnStyle.boxShadow = isOn ? `0 0 18px ${currentBgTransparent}` : "none";
  }

  return (
    <div className="w-full h-full relative">
      <div
        className="w-full h-full rounded-xl flex flex-col items-center justify-center relative overflow-hidden transition-all duration-300"
        style={{
          background: btnStyle.background,
          border: btnStyle.border,
          boxShadow: btnStyle.boxShadow,
          borderRadius: 12,
        }}
      >
        {fittedImage && p.imageOverlay !== false ? (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: "rgba(0,0,0,0.12)", zIndex: 2 }}
          />
        ) : null}

        {fittedImage ? (
          <img
            src={fittedImage}
            alt=""
            draggable={false}
            className="absolute pointer-events-none select-none block"
            style={{
              left: 0,
              top: 0,
              width: "100%",
              height: "100%",
              minWidth: "100%",
              minHeight: "100%",
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: p.imageFit || "fill",
              objectPosition: "center center",
              display: "block",
              margin: 0,
              padding: 0,
              flexShrink: 0,
              zIndex: 1,
            }}
          />
        ) : null}

        {btnStyle.showLed && !(isOn ? p.onImage : p.offImage) && (
          <div
            className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full transition-all duration-300"
            style={{
              background: isOn ? currentBgTransparent : "var(--bg-canvas)",
              boxShadow: isOn ? `0 0 8px ${currentBgTransparent}` : "none",
            }}
          />
        )}

        {p.showLabel !== false && (
          <span
            className="font-bold uppercase tracking-widest"
            style={{
              color: btnStyle.textColor,
              fontSize,
              textShadow: isOn
                ? `0 0 12px ${currentBgTransparent}`
                : "none",
            }}
          >
            {currentLabel}
          </span>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function ButtonPropertyPanel({
  p,
  set,
  availableDevices = [],
  availablePages = [],
}) {
  const isOn = p.builderState === 1;
  const action = p.action || "write";

  // The shared hook is also used here so the reset target dropdown always
  // follows the Internal Variable database.
  const {
    variables: internalVariables = [],
    loading: internalVariablesLoading = false,
  } = useInternalVariables();

  const resetTargets = normalizeResetTargets(p.resetTargets);

  const setResetTargets = (nextTargets) => {
    set(
      "resetTargets",
      nextTargets.map(({ id, ...target }) => ({
        ...target,
        id,
      }))
    );
  };

  const updateResetTarget = (index, patch) => {
    const next = resetTargets.map((target, i) =>
      i === index ? { ...target, ...patch } : target
    );
    setResetTargets(next);
  };

  const addResetTarget = (type = "internal") => {
    setResetTargets([...resetTargets, createResetTarget(type)]);
  };

  const removeResetTarget = (index) => {
    setResetTargets(resetTargets.filter((_, i) => i !== index));
  };

  const tcpDevices = (Array.isArray(availableDevices) ? availableDevices : []).filter(
    isTcpDevice
  );

  return (
    <>
      <PropSection title="Button Action">
        <PropInput
          label="Action"
          options={[
            { value: "write", label: "Write" },
            { value: "navigate", label: "Go to Page" },
            { value: "reset", label: "Reset" },
          ]}
          value={action}
          onChange={(v) => set("action", v)}
        />

        {action === "write" && (
          <>
            <PropInput
              label="Button Type"
              options={[
                { value: "toggle", label: "Toggle ON/OFF" },
                { value: "momentary", label: "Momentary" },
              ]}
              value={p.buttonType || "toggle"}
              onChange={(v) => set("buttonType", v)}
            />

            <PropInput
              label="Write Target"
              options={[
                { value: "tcp", label: "TCP / PLC" },
                { value: "internal", label: "Internal Variable" },
              ]}
              value={p.writeTarget || "tcp"}
              onChange={(v) => {
                set("writeTarget", v);
                if (v === "internal") {
                  // Clear PLC-only fields so Internal mode cannot
                  // accidentally retain the previous PLC binding.
                  set("device", "");
                  set("address", "");
                }
              }}
            />

            {p.writeTarget === "internal" ? (
              <>
                <PropInput
                  label="Internal Variable"
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

                <div className="text-[8px] text-[var(--text-dim)] mt-1">
                  Writes directly to the selected Internal Variable.
                </div>
              </>
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
                        onChange={(e) => set("device", e.target.value)}
                        className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none focus:border-[var(--accent-green)]"
                      >
                        <option value="">Select device...</option>
                        {tcpDevices.map((dev) => {
                          const name = getDeviceName(dev);
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
                    options={BUTTON_ADDRESS_TYPES}
                    value={p.addressType || "coil"}
                    onChange={(v) => set("addressType", v)}
                  />
                </PropSection>

                
              </>
            )}
          </>
        )}

        {action === "navigate" && (
          <PropInput
            label="Target Page"
            options={[
              { value: "", label: "Select page..." },
              ...availablePages.map((page) => ({
                value: page.id,
                label: page.name || page.id,
              })),
            ]}
            value={p.targetPage ?? ""}
            onChange={(v) => set("targetPage", v)}
          />
        )}
      </PropSection>

      {action === "reset" && (
        <PropSection title="Reset Targets">
          <div className="text-[8px] text-[var(--text-dim)] mb-2">
            Every selected target is written with value <b>0</b> when the
            button is pressed.
          </div>

          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => addResetTarget("internal")}
              className="flex-1 h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[9px] font-bold text-[var(--text-primary)] hover:border-[var(--accent-green)]"
            >
              + Internal Variable
            </button>

            <button
              type="button"
              onClick={() => addResetTarget("tcp")}
              className="flex-1 h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[9px] font-bold text-[var(--text-primary)] hover:border-[var(--accent-cyan)]"
            >
              + TCP Address
            </button>
          </div>

          {resetTargets.length === 0 && (
            <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-center text-[9px] text-[var(--text-dim)]">
              No reset target configured.
            </div>
          )}

          <div className="space-y-2">
            {resetTargets.map((target, index) => (
              <div
                key={target.id || index}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-2"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[8px] font-bold text-[var(--text-dim)]">
                    TARGET {index + 1}
                  </span>

                  <select
                    value={target.type}
                    onChange={(e) =>
                      updateResetTarget(index, {
                        type: e.target.value,
                        variable: "",
                        device: "",
                        addressType: "holding_register",
                        address: "",
                      })
                    }
                    className="flex-1 h-7 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[9px] text-[var(--text-primary)]"
                  >
                    <option value="internal">Internal Variable</option>
                    <option value="tcp">TCP Address</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => removeResetTarget(index)}
                    className="w-7 h-7 rounded border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent-red)]"
                    title="Remove target"
                  >
                    ×
                  </button>
                </div>

                {target.type === "internal" ? (
                  <select
                    value={target.variable || ""}
                    onChange={(e) =>
                      updateResetTarget(index, { variable: e.target.value })
                    }
                    disabled={
                      internalVariablesLoading && internalVariables.length === 0
                    }
                    className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[9px] font-mono text-[var(--text-primary)]"
                  >
                    <option value="">
                      {internalVariablesLoading
                        ? "Loading variables..."
                        : "Select internal variable..."}
                    </option>
                    {internalVariables.map((variable) => (
                      <option
                        key={String(variable.id ?? variable.name)}
                        value={variable.name}
                      >
                        {variable.name}
                        {variable.data_type
                          ? ` — ${variable.data_type}`
                          : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={target.device || ""}
                      onChange={(e) =>
                        updateResetTarget(index, { device: e.target.value })
                      }
                      className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[9px] font-mono text-[var(--text-primary)]"
                    >
                      <option value="">Select TCP device...</option>
                      {tcpDevices.map((dev) => {
                        const name = getDeviceName(dev);
                        return (
                          <option key={name} value={name}>
                            {name}
                            {dev.connection ? ` — ${dev.connection}` : ""}
                          </option>
                        );
                      })}
                    </select>

                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={target.addressType || "holding_register"}
                        onChange={(e) =>
                          updateResetTarget(index, {
                            addressType: e.target.value,
                          })
                        }
                        className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[9px] font-mono text-[var(--text-primary)]"
                      >
                        {RESET_TCP_ADDRESS_TYPES.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>

                      <input
                        value={target.address || ""}
                        onChange={(e) =>
                          updateResetTarget(index, { address: e.target.value })
                        }
                        placeholder="Address e.g. 100"
                        className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[9px] font-mono text-[var(--text-primary)] outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <PropInput
            label="Reset Label"
            value={p.resetLabel ?? "RESET"}
            onChange={(v) => set("resetLabel", v)}
          />

          <div className="mt-1 text-[8px] text-[var(--text-dim)]">
            TCP reset supports Coil and Holding Register. Read-only address
            types are not allowed.
          </div>
        </PropSection>
      )}

      <PropSection title="Simulation State">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => set("builderState", 1)}
            className="h-8 rounded-lg border text-[9px] font-bold transition-all"
            style={{
              background:
                action === "reset"
                  ? "var(--bg-canvas)"
                  : isOn
                    ? "var(--accent-cyan)"
                    : "var(--bg-canvas)",
              borderColor:
                action === "reset"
                  ? "var(--border)"
                  : isOn
                    ? "var(--accent-cyan)"
                    : "var(--border)",
              color:
                action === "reset"
                  ? "var(--text-dim)"
                  : isOn
                    ? "var(--panel-canvas)"
                    : "var(--text-dim)",
              boxShadow:
                action === "reset" || !isOn
                  ? "none"
                  : "0 0 12px rgba(0,191,255,0.25)",
            }}
            disabled={action === "reset"}
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
              borderColor: !isOn ? "var(--text-dim)" : "var(--border)",
              color: !isOn ? "#FFFFFF" : "var(--text-dim)",
            }}
          >
            ○ OFF
          </button>
        </div>

        <div className="text-[8px] text-[var(--text-dim)] mt-1">
          Builder preview only. Runtime value comes from the bound
          variable/device. Reset does not toggle a state.
        </div>
      </PropSection>

      <PropSection title="Button">
        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Label ON"
            value={p.labelOn ?? "BUTTON ON"}
            onChange={(v) => set("labelOn", v)}
          />

          <PropInput
            label="Label OFF"
            value={p.labelOff ?? "BUTTON OFF"}
            onChange={(v) => set("labelOff", v)}
          />
        </div>

        <PropInput
          label="Show Label"
          type="checkbox"
          value={p.showLabel !== false}
          onChange={(v) => set("showLabel", v === true || v === "true")}
        />

        <PropInput
          label="Variant"
          options={[
            { value: "neon", label: "Neon" },
            { value: "solid", label: "Solid" },
          ]}
          value={p.variant || "neon"}
          onChange={(v) => set("variant", v)}
        />

        <PropInput
          label="Background Transparency"
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(getBackgroundOpacity(p.backgroundOpacity ?? 1) * 100)}
          onChange={(v) => set("backgroundOpacity", v === "" ? "" : Number(v) / 100)}
        />
        <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
          Shared for ON/OFF background and border. 0% = fully transparent, 100% = fully opaque.
        </div>

        <PropInput
          label="Font Size"
          type="number"
          min={8}
          max={48}
          value={p.fontSize ?? 18}
          onChange={(v) => set("fontSize", v === "" ? "" : Number(v))}
        />
      </PropSection>

      <PropSection title="Custom State Images">
        <div className="text-[8px] text-[var(--text-dim)] mb-2">
          Images are loaded automatically from <b>src/assets/button-images</b>.
          No individual import is required.
        </div>

        {(() => {
          const assets = getButtonAssets();

          assets.forEach((asset) => preloadButtonImage(asset.url));

          return (
            <div className="space-y-3">
              {[
                { key: "onImage", label: "ON Image", accent: "var(--accent-green)" },
                { key: "offImage", label: "OFF Image", accent: "var(--border)" },
              ].map(({ key, label, accent }) => {
                const selected = String(p[key] || "");
                const selectedName = selected.split("/").pop() || "";
                const selectedUrl = resolveButtonAsset(selected);

                return (
                  <div
                    key={key}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-2"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[9px] font-bold text-[var(--text-primary)]">
                        {label}
                      </div>
                      {selected && (
                        <button
                          type="button"
                          onClick={() => set(key, "")}
                          className="px-2 py-1 rounded border border-[var(--accent-red)] text-[8px] text-[var(--accent-red)]"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    <select
                      value={selectedName}
                      onChange={(e) =>
                        set(
                          key,
                          e.target.value
                            ? `button-images/${e.target.value}`
                            : ""
                        )
                      }
                      className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[9px] font-mono text-[var(--text-primary)] outline-none"
                    >
                      <option value="">
                        {assets.length ? "No custom image" : "No images found"}
                      </option>
                      {assets.map((asset) => (
                        <option key={asset.filePath} value={asset.name}>
                          {asset.name}
                        </option>
                      ))}
                    </select>

                    {selected && selectedUrl && (
                      <div className="mt-2 flex items-center gap-2">
                        <img
                          src={selectedUrl}
                          alt={`${label} preview`}
                          className="w-20 h-12 rounded border object-cover bg-[var(--bg-canvas)]"
                          style={{ borderColor: accent }}
                        />
                        <div className="min-w-0 text-[8px] text-[var(--text-dim)] truncate">
                          {selected}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <PropInput
                label="Image Fit"
                options={[
                  { value: "fill", label: "Fit Button Exactly" },
                  { value: "cover", label: "Cover" },
                  { value: "contain", label: "Contain" },
                  { value: "none", label: "Original Size" },
                ]}
                value={p.imageFit ?? "fill"}
                onChange={(v) => set("imageFit", v)}
              />
              <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
                Fit Button Exactly automatically removes transparent image margins and then fits the visible image to the full Button Width × Height.
              </div>

              <PropInput
                label="Text Overlay"
                options={[
                  { value: true, label: "On" },
                  { value: false, label: "Off" },
                ]}
                value={p.imageOverlay !== false}
                onChange={(v) => set("imageOverlay", v === true || v === "true")}
              />
            </div>
          );
        })()}
      </PropSection>

      <PropSection title="ON State Appearance">
        <PropInput
          label="Background"
          type="color"
          value={p.onBackground || "var(--accent-cyan)"}
          onChange={(v) => set("onBackground", v)}
        />

        <PropInput
          label="Border"
          type="color"
          value={p.onBorder || "var(--accent-cyan)"}
          onChange={(v) => set("onBorder", v)}
        />

        <PropInput
          label="Text"
          type="color"
          value={p.onTextColor || "#FFFFFF"}
          onChange={(v) => set("onTextColor", v)}
        />
      </PropSection>

      <PropSection title="OFF State Appearance">
        <PropInput
          label="Background"
          type="color"
          value={p.offBackground || "var(--bg-canvas)"}
          onChange={(v) => set("offBackground", v)}
        />

        <PropInput
          label="Border"
          type="color"
          value={p.offBorder || "var(--panel-mid)"}
          onChange={(v) => set("offBorder", v)}
        />

        <PropInput
          label="Text"
          type="color"
          value={p.offTextColor || "var(--panel-line)"}
          onChange={(v) => set("offTextColor", v)}
        />
      </PropSection>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// DYNAMIC CP PAGE — RUNTIME
// ────────────────────────────────────────────────────────────────

export function RuntimeButton({ widget, value, onChange, onNavigate }) {
  const p = widget.props || {};
  const v = getVisual(p);

  preloadButtonImage(resolveButtonAsset(p.onImage));
  preloadButtonImage(resolveButtonAsset(p.offImage));
  const variant = p.variant || "neon";
  const action = p.action || "write";
  const buttonType =
    p.buttonType === "momentary" ? "momentary" : "toggle";
  const writeTarget =
    p.writeTarget === "internal" ? "internal" : "tcp";

  const {
    getValue: getInternalValue,
    setValue: setInternalValue,
  } = useInternalVariables();

  const internalVariableName = String(p.variable || "").trim();

  const runtimeValue =
    writeTarget === "internal"
      ? getInternalValue(internalVariableName, 0)
      : value;

  const isReset = action === "reset";
  const isOn =
    !isReset &&
    (
      runtimeValue === true ||
      Number(runtimeValue) === 1 ||
      String(runtimeValue).toLowerCase() === "true" ||
      String(runtimeValue).toLowerCase() === "on"
    );

  const activeImage = isOn ? p.onImage : p.offImage;
  const fittedImage = useFittedButtonImage(activeImage);

  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState("");

  const resetTargets = normalizeResetTargets(p.resetTargets);

  const writeTcpZero = async (target) => {
    const device = String(target.device || "").trim();
    const addressType = String(target.addressType || "").trim();
    const address = Number(target.address);

    if (!device) {
      throw new Error("TCP reset target has no device.");
    }

    if (addressType !== "coil" && addressType !== "holding_register") {
      throw new Error(
        `TCP reset target ${device}/${target.address} uses a read-only address type.`
      );
    }

    if (!Number.isInteger(address) || address < 0 || address > 65535) {
      throw new Error(
        `Invalid TCP reset address '${target.address}' for ${device}.`
      );
    }

    const response = await fetch(`${API}/api/tcp/write`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        device_name: device,
        address_type: addressType,
        address,
        value: toTcpWriteValue(addressType),
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data?.success === false) {
      throw new Error(
        data?.message ||
          `TCP reset failed: ${device} ${addressType} ${address} (HTTP ${response.status})`
      );
    }

    const normalizedValue =
      addressType === "coil" ? false : 0;

    // Keep the rest of the runtime in sync immediately.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("plc-value", {
          detail: {
            device,
            addressType,
            address,
            value: normalizedValue,
            widgetIds: [],
            write: true,
            reset: true,
          },
        })
      );
    }

    return data;
  };

  const handleReset = async () => {
    if (resetting) return;

    setResetMessage("");

    if (!resetTargets.length) {
      setResetMessage("No reset target configured.");
      return;
    }

    setResetting(true);

    const errors = [];
    let successCount = 0;

    try {
      // Execute all configured reset targets. They are independent, so one
      // failed target does not prevent the remaining targets from resetting.
      for (const target of resetTargets) {
        try {
          if (target.type === "internal") {
            const variableName = String(target.variable || "").trim();

            if (!variableName) {
              throw new Error("Internal reset target has no variable.");
            }

            await setInternalValue(variableName, 0);
          } else if (target.type === "tcp") {
            await writeTcpZero(target);
          } else {
            throw new Error(`Unsupported reset target type '${target.type}'.`);
          }

          successCount += 1;
        } catch (error) {
          errors.push(error?.message || String(error));
        }
      }

      if (errors.length) {
        setResetMessage(
          `${successCount}/${resetTargets.length} reset. ${errors.join(" | ")}`
        );
      } else {
        setResetMessage(`${successCount} target(s) reset to 0.`);
      }
    } finally {
      setResetting(false);

      // Clear the short status message after a few seconds.
      window.setTimeout(() => {
        setResetMessage("");
      }, 3500);
    }
  };

  const writeInternalValue = async (nextValue) => {
    const variableName = String(p.variable || "").trim();

    if (!variableName) {
      console.error(
        "[Button] No Internal Variable selected."
      );
      return;
    }

    try {
      await setInternalValue(variableName, nextValue);
    } catch (error) {
      console.error(
        "[Button] Internal Variable write failed:",
        error
      );
    }
  };

  const writeValue = async (nextValue) => {
    if (writeTarget === "internal") {
      await writeInternalValue(nextValue);
    } else {
      onChange?.(nextValue);
    }
  };

  const handleToggle = async () => {
    if (action === "navigate") {
      const targetPage = String(p.targetPage || "").trim();
      if (targetPage) onNavigate?.(targetPage);
      return;
    }

    if (action === "reset") {
      await handleReset();
      return;
    }

    if (buttonType !== "toggle") return;

    const nextValue = isOn
      ? (p.valueOff ?? 0)
      : (p.valueOn ?? 1);

    await writeValue(nextValue);
  };

  const handleMomentaryDown = async () => {
    if (action !== "write" || buttonType !== "momentary") {
      return;
    }

    await writeValue(p.valueOn ?? 1);
  };

  const handleMomentaryUp = async () => {
    if (action !== "write" || buttonType !== "momentary") {
      return;
    }

    await writeValue(p.valueOff ?? 0);
  };

  const backgroundOpacity = getBackgroundOpacity(p.backgroundOpacity ?? 1);
  const onBg = p.onBackground || v.accentColor || "var(--accent-cyan)";
  const offBg = p.offBackground || v.backgroundColor || "var(--bg-canvas)";
  const onBgTransparent = withAlpha(onBg, backgroundOpacity);
  const offBgTransparent = withAlpha(offBg, backgroundOpacity);
  const onBorder = p.onBorder || v.accentColor || "var(--accent-cyan)";
  const offBorder = p.offBorder || v.borderColor || "var(--panel-mid)";
  const onBorderTransparent = withAlpha(onBorder, backgroundOpacity);
  const offBorderTransparent = withAlpha(offBorder, backgroundOpacity);
  const onText = p.onTextColor || v.textColor || "#FFFFFF";
  const offText = p.offTextColor || v.secondaryTextColor || "var(--panel-line)";

  const label =
    action === "reset"
      ? p.resetLabel || "RESET"
      : isOn
        ? p.labelOn || "ON"
        : p.labelOff || "OFF";

  const fontSize = p.fontSize || 18;

  let btnStyle = {
    background: isOn ? onBgTransparent : offBgTransparent,
    border: `${v.borderWidth || 1}px solid ${
      isOn ? onBorderTransparent : offBorderTransparent
    }`,
    boxShadow: isOn
      ? `0 0 ${v.glowIntensity || 18}px ${onBgTransparent}`
      : "none",
    textColor: isOn ? onText : offText,
    showLed: variant === "neon" && action !== "reset",
  };

  if (variant === "neon") {
    btnStyle.background = `linear-gradient(135deg, ${
      v.backgroundColor || "var(--panel-canvas)"
    }, ${isOn ? onBgTransparent : offBgTransparent})`;
  }

  return (
    <div
      className="absolute"
      style={{
        left: widget.x,
        top: widget.y,
        width: p.width,
        height: p.height,
      }}
    >
      <button
        onClick={
          action === "write" && buttonType === "momentary"
            ? undefined
            : handleToggle
        }
        onPointerDown={handleMomentaryDown}
        onPointerUp={handleMomentaryUp}
        onPointerCancel={handleMomentaryUp}
        onPointerLeave={handleMomentaryUp}
        disabled={resetting}
        className="w-full h-full rounded-xl flex flex-col items-center justify-center relative overflow-hidden transition-all duration-300 active:scale-[0.97] disabled:opacity-70"
        style={{
          background: btnStyle.background,
          border: btnStyle.border,
          boxShadow: btnStyle.boxShadow,
          borderRadius: v.borderRadius ?? 12,
          userSelect: "none",
          touchAction: "none",
        }}
      >
        {fittedImage && p.imageOverlay !== false ? (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "rgba(0,0,0,0.12)",
              zIndex: 2,
            }}
          />
        ) : null}

        {fittedImage ? (
          <img
            src={fittedImage}
            alt=""
            draggable={false}
            className="absolute pointer-events-none select-none block"
            style={{
              left: 0,
              top: 0,
              width: "100%",
              height: "100%",
              minWidth: "100%",
              minHeight: "100%",
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: p.imageFit || "fill",
              objectPosition: "center center",
              display: "block",
              margin: 0,
              padding: 0,
              flexShrink: 0,
              zIndex: 1,
            }}
          />
        ) : null}

        {btnStyle.showLed && !(isOn ? p.onImage : p.offImage) && (
          <div
            className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full transition-all duration-300"
            style={{
              background: isOn ? onBgTransparent : offBgTransparent,
              boxShadow: isOn
                ? `0 0 8px ${onBgTransparent}`
                : "none",
            }}
          />
        )}

        {p.showLabel !== false && (
          <span
            className="font-bold uppercase tracking-widest"
            style={{
              color: btnStyle.textColor,
              fontSize,
              textShadow: isOn
                ? `0 0 12px ${onBgTransparent}`
                : "none",
            }}
          >
            {resetting ? "RESETTING..." : label}
          </span>
        )}

        {isReset && resetMessage && (
          <span
            className="absolute left-2 right-2 bottom-1 truncate text-center"
            style={{
              color: resetMessage.startsWith("0/")
                ? "var(--accent-red)"
                : "var(--text-dim)",
              fontSize: 8,
              lineHeight: "10px",
            }}
            title={resetMessage}
          >
            {resetMessage}
          </span>
        )}
      </button>
    </div>
  );
}