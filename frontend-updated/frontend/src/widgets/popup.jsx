import React from "react";
import { PropInput, PropSection } from "./shared";

export const popupDef = {
  type: "popup",
  label: "Popup",
  icon: "▣",
  desc: "Popup custom page yang muncul saat trigger aktif",
  defaultProps: {
    width: 180,
    height: 72,
    targetPage: "",
    popupWidth: 800,
    popupHeight: 500,
    title: "Popup",
    showHeader: true,
    closeOnOutside: true,
    triggerVariable: "",
    triggerValue: 1,
  },
};

export function PopupPreview({ widget }) {
  const p = widget?.props || {};
  return (
    <div className="w-full h-full flex items-center justify-center rounded-md" style={{background:"linear-gradient(135deg, rgba(34,197,94,.14), rgba(59,130,246,.10))",border:"1px dashed rgba(34,197,94,.55)"}}>
      <div className="text-center leading-tight">
        <div className="text-lg">▣</div>
        <div className="text-[10px] font-bold text-[var(--text-primary)]">POPUP</div>
        <div className="text-[8px] text-[var(--text-muted)] truncate max-w-[150px]">{p.targetPage || "Select Page"}</div>
        <div className="text-[7px] text-[var(--text-faint)] mt-0.5">{Number(p.popupWidth||800)}×{Number(p.popupHeight||500)}</div>
      </div>
    </div>
  );
}

export function PopupPropertyPanel({ p, set, availablePages = [], availableInternalVariables = [] }) {
  const pages = availablePages.filter(page => page && page.id !== "dynamic");
  const internalVariables = Array.isArray(availableInternalVariables) ? availableInternalVariables : [];
  return (
    <>
      <PropSection title="Popup Content">
        <label className="text-[9px] text-[var(--text-muted)]">Target Page</label>
        <select value={p.targetPage || ""} onChange={e => set("targetPage", e.target.value)} className="w-full h-8 mt-1 rounded border border-[var(--border)] bg-[var(--bg-surface)] text-[10px] text-[var(--text-primary)] px-2 outline-none">
          <option value="">Select Page…</option>
          {pages.map(page => <option key={page.id} value={page.id}>{page.name}{page.kind === "popup" ? " (Popup Page)" : ""}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <PropInput label="Popup Width" type="number" min={240} value={p.popupWidth ?? 800} onChange={v => set("popupWidth", Math.max(240, Number(v) || 240))} />
          <PropInput label="Popup Height" type="number" min={160} value={p.popupHeight ?? 500} onChange={v => set("popupHeight", Math.max(160, Number(v) || 160))} />
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <label className="flex items-center gap-2 text-[9px] text-[var(--text-secondary)]"><input type="checkbox" checked={p.showHeader !== false} onChange={e => set("showHeader", e.target.checked)} /> Header</label>
          <label className="flex items-center gap-2 text-[9px] text-[var(--text-secondary)]"><input type="checkbox" checked={p.closeOnOutside !== false} onChange={e => set("closeOnOutside", e.target.checked)} /> Close outside</label>
        </div>
        <label className="text-[9px] text-[var(--text-muted)] block mt-2">Title</label>
        <input value={p.title || ""} onChange={e => set("title", e.target.value)} className="w-full h-8 mt-1 rounded border border-[var(--border)] bg-[var(--bg-surface)] text-[10px] text-[var(--text-primary)] px-2 outline-none" />
      </PropSection>

      <PropSection title="Trigger">
        <label className="text-[9px] text-[var(--text-muted)] block">Internal Variable (CP aktif)</label>
        <select value={p.triggerVariable || ""} onChange={e => set("triggerVariable", e.target.value)} className="w-full h-8 mt-1 rounded border border-[var(--border)] bg-[var(--bg-surface)] text-[10px] text-[var(--text-primary)] px-2 outline-none">
          <option value="">Select Internal Variable…</option>
          {internalVariables.map(v => {
            const name = typeof v === "string" ? v : v?.name;
            if (!name) return null;
            return <option key={String(name)} value={String(name)}>{String(name)}</option>;
          })}
        </select>
        <PropInput label="Trigger Value" type="text" value={p.triggerValue ?? 1} onChange={v => set("triggerValue", v)} />
        <p className="text-[8px] text-[var(--text-faint)] mt-1">Popup aktif hanya jika Internal Variable CP aktif sama dengan Trigger Value.</p>
      </PropSection>
    </>
  );
}

// Runtime dispatch is handled by DynamicCPPage because it owns page state,
// internal variables, TCP values and the popup window shell.
export function RuntimePopup() { return null; }
