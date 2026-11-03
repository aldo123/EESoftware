// src/widgets/logtable.jsx
//
// Everything about the "logtable" widget lives in this one file:
//   - logTableDef            palette entry for the Page Builder sidebar
//   - LogTablePreview        how it looks on the Page Builder canvas (design-time)
//   - LogTablePropertyPanel  the property panel shown when this widget is selected
//   - RuntimeLogTable        how it looks/behaves on the live Dynamic CP Page
//
// "Today's Log": a collapsible table of today's rows from this CP's SN List (the production log the
// Logic Builder "Write SN List" node fills). Collapsed it is a slim header with a "N test" badge;
// "Show" opens the table (upwards when anchored at the bottom of the page, so it overlays the page
// instead of needing reserved space).
import { useEffect, useMemo, useState } from "react";
import { API } from "../service/api";
import { PropInput, PropSection, DEFAULT_VISUAL } from "./shared";

// ────────────────────────────────────────────────────────────────
//  PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

const DEFAULT_COLUMNS = [
  { label: "Date", field: "date_time", kind: "date" },
  { label: "Time", field: "date_time", kind: "time" },
  { label: "Bubble Count", field: "bubble_count", kind: "text" },
  { label: "Result", field: "result", kind: "result" },
];

export const logTableDef = {
  type: "logtable",
  label: "Today's Log",
  icon: "📋",
  desc: "Collapsible table of today's SN List rows",
  defaultProps: {
    title: "Today's Log",
    columns: DEFAULT_COLUMNS,
    resultField: "result",
    countLabel: "test",
    maxRows: 200,
    refreshMs: 2000,
    defaultOpen: false,
    openUpwards: true,
    fontSize: 14,
    width: 900,
    height: 320,
    visual: { ...DEFAULT_VISUAL },
  },
};

const C = {
  surface: "var(--bg-elevated)", border: "var(--border)", text: "var(--text-primary)", sub: "var(--text-secondary)",
  accent: "#00C896", ok: "#30D158", ng: "#FF453A",
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
};

const pad2 = (n) => String(n).padStart(2, "0");
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const cellText = (row, col) => {
  const raw = row?.[col.field];
  if (raw === undefined || raw === null || raw === "") return "—";
  const text = String(raw);
  if (col.kind === "date") return text.split(/[ T]/)[0] || "—";
  if (col.kind === "time") return (text.split(/[ T]/)[1] || "—").slice(0, 8);
  return text;
};

// ────────────────────────────────────────────────────────────────
//  SHARED SURFACE
// ────────────────────────────────────────────────────────────────

