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
    triggerSource: "internal",
    triggerVariable: "",
    triggerValue: 1,
    triggerDevice: "",
    triggerAddressType: "coil",
    triggerAddress: "",
    triggerLogicVariable: "",
    reopenText: "REOPEN POPUP",
    reopenEnabled: true,
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

export function PopupPropertyPanel({ p, set, availablePages = [], availableDevices = [], availableInternalVariables = [] }) {
  const pages = availablePages.filter(page => page && page.id !== "dynamic");
  const internalVariables = Array.isArray(availableInternalVariables) ? availableInternalVariables : [];
  const source = String(p.triggerSource || "internal").toLowerCase();
  return (
    <>
      <PropSection title="Popup Content">
        <label className="text-[9px] text-[var(--text-muted)]">Target Page</label>
        <select value={p.targetPage || ""} onChange={e => set("targetPage", e.target.value)} className="w-full h-8 mt-1 rounded border border-[var(--border)] bg-[var(--bg-surface)] text-[10px] text-[var(--text-primary)] px-2 outline-none">
          <option value="">Select Page…</option>
          {pages.map(page => (
            <option key={page.id} value={page.id}>
              {page.name}{page.kind === "popup" ? " (Popup Page)" : ""}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <PropInput label="Popup Width" type="number" min={240} value={p.popupWidth ?? 800} onChange={v => set("popupWidth", Math.max(240, Number(v) || 240))} />
          <PropInput label="Popup Height" type="number" min={160} value={p.popupHeight ?? 500} onChange={v => set("popupHeight", Math.max(160, Number(v) || 160))} />
        </div>
        <p className="text-[8px] text-[var(--text-faint)] mt-1">Ukuran window popup runtime. Isi popup dibuat pada Popup Page dengan canvas yang dapat diatur sendiri.</p>
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
        <p className="text-[8px] text-[var(--text-faint)] mt-1">Hanya Internal Variable yang terdaftar pada CP aktif.</p>
        <PropInput label="Trigger Value" type="text" value={p.triggerValue ?? 1} onChange={v => set("triggerValue", v)} />
        <label className="flex items-center gap-2 text-[9px] text-[var(--text-secondary)] mt-2">
          <input type="checkbox" checked={p.reopenEnabled !== false} onChange={e => set("reopenEnabled", e.target.checked)} />
          Enable Reopen when Popup is closed
        </label>
        <label className="text-[9px] text-[var(--text-muted)] block mt-2">Reopen Text</label>
        <input value={p.reopenText || "REOPEN POPUP"} onChange={e => set("reopenText", e.target.value)} className="w-full h-8 mt-1 rounded border border-[var(--border)] bg-[var(--bg-surface)] text-[10px] text-[var(--text-primary)] px-2 outline-none" />
        <p className="text-[8px] text-[var(--text-faint)] mt-1">Saat trigger masih aktif tetapi Popup ditutup dengan klik area luar atau tombol Close, widget Popup pada posisi Page Builder berubah menjadi tombol Reopen. Saat trigger OFF, widget kembali hidden.</p>
      </PropSection>
    </>
  );
}

// Runtime dispatch is handled by DynamicCPPage because it owns page state,
// internal variables, TCP values and the popup window shell.
// The same Popup widget also renders its Page Builder-positioned Reopen UI.
// No separate reopenpopup widget is required.
export function RuntimePopup({ widget, visible = false, onReopen }) {
  const p = widget?.props || {};
  if (!visible || p.reopenEnabled === false) return null;

  const label = p.reopenText || "REOPEN POPUP";
  const width = Math.max(1, Number(p.width || 180));
  const height = Math.max(1, Number(p.height || 72));

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onReopen?.();
      }}
      title="Reopen Popup"
      style={{
        width: "100%",
        height: "100%",
        minWidth: width,
        minHeight: height,
        borderRadius: 10,
        border: "1px solid rgba(59,130,246,.45)",
        background: "rgba(15,23,42,.88)",
        color: "#e2e8f0",
        fontSize: Math.max(10, Math.min(18, height * 0.22)),
        fontWeight: 700,
        cursor: "pointer",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        boxShadow: "0 4px 18px rgba(0,0,0,.18)",
      }}
    >
      <span>↗</span>
      <span>{label}</span>
    </button>
  );
}
