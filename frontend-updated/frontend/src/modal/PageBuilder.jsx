// src/modal/PageBuilder.jsx
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { API } from "../service/api";
import { ModalBackdrop, ModalPanel } from "../components/motion";
import {
  COMPONENT_TYPES,
  WIDGET_PREVIEWS,
  WIDGET_PROPERTY_PANELS,
  GRID,
  snap,
  uid,
  IconX,
  IconTrash,
  IconDupe,
  PropSection,
  PropInput,
} from "../widgets";

// ──────────────────────────────────────────────────────────────────
// Every widget's default props, canvas preview, and property panel now
// live in src/widgets/<type>.jsx (one file per widget type). This file
// only handles the builder shell: canvas, drag/drop, resize, layering,
// palette list, and save/load. See src/widgets/index.js for the registry.
// ──────────────────────────────────────────────────────────────────

const CANVAS_PRESETS = [{ label: "Full HD • 1980 × 1080", width: 1980, height: 1080 }];
const DEFAULT_CANVAS = { width: 1980, height: 1080 };
const canvasKey = (width, height) => `${width}x${height}`;

// ── WIDGET PREVIEW (dispatches to the widget's own Preview component) ──
function WidgetPreview({ widget }) {
  const Comp = WIDGET_PREVIEWS[widget.type];
  if (!Comp) return <div className="text-[10px] text-[var(--text-muted)]">Empty Component</div>;
  return <Comp widget={widget} />;
}

// ── PROPERTY PANEL (common chrome + dispatches to the widget's own panel) ──
function PropertyPanel({ widget, onChange, onDelete, onDuplicate, onLayerAction, canvasWidth, canvasHeight, availableDevices = [] }) {
  if (!widget) return (<div className="flex flex-col items-center justify-center h-full text-center px-4"><span className="text-3xl opacity-20 mb-2">🖱</span><p className="text-[var(--text-muted)] text-[10px]">Click a widget on the canvas to edit its properties</p></div>);
  const { type, props: p, x, y } = widget;

  const set = useCallback((key, val) => {
    let newProps = { ...p, [key]: val };
    if (key === "width") { const maxW = canvasWidth - x; newProps.width = Math.min(maxW, Math.max(40, val)); }
    if (key === "height") { const maxH = canvasHeight - y; newProps.height = Math.min(maxH, Math.max(24, val)); }
    onChange({ ...widget, props: newProps });
  }, [widget, onChange, canvasWidth, canvasHeight, x, y, p]);

  const handleXChange = useCallback((v) => { const newX = Math.max(0, Math.min(snap(v), canvasWidth - p.width)); onChange({ ...widget, x: newX }); }, [widget, onChange, canvasWidth, p.width]);
  const handleYChange = useCallback((v) => { const newY = Math.max(0, Math.min(snap(v), canvasHeight - p.height)); onChange({ ...widget, y: newY }); }, [widget, onChange, canvasHeight, p.height]);

  const isOn = p.builderState === 1;

  return (<div className="flex flex-col h-full overflow-hidden"><div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-soft)] shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-base shrink-0">◻</span>
        <span className="text-[var(--text-primary)] font-bold text-xs capitalize truncate">{type || 'Unknown'}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" onClick={() => onLayerAction?.("front")} title="Bring to Front" aria-label="Bring to Front"
          className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-green)] hover:bg-[var(--accent-green)]/10 transition-colors text-[11px] font-bold">⇈</button>
        <button type="button" onClick={() => onLayerAction?.("forward")} title="Bring Forward" aria-label="Bring Forward"
          className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-green)] hover:bg-[var(--accent-green)]/10 transition-colors text-[11px] font-bold">↑</button>
        <button type="button" onClick={() => onLayerAction?.("backward")} title="Send Backward" aria-label="Send Backward"
          className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-orange)] hover:bg-[var(--accent-orange)]/10 transition-colors text-[11px] font-bold">↓</button>
        <button type="button" onClick={() => onLayerAction?.("back")} title="Send to Back" aria-label="Send to Back"
          className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-orange)] hover:bg-[var(--accent-orange)]/10 transition-colors text-[11px] font-bold">⇊</button>
        <button type="button" onClick={onDuplicate} title="Duplicate" aria-label="Duplicate"
          className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-blue)] hover:bg-[var(--bg-hover)] transition-colors"><IconDupe /></button>
        <button type="button" onClick={onDelete} title="Delete" aria-label="Delete"
          className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-red)] hover:bg-[var(--status-red-bg)]/20 transition-colors"><IconTrash /></button>
      </div>
    </div><div className="flex-1 overflow-y-auto px-3 flex flex-col gap-0" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--border) var(--bg-canvas)" }}>

    <PropSection title="Position & Size"><div className="grid grid-cols-2 gap-2">
      <PropInput label="X" type="number" min={0} value={x} onChange={handleXChange} />
      <PropInput label="Y" type="number" min={0} value={y} onChange={handleYChange} />
      <PropInput label="Width" type="number" min={40} value={p.width} onChange={v => set("width", snap(v))} />
      <PropInput label="Height" type="number" min={24} value={p.height} onChange={v => set("height", snap(v))} />
    </div></PropSection>

    {(() => {
      const Panel = WIDGET_PROPERTY_PANELS[type];
      if (!Panel) return null;
      return <Panel p={p} set={set} availableDevices={availableDevices} />;
    })()}


  </div></div>);
}

