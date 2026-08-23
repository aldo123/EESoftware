// src/widgets/camerafeed.jsx
//
// Live camera view widget, backed by the backend's vision engine
// (backend/vision/) — starts the named camera on the backend (idempotent,
// safe to call every time the page mounts) and shows its MJPEG stream.
//
//   - cameraFeedDef            palette entry
//   - CameraFeedPreview        static placeholder shown on the Page Builder canvas
//   - CameraFeedPropertyPanel  camera source config
//   - RuntimeCameraFeed        live stream on the Dynamic CP Page
//
import { useEffect, useRef, useState } from "react";
import { API } from "../service/api";
import { PropInput, PropSection, DEFAULT_VISUAL } from "./shared";

// ────────────────────────────────────────────────────────────────
//  PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

export const cameraFeedDef = {
  type: "camerafeed",
  label: "Camera Feed",
  icon: "📷",
  desc: "Live camera view (vision engine)",
  defaultProps: {
    cameraId: "",
    sourceType: "webcam",
    deviceIndex: "0",
    ipAddress: "",
    autoStart: true,
    borderColor: "var(--panel-mid)",
    borderWidth: 1,
    radius: 8,
    width: 480,
    height: 360,
    visual: { ...DEFAULT_VISUAL },
  },
};

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — CANVAS PREVIEW (static, no real camera connection)
// ────────────────────────────────────────────────────────────────

