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

const CANVAS_PRESETS = [{ label: "Full HD • 1920 × 1080", width: 1920, height: 1080 }];
const DEFAULT_CANVAS = { width: 1920, height: 1080 };
const canvasKey = (width, height) => `${width}x${height}`;

// ── WIDGET PREVIEW (dispatches to the widget's own Preview component) ──
function WidgetPreview({ widget }) {
  const Comp = WIDGET_PREVIEWS[widget.type];
  if (!Comp) return <div className="text-[10px] text-[var(--text-muted)]">Empty Component</div>;
  return <Comp widget={widget} />;
}

// ── PROPERTY PANEL (common chrome + dispatches to the widget's own panel) ──
// Shown in the right panel instead of single-widget properties whenever
// 2+ widgets are selected — lines them up without touching width/height.
function AlignButton({ onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="h-10 rounded-lg border border-[var(--border-soft)] bg-[var(--panel-canvas)] hover:border-[var(--accent-green)]/60 hover:bg-[var(--accent-green)]/10 text-[var(--text-secondary)] hover:text-[var(--accent-green)] transition-colors flex flex-col items-center justify-center gap-0.5"
    >
      <span className="text-sm leading-none">{children}</span>
    </button>
  );
}

function AlignDistributePanel({ count, onAlign, onDelete, onDuplicate }) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-soft)] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">▦</span>
          <span className="text-[var(--text-primary)] font-bold text-xs">{count} widgets selected</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={onDuplicate} title="Duplicate" aria-label="Duplicate"
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-blue)] hover:bg-[var(--bg-hover)] transition-colors"><IconDupe /></button>
          <button type="button" onClick={onDelete} title="Delete" aria-label="Delete"
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-red)] hover:bg-[var(--status-red-bg)]/20 transition-colors"><IconTrash /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3" style={{ scrollbarWidth: "thin" }}>
        <PropSection title="Align Horizontal">
          <div className="grid grid-cols-3 gap-2">
            <AlignButton title="Align Left" onClick={() => onAlign("left")}>⊢⯀</AlignButton>
            <AlignButton title="Align Center" onClick={() => onAlign("center-h")}>⊢⯀⊣</AlignButton>
            <AlignButton title="Align Right" onClick={() => onAlign("right")}>⯀⊣</AlignButton>
          </div>
        </PropSection>

        <PropSection title="Align Vertical">
          <div className="grid grid-cols-3 gap-2">
            <AlignButton title="Align Top" onClick={() => onAlign("top")}>⊤⯀</AlignButton>
            <AlignButton title="Align Middle" onClick={() => onAlign("middle-v")}>⯀↕</AlignButton>
            <AlignButton title="Align Bottom" onClick={() => onAlign("bottom")}>⯀⊥</AlignButton>
          </div>
        </PropSection>

        <PropSection title="Distribute Spacing">
          <div className="grid grid-cols-2 gap-2">
            <AlignButton title="Distribute Horizontally (needs 3+)" onClick={() => onAlign("distribute-h")}>↔ Horizontal</AlignButton>
            <AlignButton title="Distribute Vertically (needs 3+)" onClick={() => onAlign("distribute-v")}>↕ Vertical</AlignButton>
          </div>
          {count < 3 && (
            <p className="text-[var(--text-faint)] text-[9px] mt-1">Distribute butuh minimal 3 widget dipilih.</p>
          )}
        </PropSection>
      </div>
    </div>
  );
}

function PropertyPanel({ widget, onChange, onDelete, onDuplicate, onLayerAction, canvasWidth, canvasHeight, availableDevices = [], availablePages = [] }) {
  if (!widget) return (<div className="flex flex-col items-center justify-center h-full text-center px-4"><span className="text-3xl opacity-20 mb-2">🖱</span><p className="text-[var(--text-muted)] text-[10px]">Click a widget on the canvas to edit its properties</p></div>);
  const { type, props: p, x, y } = widget;

  // Accepts either set(key, val) or set({ key1: val1, key2: val2 }) for a
  // batched update. Dispatches a { id, propsPatch } patch (merged against
  // the LIVE widget in PageBuilder's state) rather than a full replacement
  // built from this render's `p` — so several set() calls made back-to-back
  // in one handler (e.g. two related fields) no longer clobber each other.
  const set = useCallback((key, val) => {
    const patch = key && typeof key === "object" ? { ...key } : { [key]: val };
    if (Object.prototype.hasOwnProperty.call(patch, "width")) {
      const maxW = canvasWidth - x;
      patch.width = Math.min(maxW, Math.max(40, patch.width));
    }
    if (Object.prototype.hasOwnProperty.call(patch, "height")) {
      const maxH = canvasHeight - y;
      patch.height = Math.min(maxH, Math.max(24, patch.height));
    }
    onChange({ id: widget.id, propsPatch: patch });
  }, [widget, onChange, canvasWidth, canvasHeight, x, y]);

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
      return <Panel p={p} set={set} availableDevices={availableDevices} availablePages={availablePages} />;
    })()}


  </div></div>);
}

