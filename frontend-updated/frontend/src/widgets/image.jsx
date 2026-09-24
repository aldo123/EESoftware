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
import { useInternalVariables } from "../hooks/useInternalVariables";

// Local field wrapper used by the Image property panel.
// This widget cannot rely on LogicBuilder's private Field component.
const Field = ({ label, children }) => (
  <div className="flex flex-col gap-0.5 w-full">
    <span className="text-[9px] font-bold text-[var(--text-dim)] uppercase tracking-wider">{label}</span>
    {children}
  </div>
);

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

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"];

const stripImageExtension = (name) => {
  const value = String(name || "").trim();
  const lower = value.toLowerCase();
  const match = IMAGE_EXTENSIONS.find((ext) => lower.endsWith(ext));
  return match ? value.slice(0, -match.length) : value;
};

const normalizeImageFileKey = (name) =>
  stripImageExtension(
    String(name || "")
      .replace(/\\/g, "/")
      .split("/")
      .pop() || ""
  )
    .trim()
    .toLowerCase();

const resolveFolderImage = (images, variableValue) => {
  const list = Array.isArray(images) ? images : [];
  const requested = String(variableValue ?? "").trim();
  if (!requested || !list.length) return null;

  const requestedBase = normalizeImageFileKey(requested);
  const requestedFull = requested.toLowerCase();

  return (
    list.find((item) => {
      const fileName = String(item?.fileName || "").trim();
      const relativePath = String(item?.relativePath || "").trim();
      const nameLower = fileName.toLowerCase();
      const pathLower = relativePath.toLowerCase();
      const baseName = normalizeImageFileKey(fileName);

      return (
        nameLower === requestedFull ||
        pathLower === requestedFull ||
        baseName === requestedBase
      );
    }) || null
  );
};

const serializeFolderImage = (entry) => ({
  fileName: String(entry?.fileName || ""),
  relativePath: String(entry?.relativePath || entry?.fileName || ""),
  baseName: stripImageExtension(entry?.fileName || ""),
  src: String(entry?.src || ""),
  originalSize: Number(entry?.originalSize || 0),
  compressedSize: Number(entry?.compressedSize || 0),
  width: Number(entry?.width || 0),
  height: Number(entry?.height || 0),
});

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

    // Runtime visibility trigger
    triggerEnabled: false,
    triggerVariableName: "",
    triggerOperator: "equals", // equals | not_equals
    triggerValue: "1",
    triggerAction: "hide", // hide | show

    // Image source:
    // - static = one fixed image
    // - folder_variable = resolve file name from an Internal Variable
    //   against the persisted folderImages collection.
    sourceMode: "static",
    sourceVariableName: "",
    sourceFolder: "",
    sourcePath: "",
    folderImages: [],

    width: 240,
    height: 160,
  },
};

// ────────────────────────────────────────────────────────────────
// SHARED SURFACE
// ────────────────────────────────────────────────────────────────

