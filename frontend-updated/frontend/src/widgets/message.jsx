// src/widgets/message.jsx
//
// Central runtime information / event log widget.
//
// The DynamicCPPage owns the communication log and passes it here.
// This keeps Message as a normal Page Builder widget while allowing
// it to display SYSTEM / DEVICE / COM / TCP / INTERNAL activity.

import { useEffect, useMemo, useRef } from "react";
import { PropInput, PropSection } from "./shared";

const DEFAULT_PROPS = {
  width: 620,
  height: 300,

  title: "Message",
  fontSize: 11,
  lineHeight: 1.45,

  textColor: "#D7E7F5",
  backgroundColor: "#06131F",
  backgroundOpacity: 92,
  borderColor: "#1E3A4D",
  borderWidth: 1,
  borderRadius: 8,

  showTimestamp: true,
  showLevel: true,
  showSource: true,
  autoScroll: true,
  wrapText: false,

  maxMessages: 500,
  filter: "all",

  showClearButton: true,
  showHeader: true,
};

const COLORS = {
  green: "var(--accent-green)",
  blue: "var(--accent-blue)",
  red: "var(--accent-red)",
  orange: "var(--accent-orange)",
  purple: "var(--accent-purple)",
};

function alphaHex(hex, opacity) {
  const value = String(hex || "").trim();
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match) return value || "#06131F";
  const alpha = Math.round(Math.max(0, Math.min(100, Number(opacity ?? 100))) * 2.55);
  return `${value}${alpha.toString(16).padStart(2, "0")}`;
}

