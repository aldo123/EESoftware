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
import { useInternalVariables } from "../hooks/useInternalVariables";
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

function VariableSelect({ label, value, onChange, variables }) {
  return (
    <div>
      <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">{label}</label>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-7 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none"
      >
        <option value="">(none)</option>
        {variables.map((v) => (
          <option key={v.id} value={v.name}>{v.name} ({v.data_type})</option>
        ))}
      </select>
    </div>
  );
}

// "Inspection" look: HUD, big OK/NG + countdown + fail overlays, phase-coloured border and a progress
// bar under the feed. The phase comes from Internal Variables the Logic Builder flow already writes.
function InspectionSection({ p, set }) {
  const { variables = [] } = useInternalVariables();
  const inspection = p.overlayStyle === "inspection";
  return (
    <PropSection title="Inspection Overlay">
      <PropInput
        label="Style"
        options={[
          { value: "classic", label: "Classic" },
          { value: "inspection", label: "Inspection (Live View + phase overlays)" },
        ]}
        value={p.overlayStyle || "classic"}
        onChange={v => set("overlayStyle", v)}
      />
      {inspection && (
        <>
          <VariableSelect label="State variable (IDLE / COUNTDOWN / DETECTING / FAIL)" value={p.stateVariable} onChange={v => set("stateVariable", v)} variables={variables} />
          <VariableSelect label="Result variable (OK / NG)" value={p.resultVariable} onChange={v => set("resultVariable", v)} variables={variables} />
          <VariableSelect label="Countdown variable (number)" value={p.countdownVariable} onChange={v => set("countdownVariable", v)} variables={variables} />
          <PropInput label="Fail text" value={p.failText ?? "FAIL TO TEST"} onChange={v => set("failText", v)} />
          <PropInput label="Fail sub-text" value={p.failSubText ?? ""} onChange={v => set("failSubText", v)} />
        </>
      )}
    </PropSection>
  );
}

// Draws the counting ROI on the live feed, taken from four Internal Variables (camera-pixel coordinates).
// Pair with Count Over Time -> Live tuning so the box and the node always use the same numbers.
// ── Live detection overlay (what Buble Tester V1 draws on its live view): the ROI as a yellow box and every blob the counting
// would see as a green circle, updated ~5 times a second, also BEFORE a test starts. The backend runs the same detection as
// the "Contour Blob" counting (GET /api/vision/blob-preview); threshold / contour sizes / ROI come from Internal Variables.
const LIVE_ROI = "#FFFF00";
const LIVE_BLOB = "#00FF00";

// ONE shared poller per camera for the count status (countdown + highlighted blobs): several widgets can show the same
// camera, and each used to fire its own request every 150 ms. Requests never overlap and stop when nobody is listening.
const countStatusPollers = new Map();
function subscribeCountStatus(cameraId, listener) {
  let poller = countStatusPollers.get(cameraId);
  if (!poller) {
    poller = { listeners: new Set(), busy: false, timer: null, last: null };
    poller.tick = () => {
      if (poller.busy || document.hidden) return;
      poller.busy = true;
      fetch(`${API}/api/vision/count-status/${encodeURIComponent(cameraId)}`)
        .then(r => (r.ok ? r.json() : { counting: false }))
        .then(d => {
          const next = d.counting ? d : null;
          if (next === null && poller.last === null) return;   // idle: nothing to re-render
          poller.last = next;
          poller.listeners.forEach(fn => fn(next));
        })
        .catch(() => {})
        .finally(() => { poller.busy = false; });
    };
    poller.timer = setInterval(poller.tick, 200);
    countStatusPollers.set(cameraId, poller);
  }
  poller.listeners.add(listener);
  listener(poller.last);
  return () => {
    poller.listeners.delete(listener);
    if (poller.listeners.size === 0) {
      clearInterval(poller.timer);
      countStatusPollers.delete(cameraId);
    }
  };
}

