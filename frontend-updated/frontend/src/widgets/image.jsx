// src/widgets/image.jsx
//
// Image widget — upload a picture, auto-compressed client-side before
// it's stored in the page layout (so page_configs/*.json doesn't blow
// up with full-resolution photos).
//
// - imageDef            palette entry
// - ImagePreview        Page Builder canvas preview
// - ImagePropertyPanel  property panel (upload + fit/appearance controls)
// - RuntimeImage        Dynamic CP Page runtime

import React, { useRef, useState } from "react";
import { PropInput, PropSection } from "./shared";

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.72;

const formatBytes = (bytes) => {
  if (!bytes) return "0 KB";
  const kb = bytes / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb.toFixed(0)} KB`;
};

// Downscales to MAX_DIMENSION and re-encodes as JPEG (or PNG if the
// source is a PNG, to preserve transparency) via an offscreen canvas.
function compressImageFile(file, { maxDim = MAX_DIMENSION, quality = JPEG_QUALITY } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal membaca file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Gagal memuat gambar"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const keepPng = file.type === "image/png";
        const mime = keepPng ? "image/png" : "image/jpeg";
        const dataUrl = canvas.toDataURL(mime, keepPng ? undefined : quality);
        resolve({ dataUrl, width, height });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const dataUrlSize = (dataUrl) => {
  if (!dataUrl) return 0;
  const base64 = dataUrl.split(",")[1] || "";
  return Math.round((base64.length * 3) / 4);
};

// ────────────────────────────────────────────────────────────────
// PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

export const imageDef = {
  type: "image",
  label: "Image",
  icon: "🖼",
  desc: "Upload gambar (auto-compress)",

  defaultProps: {
    src: "",
    fileName: "",
    originalSize: 0,
    compressedSize: 0,

    fit: "cover", // cover | contain | fill
    radius: 8,
    borderColor: "transparent",
    borderWidth: 0,
    opacity: 1,
    rotation: 0,

    width: 240,
    height: 160,
  },
};

// ────────────────────────────────────────────────────────────────
// SHARED SURFACE
// ────────────────────────────────────────────────────────────────

function ImageSurface({ p }) {
  const radius = Math.max(0, Number(p.radius ?? 8));
  const borderWidth = Math.max(0, Number(p.borderWidth ?? 0));
  const opacity = Math.min(1, Math.max(0, Number(p.opacity ?? 1)));
  const rotation = Number(p.rotation ?? 0);

  const outerStyle = {
    position: "relative",
    width: "100%",
    height: "100%",
    borderRadius: `${radius}px`,
    border: `${borderWidth}px solid ${p.borderColor || "transparent"}`,
    overflow: "hidden",
    boxSizing: "border-box",
    transform: `rotate(${rotation}deg)`,
    background: p.src ? "transparent" : "rgba(255,255,255,0.04)",
  };

  if (!p.src) {
    return (
      <div style={outerStyle}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            color: "var(--text-dim, #6b7280)",
            border: "1px dashed rgba(255,255,255,0.15)",
            borderRadius: `${radius}px`,
          }}
        >
          <span style={{ fontSize: 22 }}>🖼</span>
          <span style={{ fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            No Image
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={outerStyle}>
      <img
        src={p.src}
        alt={p.fileName || "image"}
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: p.fit || "cover",
          opacity,
          display: "block",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

export function ImagePreview({ widget }) {
  const p = widget.props || {};
  return (
    <div className="relative w-full h-full overflow-visible">
      <ImageSurface p={p} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function ImagePropertyPanel({ p, set }) {
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleFile = async (file) => {
    console.log('[ImageWidget] handleFile called', file);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("File harus berupa gambar");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const { dataUrl } = await compressImageFile(file);
      set({
        src: dataUrl,
        fileName: file.name,
        originalSize: file.size,
        compressedSize: dataUrlSize(dataUrl),
      });
    } catch (e) {
      setError(e.message || "Gagal memproses gambar");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const savedPct =
    p.originalSize && p.compressedSize
      ? Math.max(0, Math.round((1 - p.compressedSize / p.originalSize) * 100))
      : null;

  return (
    <>
      <PropSection title="Image">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="w-full h-9 rounded border border-[var(--accent-green)] text-[var(--accent-green)] text-[10px] font-semibold disabled:opacity-50"
        >
          {busy ? "Compressing..." : p.src ? "Replace Image" : "+ Upload Image"}
        </button>

        {error && (
          <div className="text-[9px] text-[var(--accent-red)] mt-1">{error}</div>
        )}

        {p.src && (
          <>
            <div className="mt-2 rounded border border-[var(--border)] overflow-hidden bg-[var(--panel-canvas)]">
              <img
                src={p.src}
                alt="preview"
                style={{ width: "100%", height: 90, objectFit: "contain", display: "block" }}
              />
            </div>

            <div className="text-[8px] text-[var(--text-dim)] mt-1 leading-relaxed">
              {p.fileName || "image"}
              <br />
              {formatBytes(p.originalSize)} → {formatBytes(p.compressedSize)}
              {savedPct !== null && savedPct > 0 ? ` (-${savedPct}%)` : ""}
            </div>

            <button
              type="button"
              onClick={() => {
                set({ src: "", fileName: "", originalSize: 0, compressedSize: 0 });
              }}
              className="mt-2 w-full h-7 rounded border border-[var(--accent-red)] text-[var(--accent-red)] text-[9px] font-semibold"
            >
              Remove Image
            </button>
          </>
        )}
      </PropSection>

      <PropSection title="Appearance">
        <PropInput
          label="Fit"
          options={[
            { value: "cover", label: "Cover (crop to fill)" },
            { value: "contain", label: "Contain (fit inside)" },
            { value: "fill", label: "Fill (stretch)" },
          ]}
          value={p.fit || "cover"}
          onChange={(v) => set("fit", v)}
        />

        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Radius"
            type="number"
            min={0}
            max={100}
            value={p.radius ?? 8}
            onChange={(v) => set("radius", Number(v))}
          />
          <PropInput
            label="Opacity"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={p.opacity ?? 1}
            onChange={(v) => set("opacity", Number(v))}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Border Width"
            type="number"
            min={0}
            max={20}
            value={p.borderWidth ?? 0}
            onChange={(v) => set("borderWidth", Number(v))}
          />
          <PropInput
            label="Border Color"
            type="color"
            value={p.borderColor === "transparent" ? "#000000" : (p.borderColor || "#000000")}
            onChange={(v) => set("borderColor", v)}
          />
        </div>

        <PropInput
          label="Rotation"
          type="number"
          min={-360}
          max={360}
          value={p.rotation ?? 0}
          onChange={(v) => set("rotation", Number(v))}
        />
      </PropSection>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// DYNAMIC CP PAGE — RUNTIME
// ────────────────────────────────────────────────────────────────

export function RuntimeImage({ widget }) {
  const p = widget.props || {};
  return (
    <div
      className="absolute"
      style={{
        left: widget.x,
        top: widget.y,
        width: p.width,
        height: p.height,
        overflow: "visible",
      }}
    >
      <ImageSurface p={p} />
    </div>
  );
}