export default function PageBuilder({ cpNumber, onClose, onSaved, availableDevices = [] }) {
  // Dynamic Page is the permanent MAIN page.
  // Custom pages are stored alongside it and may be deleted.
  const [pageType, setPageType] = useState("dynamic");
  const [pages, setPages] = useState({
    dynamic: {
      name: "Dynamic Page",
      icon: "🖥",
      widgets: [],
    },
  });
  const [showCreatePage, setShowCreatePage] = useState(false);
  const [newPageName, setNewPageName] = useState("");
  const [widgets, setWidgetsRaw] = useState([]);
  // Undo/redo history for the CURRENT page's widget list. Kept as plain refs
  // (not state) since pushing to them must never itself trigger a re-render —
  // only the resulting `widgets` update should. `suppressHistoryRef` is set
  // around page loads/switches/the canvas-resize clamp effect, and around
  // continuous drag/resize gestures (which push ONE snapshot at gesture start
  // instead of one per mousemove frame).
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const suppressHistoryRef = useRef(false);
  // Widgets snapshot taken at the start of a drag/resize gesture, pushed to
  // history lazily on the gesture's first real mousemove (see below) — a
  // plain click that never moves anything should not leave an undo step.
  const gestureSnapshotRef = useRef(null);

  const pushHistory = useCallback((snapshot) => {
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    redoStackRef.current = [];
  }, []);

  const resetHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
  }, []);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const syncUndoRedoFlags = useCallback(() => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);

  // `skipHistory` is captured in the closure passed to setWidgetsRaw below,
  // so whether this particular call counts as undoable is decided at the
  // moment setWidgets() is CALLED — not read from a mutable ref at the
  // moment React eventually runs the updater. That distinction matters:
  // React 18 batches/defers state updates from effects and promises, so a
  // "suppressHistoryRef.current = true; setWidgets(...); ...= false" pattern
  // around an effect body silently did nothing (the flag was back to false
  // by the time the updater actually ran). suppressHistoryRef.current is
  // still read here as a fallback for the drag/resize gestures below, whose
  // setWidgets calls come from native mousemove listeners outside React's
  // effect scheduling and do observe the ref synchronously.
  const setWidgets = useCallback((updater, opts) => {
    const skip = opts?.skipHistory || suppressHistoryRef.current;
    setWidgetsRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (!skip && next !== prev) pushHistory(prev);
      return next;
    });
  }, [pushHistory]);

  // Keep the Undo/Redo buttons in sync with the ref-based stacks whenever
  // `widgets` changes, regardless of what caused the change.
  useEffect(() => { syncUndoRedoFlags(); }, [widgets, syncUndoRedoFlags]);

  // The stack-empty check happens INSIDE the updater, not just before calling
  // setWidgetsRaw — React 18 (StrictMode especially) can invoke an updater
  // later/twice relative to when the surrounding function ran, so a guard
  // only in the outer function body can pass twice while the stack is only
  // long enough for one pop, popping `undefined` the second time and
  // crashing on `.length`. Checking at pop-time is correct regardless of how
  // many times or when React actually runs this updater.
  const undo = useCallback(() => {
    setWidgetsRaw(prev => {
      if (undoStackRef.current.length === 0) return prev;
      const previous = undoStackRef.current.pop();
      redoStackRef.current.push(prev);
      return previous;
    });
    syncUndoRedoFlags();
  }, [syncUndoRedoFlags]);

  const redo = useCallback(() => {
    setWidgetsRaw(prev => {
      if (redoStackRef.current.length === 0) return prev;
      const next = redoStackRef.current.pop();
      undoStackRef.current.push(prev);
      return next;
    });
    syncUndoRedoFlags();
  }, [syncUndoRedoFlags]);
  const [selected, setSelected] = useState([]);
  const [clipboard, setClipboard] = useState([]);
  const [dragInfo, setDragInfo] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const marqueeRef = useRef(null);
  // A completed marquee-drag still fires a native "click" on mouseup (click
  // fires whenever mousedown/mouseup share a target, no matter how far the
  // mouse moved between them) — without this guard that click immediately
  // wiped the selection the drag had just made, so multi-select never stuck.
  const justMarqueedRef = useRef(false);
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

  const toggleSelection = useCallback((id, additive = false) => {
    setSelected(prev => {
      if (!additive) return [id];
      return prev.includes(id)
        ? prev.filter(x => x !== id)
        : [...prev, id];
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelected([]);
  }, []);

  const selectAll = useCallback(() => {
    setSelected(widgets.map(w => w.id));
  }, [widgets]);

  const switchPage = useCallback((nextPage) => {
    if (!nextPage || nextPage === pageType) return;

    setPages(prev => ({
      ...prev,
      [pageType]: {
        ...(prev[pageType] || {}),
        widgets: normalizeLayerOrder(widgets),
      },
    }));

    resetHistory();
    setWidgets(nextPage ? normalizePage(pages[nextPage]?.widgets || []) : [], { skipHistory: true });
    setSelected([]);
    setDragInfo(null);
    setResizing(null);
    setPageType(nextPage);
  }, [pageType, pages, widgets, normalizeLayerOrder, normalizePage, resetHistory]);

  const handleLayerAction = useCallback((action) => {
    if (selected.length === 0) return;

    setWidgets(prev => {
      const selectedSet = new Set(selected);

      if (action === "front") {
        const selectedItems = prev.filter(w => selectedSet.has(w.id));
        const others = prev.filter(w => !selectedSet.has(w.id));
        return normalizeLayerOrder([...others, ...selectedItems]);
      }

      if (action === "back") {
        const selectedItems = prev.filter(w => selectedSet.has(w.id));
        const others = prev.filter(w => !selectedSet.has(w.id));
        return normalizeLayerOrder([...selectedItems, ...others]);
      }

      const next = [...prev];

      if (action === "forward") {
        // Process from the end so a selected group moves forward as a unit.
        for (let i = next.length - 2; i >= 0; i--) {
          if (selectedSet.has(next[i].id) && !selectedSet.has(next[i + 1].id)) {
            [next[i], next[i + 1]] = [next[i + 1], next[i]];
          }
        }
      } else if (action === "backward") {
        // Process from the start so a selected group moves backward as a unit.
        for (let i = 1; i < next.length; i++) {
          if (selectedSet.has(next[i].id) && !selectedSet.has(next[i - 1].id)) {
            [next[i], next[i - 1]] = [next[i - 1], next[i]];
          }
        }
      }

      return normalizeLayerOrder(next);
    });
  }, [selected, normalizeLayerOrder]);

  const handleWidgetUpdate = useCallback((updatedWidget) => {
    setWidgets(prevWidgets =>
      prevWidgets.map(w => (w.id === updatedWidget.id ? updatedWidget : w))
    );
  }, []);

  // Align/distribute the currently selected widgets. `mode` is one of:
  // left/center-h/right/top/middle-v/bottom/distribute-h/distribute-v.
  // Position math only — never touches width/height, so widget content
  // (charts, tables, etc.) never gets resized by lining things up.
  const alignSelected = useCallback((mode) => {
    setWidgets(prev => {
      const selectedSet = new Set(selected);
      const targets = prev.filter(w => selectedSet.has(w.id));
      if (targets.length < 2) return prev;

      const rectOf = (w) => ({
        x: w.x,
        y: w.y,
        w: Number(w.props?.width || 0),
        h: Number(w.props?.height || 0),
      });

      const minX = Math.min(...targets.map(w => rectOf(w).x));
      const maxRight = Math.max(...targets.map(w => rectOf(w).x + rectOf(w).w));
      const minY = Math.min(...targets.map(w => rectOf(w).y));
      const maxBottom = Math.max(...targets.map(w => rectOf(w).y + rectOf(w).h));

      const updates = new Map();

      if (mode === "left") {
        targets.forEach(w => updates.set(w.id, { x: minX }));
      } else if (mode === "right") {
        targets.forEach(w => updates.set(w.id, { x: maxRight - rectOf(w).w }));
      } else if (mode === "center-h") {
        const centerX = (minX + maxRight) / 2;
        targets.forEach(w => updates.set(w.id, { x: Math.round(centerX - rectOf(w).w / 2) }));
      } else if (mode === "top") {
        targets.forEach(w => updates.set(w.id, { y: minY }));
      } else if (mode === "bottom") {
        targets.forEach(w => updates.set(w.id, { y: maxBottom - rectOf(w).h }));
      } else if (mode === "middle-v") {
        const centerY = (minY + maxBottom) / 2;
        targets.forEach(w => updates.set(w.id, { y: Math.round(centerY - rectOf(w).h / 2) }));
      } else if (mode === "distribute-h") {
        if (targets.length < 3) return prev;
        const sorted = [...targets].sort((a, b) => rectOf(a).x - rectOf(b).x);
        const totalWidth = sorted.reduce((sum, w) => sum + rectOf(w).w, 0);
        const span = (rectOf(sorted[sorted.length - 1]).x + rectOf(sorted[sorted.length - 1]).w) - rectOf(sorted[0]).x;
        const gap = (span - totalWidth) / (sorted.length - 1);
        let cursor = rectOf(sorted[0]).x;
        sorted.forEach(w => {
          updates.set(w.id, { x: Math.round(cursor) });
          cursor += rectOf(w).w + gap;
        });
      } else if (mode === "distribute-v") {
        if (targets.length < 3) return prev;
        const sorted = [...targets].sort((a, b) => rectOf(a).y - rectOf(b).y);
        const totalHeight = sorted.reduce((sum, w) => sum + rectOf(w).h, 0);
        const span = (rectOf(sorted[sorted.length - 1]).y + rectOf(sorted[sorted.length - 1]).h) - rectOf(sorted[0]).y;
        const gap = (span - totalHeight) / (sorted.length - 1);
        let cursor = rectOf(sorted[0]).y;
        sorted.forEach(w => {
          updates.set(w.id, { y: Math.round(cursor) });
          cursor += rectOf(w).h + gap;
        });
      }

      if (updates.size === 0) return prev;
      return prev.map(w => {
        const u = updates.get(w.id);
        if (!u) return w;
        return {
          ...w,
          x: u.x !== undefined ? Math.max(0, Math.min(CANVAS_W - rectOf(w).w, u.x)) : w.x,
          y: u.y !== undefined ? Math.max(0, Math.min(CANVAS_H - rectOf(w).h, u.y)) : w.y,
        };
      });
    });
  }, [selected, CANVAS_W, CANVAS_H]);

  const deleteSelected = useCallback(() => {
    if (selected.length === 0) return;
    setWidgets(ws => normalizeLayerOrder(ws.filter(w => !selected.includes(w.id))));
    setSelected([]);
  }, [selected, normalizeLayerOrder]);

  const duplicateSelected = useCallback(() => {
    if (selected.length === 0) return;

    const clones = widgets
      .filter(w => selected.includes(w.id))
      .map(w => {
        const newId = uid();
        const width = Number(w.props?.width || 40);
        const height = Number(w.props?.height || 24);
        const props = { ...structuredClone(w.props || {}) };
        if (props.variable) props.variable = `${props.variable}_copy_${newId.slice(-4)}`;

        return {
          ...structuredClone(w),
          id: newId,
          x: Math.max(0, Math.min(CANVAS_W - width, w.x + 16)),
          y: Math.max(0, Math.min(CANVAS_H - height, w.y + 16)),
          props,
        };
      });

    setWidgets(ws => normalizeLayerOrder([...ws, ...clones]));
    setSelected(clones.map(w => w.id));
  }, [selected, widgets, CANVAS_W, CANVAS_H, normalizeLayerOrder]);

  useEffect(() => {
    if (!cpNumber) { setLoading(false); return; }
    fetch(`${API}/api/page-config/${cpNumber}`)
      .then(r => r.ok ? r.json() : { widgets: [] })
      .then(d => {
        // Design canvas is fixed to Full HD.
        setCanvasPreset(CANVAS_PRESETS[0]);
        const savedPages = d?.pages && typeof d.pages === "object" ? d.pages : {};
        const legacyDynamic = Array.isArray(d?.widgets) ? d.widgets : [];
        const normalizedPages = {};

        // Dynamic Page is always the protected MAIN page.
        // If it exists in saved data, preserve its widgets.
        const savedDynamic = savedPages.dynamic;
        normalizedPages.dynamic = {
          name: "Dynamic Page",
          icon: "🖥",
          widgets: normalizePage(
            savedDynamic?.widgets ??
            legacyDynamic ??
            []
          ),
        };

        // Load all custom pages after Dynamic Page.
        Object.entries(savedPages).forEach(([key, value]) => {
          if (key === "dynamic") return;
          if (!value || typeof value !== "object") return;

          normalizedPages[key] = {
            name: value.name || key,
            icon: value.icon || "📄",
            widgets: normalizePage(value.widgets || []),
          };
        });

        setPages(normalizedPages);
        setPageType("dynamic");
        resetHistory();
        setWidgets(normalizedPages.dynamic.widgets, { skipHistory: true });
        setSelected([]);
        setDragInfo(null);
        setResizing(null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [cpNumber, normalizePage, resetHistory]);

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

  // Keep widgets inside the newly selected logical canvas. Runs on every
  // CANVAS_W/H change (including mount) and is normally a no-op — it must
  // never itself count as an undoable edit.
  useEffect(() => {
    setWidgets(prev => prev.map(w => {
      const p = w.props || {};
      const width = Math.min(Math.max(1, Number(p.width || 1)), CANVAS_W);
      const height = Math.min(Math.max(1, Number(p.height || 1)), CANVAS_H);
      const x = Math.max(0, Math.min(Number(w.x || 0), CANVAS_W - width));
      const y = Math.max(0, Math.min(Number(w.y || 0), CANVAS_H - height));
      if (x === w.x && y === w.y && width === p.width && height === p.height) return w;
      return { ...w, x, y, props: { ...p, width, height } };
    }), { skipHistory: true });
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
    setSelected([id]);
  }, [scale, CANVAS_W, CANVAS_H]);

  // Mouse marquee selection: hold left mouse on empty canvas and drag.
  const startMarquee = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target !== canvasRef.current) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;

    marqueeRef.current = {
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
      additive: e.shiftKey,
      baseSelected: e.shiftKey ? [...selected] : [],
    };
    setMarquee({ x, y, width: 0, height: 0 });
  }, [scale, selected]);

  useEffect(() => {
    if (!marquee) return;

    const onMove = (e) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(CANVAS_W, (e.clientX - rect.left) / scale));
      const y = Math.max(0, Math.min(CANVAS_H, (e.clientY - rect.top) / scale));
      const m = marqueeRef.current;
      if (!m) return;
      m.currentX = x;
      m.currentY = y;

      const left = Math.min(m.startX, x);
      const top = Math.min(m.startY, y);
      const right = Math.max(m.startX, x);
      const bottom = Math.max(m.startY, y);
      setMarquee({ x: left, y: top, width: right - left, height: bottom - top });

      // Select widgets whose rectangles intersect the marquee.
      const hitIds = widgets.filter(w => {
        const wx = Number(w.x || 0);
        const wy = Number(w.y || 0);
        const ww = Number(w.props?.width || 0);
        const wh = Number(w.props?.height || 0);
        return wx < right && wx + ww > left && wy < bottom && wy + wh > top;
      }).map(w => w.id);

      const next = m.additive
        ? Array.from(new Set([...m.baseSelected, ...hitIds]))
        : hitIds;
      setSelected(next);
    };

    const onUp = () => {
      const m = marqueeRef.current;
      if (m) {
        const moved = Math.abs(m.currentX - m.startX) > 2 || Math.abs(m.currentY - m.startY) > 2;
        if (!moved && !m.additive) setSelected([]);
        if (moved) justMarqueedRef.current = true;
      }
      marqueeRef.current = null;
      setMarquee(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [marquee, widgets, scale, CANVAS_W, CANVAS_H]);

  const startDrag = useCallback((e, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    const w = document.getElementById(`widget-${id}`);
    if (!w) return;

    // Shift-click is a selection operation. Do not start a drag for that click.
    if (e.shiftKey) {
      toggleSelection(id, true);
      return;
    }

    // Clicking an unselected widget starts a new single selection. Clicking a
    // selected widget preserves the current group so the whole group moves.
    const activeIds = selected.includes(id)
      ? [...selected]
      : [id];

    if (!selected.includes(id)) {
      setSelected([id]);
    }

    const rect = w.getBoundingClientRect();
    const offsetX = (e.clientX - rect.left) / scale;
    const offsetY = (e.clientY - rect.top) / scale;

    // One history snapshot for the whole drag, pushed lazily on the first
    // actual mousemove (see the effect below) rather than here — a plain
    // click with no movement should not leave a no-op undo step behind.
    gestureSnapshotRef.current = widgets;
    suppressHistoryRef.current = true;

    setDragInfo({
      id,
      selectedIds: activeIds,
      offsetX,
      offsetY,
    });
  }, [scale, selected, toggleSelection, widgets]);

  useEffect(() => {
    if (!dragInfo) return;

    const onMove = (e) => {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;

      if (gestureSnapshotRef.current) {
        pushHistory(gestureSnapshotRef.current);
        gestureSnapshotRef.current = null;
      }

      const mouseX = (e.clientX - canvasRect.left) / scale;
      const mouseY = (e.clientY - canvasRect.top) / scale;
      const anchorX = snap(mouseX - dragInfo.offsetX);
      const anchorY = snap(mouseY - dragInfo.offsetY);

      setWidgets(ws => {
        const dragged = ws.find(w => w.id === dragInfo.id);
        if (!dragged) return ws;

        const dx = anchorX - dragged.x;
        const dy = anchorY - dragged.y;
        const selectedIds = dragInfo.selectedIds || [dragInfo.id];

        return ws.map(w => {
          if (!selectedIds.includes(w.id)) return w;

          const maxX = CANVAS_W - w.props.width;
          const maxY = CANVAS_H - w.props.height;

          return {
            ...w,
            x: Math.max(0, Math.min(maxX, snap(w.x + dx))),
            y: Math.max(0, Math.min(maxY, snap(w.y + dy))),
          };
        });
      });
    };

    const onUp = () => {
      setDragInfo(null);
      gestureSnapshotRef.current = null;
      suppressHistoryRef.current = false;
      syncUndoRedoFlags();
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragInfo, scale, CANVAS_W, CANVAS_H, pushHistory, syncUndoRedoFlags]);

  const startResize = useCallback((e, id) => {
    e.stopPropagation(); e.preventDefault();
    const widget = widgets.find(w => w.id === id);
    if (!widget) return;
    // Same lazy-snapshot approach as startDrag — see gestureSnapshotRef above.
    gestureSnapshotRef.current = widgets;
    suppressHistoryRef.current = true;
    setResizing({ id, startX: e.clientX, startY: e.clientY, startW: widget.props.width, startH: widget.props.height });
  }, [widgets]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e) => {
      if (gestureSnapshotRef.current) {
        pushHistory(gestureSnapshotRef.current);
        gestureSnapshotRef.current = null;
      }
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
    const onUp = () => {
      setResizing(null);
      gestureSnapshotRef.current = null;
      suppressHistoryRef.current = false;
      syncUndoRedoFlags();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [resizing, scale, CANVAS_W, CANVAS_H, pushHistory, syncUndoRedoFlags]);

  const save = useCallback(async () => {
    setSaving(true); setSaveMsg("");
    try {
      const canvas = { width: CANVAS_W, height: CANVAS_H };
      const finalPages = {
        dynamic: {
          name: "Dynamic Page",
          icon: "🖥",
          widgets:
            pageType === "dynamic"
              ? normalizeLayerOrder(widgets)
              : normalizePage(pages.dynamic?.widgets || []),
        },
        ...Object.fromEntries(
          Object.entries(pages).filter(([key]) => key !== "dynamic")
        ),
      };

      if (pageType && pageType !== "dynamic") {
        finalPages[pageType] = {
          ...(pages[pageType] || { name: "Page", icon: "📄" }),
          widgets: normalizeLayerOrder(widgets),
        };
      }
      const cleanPages = Object.fromEntries(
        Object.entries(finalPages).map(([key, value]) => [
          key,
          {
            name: value?.name || key,
            icon: value?.icon || "📄",
            widgets: normalizePage(value?.widgets || []),
          },
        ])
      );
      const r = await fetch(`${API}/api/page-config/${cpNumber}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Keep legacy widgets populated with the active page for older readers.
          widgets: cleanPages.dynamic?.widgets || [],
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
      if (d.success) {
        setSaveMsg("✓ Saved!");
        onSaved?.();
      } else {
        setSaveMsg("✗ Save failed");
      }
    } catch { setSaveMsg("✗ Network error"); }
    setSaving(false);
    setTimeout(() => setSaveMsg(""), 3000);
  }, [cpNumber, pages, pageType, widgets, CANVAS_W, CANVAS_H, normalizeLayerOrder, normalizePage, onSaved]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const target = e.target;

      // Never hijack typing inside the property panel or palette search.
      if (
        target &&
        (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable
        )
      ) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Ctrl+Z — undo. Ctrl+Shift+Z / Ctrl+Y — redo.
      if (ctrl && key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (ctrl && ((key === "z" && e.shiftKey) || key === "y")) {
        e.preventDefault();
        redo();
        return;
      }

      // Ctrl+A — select all widgets.
      if (ctrl && key === "a") {
        e.preventDefault();
        setSelected(widgets.map(w => w.id));
        return;
      }

      // Ctrl+C — copy selected widgets.
      if (ctrl && key === "c") {
        if (selected.length === 0) return;
        e.preventDefault();
        setClipboard(
          widgets
            .filter(w => selected.includes(w.id))
            .map(w => structuredClone(w))
        );
        return;
      }

      // Ctrl+X — cut selected widgets.
      if (ctrl && key === "x") {
        if (selected.length === 0) return;
        e.preventDefault();

        const copied = widgets
          .filter(w => selected.includes(w.id))
          .map(w => structuredClone(w));
        setClipboard(copied);

        setWidgets(prev =>
          normalizeLayerOrder(prev.filter(w => !selected.includes(w.id)))
        );
        setSelected([]);
        return;
      }

      // Ctrl+V — paste a fresh copy with fresh widget IDs.
      if (ctrl && key === "v") {
        if (clipboard.length === 0) return;
        e.preventDefault();

        const pasted = clipboard.map(w => {
          const newId = uid();
          const width = Number(w.props?.width || 40);
          const height = Number(w.props?.height || 24);
          const x = Math.max(0, Math.min(CANVAS_W - width, Number(w.x || 0) + 20));
          const y = Math.max(0, Math.min(CANVAS_H - height, Number(w.y || 0) + 20));

          const props = {
            ...structuredClone(w.props || {}),
          };

          // Variables must not accidentally collide with the source widget.
          if (props.variable) props.variable = `${props.variable}_copy_${newId.slice(-4)}`;

          return {
            ...structuredClone(w),
            id: newId,
            x,
            y,
            props,
          };
        });

        setWidgets(prev => normalizeLayerOrder([...prev, ...pasted]));
        setSelected(pasted.map(w => w.id));
        return;
      }

      // Ctrl+D — duplicate selected widgets in-place with an offset.
      if (ctrl && key === "d") {
        if (selected.length === 0) return;
        e.preventDefault();

        const clones = widgets
          .filter(w => selected.includes(w.id))
          .map(w => {
            const newId = uid();
            const width = Number(w.props?.width || 40);
            const height = Number(w.props?.height || 24);
            const props = { ...structuredClone(w.props || {}) };
            if (props.variable) props.variable = `${props.variable}_copy_${newId.slice(-4)}`;

            return {
              ...structuredClone(w),
              id: newId,
              x: Math.max(0, Math.min(CANVAS_W - width, Number(w.x || 0) + 20)),
              y: Math.max(0, Math.min(CANVAS_H - height, Number(w.y || 0) + 20)),
              props,
            };
          });

        setWidgets(prev => normalizeLayerOrder([...prev, ...clones]));
        setSelected(clones.map(w => w.id));
        return;
      }

      // Delete / Backspace — delete the whole selection.
      if ((e.key === "Delete" || e.key === "Backspace") && selected.length > 0) {
        e.preventDefault();
        setWidgets(prev =>
          normalizeLayerOrder(prev.filter(w => !selected.includes(w.id)))
        );
        setSelected([]);
        return;
      }

      if (selected.length === 0) return;

      // [ / ] — layer operations. Shift sends to absolute front/back.
      if (e.key === "]" || e.key === "[") {
        e.preventDefault();

        setWidgets(prev => {
          const selectedSet = new Set(selected);
          const selectedWidgets = prev.filter(w => selectedSet.has(w.id));
          const unselectedWidgets = prev.filter(w => !selectedSet.has(w.id));

          if (e.key === "]") {
            if (e.shiftKey) return normalizeLayerOrder([...unselectedWidgets, ...selectedWidgets]);

            const next = [...prev];
            selected.forEach(id => {
              const index = next.findIndex(w => w.id === id);
              if (index >= 0 && index < next.length - 1) {
                [next[index], next[index + 1]] = [next[index + 1], next[index]];
              }
            });
            return normalizeLayerOrder(next);
          }

          if (e.shiftKey) return normalizeLayerOrder([...selectedWidgets, ...unselectedWidgets]);

          const next = [...prev];
          [...selected].reverse().forEach(id => {
            const index = next.findIndex(w => w.id === id);
            if (index > 0) {
              [next[index], next[index - 1]] = [next[index - 1], next[index]];
            }
          });
          return normalizeLayerOrder(next);
        });
        return;
      }

      // Arrow keys — move the entire selection by one grid step.
      let dx = 0;
      let dy = 0;
      if (e.key === "ArrowLeft") dx = -GRID;
      if (e.key === "ArrowRight") dx = GRID;
      if (e.key === "ArrowUp") dy = -GRID;
      if (e.key === "ArrowDown") dy = GRID;

      if (dx !== 0 || dy !== 0) {
        e.preventDefault();
        const multiplier = e.shiftKey ? 5 : 1;
        dx *= multiplier;
        dy *= multiplier;

        setWidgets(prev =>
          prev.map(w => {
            if (!selected.includes(w.id)) return w;

            const maxX = CANVAS_W - w.props.width;
            const maxY = CANVAS_H - w.props.height;

            return {
              ...w,
              x: Math.max(0, Math.min(maxX, snap(w.x + dx))),
              y: Math.max(0, Math.min(maxY, snap(w.y + dy))),
            };
          })
        );
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, widgets, clipboard, normalizeLayerOrder, CANVAS_W, CANVAS_H, undo, redo]);


  const createPage = useCallback(() => {
    const name = newPageName.trim();
    if (!name) return;

    const baseId = `page_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    let id = baseId;
    let counter = 1;

    while (pages[id] || id === "dynamic") {
      id = `${baseId}_${counter++}`;
    }

    const newPage = {
      name,
      icon: "📄",
      widgets: [],
    };

    setPages(prev => ({ ...prev, [id]: newPage }));
    setPageType(id);
    resetHistory();
    setWidgets([], { skipHistory: true });
    setSelected([]);
    setDragInfo(null);
    setResizing(null);
    setShowCreatePage(false);
    setNewPageName("");
  }, [newPageName, pages, resetHistory]);

  const deleteCurrentPage = useCallback(() => {
    if (!pageType || pageType === "dynamic") return;

    const pageName = pages[pageType]?.name || pageType;
    const confirmed = window.confirm(`Delete page "${pageName}"?`);
    if (!confirmed) return;

    const remaining = Object.keys(pages).filter(key => key !== pageType);
    const nextPage = remaining[0] || null;

    setPages(prev => {
      const next = { ...prev };
      delete next[pageType];
      return next;
    });

    setPageType(nextPage);
    resetHistory();
    setWidgets(nextPage ? normalizePage(pages[nextPage]?.widgets || []) : [], { skipHistory: true });
    setSelected([]);
    setDragInfo(null);
    setResizing(null);
  }, [pageType, pages, normalizePage, resetHistory]);

  const clearCanvas = useCallback(() => {
    setWidgets([]);
    setSelected([]);
    if (pageType) {
      setPages(prev => ({
        ...prev,
        [pageType]: {
          ...(prev[pageType] || { name: "Page", icon: "📄" }),
          widgets: [],
        },
      }));
    }
  }, [pageType]);
  const selectedWidget = useMemo(() => {
    if (selected.length !== 1) return null;
    return widgets.find(w => w.id === selected[0]) || null;
  }, [widgets, selected]);
  const filteredPalette = useMemo(() => COMPONENT_TYPES.filter(c => c.label.toLowerCase().includes(paletteSearch.toLowerCase()) || c.desc.toLowerCase().includes(paletteSearch.toLowerCase())), [paletteSearch]);

  const displayWidth = CANVAS_W * scale;
  const displayHeight = CANVAS_H * scale;

  return (
    <ModalBackdrop className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm font-sans">
      <ModalPanel className="relative flex flex-col rounded-2xl overflow-hidden border border-[var(--border)] shadow-2xl" style={{ width: "min(99vw, 1920px)", height: "min(97vh, 1040px)", background: "var(--panel-canvas)" }}>
        <div className="flex items-center justify-between gap-x-3 gap-y-2 flex-wrap px-5 py-3 border-b border-[var(--border-soft)] shrink-0" style={{ background: "var(--bg-surface-2)" }}>
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <span className="text-[var(--accent-green)] font-black text-lg tracking-tighter shrink-0">WIK</span>
            <div className="w-px h-5 bg-[var(--border)] shrink-0" />
            <span className="text-[var(--text-primary)] font-bold text-sm shrink-0">Page Builder</span>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[var(--accent-green)]/15 text-[var(--accent-green)] border border-[var(--accent-green)]/30 shrink-0">CP{String(cpNumber).padStart(2, "0")}</span>
            <div className="flex items-center gap-1 ml-2 p-1 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-canvas)] flex-wrap max-w-full overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
              {Object.entries(pages).map(([key, page]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => switchPage(key)}
                  title={page.name}
                  className={`h-6 px-2.5 rounded-md text-[9px] font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap ${pageType === key ? "bg-[var(--accent-green)] text-[var(--status-green-bg)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border-soft)]"}`}
                >
                  <span>{page.icon || "📄"}</span>{page.name || key}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setNewPageName("");
                  setShowCreatePage(true);
                }}
                title="Create New Page"
                className="h-6 px-2.5 rounded-md text-[10px] font-black flex items-center gap-1.5 text-[var(--accent-green)] hover:bg-[var(--accent-green)]/10 border border-dashed border-[var(--accent-green)]/40 transition-colors whitespace-nowrap"
              >
                <span>＋</span> Create Page
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Canvas</span>
              <span className="px-2 h-7 inline-flex items-center rounded border border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--accent-green)] text-[10px] font-bold font-mono whitespace-nowrap">FULL HD · 1920 × 1080</span>
            </div>
            {saveMsg && <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${saveMsg.startsWith("✓") ? "text-[var(--accent-green)] bg-[var(--accent-green)]/10" : "text-[var(--accent-red)] bg-[var(--accent-red)]/10"}`}>{saveMsg}</span>}
            {pageType && pageType !== "dynamic" && (
              <button onClick={deleteCurrentPage} className="h-7 px-3 rounded-lg border border-[var(--accent-red)]/30 text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10 text-[10px] font-bold transition-colors">Delete Page</button>
            )}
            <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" className="w-7 h-7 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--border-soft)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-xs font-bold">↶</button>
            <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" className="w-7 h-7 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--border-soft)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-xs font-bold">↷</button>
            <button onClick={clearCanvas} className="h-7 px-3 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--border-soft)] text-[10px] font-bold transition-colors">Clear</button>
            <button onClick={save} disabled={saving || !pageType} className="h-7 px-4 rounded-lg bg-[var(--accent-green)] hover:bg-[var(--accent-green-dark)] text-[var(--status-green-bg)] font-bold text-[10px] transition-colors disabled:opacity-50 flex items-center gap-1.5">{saving ? <><div className="w-3 h-3 border-2 border-[var(--status-green-bg)] border-t-transparent rounded-full animate-spin" /> Saving…</> : "💾 Save Layout"}</button>
            <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border-soft)] transition-colors"><IconX /></button>
          </div>
        </div>
        <div className="flex flex-1 overflow-hidden min-h-0">
          <div className="shrink-0 border-r border-[var(--border-soft)] flex flex-col" style={{ width: "clamp(200px, 16vw, 272px)", background: "var(--bg-canvas)" }}>
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
                <div ref={canvasRef} onMouseDown={startMarquee} onDragOver={e => e.preventDefault()} onDrop={handleCanvasDrop} onClick={e => { if (justMarqueedRef.current) { justMarqueedRef.current = false; return; } if (e.target === canvasRef.current && !marquee) clearSelection(); }} className="relative origin-top-left overflow-hidden" style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})`, background: "var(--bg-canvas)", border: "1px solid var(--border-soft)", borderRadius: 8, backgroundImage: "radial-gradient(circle, var(--border-soft) 1px, transparent 1px)", backgroundSize: `${GRID * 2}px ${GRID * 2}px` }}>
                  {marquee && <div className="absolute pointer-events-none" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height, border: "1px dashed var(--accent-green)", background: "var(--accent-green)", opacity: 0.12, zIndex: 999999 }} /> }
                  {widgets.length === 0 && (<div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none"><span className="text-4xl opacity-10 mb-2">{pageType ? "🖱" : "📄"}</span><p className="text-[var(--border-soft)] text-sm font-mono">{pageType ? "Drag components here" : "Create a Page to start designing"}</p></div>)}
                  {widgets.map(widget => {
                    const isSel = selected.includes(widget.id);
                    return (<div key={widget.id} id={`widget-${widget.id}`} onMouseDown={e => startDrag(e, widget.id)} onClick={e => { e.stopPropagation(); }} className="absolute select-none" style={{ left: widget.x, top: widget.y, width: widget.props.width, height: widget.props.height, cursor: dragInfo?.id === widget.id ? "grabbing" : "grab", outline: isSel ? "2px solid var(--accent-green)" : "1px solid transparent", outlineOffset: 2, borderRadius: 6, zIndex: Number.isFinite(Number(widget.zIndex)) ? Number(widget.zIndex) : 1 }}><div className="w-full h-full overflow-hidden" style={{ borderRadius: 6 }}><WidgetPreview widget={widget} onUpdate={handleWidgetUpdate} /></div>{isSel && <div className="absolute -top-5 left-0 flex items-center gap-1 pointer-events-none"><span className="text-[var(--accent-green)] text-[9px] font-bold bg-[var(--panel-canvas)] px-1.5 py-0.5 rounded font-mono capitalize">{widget.type}</span></div>}{isSel && <div onMouseDown={e => startResize(e, widget.id)} className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize" style={{ background: "var(--accent-green)", borderRadius: "2px 0 4px 0", zIndex: 20 }} />}</div>);
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="shrink-0 border-l border-[var(--border-soft)] flex flex-col overflow-y-auto" style={{ width: "clamp(220px, 17vw, 296px)", background: "var(--bg-canvas)", scrollbarWidth: "thin" }}>
            {selected.length > 1 ? (
              <AlignDistributePanel
                count={selected.length}
                onAlign={alignSelected}
                onDelete={deleteSelected}
                onDuplicate={duplicateSelected}
              />
            ) : (
              <PropertyPanel
                widget={selectedWidget}
                onChange={updated => setWidgets(ws => ws.map(w => {
                  if (w.id !== updated.id) return w;
                  return updated.propsPatch
                    ? { ...w, props: { ...w.props, ...updated.propsPatch } }
                    : updated;
                }))}
                onDelete={deleteSelected}
                onLayerAction={handleLayerAction}
                onDuplicate={duplicateSelected}
                canvasWidth={CANVAS_W}
                canvasHeight={CANVAS_H}
                availableDevices={availableDevices}
                availablePages={Object.entries(pages).map(([id, page]) => ({ id, name: page?.name || id }))}
              />
            )}
          </div>
        </div>
        {showCreatePage && (
          <div
            className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onMouseDown={e => {
              if (e.target === e.currentTarget) setShowCreatePage(false);
            }}
          >
            <div
              className="w-[360px] rounded-xl border border-[var(--border)] shadow-2xl p-5"
              style={{ background: "var(--bg-surface-2)" }}
              onMouseDown={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-[var(--text-primary)] font-bold text-sm">Create New Page</div>
                  <div className="text-[var(--text-muted)] text-[10px] mt-1">Create a blank page for your HMI layout.</div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreatePage(false)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border-soft)]"
                >
                  <IconX />
                </button>
              </div>

              <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1.5">
                Page Name
              </label>
              <input
                autoFocus
                value={newPageName}
                onChange={e => setNewPageName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") createPage();
                  if (e.key === "Escape") setShowCreatePage(false);
                }}
                placeholder="e.g. Inspection Page"
                className="w-full h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] text-[var(--text-primary)] text-xs outline-none focus:border-[var(--accent-green)]"
              />

              <div className="flex justify-end gap-2 mt-5">
                <button
                  type="button"
                  onClick={() => setShowCreatePage(false)}
                  className="h-8 px-4 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--border-soft)] text-[10px] font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={createPage}
                  disabled={!newPageName.trim()}
                  className="h-8 px-4 rounded-lg bg-[var(--accent-green)] text-[var(--status-green-bg)] text-[10px] font-bold disabled:opacity-40"
                >
                  Create Page
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-1.5 border-t border-[var(--border-soft)] shrink-0" style={{ background: "var(--panel-canvas)" }}>
          <span className="text-[var(--border)] text-[9px] font-mono">{widgets.length} widget{widgets.length !== 1 ? "s" : ""} · {pages[pageType]?.name || "No Page"} · Design {CANVAS_W}×{CANVAS_H}px · Fit {Math.round(scale * 100)}% · Grid {GRID}px</span>
          {selectedWidget && <span className="text-[var(--text-muted)] text-[9px] font-mono">x:{selectedWidget.x} y:{selectedWidget.y} · {selectedWidget.props.width}×{selectedWidget.props.height}</span>}
          {!selectedWidget && selected.length > 0 && <span className="text-[var(--text-muted)] text-[9px] font-mono">{selected.length} widgets selected</span>}
          <span className="text-[var(--border)] text-[9px] font-mono">Shift+Click = multi-select · Ctrl+C/V = copy/paste · Del = delete · Arrows = move</span>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}