function messageText(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function levelColor(level) {
  const value = String(level || "INFO").toUpperCase();
  if (value === "ERROR") return COLORS.red;
  if (value === "WARNING" || value === "WARN") return COLORS.orange;
  if (value === "RX") return COLORS.blue;
  if (value === "TX") return COLORS.purple;
  return COLORS.green;
}

function matchesFilter(log, filter) {
  const f = String(filter || "all").toLowerCase();
  if (f === "all") return true;

  const source = String(log?.source || "SYSTEM").toLowerCase();
  const level = String(log?.level || "info").toLowerCase();

  if (f === "system") return source === "system";
  if (f === "device") return source === "device";
  if (f === "com") return source === "com";
  if (f === "tcp") return source === "tcp";
  if (f === "internal") return source === "internal";
  if (f === "error") return level === "error";
  if (f === "warning") return level === "warning" || level === "warn";
  if (f === "rx") return level === "rx";
  if (f === "tx") return level === "tx";
  if (f === "info") return level === "info";

  return true;
}

function formatLog(log, p) {
  const pieces = [];

  if (p.showTimestamp !== false) {
    pieces.push(`[${log?.time || "--:--:--"}]`);
  }

  if (p.showSource !== false) {
    pieces.push(`[${String(log?.source || "SYSTEM").toUpperCase()}]`);
  }

  if (p.showLevel !== false) {
    pieces.push(`[${String(log?.level || "INFO").toUpperCase()}]`);
  }

  pieces.push(messageText(log?.message ?? ""));

  return pieces.join(" ");
}

export const messageDef = {
  type: "message",
  label: "Message",
  icon: "☷",
  desc: "System, device, COM, TCP/IP and internal variable information log",
  defaults: DEFAULT_PROPS,
};

export function MessagePreview({ widget }) {
  const p = { ...DEFAULT_PROPS, ...(widget?.props || {}) };

  const demo = [
    { time: "08:15:21", source: "SYSTEM", level: "INFO", message: "Application started" },
    { time: "08:15:22", source: "DEVICE", level: "INFO", message: "TCP/IP connected — PLC_01" },
    { time: "08:15:23", source: "COM", level: "RX", message: "Scanner_01 — ABC123" },
    { time: "08:15:24", source: "TCP", level: "RX", message: "PLC_01 / Holding Register 100 — 125.4" },
    { time: "08:15:25", source: "INTERNAL", level: "INFO", message: "Counter: 10 → 11" },
  ];

  return (
    <div
      className="w-full h-full overflow-hidden font-mono"
      style={{
        background: alphaHex(p.backgroundColor, p.backgroundOpacity),
        border: `${Number(p.borderWidth ?? 1)}px solid ${p.borderColor || "#1E3A4D"}`,
        borderRadius: Number(p.borderRadius ?? 8),
        color: p.textColor || "#D7E7F5",
      }}
    >
      {p.showHeader !== false && (
        <div
          className="flex items-center justify-between px-3"
          style={{
            height: 28,
            borderBottom: "1px solid rgba(255,255,255,.08)",
          }}
        >
          <span className="text-[10px] font-bold tracking-wider">MESSAGE</span>
          <span className="text-[9px] opacity-50">LIVE</span>
        </div>
      )}

      <div className="p-2 space-y-1 overflow-hidden" style={{ fontSize: Math.max(8, Number(p.fontSize || 11)) }}>
        {demo.slice(-4).map((item, i) => (
          <div key={i} className="truncate">
            <span style={{ color: levelColor(item.level) }}>
              {formatLog(item, p)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MessagePropertyPanel({ p, set }) {
  const value = { ...DEFAULT_PROPS, ...(p || {}) };

  return (
    <>
      <PropSection title="Message">
        <PropInput label="Title" value={value.title} onChange={(v) => set("title", v)} />
        <div className="grid grid-cols-2 gap-2">
          <PropInput label="Font Size" type="number" min={7} max={40} value={value.fontSize} onChange={(v) => set("fontSize", v)} />
          <PropInput label="Line Height" type="number" min={1} max={3} step={0.05} value={value.lineHeight} onChange={(v) => set("lineHeight", v)} />
          <PropInput label="Max Messages" type="number" min={10} max={5000} value={value.maxMessages} onChange={(v) => set("maxMessages", v)} />
          <PropInput label="Border Width" type="number" min={0} max={10} value={value.borderWidth} onChange={(v) => set("borderWidth", v)} />
          <PropInput label="Border Radius" type="number" min={0} max={40} value={value.borderRadius} onChange={(v) => set("borderRadius", v)} />
          <PropInput label="Background Opacity" type="number" min={0} max={100} value={value.backgroundOpacity} onChange={(v) => set("backgroundOpacity", v)} />
        </div>
      </PropSection>

      <PropSection title="Filter">
        <select
          value={value.filter || "all"}
          onChange={(e) => set("filter", e.target.value)}
          className="w-full h-8 rounded-md px-2 text-[10px] bg-[var(--bg-canvas)] border border-[var(--border)] text-[var(--text-primary)] outline-none"
        >
          <option value="all">All Messages</option>
          <option value="system">System</option>
          <option value="device">Device</option>
          <option value="com">COM / RS232</option>
          <option value="tcp">TCP / IP</option>
          <option value="internal">Internal Variable</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
          <option value="rx">RX</option>
          <option value="tx">TX</option>
        </select>
      </PropSection>

      <PropSection title="Display">
        <div className="grid grid-cols-2 gap-2">
          {[
            ["showTimestamp", "Timestamp"],
            ["showSource", "Source"],
            ["showLevel", "Level"],
            ["autoScroll", "Auto Scroll"],
            ["wrapText", "Wrap Text"],
            ["showClearButton", "Clear Button"],
            ["showHeader", "Header"],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 h-7 text-[10px] text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={value[key] !== false}
                onChange={(e) => set(key, e.target.checked)}
              />
              {label}
            </label>
          ))}
        </div>
      </PropSection>

      <PropSection title="Colors">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[9px] text-[var(--text-muted)]">
            Text
            <input type="color" value={value.textColor || "#D7E7F5"} onChange={(e) => set("textColor", e.target.value)} className="block w-full h-8 mt-1 bg-transparent cursor-pointer" />
          </label>
          <label className="text-[9px] text-[var(--text-muted)]">
            Background
            <input type="color" value={value.backgroundColor || "#06131F"} onChange={(e) => set("backgroundColor", e.target.value)} className="block w-full h-8 mt-1 bg-transparent cursor-pointer" />
          </label>
          <label className="text-[9px] text-[var(--text-muted)]">
            Border
            <input type="color" value={value.borderColor || "#1E3A4D"} onChange={(e) => set("borderColor", e.target.value)} className="block w-full h-8 mt-1 bg-transparent cursor-pointer" />
          </label>
        </div>
      </PropSection>
    </>
  );
}

export function RuntimeMessage({ widget, logs = [], onClear }) {
  const p = { ...DEFAULT_PROPS, ...(widget?.props || {}) };
  const scrollRef = useRef(null);
  const userScrolledRef = useRef(false);

  const visibleLogs = useMemo(() => {
    const source = Array.isArray(logs) ? logs : [];
    const filtered = source.filter((log) => matchesFilter(log, p.filter));
    const max = Math.max(1, Number(p.maxMessages || 500));
    return filtered.slice(-max);
  }, [logs, p.filter, p.maxMessages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || p.autoScroll === false || userScrolledRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [visibleLogs.length, p.autoScroll]);

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden font-mono"
      style={{
        background: alphaHex(p.backgroundColor, p.backgroundOpacity),
        border: `${Number(p.borderWidth ?? 1)}px solid ${p.borderColor || "#1E3A4D"}`,
        borderRadius: Number(p.borderRadius ?? 8),
        color: p.textColor || "#D7E7F5",
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {p.showHeader !== false && (
        <div
          className="flex items-center justify-between gap-2 px-2 shrink-0"
          style={{
            height: 30,
            borderBottom: "1px solid rgba(255,255,255,.09)",
            background: "rgba(255,255,255,.025)",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span style={{ color: COLORS.green }}>☷</span>
            <span
              className="font-bold truncate"
              style={{ fontSize: Math.max(8, Number(p.fontSize || 11)) }}
            >
              {p.title || "Message"}
            </span>
            <span className="text-[8px] opacity-40">
              {visibleLogs.length}
            </span>
          </div>

          {p.showClearButton !== false && (
            <button
              type="button"
              onClick={() => {
                userScrolledRef.current = false;
                onClear?.();
              }}
              className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 text-[8px] opacity-70 hover:opacity-100"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2"
        style={{
          fontSize: Math.max(7, Number(p.fontSize || 11)),
          lineHeight: Number(p.lineHeight || 1.45),
          scrollbarWidth: "thin",
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          userScrolledRef.current = distanceFromBottom > 16;
        }}
      >
        {visibleLogs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center opacity-30 text-[10px]">
            No messages
          </div>
        ) : (
          visibleLogs.map((log, index) => (
            <div
              key={log?.id || `${log?.timestamp || index}-${index}`}
              className="flex gap-2 px-1 py-0.5 rounded hover:bg-white/[0.025]"
              style={{
                whiteSpace: p.wrapText ? "normal" : "nowrap",
              }}
            >
              <span
                className="shrink-0"
                style={{
                  color: log?.color || levelColor(log?.level),
                }}
              >
                {formatLog(log, p)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default RuntimeMessage;