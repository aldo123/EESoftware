// src/widgets/shiftschedule.jsx
//
// Everything about the "shiftschedule" widget lives in this one file:
//   - shiftScheduleDef           palette entry for the Page Builder sidebar
//   - ShiftSchedulePreview       how it looks on the Page Builder canvas (design-time)
//   - ShiftSchedulePropertyPanel the property panel shown when this widget is selected
//   - RuntimeShiftSchedule       how it looks/behaves on the live Dynamic CP Page
//
// "Shift reset schedule": edits what backend/shift_reset.py does for this CP — at each reset time it pulses an
// Internal Variable (e.g. BT_ShiftReset) and the CP's Logic Builder flow does the reset (counters, Dummy Check, ...).
// The times come either from the CP's Dashboard shifts (the start of every shift) or from a custom list set here.
// Backend: GET / POST /api/shift-reset/<cp>, POST /api/shift-reset/<cp>/fire.
import { useCallback, useEffect, useState } from "react";
import { API } from "../service/api";
import { PropInput, PropSection, DEFAULT_VISUAL } from "./shared";

export const shiftScheduleDef = {
  type: "shiftschedule",
  label: "Shift Reset Schedule",
  icon: "⏱",
  desc: "Edit the shift-reset times (Dummy Check / counters)",
  defaultProps: {
    title: "Shift reset schedule",
    fontSize: 14,
    width: 560,
    height: 520,
    visual: { ...DEFAULT_VISUAL },
  },
};

const C = {
  surface: "var(--bg-elevated)", field: "var(--bg-surface-2)", border: "var(--border)", text: "var(--text-primary)", sub: "var(--text-secondary)",
  accent: "#00C896", warn: "#FF9F0A", bad: "#FF453A",
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
};

const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ""));

function Surface({ p, state, busy, message, onChange, onSave, onFire }) {
  const k = Math.max(0.5, Number(p.fontSize ?? 14) / 12);
  const { enabled, variable, custom, times, effective, lastFired, dirty } = state;
  const today = new Date().toISOString().slice(0, 10);
  const btn = (bg, fg, border) => ({
    padding: `${8 * k}px ${16 * k}px`, borderRadius: 9 * k, border: `0.5px solid ${border || bg}`, background: bg, color: fg,
    fontSize: 12 * k, fontWeight: 700, cursor: "pointer", fontFamily: C.font,
  });
  const label = { fontSize: 10 * k, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: C.sub };

  return (
    <div style={{
      position: "absolute", inset: 0, background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 14 * k,
      padding: 20 * k, boxSizing: "border-box", fontFamily: C.font, color: C.text, display: "flex", flexDirection: "column",
      gap: 14 * k, overflowY: "auto",
    }}>
      <div style={{ fontSize: 15 * k, fontWeight: 700 }}>{p.title || "Shift reset schedule"}</div>
      <div style={{ fontSize: 11 * k, color: C.sub, lineHeight: 1.45 }}>
        At each reset time the counters are zeroed and the Dummy Check is required again.
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 10 * k, cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onChange({ enabled: e.target.checked })}
               style={{ width: 16 * k, height: 16 * k, accentColor: C.accent }} />
        <span style={{ fontSize: 13 * k, fontWeight: 600 }}>Automatic reset enabled</span>
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 * k }}>
        <span style={label}>Reset times</span>
        <div style={{ display: "flex", gap: 8 * k }}>
          {[[false, "Dashboard shifts"], [true, "Custom times"]].map(([val, text]) => (
            <button key={text} type="button" onClick={() => onChange({ custom: val, times: val && !times.length ? effective.slice() : times })}
                    style={{ ...btn(custom === val ? C.accent : "transparent", custom === val ? "#0B1410" : C.sub, custom === val ? C.accent : C.border), flex: 1 }}>
              {text}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11 * k, color: C.sub }}>
          {custom ? "Reset at exactly these times, every day." : "Reset at the start of every shift set in this CP's Dashboard."}
        </div>
      </div>

      {custom && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 * k }}>
          {times.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 8 * k, alignItems: "center" }}>
              <input type="time" value={t} onChange={(e) => onChange({ times: times.map((x, j) => (j === i ? e.target.value : x)) })}
                     style={{ flex: 1, padding: `${7 * k}px ${10 * k}px`, borderRadius: 8 * k, border: `0.5px solid ${isTime(t) ? C.border : C.bad}`,
                              background: C.field, color: C.text, fontSize: 14 * k, fontFamily: "monospace",
                              colorScheme: typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark" }} />
              <button type="button" onClick={() => onChange({ times: times.filter((_, j) => j !== i) })}
                      style={{ ...btn("transparent", C.bad, C.border), padding: `${7 * k}px ${12 * k}px` }}>✕</button>
            </div>
          ))}
          <button type="button" onClick={() => onChange({ times: [...times, "08:00"] })}
                  style={{ ...btn("transparent", C.sub, C.border), borderStyle: "dashed" }}>+ Add time</button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 * k }}>
        <span style={label}>{dirty ? "Resets at (after saving)" : "Resets at"}</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 * k }}>
          {(custom ? times.filter(isTime).sort() : effective).map((t) => (
            <span key={t} style={{ padding: `${4 * k}px ${10 * k}px`, borderRadius: 8 * k, background: `${C.accent}1F`, color: C.accent,
                                   fontSize: 12 * k, fontWeight: 700, fontFamily: "monospace" }}>
              {t}{!dirty && lastFired?.[t] === today ? "  ✓ done today" : ""}
            </span>
          ))}
          {!(custom ? times.filter(isTime).length : effective.length) && (
            <span style={{ fontSize: 12 * k, color: C.warn }}>No times — set the shifts in the Dashboard or use custom times.</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 * k }}>
        <span style={label}>Trigger variable</span>
        <input value={variable} onChange={(e) => onChange({ variable: e.target.value })} spellCheck={false}
               style={{ padding: `${7 * k}px ${10 * k}px`, borderRadius: 8 * k, border: `0.5px solid ${C.border}`, background: C.field,
                        color: C.text, fontSize: 13 * k, fontFamily: "monospace" }} />
      </div>

      <div style={{ display: "flex", gap: 10 * k, alignItems: "center", marginTop: "auto" }}>
        <button type="button" disabled={busy || !dirty} onClick={onSave}
                style={{ ...btn(C.accent, "#0B1410"), opacity: busy || !dirty ? 0.45 : 1 }}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={busy} onClick={onFire} title="Run the shift reset right now (counters to 0, Dummy Check required)"
                style={btn("transparent", C.warn, C.warn + "80")}>Reset now</button>
        <span style={{ fontSize: 11 * k, color: message.startsWith("✓") ? C.accent : C.bad }}>{message}</span>
      </div>
    </div>
  );
}