export default function PageBuilder({ cpNumber, onClose, availableDevices = [] }) {
  const [pageType, setPageType] = useState("dynamic");
  const [pages, setPages] = useState({
    dynamic: { widgets: [] },
    manual: { widgets: [] },
    calibration: { widgets: [] },
  });
  const [widgets, setWidgets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [dragInfo, setDragInfo] = useState(null);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState("");
  const [resizing, setResizing] = useState(null);
  const canvasRef = useRef(null);
  const canvasContainerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [canvasPreset, setCanvasPreset] = useState(
    CANVAS_PRESETS.find(p => p.width === DEFAULT_CANVAS.width && p.height === DEFAULT_CANVAS.height) || CANVAS_PRESETS[0]
  );
  const CANVAS_W = canvasPreset.width;
  const CANVAS_H = canvasPreset.height;

  // Layer order is represented by the widgets array and a normalized zIndex.
  // Higher zIndex is always rendered above lower zIndex.
  const normalizeLayerOrder = useCallback((list) => {
    return list.map((w, index) => ({ ...w, zIndex: index + 1 }));
  }, []);

  const normalizePage = useCallback((list) => {
    const source = Array.isArray(list) ? list : [];
    const hasLayer = source.some(w => Number.isFinite(Number(w?.zIndex)));
    const ordered = hasLayer
      ? [...source].sort((a, b) => Number(a?.zIndex ?? 0) - Number(b?.zIndex ?? 0))
      : source;
    return normalizeLayerOrder(ordered);
  }, [normalizeLayerOrder]);

  const switchPage = useCallback((nextPage) => {
    if (!nextPage || nextPage === pageType) return;

    setPages(prev => ({
      ...prev,
      [pageType]: { widgets: normalizeLayerOrder(widgets) },
    }));

    setWidgets(normalizePage(pages[nextPage]?.widgets || []));
    setSelected(null);
    setDragInfo(null);
    setResizing(null);
    setPageType(nextPage);
  }, [pageType, pages, widgets, normalizeLayerOrder, normalizePage]);

  const handleLayerAction = useCallback((action) => {
    if (!selected) return;
    setWidgets(prev => {
      const index = prev.findIndex(w => w.id === selected);
      if (index < 0) return prev;

      const next = [...prev];
      const [item] = next.splice(index, 1);

      if (action === "front") {
        next.push(item);
      } else if (action === "back") {
        next.unshift(item);
      } else if (action === "forward") {
        const target = Math.min(index + 1, next.length);
        next.splice(target, 0, item);
      } else if (action === "backward") {
        const target = Math.max(index - 1, 0);
        next.splice(target, 0, item);
      } else {
        next.splice(index, 0, item);
      }

      return normalizeLayerOrder(next);
    });
  }, [selected, normalizeLayerOrder]);

  const handleWidgetUpdate = useCallback((updatedWidget) => {
    setWidgets(prevWidgets =>
      prevWidgets.map(w => (w.id === updatedWidget.id ? updatedWidget : w))
    );
  }, []);

  useEffect(() => {
    if (!cpNumber) { setLoading(false); return; }
    fetch(`${API}/api/page-config/${cpNumber}`)
      .then(r => r.ok ? r.json() : { widgets: [] })
      .then(d => {
        // Design canvas is fixed to Full HD.
        setCanvasPreset(CANVAS_PRESETS[0]);
        const savedPages = d?.pages && typeof d.pages === "object" ? d.pages : {};
        const legacyDynamic = Array.isArray(d?.widgets) ? d.widgets : [];
        const normalizedPages = {
          dynamic: { widgets: normalizePage(savedPages.dynamic?.widgets ?? legacyDynamic) },
          manual: { widgets: normalizePage(savedPages.manual?.widgets ?? []) },
          calibration: { widgets: normalizePage(savedPages.calibration?.widgets ?? []) },
        };
        setPages(normalizedPages);
        setPageType("dynamic");
        setWidgets(normalizedPages.dynamic.widgets);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [cpNumber, normalizePage]);

  // The selected resolution is the DESIGN HMI canvas.
  // The Builder always fits this canvas completely inside the editor.
  // The saved x/y/width/height values remain in DESIGN pixels.
  // Dynamic Page can later scale these design pixels to its own display resolution.
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const updateScale = () => {
      // Keep the 1920×1080 design canvas fully visible inside the Builder.
      // Only the editor preview is scaled; logical widget coordinates remain Full HD pixels.
      const availableWidth = Math.max(1, container.clientWidth - 64);
      const availableHeight = Math.max(1, container.clientHeight - 32);
      const widthScale = availableWidth / CANVAS_W;
      const heightScale = availableHeight / CANVAS_H;
      const next = Math.min(1, widthScale, heightScale);
      const safeScale = Math.max(0.05, Number.isFinite(next) ? next : 1);
      setScale(prev => Math.abs(prev - safeScale) < 0.001 ? prev : safeScale);
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(container);
    return () => observer.disconnect();
  }, [CANVAS_W, CANVAS_H]);

  // Keep widgets inside the newly selected logical canvas.
  useEffect(() => {
    setWidgets(prev => prev.map(w => {
      const p = w.props || {};
      const width = Math.min(Math.max(1, Number(p.width || 1)), CANVAS_W);
      const height = Math.min(Math.max(1, Number(p.height || 1)), CANVAS_H);
      const x = Math.max(0, Math.min(Number(w.x || 0), CANVAS_W - width));
      const y = Math.max(0, Math.min(Number(w.y || 0), CANVAS_H - height));
      if (x === w.x && y === w.y && width === p.width && height === p.height) return w;
      return { ...w, x, y, props: { ...p, width, height } };
    }));
  }, [CANVAS_W, CANVAS_H]);

  const handleCanvasDrop = useCallback((e) => {
    e.preventDefault();
    const typeData = e.dataTransfer.getData("component-type");
    if (!typeData) return;
    const def = COMPONENT_TYPES.find(c => c.type === typeData);
    if (!def) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaledX = (e.clientX - rect.left) / scale;
    const scaledY = (e.clientY - rect.top) / scale;
    let x = snap(scaledX - (def.defaultProps.width / 2 || 60));
    let y = snap(scaledY - (def.defaultProps.height / 2 || 20));
    x = Math.max(0, Math.min(x, CANVAS_W - def.defaultProps.width));
    y = Math.max(0, Math.min(y, CANVAS_H - def.defaultProps.height));
    const id = uid();
    const needsVariable = Object.prototype.hasOwnProperty.call(def.defaultProps, "variable");
    setWidgets(ws => [...ws, { id, type: def.type, x, y, props: { ...def.defaultProps, ...(needsVariable ? { variable: `Var_${id}` } : {}), width: Math.min(def.defaultProps.width, CANVAS_W - x), height: Math.min(def.defaultProps.height, CANVAS_H - y) } }]);
    setSelected(id);
  }, [scale, CANVAS_W, CANVAS_H]);

  const startDrag = useCallback((e, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const w = document.getElementById(`widget-${id}`);
    if (!w) return;
    const rect = w.getBoundingClientRect();
    const offsetX = (e.clientX - rect.left) / scale;
    const offsetY = (e.clientY - rect.top) / scale;
    setDragInfo({ id, offsetX, offsetY });
    setSelected(id);
  }, [scale]);

  useEffect(() => {
    if (!dragInfo) return;
    const onMove = (e) => {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const mouseX = (e.clientX - canvasRect.left) / scale;
      const mouseY = (e.clientY - canvasRect.top) / scale;
      let newX = snap(mouseX - dragInfo.offsetX);
      let newY = snap(mouseY - dragInfo.offsetY);
      setWidgets(ws => {
        const widget = ws.find(w => w.id === dragInfo.id);
        if (!widget) return ws;
        const maxX = CANVAS_W - widget.props.width;
        const maxY = CANVAS_H - widget.props.height;
        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));
        return ws.map(w => w.id === dragInfo.id ? { ...w, x: newX, y: newY } : w);
      });
    };
    const onUp = () => setDragInfo(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragInfo, scale, CANVAS_W, CANVAS_H]);

  const startResize = useCallback((e, id) => {
    e.stopPropagation(); e.preventDefault();
    const widget = widgets.find(w => w.id === id);
    if (!widget) return;
    setResizing({ id, startX: e.clientX, startY: e.clientY, startW: widget.props.width, startH: widget.props.height });
  }, [widgets]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e) => {
      const dw = (e.clientX - resizing.startX) / scale;
      const dh = (e.clientY - resizing.startY) / scale;
      setWidgets(ws => ws.map(w => {
        if (w.id !== resizing.id) return w;
        const newW = Math.max(40, snap(resizing.startW + dw));
        const newH = Math.max(24, snap(resizing.startH + dh));
        const maxW = CANVAS_W - w.x;
        const maxH = CANVAS_H - w.y;
        return { ...w, props: { ...w.props, width: Math.min(newW, maxW), height: Math.min(newH, maxH) } };
      }));
    };
    const onUp = () => setResizing(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [resizing, scale, CANVAS_W, CANVAS_H]);

  const save = useCallback(async () => {
    setSaving(true); setSaveMsg("");
    try {
      const canvas = { width: CANVAS_W, height: CANVAS_H };
      const finalPages = {
        ...pages,
        [pageType]: { widgets: normalizeLayerOrder(widgets) },
      };
      const cleanPages = {
        dynamic: { widgets: normalizePage(finalPages.dynamic?.widgets || []) },
        manual: { widgets: normalizePage(finalPages.manual?.widgets || []) },
        calibration: { widgets: normalizePage(finalPages.calibration?.widgets || []) },
      };
      const r = await fetch(`${API}/api/page-config/${cpNumber}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Backward compatibility: Dynamic Page remains in the legacy widgets key.
          widgets: cleanPages.dynamic.widgets,
          pages: cleanPages,
          canvas,
          // Design resolution: Dynamic Page uses this as the source coordinate system.
          canvasWidth: CANVAS_W,
          canvasHeight: CANVAS_H,
          designCanvasWidth: CANVAS_W,
          designCanvasHeight: CANVAS_H,
        }),
      });
      const d = await r.json();
      if (d.success) setSaveMsg("✓ Saved!"); else setSaveMsg("✗ Save failed");
    } catch { setSaveMsg("✗ Network error"); }
    setSaving(false);
    setTimeout(() => setSaveMsg(""), 3000);
  }, [cpNumber, pages, pageType, widgets, CANVAS_W, CANVAS_H, normalizeLayerOrder, normalizePage]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (!selected) return;
      const target = e.target;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === "]") { e.preventDefault(); handleLayerAction(e.shiftKey ? "front" : "forward"); }
      if (e.key === "[") { e.preventDefault(); handleLayerAction(e.shiftKey ? "back" : "backward"); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, handleLayerAction]);

  const clearCanvas = useCallback(() => {
    setWidgets([]);
    setSelected(null);
    setPages(prev => ({ ...prev, [pageType]: { widgets: [] } }));
  }, [pageType]);
  const selectedWidget = useMemo(() => widgets.find(w => w.id === selected) || null, [widgets, selected]);
  const filteredPalette = useMemo(() => COMPONENT_TYPES.filter(c => c.label.toLowerCase().includes(paletteSearch.toLowerCase()) || c.desc.toLowerCase().includes(paletteSearch.toLowerCase())), [paletteSearch]);

  const displayWidth = CANVAS_W * scale;
  const displayHeight = CANVAS_H * scale;

  return (
    <ModalBackdrop className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm font-sans">
      <ModalPanel className="flex flex-col rounded-2xl overflow-hidden border border-[var(--border)] shadow-2xl" style={{ width: "min(98vw, 1800px)", height: "min(96vh, 900px)", background: "var(--panel-canvas)" }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-soft)] shrink-0" style={{ background: "var(--bg-surface-2)" }}>
          <div className="flex items-center gap-3">
            <span className="text-[var(--accent-green)] font-black text-lg tracking-tighter">WIK</span>
            <div className="w-px h-5 bg-[var(--border)]" />
            <span className="text-[var(--text-primary)] font-bold text-sm">Page Builder</span>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[var(--accent-green)]/15 text-[var(--accent-green)] border border-[var(--accent-green)]/30">CP{String(cpNumber).padStart(2, "0")}</span>
            <div className="flex items-center gap-1 ml-2 p-1 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-canvas)]">
              {[
                ["dynamic", "Dynamic Page", "🖥"],
                ["manual", "Manual Page", "🕹"],
                ["calibration", "Calibration Page", "🎯"],
              ].map(([key, label, icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => switchPage(key)}
                  className={`h-6 px-2.5 rounded-md text-[9px] font-bold flex items-center gap-1.5 transition-colors ${pageType === key ? "bg-[var(--accent-green)] text-[var(--status-green-bg)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border-soft)]"}`}
                >
                  <span>{icon}</span>{label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Canvas</span>
              <span className="px-2 h-7 inline-flex items-center rounded border border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--accent-green)] text-[10px] font-bold font-mono">FULL HD · 1980 × 1080</span>
            </div>
            {saveMsg && <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${saveMsg.startsWith("✓") ? "text-[var(--accent-green)] bg-[var(--accent-green)]/10" : "text-[var(--accent-red)] bg-[var(--accent-red)]/10"}`}>{saveMsg}</span>}
            <button onClick={clearCanvas} className="h-7 px-3 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--border-soft)] text-[10px] font-bold transition-colors">Clear</button>
            <button onClick={save} disabled={saving} className="h-7 px-4 rounded-lg bg-[var(--accent-green)] hover:bg-[var(--accent-green-dark)] text-[var(--status-green-bg)] font-bold text-[10px] transition-colors disabled:opacity-50 flex items-center gap-1.5">{saving ? <><div className="w-3 h-3 border-2 border-[var(--status-green-bg)] border-t-transparent rounded-full animate-spin" /> Saving…</> : "💾 Save Layout"}</button>
            <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border-soft)] transition-colors"><IconX /></button>
          </div>
        </div>
        <div className="flex flex-1 overflow-hidden min-h-0">
          <div className="shrink-0 border-r border-[var(--border-soft)] flex flex-col" style={{ width: 272, background: "var(--bg-canvas)" }}>
            <div className="px-3 pt-3 pb-2 shrink-0"><p className="text-[var(--accent-green)] text-[9px] font-bold uppercase tracking-widest mb-2">Components</p><input value={paletteSearch} onChange={e => setPaletteSearch(e.target.value)} placeholder="Search…" className="w-full bg-[var(--border-soft)] border border-[var(--border)] text-[var(--text-primary)] text-[10px] rounded-lg px-2 h-7 outline-none placeholder-[var(--border)] focus:border-[var(--accent-green)]/50" /></div>
            <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-1.5 mt-2" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--border) var(--bg-canvas)" }}>
              {filteredPalette.map(comp => (
                <div
                  key={comp.type}
                  draggable
                  onDragStart={e => e.dataTransfer.setData("component-type", comp.type)}
                  className="relative flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--border-soft)]/40 bg-[var(--bg-canvas)]/50 hover:border-[var(--accent-green)]/40 hover:bg-[var(--border-soft)] cursor-grab active:cursor-grabbing transition-all duration-200 group overflow-hidden shadow-sm hover:shadow-md"
                >
                  {/* Aksen garis di sebelah kiri saat hover */}
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[var(--accent-green)] scale-y-0 group-hover:scale-y-100 transition-transform duration-200 origin-center rounded-r-sm shadow-[0_0_8px_var(--accent-green)]" />

                  {/* Wadah Ikon */}
                  <div className="w-8 h-8 rounded bg-[var(--panel-canvas)] border border-[var(--border-soft)] group-hover:border-[var(--accent-green)]/50 flex items-center justify-center text-[var(--accent-green)] shrink-0 transition-all duration-200 group-hover:shadow-[0_0_10px_rgba(34,197,94,0.15)] group-hover:scale-105">
                    <span className="text-sm">{comp.icon}</span>
                  </div>

                  {/* Teks Label & Deskripsi */}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[var(--text-primary)] text-[11px] font-bold tracking-wide leading-tight group-hover:text-[var(--text-primary)] transition-colors">
                      {comp.label}
                    </span>
                    <span className="text-[var(--text-dim)] text-[9px] leading-tight truncate group-hover:text-[var(--text-secondary)] transition-colors mt-0.5">
                      {comp.desc}
                    </span>
                  </div>

                  {/* Ikon Drag (Grip) yang muncul saat hover */}
                  <div className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] group-hover:text-[var(--accent-green)]/70 transition-opacity mr-1 shrink-0">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="5" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="9" cy="19" r="1.5" />
                      <circle cx="15" cy="5" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="15" cy="19" r="1.5" />
                    </svg>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div ref={canvasContainerRef} className="flex-1 min-w-0 min-h-0 overflow-hidden flex items-center justify-center px-4 py-3" style={{ background: "var(--panel-canvas)" }}>
            {loading ? (<div className="flex items-center gap-2 text-[var(--accent-green)] text-xs mt-20"><div className="w-4 h-4 border-2 border-[var(--accent-green)] border-t-transparent rounded-full animate-spin" /> Loading layout…</div>) : (
              <div style={{ width: displayWidth, height: displayHeight, position: "relative", flex: "0 0 auto", overflow: "hidden" }}>
                <div ref={canvasRef} onDragOver={e => e.preventDefault()} onDrop={handleCanvasDrop} onClick={() => setSelected(null)} className="relative origin-top-left overflow-hidden" style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})`, background: "var(--bg-canvas)", border: "1px solid var(--border-soft)", borderRadius: 8, backgroundImage: "radial-gradient(circle, var(--border-soft) 1px, transparent 1px)", backgroundSize: `${GRID * 2}px ${GRID * 2}px` }}>
                  {widgets.length === 0 && (<div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none"><span className="text-4xl opacity-10 mb-2">🖱</span><p className="text-[var(--border-soft)] text-sm font-mono">Drag components here</p></div>)}
                  {widgets.map(widget => {
                    const isSel = widget.id === selected;
                    return (<div key={widget.id} id={`widget-${widget.id}`} onMouseDown={e => startDrag(e, widget.id)} onClick={e => { e.stopPropagation(); setSelected(widget.id); }} className="absolute select-none" style={{ left: widget.x, top: widget.y, width: widget.props.width, height: widget.props.height, cursor: dragInfo?.id === widget.id ? "grabbing" : "grab", outline: isSel ? "2px solid var(--accent-green)" : "1px solid transparent", outlineOffset: 2, borderRadius: 6, zIndex: Number.isFinite(Number(widget.zIndex)) ? Number(widget.zIndex) : 1 }}><div className="w-full h-full overflow-hidden" style={{ borderRadius: 6 }}><WidgetPreview widget={widget} onUpdate={handleWidgetUpdate} /></div>{isSel && <div className="absolute -top-5 left-0 flex items-center gap-1 pointer-events-none"><span className="text-[var(--accent-green)] text-[9px] font-bold bg-[var(--panel-canvas)] px-1.5 py-0.5 rounded font-mono capitalize">{widget.type}</span></div>}{isSel && <div onMouseDown={e => startResize(e, widget.id)} className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize" style={{ background: "var(--accent-green)", borderRadius: "2px 0 4px 0", zIndex: 20 }} />}</div>);
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="shrink-0 border-l border-[var(--border-soft)] flex flex-col" style={{ width: 296, background: "var(--bg-canvas)" }}>
            <PropertyPanel
              widget={selectedWidget}
              onChange={updated => setWidgets(ws => ws.map(w => w.id === updated.id ? updated : w))}
              onDelete={() => { setWidgets(ws => normalizeLayerOrder(ws.filter(w => w.id !== selected))); setSelected(null); }}
              onLayerAction={handleLayerAction}
              onDuplicate={() => {
                if (!selectedWidget) return;
                const newId = uid();
                let newX = selectedWidget.x + 16, newY = selectedWidget.y + 16;
                const maxX = CANVAS_W - selectedWidget.props.width, maxY = CANVAS_H - selectedWidget.props.height;
                newX = Math.min(newX, maxX); newY = Math.min(newY, maxY);
                const clone = { ...selectedWidget, id: newId, x: newX, y: newY };
                setWidgets(ws => normalizeLayerOrder([...ws, clone]));
                setSelected(newId);
              }}
              canvasWidth={CANVAS_W}
              canvasHeight={CANVAS_H}
               availableDevices={availableDevices}
            />
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-[var(--border-soft)] shrink-0" style={{ background: "var(--panel-canvas)" }}>
          <span className="text-[var(--border)] text-[9px] font-mono">{widgets.length} widget{widgets.length !== 1 ? "s" : ""} · {pageType === "dynamic" ? "Dynamic Page" : pageType === "manual" ? "Manual Page" : "Calibration Page"} · Design {CANVAS_W}×{CANVAS_H}px · Fit {Math.round(scale * 100)}% · Grid {GRID}px</span>
          {selectedWidget && <span className="text-[var(--text-muted)] text-[9px] font-mono">x:{selectedWidget.x} y:{selectedWidget.y} · {selectedWidget.props.width}×{selectedWidget.props.height}</span>}
          <span className="text-[var(--border)] text-[9px] font-mono">Del = delete · drag to move · ↘ to resize</span>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}