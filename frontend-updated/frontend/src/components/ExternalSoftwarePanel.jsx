// src/components/ExternalSoftwarePanel.jsx
// Placeholder panel: the external .exe window is positioned by the Electron
// main process on top of this element's rectangle.
//
// fit="Fit"    -> the program window is stretched to the panel.
// fit="Scroll" -> the program keeps its original size; only a viewport is
//                 visible and the scrollbars below move the window behind it.
import { useEffect, useRef, useState } from "react";

const SB = 14; // scrollbar thickness (css px)

// "1920x1300" -> { width: 1920, height: 1300 } (physical pixels), or null for auto
const parseSize = (s) => {
  const m = /^\s*(\d{3,5})\s*[x×*,]\s*(\d{3,5})\s*$/i.exec(s || "");
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
};

function ScrollBar({ vertical, view, content, offset, onChange }) {
  const trackRef = useRef(null);
  const max = Math.max(0, content - view);
  const thumb = Math.min(view, Math.max(28, Math.round((view * view) / content)));
  const travel = Math.max(1, view - thumb);
  const pos = max ? Math.round((offset / max) * travel) : 0;

  const onThumbDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const start = vertical ? e.clientY : e.clientX;
    const startOff = offset;
    const move = (ev) => {
      const d = (vertical ? ev.clientY : ev.clientX) - start;
      onChange(Math.min(max, Math.max(0, startOff + (d * max) / travel)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onTrackDown = (e) => {
    const rect = trackRef.current.getBoundingClientRect();
    const p = vertical ? e.clientY - rect.top : e.clientX - rect.left;
    if (p < pos) onChange(Math.max(0, offset - view * 0.9));
    else if (p > pos + thumb) onChange(Math.min(max, offset + view * 0.9));
  };

  return (
    <div
      ref={trackRef}
      onPointerDown={onTrackDown}
      className="relative w-full h-full bg-[#111827] border border-[#1f2937]"
    >
      <div
        onPointerDown={onThumbDown}
        className="absolute rounded bg-[#4b5563] hover:bg-[#6b7280] cursor-pointer"
        style={
          vertical
            ? { left: 2, right: 2, top: pos, height: thumb }
            : { top: 2, bottom: 2, left: pos, width: thumb }
        }
      />
    </div>
  );
}

export default function ExternalSoftwarePanel({
  exePath, args, windowTitle, method = "Overlay", fit = "Fit", contentSize = "", visible,
}) {
  const ref = useRef(null);
  const sendRef = useRef(null);
  const [status, setStatus] = useState("starting"); // starting | running | stopped | error
  const [message, setMessage] = useState("");
  const [size, setSize] = useState({ w: 0, h: 0 });        // panel size (css px)
  const [content, setContent] = useState(null);             // program's original size (css px)
  const [offset, setOffset] = useState({ x: 0, y: 0 });     // scroll offset (css px)
  const api = window.electronAPI;
  const supported = !!api?.embedExternal;
  const scrollMode = fit === "Scroll" && method !== "Attach";

  // ── scrollbar layout ──
  const W = size.w;
  const H = size.h;
  let needH = false;
  let needV = false;
  if (scrollMode && content && W && H) {
    needH = content.width > W + 1;
    needV = content.height > H + 1;
    if (needH && !needV && content.height > H - SB) needV = true;
    if (needV && !needH && content.width > W - SB) needH = true;
  }
  const viewW = Math.max(0, W - (needV ? SB : 0));
  const viewH = Math.max(0, H - (needH ? SB : 0));
  const maxX = scrollMode && content ? Math.max(0, content.width - viewW) : 0;
  const maxY = scrollMode && content ? Math.max(0, content.height - viewH) : 0;
  const offX = Math.round(Math.min(offset.x, maxX));
  const offY = Math.round(Math.min(offset.y, maxY));

  // Track the panel size
  useEffect(() => {
    if (!supported) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((p) => (Math.abs(p.w - width) < 0.5 && Math.abs(p.h - height) < 0.5 ? p : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [supported]);

  // Tell Electron where to put the program window
  useEffect(() => {
    if (!supported) return undefined;
    const el = ref.current;
    if (!el) return undefined;

    let cancelled = false;
    let timer = null;

    const send = async (restart = false) => {
      const r = el.getBoundingClientRect();
      const bounds = {
        x: Math.round(r.x), y: Math.round(r.y),
        width: Math.round(r.width), height: Math.round(r.height),
      };
      try {
        const res = await api.embedExternal({
          exePath,
          args: args || "",
          windowTitle: windowTitle || "",
          method: method === "Attach" ? "attach" : "overlay",
          fit: scrollMode ? "scroll" : "fit",
          view: scrollMode && viewW > 0 && viewH > 0
            ? { x: bounds.x, y: bounds.y, width: Math.round(viewW), height: Math.round(viewH) }
            : undefined,
          offset: scrollMode ? { x: offX, y: offY } : undefined,
          contentPx: scrollMode ? parseSize(contentSize) || undefined : undefined,
          visible,
          restart,
          bounds,
        });
        if (cancelled) return;
        if (res?.ok) {
          setStatus("running");
          setMessage("");
          if (res.content) {
            setContent((p) =>
              p && Math.abs(p.width - res.content.width) < 1 && Math.abs(p.height - res.content.height) < 1
                ? p
                : res.content
            );
          }
        } else if (res?.stopped) {
          setStatus("stopped");
          setMessage(res.error || "The external program was closed.");
        } else if (res?.error !== "cancelled") {
          setStatus("error");
          setMessage(res?.error || "Failed to start external software");
        }
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setMessage(String(e?.message || e));
        }
      }
    };
    sendRef.current = send;

    // Debounce: ResizeObserver can fire many times during layout
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => send(false), 30);
    };

    // The program ended by itself (closed its window / exited)
    const offStopped = api.onExternalStopped?.((d) => {
      if (cancelled) return;
      setStatus("stopped");
      setMessage(d?.message || "The external program was closed.");
    });

    send(false);
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener("resize", schedule);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      offStopped?.();
    };
  }, [supported, exePath, args, windowTitle, method, scrollMode, contentSize, visible, viewW, viewH, offX, offY]);

  // Close the external program when this panel is removed (mode switched back, path cleared)
  useEffect(() => {
    return () => {
      window.electronAPI?.closeExternal?.();
    };
  }, [exePath, args, windowTitle, method]);

  if (!supported) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-sm text-[var(--text-muted)]">
        External Software mode only works in the desktop (Electron) app.
      </div>
    );
  }

  return (
    <div ref={ref} className="flex-1 relative bg-black overflow-hidden">
      {status !== "running" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-sm text-center text-[var(--text-muted)]">
          {status === "starting" && "Starting external software…"}
          {(status === "error" || status === "stopped") && (
            <span className="text-[#FCA5A5] font-mono whitespace-pre-wrap">{message}</span>
          )}
          {(status === "error" || status === "stopped") && (
            <button
              type="button"
              onClick={() => {
                setStatus("starting");
                sendRef.current?.(true);
              }}
              className="px-4 py-2 text-xs font-semibold border border-[var(--border)] hover:border-[#22C55E]/50 text-[var(--text-secondary)] hover:text-[#22C55E] rounded-lg transition-colors"
            >
              Restart
            </button>
          )}
        </div>
      )}

      {status === "running" && scrollMode && content && (
        <>
          {needV && (
            <div className="absolute right-0 top-0" style={{ width: SB, height: viewH }}>
              <ScrollBar
                vertical
                view={viewH}
                content={content.height}
                offset={offY}
                onChange={(v) => setOffset((o) => ({ ...o, y: v }))}
              />
            </div>
          )}
          {needH && (
            <div className="absolute left-0 bottom-0" style={{ width: viewW, height: SB }}>
              <ScrollBar
                view={viewW}
                content={content.width}
                offset={offX}
                onChange={(v) => setOffset((o) => ({ ...o, x: v }))}
              />
            </div>
          )}
          {needV && needH && (
            <div className="absolute right-0 bottom-0 bg-[#111827]" style={{ width: SB, height: SB }} />
          )}
        </>
      )}
    </div>
  );
}