function useLiveBlobs(cameraId, active, p, getValue) {
  const [data, setData] = useState({ blobs: [], frame: null });
  const latest = useRef({ p, getValue });
  latest.current = { p, getValue };

  useEffect(() => {
    if (!active || !cameraId) { setData({ blobs: [], frame: null }); return undefined; }

    let cancelled = false, busy = false;
    const tick = () => {
      if (busy) return;
      busy = true;
      const { p: props, getValue: read } = latest.current;
      const roi = props.roiVariables || {}, bp = props.blobPreview || {};
      const q = new URLSearchParams();
      const put = (key, name) => { const v = name ? Number(read(name)) : NaN; if (Number.isFinite(v)) q.set(key, String(v)); };
      const roiNames = [roi.x, roi.y, roi.w, roi.h];
      if (roiNames.some((n) => n) && !roiNames.every((n) => n && Number.isFinite(Number(read(n))))) { busy = false; setData((d) => (d.blobs.length ? { blobs: [], frame: d.frame } : d)); return; }
      put("threshold", bp.threshold); put("min_contour", bp.min_contour); put("max_contour", bp.max_contour);
      put("roi_x", roi.x); put("roi_y", roi.y); put("roi_w", roi.w); put("roi_h", roi.h);
      q.set("roi_mode", props.roiMode === "center" ? "center" : "crop");   // must match the Count Over Time node
      fetch(`${API}/api/vision/blob-preview/${encodeURIComponent(cameraId)}?${q.toString()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled && d) setData({ blobs: d.blobs || [], frame: d.frame || null }); })
        .catch(() => {})
        .finally(() => { busy = false; });
    };
    tick();
    const id = setInterval(tick, 200);
    return () => { cancelled = true; clearInterval(id); };
  }, [active, cameraId]);

  return data;
}

// Blobs only exist inside the ROI. No ROI variables configured = no restriction; a configured ROI that is not valid
// (empty / zero size, e.g. while the variables load) draws nothing instead of every blob of the frame.
const blobsInRoi = (blobs, roi) => {
  if (!roi) return blobs;
  if (!(roi.w > 0 && roi.h > 0)) return [];
  return blobs.filter((b) => b.cx >= roi.x && b.cx <= roi.x + roi.w && b.cy >= roi.y && b.cy <= roi.y + roi.h);
};

// Draws the ROI + blobs over a feed that is shown with object-fit: cover (box = boxW x boxH, frame = camera pixels).
function LiveDetectionOverlay({ live, roi, boxW, boxH, k }) {
  const fw = live.frame?.w || 640, fh = live.frame?.h || 480;
  const s = Math.max(boxW / fw, boxH / fh);
  const ox = (boxW - fw * s) / 2, oy = (boxH - fh * s) / 2;
  const hasRoi = roi && Number(roi.w) > 0 && Number(roi.h) > 0;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      {hasRoi && (
        <div style={{
          position: "absolute", left: ox + roi.x * s, top: oy + roi.y * s, width: roi.w * s, height: roi.h * s,
          border: `${Math.max(2, 2 * k)}px solid ${LIVE_ROI}`, boxSizing: "border-box",
        }}>
          <span style={{
            position: "absolute", left: 0, bottom: "100%", marginBottom: 3 * k, fontSize: 12 * k, fontWeight: 700,
            color: LIVE_ROI, fontFamily: "monospace", textShadow: "0 1px 3px rgba(0,0,0,0.9)", whiteSpace: "nowrap",
          }}>ROI</span>
        </div>
      )}
      {blobsInRoi(live.blobs, roi).map((b, i) => {
        const r = Math.max(3, b.r * s);
        return (
          <div key={i} style={{
            position: "absolute", left: ox + b.cx * s - r, top: oy + b.cy * s - r, width: r * 2, height: r * 2, borderRadius: "50%",
            border: `${Math.max(2, 2 * k)}px solid ${LIVE_BLOB}`, boxSizing: "border-box", boxShadow: `0 0 8px ${LIVE_BLOB}99`,
          }} />
        );
      })}
    </div>
  );
}

// The ROI box on the live feed. With `editable` the operator can drag it (move), pull its 8 handles (resize) or drag on
// an empty part of the feed (draw a new one); every change is written to the four ROI variables straight away, so the
// sliders and the Count Over Time node (Live tuning) follow.
const ROI_HANDLES = [
  ["nw", 0, 0, "nwse-resize"], ["n", 0.5, 0, "ns-resize"], ["ne", 1, 0, "nesw-resize"], ["e", 1, 0.5, "ew-resize"],
  ["se", 1, 1, "nwse-resize"], ["s", 0.5, 1, "ns-resize"], ["sw", 0, 1, "nesw-resize"], ["w", 0, 0.5, "ew-resize"],
];
const ROI_MIN = 8;

function RoiOverlay({ imgRef, vars, editable, scaleX, scaleY }) {
  const { getValue, setValues } = useInternalVariables();
  const drag = useRef(null);
  const num = (key) => Math.round(Number(getValue(vars[key])) || 0);
  const roi = { x: num("x"), y: num("y"), w: num("w"), h: num("h") };

  const toCamera = (e) => {
    const img = imgRef.current;
    const r = img.getBoundingClientRect();
    // r is the on-screen box (includes any CSS scale of a popup); scaleX/Y are layout px per camera px.
    const fx = r.width / (img.offsetWidth || r.width), fy = r.height / (img.offsetHeight || r.height);
    return { x: (e.clientX - r.left) / (scaleX * fx), y: (e.clientY - r.top) / (scaleY * fy) };
  };

  const begin = (e, mode) => {
    if (!editable || !imgRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { mode, start: toCamera(e), orig: { ...roi } };
  };

  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const W = imgRef.current?.naturalWidth || 640;
    const H = imgRef.current?.naturalHeight || 480;
    const p = toCamera(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    const { x, y, w, h } = d.orig;
    let left = x, top = y, right = x + w, bottom = y + h;

    if (d.mode === "move") {
      left = Math.min(Math.max(x + dx, 0), W - w);
      top = Math.min(Math.max(y + dy, 0), H - h);
      right = left + w;
      bottom = top + h;
    } else if (d.mode === "new") {
      left = d.start.x; top = d.start.y; right = p.x; bottom = p.y;
    } else {
      if (d.mode.includes("w")) left = x + dx;
      if (d.mode.includes("e")) right = x + w + dx;
      if (d.mode.includes("n")) top = y + dy;
      if (d.mode.includes("s")) bottom = y + h + dy;
    }

    const clamp = (v, max) => Math.min(Math.max(v, 0), max);
    let nx = clamp(Math.min(left, right), W), ny = clamp(Math.min(top, bottom), H);
    let nw = clamp(Math.max(left, right), W) - nx, nh = clamp(Math.max(top, bottom), H) - ny;
    nw = Math.max(nw, ROI_MIN); nh = Math.max(nh, ROI_MIN);
    nx = Math.min(nx, W - nw); ny = Math.min(ny, H - nh);

    setValues([
      { name: vars.x, value: Math.round(nx) }, { name: vars.y, value: Math.round(ny) },
      { name: vars.w, value: Math.round(nw) }, { name: vars.h, value: Math.round(nh) },
    ].filter((u) => u.name));
  };

  const end = () => { drag.current = null; };

  return (
    <>
      {editable && (
        <div
          className="absolute inset-0 z-[5] touch-none"
          style={{ cursor: "crosshair" }}
          title="Drag on the feed to draw a new ROI"
          onPointerDown={(e) => begin(e, "new")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      )}
      <div
        className={`absolute border-2 border-dashed border-[#FACC15] bg-[#FACC15]/10 ${editable ? "z-[6] touch-none" : "pointer-events-none"}`}
        style={{
          left: roi.x * scaleX, top: roi.y * scaleY, width: roi.w * scaleX, height: roi.h * scaleY,
          cursor: editable ? "move" : undefined,
        }}
        onPointerDown={editable ? (e) => begin(e, "move") : undefined}
        onPointerMove={editable ? move : undefined}
        onPointerUp={editable ? end : undefined}
        onPointerCancel={editable ? end : undefined}
      >
        {editable && ROI_HANDLES.map(([mode, fx, fy, cursor]) => (
          <div
            key={mode}
            className="absolute bg-[#FACC15] border border-black/50 rounded-sm touch-none"
            style={{ width: 12, height: 12, left: `calc(${fx * 100}% - 6px)`, top: `calc(${fy * 100}% - 6px)`, cursor }}
            onPointerDown={(e) => begin(e, mode)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
        ))}
      </div>
    </>
  );
}

function LiveBlobSection({ p, set }) {
  const { variables = [] } = useInternalVariables();
  const bp = p.blobPreview || {};
  const setBp = (key, v) => set("blobPreview", { ...bp, [key]: v });
  return (
    <PropSection title="Live Detection Overlay">
      <div className="text-[8px] text-[var(--text-dim)]">
        Draw the ROI (yellow box) and the detected blobs (green circles) on the live view, also before a test starts.
        Uses the ROI variables above plus the detection variables below (the same ones the Count Over Time node reads).
      </div>
      <PropInput label="Show ROI + blobs on the live view" type="checkbox" value={p.liveBlobs === true} onChange={(v) => set("liveBlobs", v)} />
      <PropInput
        label="ROI mode (same as the Count Over Time node)"
        options={[
          { value: "crop", label: "Crop — only inside the ROI box" },
          { value: "center", label: "Centre in ROI — like Buble Tester" },
        ]}
        value={p.roiMode === "center" ? "center" : "crop"}
        onChange={(v) => set("roiMode", v)}
      />
      <div className="grid grid-cols-2 gap-2">
        <VariableSelect label="Threshold" value={bp.threshold} onChange={(v) => setBp("threshold", v)} variables={variables} />
        <VariableSelect label="Min contour" value={bp.min_contour} onChange={(v) => setBp("min_contour", v)} variables={variables} />
        <VariableSelect label="Max contour" value={bp.max_contour} onChange={(v) => setBp("max_contour", v)} variables={variables} />
      </div>
    </PropSection>
  );
}

function RoiOverlaySection({ p, set }) {
  const { variables = [] } = useInternalVariables();
  const roi = p.roiVariables || {};
  const setRoi = (key, v) => set("roiVariables", { ...roi, [key]: v });
  return (
    <PropSection title="ROI Overlay">
      <div className="text-[8px] text-[var(--text-dim)]">Show the counting ROI as a box on the feed (variables hold x / y / width / height in camera pixels).</div>
      <div className="grid grid-cols-2 gap-2">
        <VariableSelect label="X" value={roi.x} onChange={(v) => setRoi("x", v)} variables={variables} />
        <VariableSelect label="Y" value={roi.y} onChange={(v) => setRoi("y", v)} variables={variables} />
        <VariableSelect label="Width" value={roi.w} onChange={(v) => setRoi("w", v)} variables={variables} />
        <VariableSelect label="Height" value={roi.h} onChange={(v) => setRoi("h", v)} variables={variables} />
      </div>
      <PropInput label="Drag ROI on the feed (runtime)" type="checkbox" value={p.roiEditable === true} onChange={(v) => set("roiEditable", v)} />
    </PropSection>
  );
}

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

      <InspectionSection p={p} set={set} />
      <RoiOverlaySection p={p} set={set} />
      <LiveBlobSection p={p} set={set} />

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
    if (!cameraId || !running) { setCountStatus(null); return undefined; }
    return subscribeCountStatus(cameraId, setCountStatus);
  }, [cameraId, running]);

  // Any Zone Inspect node (Logic Builder) pointed at this same Camera ID shows
  // up here automatically — no extra config needed on the widget itself. Same
  // pass also finds a Count Over Time node using the "Contour Blob" method, so
  // the Threshold Mode toggle below only appears when it's actually relevant.
  const [blobThreshold, setBlobThreshold] = useState(null);
  const [thresholdVar, setThresholdVar] = useState("");
  const [showThreshold, setShowThreshold] = useState(false);
  const { getValue: getInternalValue } = useInternalVariables();

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
          setThresholdVar(blobNode ? String((blobNode.config.param_variables || {}).threshold || "") : "");
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
    if (p.roiMode === "center") cfg.resize = [640, 480];   // the original Buble Tester programs always work on a 640 x 480 frame

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

  const live = useLiveBlobs(cameraId, p.liveBlobs === true && running && !failed && !cameraError, p, getInternalValue);

  // When the counting node takes its threshold from an Internal Variable, preview with the live value.
  const liveThreshold = (() => {
    if (blobThreshold === null) return null;
    if (!thresholdVar) return blobThreshold;
    const n = Number(getInternalValue(thresholdVar));
    return Number.isFinite(n) ? n : blobThreshold;
  })();

  if (p.overlayStyle === "inspection" && cameraId) {
    return (
      <InspectionFeed
        widget={widget}
        running={running}
        setRunning={setRunning}
        starting={starting}
        failed={failed}
        setFailed={setFailed}
        cameraError={cameraError}
        countStatus={countStatus}
        live={live}
        threshold={liveThreshold}
        showThreshold={showThreshold}
        setShowThreshold={setShowThreshold}
        getValue={getInternalValue}
      />
    );
  }

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
  // Layout size (offsetWidth), not getBoundingClientRect: a page inside a CSS-scaled popup would otherwise be scaled twice.
  const scaleX = img?.naturalWidth ? img.offsetWidth / img.naturalWidth : 0;
  const scaleY = img?.naturalHeight ? img.offsetHeight / img.naturalHeight : 0;

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
        src={showThreshold && liveThreshold !== null
          ? `${API}/api/vision/stream-threshold/${encodeURIComponent(cameraId)}?threshold=${liveThreshold}`
          : `${API}/api/vision/stream/${encodeURIComponent(cameraId)}`}
        alt={cameraId}
        className="w-full h-full object-contain"
        onLoad={() => forceRender(n => n + 1)}
        onError={() => setFailed(true)}
      />

      {/* Only relevant when a Count Over Time node here uses "Contour Blob" —
          lets you see exactly what counts as "bright enough" before tuning it. */}
      {liveThreshold !== null && (
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

      {scaleX > 0 && p.liveBlobs === true && blobsInRoi(live.blobs, (() => {
        const rv = p.roiVariables || {};
        const num = (name) => { const v = name ? Number(getInternalValue(name)) : NaN; return Number.isFinite(v) ? v : 0; };
        return rv.w && rv.h ? { x: num(rv.x), y: num(rv.y), w: num(rv.w), h: num(rv.h) } : null;
      })()).map((b, i) => (
        <div
          key={`live-${i}`}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: b.cx * scaleX - b.r * scaleX, top: b.cy * scaleY - b.r * scaleY, width: b.r * 2 * scaleX, height: b.r * 2 * scaleY,
            border: `2px solid ${LIVE_BLOB}`, boxShadow: `0 0 8px ${LIVE_BLOB}99`, boxSizing: "border-box",
          }}
        />
      ))}

      {scaleX > 0 && p.roiVariables?.w && p.roiVariables?.h && (
        <RoiOverlay imgRef={imgRef} vars={p.roiVariables} editable={p.roiEditable === true} scaleX={scaleX} scaleY={scaleY} />
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
          {scaleX > 0 && (p.liveBlobs === true ? [] : (countStatus.blobs || [])).map((b, i) => {
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

// ────────────────────────────────────────────────────────────────
//  INSPECTION LOOK (overlayStyle === "inspection")
// ────────────────────────────────────────────────────────────────

const INSPECT = {
  accent: "#00C896", warn: "#FF9F0A", ok: "#30D158", ng: "#FF453A", border: "#38383A",
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
};

function InspectionFeed({
  widget, running, setRunning, starting, failed, setFailed, cameraError, countStatus, live,
  threshold, showThreshold, setShowThreshold, getValue,
}) {
  const p = widget.props || {};
  const cameraId = p.cameraId;
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setLoaded(false); }, [cameraId, running, showThreshold]);

  // everything is drawn for a 640-px wide feed and scaled to the widget width
  const k = Math.max(0.3, Number(p.width || 640) / 640);
  const radius = Math.max(0, Number(p.radius ?? 14));

  const state = String(getValue(p.stateVariable, "") ?? "").toUpperCase();
  const result = String(getValue(p.resultVariable, "") ?? "").toUpperCase();
  const countdownRaw = Number(getValue(p.countdownVariable, 0));
  const countdown = Number.isFinite(countdownRaw) ? countdownRaw : 0;

  const isResult = result === "OK" || result === "NG";
  const isFail = state === "FAIL";
  const isCountdown = !isResult && !isFail && countdown > 0 && (!p.stateVariable || state === "COUNTDOWN");
  const isDetecting = !isResult && !isFail && (!!countStatus || state === "DETECTING");
  const resultColor = result === "OK" ? INSPECT.ok : INSPECT.ng;

  const borderColor =
    isResult ? resultColor + "80" :
    isFail ? INSPECT.ng + "80" :
    isDetecting ? INSPECT.accent + "80" :
    isCountdown ? INSPECT.warn + "80" :
    (p.borderColor && !String(p.borderColor).startsWith("var(") ? p.borderColor : INSPECT.border);

  const remaining = countStatus ? Math.max(0, countStatus.duration - countStatus.elapsed) : 0;
  const progress = countStatus && countStatus.duration > 0 ? Math.min(100, (remaining / countStatus.duration) * 100) : 0;

  const streamUrl = showThreshold && threshold !== null
    ? `${API}/api/vision/stream-threshold/${encodeURIComponent(cameraId)}?threshold=${threshold}`
    : `${API}/api/vision/stream/${encodeURIComponent(cameraId)}`;
  const showImage = running && !failed && !cameraError;

  const pill = {
    display: "flex", alignItems: "center", gap: 8 * k, padding: `${7 * k}px ${16 * k}px`, borderRadius: 22 * k,
    background: "rgba(0,0,0,0.7)", border: `1px solid ${INSPECT.accent}50`, backdropFilter: "blur(8px)",
    fontFamily: "monospace", fontSize: 14 * k, fontWeight: 700,
  };

  return (
    <div style={{ position: "absolute", left: widget.x, top: widget.y, width: p.width, height: p.height, isolation: "isolate" }}>
      <div
        style={{
          position: "absolute", inset: 0, overflow: "hidden", background: "#000", boxSizing: "border-box",
          borderRadius: radius, border: `${Math.max(1, Number(p.borderWidth ?? 2))}px solid ${borderColor}`,
          boxShadow: isResult ? `0 0 0 4px ${resultColor}15, 0 12px 40px ${resultColor}20` : "0 4px 24px rgba(0,0,0,0.4)",
          transition: "border-color 0.35s, box-shadow 0.35s",
        }}
      >
        {showImage ? (
          <img
            key={streamUrl}
            src={streamUrl}
            alt={cameraId}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : null}

        {!(showImage && loaded) && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: 14 * k, background: "#0A0D12",
          }}>
            <svg width={44 * k} height={44 * k} viewBox="0 0 24 24" fill="none" stroke="#3B4A5E" strokeWidth="1.8" strokeLinecap="round">
              <line x1="12" y1="3" x2="12" y2="11" />
              <path d="M6.5 6.5a8 8 0 1 0 11 0" />
            </svg>
            <span style={{ fontSize: 12 * k, fontWeight: 600, color: "#3B4A5E", letterSpacing: 4 * k, fontFamily: INSPECT.font }}>
              {!running ? "STANDBY" : cameraError ? "CAMERA UNAVAILABLE" : starting ? "STARTING…" : failed ? "NO SIGNAL" : "STANDBY"}
            </span>
            {cameraError && running && (
              <span style={{ fontSize: 9 * k, color: INSPECT.ng + "cc", fontFamily: "monospace", maxWidth: "80%", textAlign: "center" }}>{cameraError}</span>
            )}
          </div>
        )}

        {/* ROI (yellow) + detected blobs (green), like the original's live view */}
        {showImage && loaded && p.liveBlobs === true && (() => {
          const bw = Math.max(1, Number(p.borderWidth ?? 2));
          const rv = p.roiVariables || {};
          const num = (name) => { const v = name ? Number(getValue(name)) : NaN; return Number.isFinite(v) ? v : 0; };
          const roi = rv.w && rv.h ? { x: num(rv.x), y: num(rv.y), w: num(rv.w), h: num(rv.h) } : null;
          return <LiveDetectionOverlay live={live} roi={roi} boxW={Number(p.width) - 2 * bw} boxH={Number(p.height) - 2 * bw} k={k} />;
        })()}

        {/* HUD: Live View label + CAM toggle */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 2, display: "flex", alignItems: "center",
          justifyContent: "space-between", padding: `${10 * k}px ${14 * k}px`,
        }}>
          <span style={{
            fontSize: 10 * k, fontWeight: 700, letterSpacing: 1.2 * k, textTransform: "uppercase",
            color: "rgba(255,255,255,0.65)", fontFamily: INSPECT.font, textShadow: "0 1px 3px rgba(0,0,0,0.8)",
          }}>
            Live View
          </span>
          <button
            onClick={() => { setFailed(false); setRunning((r) => !r); }}
            style={{
              display: "flex", alignItems: "center", gap: 6 * k, padding: `${4 * k}px ${11 * k}px`, borderRadius: 20 * k,
              border: "none", background: running ? "rgba(48,209,88,0.9)" : "rgba(0,0,0,0.55)", color: "#fff",
              fontSize: 10 * k, fontWeight: 700, fontFamily: INSPECT.font, cursor: "pointer", backdropFilter: "blur(4px)",
            }}
          >
            <span style={{ width: 6 * k, height: 6 * k, borderRadius: "50%", background: "#fff" }} />
            CAM {running ? "ON" : "OFF"}
          </button>
        </div>

        {/* big RESULT */}
        {isResult && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: resultColor + "25" }}>
            <div style={{
              fontSize: 130 * k, fontWeight: 900, color: resultColor, letterSpacing: 6 * k, lineHeight: 1,
              textShadow: `0 0 80px ${resultColor}90`, fontFamily: INSPECT.font,
            }}>
              {result}
            </div>
          </div>
        )}

        {/* FAIL */}
        {isFail && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: 10 * k, background: INSPECT.ng + "20",
          }}>
            <div style={{ fontSize: 32 * k, fontWeight: 800, color: INSPECT.ng, textAlign: "center", fontFamily: INSPECT.font }}>
              {p.failText ?? "FAIL TO TEST"}
            </div>
            {p.failSubText ? (
              <div style={{ fontSize: 14 * k, color: INSPECT.ng + "cc", fontFamily: INSPECT.font }}>{p.failSubText}</div>
            ) : null}
          </div>
        )}

        {/* big COUNTDOWN number */}
        {isCountdown && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)" }}>
            <div style={{
              fontSize: 120 * k, fontWeight: 900, color: INSPECT.warn, lineHeight: 1,
              textShadow: `0 0 60px ${INSPECT.warn}80`, fontFamily: INSPECT.font,
            }}>
              {countdown}
            </div>
          </div>
        )}

        {/* live count + timer while the Count Over Time node is counting */}
        {countStatus && (
          <>
            <div style={{ ...pill, position: "absolute", top: 52 * k, left: 12 * k, color: "#fff" }}>
              <span style={{ width: 8 * k, height: 8 * k, borderRadius: "50%", background: INSPECT.accent, boxShadow: `0 0 8px ${INSPECT.accent}` }} />
              Bubble: {countStatus.count}
            </div>
            <div style={{ ...pill, position: "absolute", top: 52 * k, right: 12 * k, color: INSPECT.accent }}>
              ⏱ {Math.ceil(remaining)}s
            </div>
          </>
        )}

        {/* Frame / Thresh toggle (only when the flow counts blobs) */}
        {threshold !== null && showImage && (
          <div style={{ position: "absolute", bottom: 12 * k, right: 12 * k, display: "flex", gap: 4 * k }}>
            {[{ label: "Frame", val: false }, { label: "Thresh", val: true }].map((opt) => (
              <button
                key={opt.label}
                onClick={() => setShowThreshold(opt.val)}
                style={{
                  padding: `${4 * k}px ${10 * k}px`, borderRadius: 6 * k, border: "none", cursor: "pointer",
                  fontSize: 10 * k, fontWeight: 700, fontFamily: INSPECT.font, backdropFilter: "blur(4px)",
                  background: showThreshold === opt.val ? INSPECT.accent : "rgba(0,0,0,0.6)",
                  color: showThreshold === opt.val ? "#0B1410" : "rgba(255,255,255,0.75)",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* detection progress bar under the feed */}
      <div style={{
        position: "absolute", left: 0, right: 0, top: Number(p.height || 480) + 8 * k, height: 3 * k, borderRadius: 2,
        background: INSPECT.border, overflow: "hidden", opacity: countStatus ? 1 : 0, transition: "opacity 0.3s",
      }}>
        <div style={{
          height: "100%", borderRadius: 2, width: `${progress}%`, transition: "width 0.15s linear",
          background: `linear-gradient(to right, ${INSPECT.accent}, ${INSPECT.accent}80)`,
        }} />
      </div>
    </div>
  );
}