function ImageSurface({ p, srcOverride, fileNameOverride }) {
  const radius = Math.max(0, Number(p.radius ?? 8));
  const borderWidth = Math.max(0, Number(p.borderWidth ?? 0));
  const opacity = Math.min(1, Math.max(0, Number(p.opacity ?? 1)));
  const rotation = Number(p.rotation ?? 0);
  const displaySrc = srcOverride !== undefined ? srcOverride : p.src;
  const displayFileName = fileNameOverride || p.fileName;

  const outerStyle = {
    position: "relative",
    width: "100%",
    height: "100%",
    borderRadius: `${radius}px`,
    border: `${borderWidth}px solid ${p.borderColor || "transparent"}`,
    overflow: "hidden",
    boxSizing: "border-box",
    transform: `rotate(${rotation}deg)`,
    background: displaySrc ? "transparent" : "rgba(255,255,255,0.04)",
  };

  if (!displaySrc) {
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
        src={displaySrc}
        alt={displayFileName || "image"}
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
  const { getValue: getInternalValue } = useInternalVariables();

  const dynamicEntry =
    p.sourceMode === "folder_variable"
      ? resolveFolderImage(
          p.folderImages,
          getInternalValue(String(p.sourceVariableName || "").trim(), "")
        )
      : null;

  const displaySrc =
    p.sourceMode === "folder_variable"
      ? dynamicEntry?.src || ""
      : p.src;

  const displayFileName =
    p.sourceMode === "folder_variable"
      ? dynamicEntry?.fileName || ""
      : p.fileName;

  return (
    <div className="relative w-full h-full overflow-visible">
      <ImageSurface
        p={p}
        srcOverride={displaySrc}
        fileNameOverride={displayFileName}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function ImagePropertyPanel({ p, set, cpNumber = "" }) {
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState("");
  const [error, setError] = useState("");
  const [folderFiles, setFolderFiles] = useState([]);
  const [folderName, setFolderName] = useState("");
  const [selectedFolderPath, setSelectedFolderPath] = useState("");

  const {
    variables: internalVariables = [],
    getValue: getInternalValue,
    loading: internalVariablesLoading = false,
  } = useInternalVariables(cpNumber || undefined);

  const imageFilesFromList = (files) =>
    Array.from(files || [])
      .filter((file) => file?.type?.startsWith("image/"))
      .sort((a, b) => {
        const pa = String(a.webkitRelativePath || a.name || "").toLowerCase();
        const pb = String(b.webkitRelativePath || b.name || "").toLowerCase();
        return pa.localeCompare(pb);
      });

  const getFolderNameFromPath = (path) => {
    const clean = String(path || "").replace(/\\/g, "/").replace(/\/$/, "");
    const parts = clean.split("/").filter(Boolean);
    return parts.length > 1 ? parts[0] : "";
  };

  const handleFile = async (file, sourceMeta = {}) => {
    if (!file) return;
    if (!file.type?.startsWith("image/")) {
      setError("File harus berupa gambar");
      return;
    }

    setBusy(true);
    setBusyText("Loading image...");
    setError("");

    try {
      const { dataUrl, width, height } = await compressImageFile(file);
      const relativePath = String(
        sourceMeta.relativePath || file.webkitRelativePath || file.name || ""
      );
      const sourceFolder = String(
        sourceMeta.folderName || getFolderNameFromPath(relativePath) || ""
      );

      set({
        src: dataUrl,
        fileName: file.name,
        originalSize: file.size,
        compressedSize: dataUrlSize(dataUrl),
        sourceMode: sourceMeta.mode === "static" ? "static" : "folder_variable",
        sourceFolder,
        sourcePath: relativePath,
        sourceWidth: width,
        sourceHeight: height,
      });

      if (sourceMeta.mode === "folder") {
        setSelectedFolderPath(relativePath);
      }
    } catch (e) {
      setError(e.message || "Gagal memproses gambar");
    } finally {
      setBusy(false);
      setBusyText("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleFolder = async (fileList) => {
    setError("");

    const images = imageFilesFromList(fileList);
    if (!images.length) {
      setFolderFiles([]);
      setFolderName("");
      setSelectedFolderPath("");
      setError("Folder tidak berisi file gambar yang didukung.");
      return;
    }

    const firstPath = String(images[0].webkitRelativePath || "");
    const detectedFolder = getFolderNameFromPath(firstPath);

    setFolderFiles(images);
    setFolderName(detectedFolder || "Selected Folder");
    setSelectedFolderPath(firstPath);

    setBusy(true);
    setBusyText(`Loading 0/${images.length} images...`);

    try {
      const storedImages = [];

      for (let i = 0; i < images.length; i += 1) {
        const file = images[i];
        const relativePath = String(file.webkitRelativePath || file.name || "");

        try {
          const { dataUrl, width, height } = await compressImageFile(file);

          storedImages.push(
            serializeFolderImage({
              fileName: file.name,
              relativePath,
              src: dataUrl,
              originalSize: file.size,
              compressedSize: dataUrlSize(dataUrl),
              width,
              height,
            })
          );
        } catch (e) {
          console.warn("[ImageWidget] Skip invalid image:", file.name, e);
        }

        setBusyText(`Loading ${i + 1}/${images.length} images...`);
      }

      if (!storedImages.length) {
        setError("Tidak ada gambar yang berhasil diproses dari folder.");
        return;
      }

      const first = storedImages[0];

      set({
        // Keep the first image as the static fallback / Builder preview.
        src: first.src,
        fileName: first.fileName,
        originalSize: first.originalSize,
        compressedSize: first.compressedSize,
        sourceMode: "folder_variable",
        sourceFolder: detectedFolder || "Selected Folder",
        sourcePath: first.relativePath,
        sourceWidth: first.width,
        sourceHeight: first.height,
        folderImages: storedImages,
      });

      setSelectedFolderPath(first.relativePath);
    } catch (e) {
      setError(e.message || "Gagal memproses folder gambar");
    } finally {
      setBusy(false);
      setBusyText("");
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  };

  const loadFolderImage = async (relativePath) => {
    const file = folderFiles.find(
      (item) =>
        String(item.webkitRelativePath || item.name) === String(relativePath)
    );
    if (!file) return;

    await handleFile(file, {
      mode: "static",
      folderName,
      relativePath: file.webkitRelativePath || file.name,
    });
  };

  const storedFolderImages = Array.isArray(p.folderImages)
    ? p.folderImages
    : [];

  const previewVariableValue =
    p.sourceMode === "folder_variable" && p.sourceVariableName
      ? getInternalValue(String(p.sourceVariableName).trim(), "")
      : "";

  const resolvedPreviewEntry =
    p.sourceMode === "folder_variable"
      ? resolveFolderImage(storedFolderImages, previewVariableValue)
      : null;

  const previewSrc =
    p.sourceMode === "folder_variable"
      ? resolvedPreviewEntry?.src || ""
      : p.src;

  const previewFileName =
    p.sourceMode === "folder_variable"
      ? resolvedPreviewEntry?.fileName || ""
      : p.fileName;

  const savedPct =
    p.originalSize && p.compressedSize
      ? Math.max(
          0,
          Math.round((1 - p.compressedSize / p.originalSize) * 100)
        )
      : null;

  const selectedTriggerVariable = String(
    p.triggerVariableName || ""
  ).trim();

  return (
    <>
      <PropSection title="Image Source">
        <div className="rounded border border-[#38BDF8]/30 bg-[#38BDF8]/5 p-2 mb-2">
          <div className="text-[9px] font-bold text-[#38BDF8] mb-1">Folder → Internal Variable File Name</div>
          <div className="text-[8px] text-[var(--text-dim)] leading-relaxed">
            Load the image folder first. The selected Internal Variable is used <b>only as the file name</b>.
            Example: <b>ProductColor = VMINI BLACK</b> → find <b>VMINI BLACK.png/jpg</b> inside the loaded folder.
          </div>
        </div>

        <Field label="Image Source Mode">
          <PropInput
            label=""
            options={[
              { value: "static", label: "Static Image" },
              { value: "folder_variable", label: "Internal Variable → File Name" },
            ]}
            value={p.sourceMode || "static"}
            onChange={(v) => {
              const nextMode = v || "static";
              set("sourceMode", nextMode);
              if (nextMode === "folder_variable") {
                // Dynamic mode resolves from the loaded folder using the IV value.
                return;
              }

              // Static mode keeps the currently selected fixed image. If there is
              // no fixed image yet but the folder already contains images, use the
              // currently selected folder entry as the static image.
              if (!p.src && storedFolderImages.length > 0) {
                const candidate =
                  storedFolderImages.find(
                    (item) => String(item?.relativePath || "") === String(selectedFolderPath || p.sourcePath || "")
                  ) || storedFolderImages[0];
                if (candidate?.src) {
                  set("src", candidate.src);
                  set("fileName", candidate.fileName || "");
                  set("originalSize", candidate.originalSize || 0);
                  set("compressedSize", candidate.compressedSize || 0);
                  set("sourcePath", candidate.relativePath || candidate.fileName || "");
                }
              }
            }}
          />
        </Field>

        {p.sourceMode === "folder_variable" && (
        <div className="rounded border border-[#38BDF8]/30 bg-[#38BDF8]/5 p-2 mb-2">
            <Field label="File Name Internal Variable">
              <select
                value={p.sourceVariableName || ""}
                onChange={(e) => {
                  set("sourceVariableName", e.target.value);
                  set("sourceMode", "folder_variable");
                }}
                disabled={internalVariablesLoading}
                className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[9px] font-mono text-[var(--text-primary)] outline-none focus:border-[#38BDF8]/60"
              >
                <option value="">
                  {internalVariablesLoading
                    ? "Loading variables..."
                    : "Select internal variable..."}
                </option>
                {internalVariables
                  .filter(
                    (v) =>
                      String(v?.data_type || "").toLowerCase() !== "system"
                  )
                  .map((v) => (
                    <option key={v.id ?? v.name} value={v.name}>
                      {v.name}
                      {v.data_type ? ` — ${v.data_type}` : ""}
                    </option>
                  ))}
              </select>
            </Field>

            <div className="text-[8px] text-[var(--text-dim)] mt-1">
              Contoh: <b>ProductColor = VMINI BLACK</b> akan mencari
              <b> VMINI BLACK.png</b>, <b>VMINI BLACK.jpg</b>, dan extension
              gambar lain dari folder yang sudah di-load.
            </div>

            <div className="mt-2 rounded border border-[#EC4899]/20 bg-[#EC4899]/5 px-2 py-1.5 text-[8px] text-[var(--text-dim)]">
              Current Variable Value:{" "}
              <b>{String(previewVariableValue ?? "") || "(empty)"}</b>
              {resolvedPreviewEntry ? (
                <>
                  {" → "}
                  <b style={{ color: "#EC4899" }}>
                    {resolvedPreviewEntry.fileName}
                  </b>
                </>
              ) : (
                previewVariableValue ? (
                  <>
                    {" → "}
                    <span style={{ color: "var(--accent-red)" }}>
                      matching image not found
                    </span>
                  </>
                ) : null
              )}
            </div>
        </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0], { mode: "static" })}
        />

        <input
          ref={folderInputRef}
          type="file"
          accept="image/*"
          multiple
          webkitdirectory="true"
          directory="true"
          className="hidden"
          onChange={(e) => handleFolder(e.target.files)}
        />

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="h-9 rounded border border-[var(--accent-green)] text-[var(--accent-green)] text-[10px] font-semibold disabled:opacity-50"
          >
            {busy ? "Loading..." : p.src ? "Replace Static Image" : "+ Load Static Image"}
          </button>

          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            disabled={busy}
            className="h-9 rounded border border-[#38BDF8] text-[#38BDF8] text-[10px] font-semibold disabled:opacity-50"
          >
            {busy ? "Loading..." : "+ Load Folder"}
          </button>
        </div>

        {busy && (
          <div className="text-[8px] text-[var(--text-dim)] mt-1">
            {busyText || "Processing images..."}
          </div>
        )}

        {error && (
          <div className="text-[9px] text-[var(--accent-red)] mt-1">
            {error}
          </div>
        )}

        {storedFolderImages.length > 0 && (
          <div className="mt-2 rounded border border-[#38BDF8]/30 bg-[#38BDF8]/5 p-2">
            <div className="text-[9px] font-bold text-[#38BDF8] mb-1">
              Loaded Image Folder:{" "}
              {p.sourceFolder || folderName || "Selected Folder"}
            </div>

            <div className="text-[8px] text-[var(--text-dim)] mb-2">
              {storedFolderImages.length} image file(s) are stored in this widget.
              In <b>Static Image</b> mode, select one file below. In <b>Internal Variable</b> mode, the variable controls <b>only the filename</b>.
            </div>

            <select
              value={selectedFolderPath || String(p.sourcePath || "")}
              onChange={(e) => loadFolderImage(e.target.value)}
              className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[9px] font-mono text-[var(--text-primary)] outline-none"
            >
              {storedFolderImages.map((file) => {
                const path = String(
                  file?.relativePath || file?.fileName || ""
                );
                return (
                  <option key={path} value={path}>
                    {path}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {previewSrc && (
          <>
            <div className="mt-2 rounded border border-[var(--border)] overflow-hidden bg-[var(--panel-canvas)]">
              <img
                src={previewSrc}
                alt="preview"
                style={{
                  width: "100%",
                  height: 90,
                  objectFit: "contain",
                  display: "block",
                }}
              />
            </div>

            <div className="text-[8px] text-[var(--text-dim)] mt-1 leading-relaxed">
              {previewFileName || "image"}
              {p.sourcePath ? (
                <>
                  <br />
                  {p.sourcePath}
                </>
              ) : null}
              {p.sourceMode !== "folder_variable" && (
                <>
                  <br />
                  {formatBytes(p.originalSize)} →{" "}
                  {formatBytes(p.compressedSize)}
                  {savedPct !== null && savedPct > 0
                    ? ` (-${savedPct}%)`
                    : ""}
                </>
              )}
            </div>
          </>
        )}

        {p.sourceMode === "folder_variable" && previewVariableValue && !previewSrc && (
          <div className="mt-2 rounded border border-[var(--accent-red)]/40 bg-[var(--accent-red)]/5 px-2 py-2 text-[8px] text-[var(--accent-red)]">
            No matching image for Internal Variable value:{" "}
            <b>{String(previewVariableValue)}</b>
          </div>
        )}

        {(p.src || storedFolderImages.length > 0) && (
          <button
            type="button"
            onClick={() => {
              set({
                src: "",
                fileName: "",
                originalSize: 0,
                compressedSize: 0,
                sourceMode: "folder_variable",
                sourceVariableName: "",
                sourceFolder: "",
                sourcePath: "",
                sourceWidth: 0,
                sourceHeight: 0,
                folderImages: [],
              });
              setFolderFiles([]);
              setFolderName("");
              setSelectedFolderPath("");
            }}
            className="mt-2 w-full h-7 rounded border border-[var(--accent-red)] text-[var(--accent-red)] text-[9px] font-semibold"
          >
            Remove Image / Folder
          </button>
        )}
      </PropSection>

      <PropSection title="Display Trigger">
        <PropInput
          label="Enable Trigger"
          type="checkbox"
          value={p.triggerEnabled === true}
          onChange={(v) =>
            set("triggerEnabled", v === true || v === "true")
          }
        />

        {p.triggerEnabled === true && (
          <>
            <Field label="Trigger Internal Variable">
              <select
                value={selectedTriggerVariable}
                onChange={(e) =>
                  set("triggerVariableName", e.target.value)
                }
                disabled={internalVariablesLoading}
                className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-[9px] font-mono outline-none focus:border-[#38BDF8]/60"
              >
                <option value="">
                  {internalVariablesLoading
                    ? "Loading variables..."
                    : "Select internal variable..."}
                </option>
                {internalVariables
                  .filter(
                    (v) =>
                      String(v?.data_type || "").toLowerCase() !== "system"
                  )
                  .map((v) => (
                    <option key={v.id ?? v.name} value={v.name}>
                      {v.name}
                      {v.data_type ? ` — ${v.data_type}` : ""}
                    </option>
                  ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <PropInput
                label="Condition"
                options={[
                  { value: "equals", label: "Equals (=)" },
                  { value: "not_equals", label: "Not Equals (≠)" },
                ]}
                value={p.triggerOperator || "equals"}
                onChange={(v) => set("triggerOperator", v)}
              />
              <PropInput
                label="Trigger Value"
                value={p.triggerValue ?? "1"}
                onChange={(v) => set("triggerValue", v)}
              />
            </div>

            <PropInput
              label="When Condition Matches"
              options={[
                { value: "hide", label: "Hide Image" },
                { value: "show", label: "Show Image" },
              ]}
              value={p.triggerAction || "hide"}
              onChange={(v) => set("triggerAction", v)}
            />

            <div className="rounded border border-[#38BDF8]/20 bg-[#38BDF8]/5 px-2 py-1.5 text-[8px] text-[var(--text-dim)]">
              Example: Internal Variable A = <b>1</b> + Action{" "}
              <b>Hide Image</b> → image hidden. A = <b>0</b> → image shown.
            </div>
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
            value={
              p.borderColor === "transparent"
                ? "#000000"
                : p.borderColor || "#000000"
            }
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
  const { getValue: getInternalValue } = useInternalVariables();

  const dynamicVariableName = String(p.sourceVariableName || "").trim();
  const dynamicVariableValue =
    p.sourceMode === "folder_variable" && dynamicVariableName
      ? getInternalValue(dynamicVariableName, "")
      : "";

  const dynamicEntry =
    p.sourceMode === "folder_variable"
      ? resolveFolderImage(p.folderImages, dynamicVariableValue)
      : null;

  const displayProps = {
    ...p,
    src: p.sourceMode === "folder_variable"
      ? dynamicEntry?.src || ""
      : p.src,
    fileName:
      p.sourceMode === "folder_variable"
        ? dynamicEntry?.fileName || ""
        : p.fileName,
  };

  const triggerEnabled = p.triggerEnabled === true;
  const triggerVariableName = String(
    p.triggerVariableName || ""
  ).trim();
  const triggerOperator = p.triggerOperator || "equals";
  const triggerValue = p.triggerValue ?? "1";
  const triggerAction = p.triggerAction || "hide";

  const actualValue =
    triggerEnabled && triggerVariableName
      ? getInternalValue(triggerVariableName, "")
      : "";

  const normalize = (value) => {
    if (value === null || value === undefined) return "";
    return String(value).trim().toLowerCase();
  };

  const conditionMatched =
    triggerEnabled && triggerVariableName
      ? triggerOperator === "not_equals"
        ? normalize(actualValue) !== normalize(triggerValue)
        : normalize(actualValue) === normalize(triggerValue)
      : false;

  const hidden =
    triggerEnabled && triggerVariableName
      ? triggerAction === "hide"
        ? conditionMatched
        : !conditionMatched
      : false;

  return (
    <div
      className="absolute"
      style={{
        left: widget.x,
        top: widget.y,
        width: p.width,
        height: p.height,
        overflow: "visible",
        display: hidden ? "none" : "block",
      }}
    >
      <ImageSurface p={displayProps} />
    </div>
  );
}