export function CameraFeedPreview({ widget }) {
  const p = widget.props || {};
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-1"
      style={{
        background: "var(--panel-canvas)",
        border: `${Math.max(0, Number(p.borderWidth ?? 1))}px solid ${p.borderColor || "var(--panel-mid)"}`,
        borderRadius: `${Math.max(0, Number(p.radius ?? 8))}px`,
        boxSizing: "border-box",
      }}
    >
      <span className="text-3xl opacity-40">📷</span>
      <span className="text-[10px] text-[var(--text-muted)]">{p.cameraId || "Camera Feed"}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function CameraFeedPropertyPanel({ p, set }) {
  const sourceType = p.sourceType || "webcam";
  return (
    <>
      <PropSection title="Camera Source">
        <PropInput label="Camera ID" value={p.cameraId || ""} onChange={v => set("cameraId", v)} />
        <PropInput
          label="Source Type"
          options={[
            { value: "webcam", label: "Local Webcam" },
            { value: "gige", label: "GigE / RTSP" },
          ]}
          value={sourceType}
          onChange={v => set("sourceType", v)}
        />
        {sourceType === "webcam" && (
          <PropInput label="Device Index" type="number" min={0} value={p.deviceIndex ?? "0"} onChange={v => set("deviceIndex", v)} />
        )}
        {sourceType === "gige" && (
          <PropInput label="IP Address" value={p.ipAddress || ""} onChange={v => set("ipAddress", v)} />
        )}
        <PropInput label="Auto-start on page load" type="checkbox" value={p.autoStart !== false} onChange={v => set("autoStart", v)} />
      </PropSection>

      <PropSection title="Appearance">
        <PropInput label="Border" type="color" value={p.borderColor || "var(--panel-mid)"} onChange={v => set("borderColor", v)} />
        <PropInput label="Border Width" type="number" min={0} max={20} value={p.borderWidth ?? 1} onChange={v => set("borderWidth", Number(v))} />
        <PropInput label="Corner Radius" type="number" min={0} max={100} value={p.radius ?? 8} onChange={v => set("radius", Number(v))} />
      </PropSection>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
//  DYNAMIC CP PAGE — RUNTIME
// ────────────────────────────────────────────────────────────────

export function RuntimeCameraFeed({ widget, cpNumber }) {
  const p = widget.props || {};
  const cameraId = p.cameraId || "";
  const [running, setRunning] = useState(p.autoStart !== false);
  const [failed, setFailed] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [starting, setStarting] = useState(false);
  const imgRef = useRef(null);
  const [zones, setZones] = useState([]);
  const [countStatus, setCountStatus] = useState(null); // live "Count Over Time" progress
  const [, forceRender] = useState(0); // re-render once <img> reports its real size

  useEffect(() => { setRunning(p.autoStart !== false); }, [cameraId]);

  // Poll for a "Count Over Time" node currently running against this camera —
  // shows a countdown + live blob highlights while it's counting. Cheap to poll
  // continuously since it's a tiny in-memory read on the backend, no camera I/O.
  useEffect(() => {
    if (!cameraId || !running) { setCountStatus(null); return; }
    let cancelled = false;
    const poll = () => {
      fetch(`${API}/api/vision/count-status/${encodeURIComponent(cameraId)}`)
        .then(r => r.ok ? r.json() : { counting: false })
        .then(d => { if (!cancelled) setCountStatus(d.counting ? d : null); })
        .catch(() => {});
    };
    const interval = setInterval(poll, 150);
    return () => { cancelled = true; clearInterval(interval); };
  }, [cameraId, running]);

  // Any Zone Inspect node (Logic Builder) pointed at this same Camera ID shows
  // up here automatically — no extra config needed on the widget itself. Same
  // pass also finds a Count Over Time node using the "Contour Blob" method, so
  // the Threshold Mode toggle below only appears when it's actually relevant.
  const [blobThreshold, setBlobThreshold] = useState(null);
  const [showThreshold, setShowThreshold] = useState(false);

  useEffect(() => {
    if (!cpNumber || !cameraId) { setZones([]); setBlobThreshold(null); return; }
    let cancelled = false;
    const load = () => {
      fetch(`${API}/api/logic-config/${cpNumber}`)
        .then(r => r.ok ? r.json() : { nodes: [] })
        .then(d => {
          if (cancelled) return;
          const nodes = d.nodes || [];
          const matched = nodes
            .filter(n => n.type === "zone_inspect" && (n.config || {}).camera_id === cameraId)
            .map(n => n.config);
          setZones(matched);

          const blobNode = nodes.find(n => n.type === "count_over_time" && (n.config || {}).camera_id === cameraId && (n.config || {}).method === "contour_blob");
          setBlobThreshold(blobNode ? Number((blobNode.config.method_params || {}).threshold ?? 165) : null);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [cpNumber, cameraId]);

  useEffect(() => {
    if (!cameraId) return;

    if (!running) {
      fetch(`${API}/api/vision/cameras/${encodeURIComponent(cameraId)}/stop`, { method: "POST" }).catch(() => {});
      setCameraError(null);
      setFailed(false);
      return;
    }

    setFailed(false);
    setCameraError(null);
    setStarting(true);
    const cfg = p.sourceType === "gige"
      ? { source_type: "gige", ip_address: p.ipAddress || "" }
      : { source_type: "webcam", device_index: p.deviceIndex || "0" };

    fetch(`${API}/api/vision/cameras/${encodeURIComponent(cameraId)}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    }).catch(() => setFailed(true));
    // Deliberately NOT stopping the camera on unmount — another widget/page may
    // still be reading the same stream (e.g. this feed plus a future inspection
    // node both watching camera "line3-cam1"). It only stops via the ON/OFF
    // button below (or another widget explicitly asking it to).

    // The /start call itself always succeeds (it just launches the capture
    // thread) — whether the camera actually opened is only known a moment
    // later, from the camera's own status. Poll it briefly so a real failure
    // (wrong index, camera in use, no driver, ...) shows up instead of an
    // indefinitely "loading" stream.
    let cancelled = false;
    const poll = setInterval(() => {
      fetch(`${API}/api/vision/cameras`)
        .then(r => r.json())
        .then(d => {
          if (cancelled) return;
          const status = (d.cameras || []).find(c => c.camera_id === cameraId);
          if (status?.error) { setCameraError(status.error); setStarting(false); clearInterval(poll); }
          else if (status?.has_frame) { setCameraError(null); setStarting(false); clearInterval(poll); }
        })
        .catch(() => {});
    }, 1000);
    const stopPolling = setTimeout(() => { clearInterval(poll); setStarting(false); }, 10000);

    return () => { cancelled = true; clearInterval(poll); clearTimeout(stopPolling); };
  }, [cameraId, running, p.sourceType, p.deviceIndex, p.ipAddress]);

  const wrapper = {
    left: widget.x, top: widget.y, width: p.width, height: p.height,
    border: `${Math.max(0, Number(p.borderWidth ?? 1))}px solid ${p.borderColor || "var(--panel-mid)"}`,
    borderRadius: `${Math.max(0, Number(p.radius ?? 8))}px`,
    boxSizing: "border-box",
    overflow: "hidden",
    background: "#000",
    position: "absolute",
  };

  const toggleButton = cameraId && (
    <button
      onClick={() => setRunning(r => !r)}
      className="absolute top-1.5 right-1.5 z-10 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-colors"
      style={{
        background: running ? "rgba(34,197,94,0.85)" : "rgba(100,116,139,0.85)",
        color: "#fff",
      }}
      title={running ? "Turn camera off" : "Turn camera on"}
    >
      {running ? "⏻ ON" : "⏻ OFF"}
    </button>
  );

  if (!cameraId) {
    return (
      <div className="flex items-center justify-center text-[10px] text-[var(--text-muted)]" style={wrapper}>
        No camera configured
      </div>
    );
  }

  if (!running) {
    return (
      <div className="flex items-center justify-center text-[10px] text-[var(--text-muted)]" style={wrapper}>
        {toggleButton}
        Camera OFF
      </div>
    );
  }

  if (failed || cameraError) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 text-center px-2 text-[10px] text-[var(--accent-red)]" style={wrapper}>
        {toggleButton}
        <span>Camera unavailable</span>
        {cameraError && <span className="text-[9px] opacity-80 font-mono">{cameraError}</span>}
      </div>
    );
  }

  // Zone rectangles are stored in actual camera-pixel coordinates — convert to
  // the CSS box the <img> is actually drawn at (same technique as the Logic
  // Builder ROI picker), so they land in the right place regardless of how
  // this widget is sized on the page.
  const img = imgRef.current;
  const scaleX = img?.naturalWidth ? img.getBoundingClientRect().width / img.naturalWidth : 0;
  const scaleY = img?.naturalHeight ? img.getBoundingClientRect().height / img.naturalHeight : 0;

  return (
    <div style={wrapper}>
      {toggleButton}
      {starting && (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--text-muted)] pointer-events-none">
          Starting…
        </div>
      )}
      <img
        ref={imgRef}
        src={showThreshold && blobThreshold !== null
          ? `${API}/api/vision/stream-threshold/${encodeURIComponent(cameraId)}?threshold=${blobThreshold}`
          : `${API}/api/vision/stream/${encodeURIComponent(cameraId)}`}
        alt={cameraId}
        className="w-full h-full object-contain"
        onLoad={() => forceRender(n => n + 1)}
        onError={() => setFailed(true)}
      />

      {/* Only relevant when a Count Over Time node here uses "Contour Blob" —
          lets you see exactly what counts as "bright enough" before tuning it. */}
      {blobThreshold !== null && (
        <button
          onClick={() => setShowThreshold(v => !v)}
          className="absolute bottom-1.5 right-1.5 z-10 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-colors"
          style={{
            background: showThreshold ? "rgba(139,92,246,0.85)" : "rgba(30,41,59,0.85)",
            color: "#fff",
          }}
          title="Toggle threshold preview"
        >
          🔲 Threshold
        </button>
      )}

      {scaleX > 0 && zones.map((z, i) => (
        <div
          key={i}
          className="absolute border-2 border-[#8B5CF6] bg-[#8B5CF6]/10 pointer-events-none"
          style={{
            left: (Number(z.roi_x) || 0) * scaleX,
            top: (Number(z.roi_y) || 0) * scaleY,
            width: (Number(z.roi_w) || 0) * scaleX,
            height: (Number(z.roi_h) || 0) * scaleY,
          }}
        />
      ))}

      {/* "Count Over Time" live feedback: countdown + detected blob circles */}
      {countStatus && (
        <>
          {scaleX > 0 && (countStatus.blobs || []).map((b, i) => {
            const r = (Number(b.r) || 0) * scaleX;
            return (
              <div
                key={i}
                className="absolute rounded-full border-2 border-[#22C55E] pointer-events-none"
                style={{
                  left: Number(b.cx) * scaleX - r,
                  top: Number(b.cy) * scaleY - r,
                  width: r * 2,
                  height: r * 2,
                  boxShadow: "0 0 6px rgba(34,197,94,0.8)",
                }}
              />
            );
          })}

          <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center gap-2 pointer-events-none">
            <div className="flex-1 h-1.5 rounded-full bg-black/50 overflow-hidden">
              <div
                className="h-full bg-[#22C55E] transition-all"
                style={{ width: `${Math.min(100, (countStatus.elapsed / countStatus.duration) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] font-bold text-white bg-black/60 px-1.5 py-0.5 rounded">
              {Math.max(0, countStatus.duration - countStatus.elapsed).toFixed(1)}s · {countStatus.count}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