function LogTableSurface({ p, rows, total, open, onToggle }) {
  const k = Math.max(0.5, Number(p.fontSize ?? 14) / 12);
  const columns = Array.isArray(p.columns) && p.columns.length ? p.columns : DEFAULT_COLUMNS;
  const headerH = Math.round(46 * k);
  const fullH = Number(p.height || 320);
  const panelH = open ? fullH : headerH;
  const up = p.openUpwards !== false;
  const resultField = p.resultField || "result";

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", fontFamily: C.font }}>
      <div
        style={{
          position: "absolute", left: 0, right: 0, [up ? "bottom" : "top"]: 0, height: panelH, pointerEvents: "auto",
          background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 14 * k, overflow: "hidden",
          boxSizing: "border-box", display: "flex", flexDirection: "column", transition: "height 0.2s ease",
          boxShadow: open ? "0 -8px 30px rgba(0,0,0,0.45)" : "none",
        }}
      >
        <div
          style={{
            height: headerH, flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: `0 ${18 * k}px`, borderBottom: open ? `0.5px solid ${C.border}` : "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 * k }}>
            <span style={{ fontSize: 13 * k, fontWeight: 600, color: C.text }}>{p.title || "Today's Log"}</span>
            {total > 0 && (
              <span style={{
                fontSize: 10 * k, padding: `${2 * k}px ${9 * k}px`, borderRadius: 10 * k, fontWeight: 700,
                background: `${C.accent}20`, color: C.accent,
              }}>
                {total} {p.countLabel || "test"}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onToggle}
            style={{
              padding: `${5 * k}px ${12 * k}px`, borderRadius: 7 * k, border: `0.5px solid ${C.border}`,
              background: "transparent", color: C.sub, fontSize: 11 * k, fontWeight: 500, cursor: "pointer", fontFamily: C.font,
            }}
          >
            {open ? "Hide ↓" : "Show ↑"}
          </button>
        </div>

        {open && (
          <div style={{ flex: "1 1 auto", overflowY: "auto", minHeight: 0 }}>
            {rows.length === 0 ? (
              <div style={{ textAlign: "center", padding: 28 * k, color: C.sub, fontSize: 13 * k }}>No logs yet today.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 * k }}>
                <thead>
                  <tr>
                    {columns.map((col, i) => (
                      <th
                        key={i}
                        style={{
                          textAlign: "left", padding: `${8 * k}px ${14 * k}px`, fontSize: 10 * k, fontWeight: 700,
                          letterSpacing: 1, textTransform: "uppercase", color: C.sub, borderBottom: `0.5px solid ${C.border}`,
                          background: C.surface, position: "sticky", top: 0,
                        }}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => {
                    const isOK = String(row?.[resultField] ?? "").toUpperCase() === "OK";
                    const tone = isOK ? C.ok : C.ng;
                    return (
                      <tr
                        key={row?.id ?? ri}
                        style={{ borderBottom: `0.5px solid ${C.border}`, background: ri === 0 ? `${tone}14` : "transparent" }}
                      >
                        {columns.map((col, ci) => (
                          <td key={ci} style={{ padding: `${7 * k}px ${14 * k}px`, fontFamily: col.kind === "result" ? C.font : "monospace" }}>
                            {col.kind === "result" ? (
                              <span style={{
                                padding: `${2 * k}px ${10 * k}px`, borderRadius: 4, fontSize: 11 * k, fontWeight: 700,
                                background: `${(String(row?.[col.field] ?? "").toUpperCase() === "OK") ? C.ok : C.ng}2E`,
                                color: (String(row?.[col.field] ?? "").toUpperCase() === "OK") ? C.ok : C.ng,
                              }}>
                                {cellText(row, col)}
                              </span>
                            ) : (
                              <span style={{ color: col.kind === "time" ? C.sub : C.text }}>{cellText(row, col)}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

const SAMPLE_ROWS = [
  { id: 3, date_time: "2026-01-01 08:15:30", bubble_count: "2", result: "OK" },
  { id: 2, date_time: "2026-01-01 08:14:12", bubble_count: "6", result: "NG" },
  { id: 1, date_time: "2026-01-01 08:12:05", bubble_count: "3", result: "OK" },
];

export function LogTablePreview({ widget }) {
  const p = widget.props || {};
  return <LogTableSurface p={p} rows={SAMPLE_ROWS} total={SAMPLE_ROWS.length} open={true} onToggle={() => {}} />;
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function LogTablePropertyPanel({ p, set }) {
  const columns = Array.isArray(p.columns) && p.columns.length ? p.columns : DEFAULT_COLUMNS;
  const updateColumn = (i, patch) => set("columns", columns.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <>
      <PropSection title="Table">
        <PropInput label="Title" value={p.title || ""} onChange={(v) => set("title", v)} />
        <PropInput label="Count badge word" value={p.countLabel ?? "test"} onChange={(v) => set("countLabel", v)} />
        <PropInput label="Result column (OK / NG coloring)" value={p.resultField || "result"} onChange={(v) => set("resultField", v)} />
        <PropInput label="Max rows" type="number" min={1} max={2000} value={p.maxRows ?? 200} onChange={(v) => set("maxRows", Number(v))} />
        <PropInput label="Refresh (ms)" type="number" min={500} value={p.refreshMs ?? 2000} onChange={(v) => set("refreshMs", Number(v))} />
        <PropInput label="Open on load" type="checkbox" value={p.defaultOpen === true} onChange={(v) => set("defaultOpen", v)} />
        <PropInput label="Open upwards (widget sits at page bottom)" type="checkbox" value={p.openUpwards !== false} onChange={(v) => set("openUpwards", v)} />
        <PropInput label="Font Size" type="number" min={8} max={40} value={p.fontSize ?? 14} onChange={(v) => set("fontSize", Number(v))} />
        <div className="text-[8px] text-[var(--text-dim)]">
          Rows come from this CP's SN List (today only), newest first. Widget height = height when opened.
        </div>
      </PropSection>

      <PropSection title="Columns (SN List field names)">
        {columns.map((col, i) => (
          <div key={i} className="grid grid-cols-3 gap-1.5 items-end">
            <PropInput label="Header" value={col.label} onChange={(v) => updateColumn(i, { label: v })} />
            <PropInput label="Field" value={col.field} onChange={(v) => updateColumn(i, { field: v })} />
            <PropInput
              label="Show as"
              options={[
                { value: "text", label: "Text" },
                { value: "date", label: "Date" },
                { value: "time", label: "Time" },
                { value: "result", label: "OK/NG tag" },
              ]}
              value={col.kind || "text"}
              onChange={(v) => updateColumn(i, { kind: v })}
            />
          </div>
        ))}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => set("columns", [...columns, { label: "Column", field: "", kind: "text" }])}
            className="flex-1 h-7 rounded border border-dashed border-[var(--border)] text-[10px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            + Add column
          </button>
          {columns.length > 1 && (
            <button
              type="button"
              onClick={() => set("columns", columns.slice(0, -1))}
              className="h-7 px-3 rounded border border-[var(--border)] text-[10px] font-semibold text-red-400"
            >
              Remove last
            </button>
          )}
        </div>
      </PropSection>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
//  DYNAMIC CP PAGE — RUNTIME
// ────────────────────────────────────────────────────────────────

export function RuntimeLogTable({ widget, cpNumber }) {
  const p = widget.props || {};
  const [open, setOpen] = useState(p.defaultOpen === true);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const refreshMs = Math.max(500, Number(p.refreshMs) || 2000);
  const maxRows = Math.min(2000, Math.max(1, Number(p.maxRows) || 200));

  useEffect(() => {
    if (!cpNumber) return undefined;
    let cancelled = false;

    const load = () => {
      const day = localToday();
      const url = `${API}/api/snlist/data?cp=${encodeURIComponent(cpNumber)}&date_from=${day}&per=${maxRows}&page=1`;
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled || !d) return;
          setRows(Array.isArray(d.data) ? d.data : []);
          setTotal(Number(d.total) || 0);
        })
        .catch(() => {});
    };

    load();
    const timer = setInterval(load, refreshMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [cpNumber, refreshMs, maxRows]);

  const stableRows = useMemo(() => rows, [rows]);

  return (
    <div className="absolute" style={{ left: widget.x, top: widget.y, width: p.width, height: p.height, pointerEvents: "none" }}>
      <LogTableSurface p={p} rows={stableRows} total={total} open={open} onToggle={() => setOpen((v) => !v)} />
    </div>
  );
}