const SAMPLE = { enabled: true, variable: "BT_ShiftReset", custom: true, times: ["08:00", "20:00"], effective: ["08:00", "20:00"], lastFired: {}, dirty: false };

export function ShiftSchedulePreview({ widget }) {
  return <Surface p={widget.props || {}} state={SAMPLE} busy={false} message="" onChange={() => {}} onSave={() => {}} onFire={() => {}} />;
}

export function ShiftSchedulePropertyPanel({ p, set }) {
  return (
    <PropSection title="Shift Reset Schedule">
      <PropInput label="Title" value={p.title || ""} onChange={(v) => set("title", v)} />
      <PropInput label="Font Size" type="number" min={8} max={40} value={p.fontSize ?? 14} onChange={(v) => set("fontSize", Number(v))} />
      <div className="text-[8px] text-[var(--text-dim)]">
        Edits backend/data/shift_reset.json for this CP (no restart needed). The reset itself is done by the CP's Logic Builder
        flow, which listens to the trigger variable.
      </div>
    </PropSection>
  );
}

export function RuntimeShiftSchedule({ widget, cpNumber }) {
  const p = widget.props || {};
  const [state, setState] = useState({ enabled: false, variable: "", custom: false, times: [], effective: [], lastFired: {}, dirty: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(() => {
    if (!cpNumber) return;
    fetch(`${API}/api/shift-reset/${encodeURIComponent(cpNumber)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const times = Array.isArray(d.times) ? d.times : [];
        setState({ enabled: !!d.enabled, variable: d.variable || "", custom: times.length > 0, times,
                   effective: d.effective_times || [], lastFired: d.last_fired || {}, dirty: false });
      })
      .catch(() => setMessage("✗ Cannot reach the backend"));
  }, [cpNumber]);

  useEffect(() => { load(); }, [load]);

  const onChange = (patch) => { setState((s) => ({ ...s, ...patch, dirty: true })); setMessage(""); };

  const onSave = async () => {
    const times = state.custom ? state.times : [];
    if (times.some((t) => !isTime(t))) { setMessage("✗ Fill in every time (HH:MM)"); return; }
    if (state.custom && !times.length) { setMessage("✗ Add at least one time, or use Dashboard shifts"); return; }
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/shift-reset/${encodeURIComponent(cpNumber)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: state.enabled, variable: state.variable, times }),
      });
      const d = await r.json();
      if (!d.success) { setMessage(`✗ ${d.message || "Save failed"}`); }
      else { setMessage("✓ Saved"); load(); }
    } catch { setMessage("✗ Network error"); }
    setBusy(false);
  };

  const onFire = async () => {
    if (!window.confirm("Run the shift reset now?\nCounters go back to 0 and the Dummy Check is required again.")) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/shift-reset/${encodeURIComponent(cpNumber)}/fire`, { method: "POST" });
      const d = await r.json();
      setMessage(d.success ? "✓ Reset sent" : `✗ ${d.message || "Failed"}`);
    } catch { setMessage("✗ Network error"); }
    setBusy(false);
  };

  return (
    <div className="absolute" style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}>
      <Surface p={p} state={state} busy={busy} message={message} onChange={onChange} onSave={onSave} onFire={onFire} />
    </div>
  );
}
