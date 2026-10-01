// src/modal/DashboardModal.jsx
//
// Configurable production dashboard.
// Reads the same SN List data used by routes/dashboard.py.
// KPI formats:
//   1) FPY / Pass / NG / Total QTY
//   2) Pass1 / Pass2 / FPY1 / FPY2 / Total QTY
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { API } from "../service/api";

const PASS_COLOR = "#22C55E";
const PASS2_COLOR = "#3B82F6";
const NG_COLOR = "#EF4444";
const ACCENT = "#3B82F6";

const DEFAULT_SHIFTS = [
  { id: "shift1", label: "Shift 1", start: "08:00", end: "19:30" },
  { id: "shift2", label: "Shift 2", start: "20:00", end: "07:30" },
];

const DEFAULT_SETTINGS = {
  kpi_format: "fpy_pass_ng_total",
  sn_column: "auto",
  fpy_formula: { numerator: "pass", denominator: "total_qty", multiplier: 100 },
  fpy1_formula: { numerator: "pass1", denominator: "total_qty", multiplier: 100 },
  fpy2_formula: { numerator: "pass", denominator: "total_qty", multiplier: 100 },
  shifts: DEFAULT_SHIFTS,
};

const FORMULA_OPTIONS = [
  { value: "pass1", label: "Pass1" },
  { value: "pass2", label: "Pass2" },
  { value: "pass", label: "Pass (Pass1 + Pass2)" },
  { value: "ng", label: "NG" },
  { value: "total_qty", label: "Total QTY" },
  { value: "test_qty", label: "Test QTY" },
  { value: "ok_records", label: "OK Test Records" },
  { value: "ng_records", label: "NG Test Records" },
];

const cloneSettings = (value) =>
  JSON.parse(JSON.stringify(value || DEFAULT_SETTINGS));

function formulaText(f) {
  if (!f) return "—";
  return `${f.numerator} ÷ ${f.denominator} × ${f.multiplier}`;
}

function FpyHeroCard({ fpy, totalQty }) {
  const color =
    totalQty === 0
      ? "var(--text-muted)"
      : fpy >= 95
      ? PASS_COLOR
      : fpy >= 85
      ? "#F59E0B"
      : NG_COLOR;

  return (
    <div
      className="relative overflow-hidden rounded-2xl flex-shrink-0"
      style={{
        width: 220,
        background: "linear-gradient(135deg, var(--card-grad-start) 0%, var(--bg-surface) 100%)",
        border: "1px solid var(--border)",
        padding: "14px 16px",
      }}
    >
      <div
        className="absolute top-0 right-0 w-28 h-28 rounded-full blur-2xl"
        style={{ background: `${color}18` }}
      />
      <div className="relative z-10 flex flex-col h-full justify-between">
        <span className="text-[var(--text-secondary)] text-xs font-bold tracking-widest uppercase mb-2">
          FPY
        </span>
        <span className="font-bold text-4xl leading-none mb-2" style={{ color }}>
          {totalQty === 0 ? "—" : `${Number(fpy || 0).toFixed(1)}%`}
        </span>
        <span className="text-[var(--text-secondary)] text-xs">Configured FPY Formula</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, sub }) {
  return (
    <div
      className="flex-1 min-w-[130px] flex flex-col items-center justify-center rounded-xl text-center"
      style={{
        background: "linear-gradient(135deg, var(--card-grad-start) 0%, var(--bg-surface) 100%)",
        border: "1px solid var(--border)",
        padding: "14px 8px",
      }}
    >
      <span className="text-[var(--text-secondary)] text-xs font-bold tracking-widest uppercase mb-2">
        {label}
      </span>
      <span className="font-bold text-3xl leading-tight" style={{ color }}>
        {value}
      </span>
      {sub && <span className="text-[var(--text-secondary)] text-xs mt-1">{sub}</span>}
    </div>
  );
}

function Select({ value, onChange, options, className = "" }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`bg-[var(--bg-surface)] border border-[var(--border)] focus:border-[#22C55E]/60 text-[var(--text-primary)] text-xs rounded-lg px-2 h-8 outline-none transition-colors ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function DateInput({ value, onChange }) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-[var(--bg-surface)] border border-[var(--border)] focus:border-[#22C55E]/60 text-[var(--text-primary)] text-xs rounded-lg px-2 h-8 outline-none transition-colors"
    />
  );
}

function Button({ children, onClick, active, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 px-3 rounded-lg border text-[11px] font-bold transition-colors whitespace-nowrap ${
        active
          ? "border-[#22C55E]/60 text-[#22C55E] bg-[#22C55E]/10"
          : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
      } ${className}`}
    >
      {children}
    </button>
  );
}

function fmtDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysDate(value, days) {
  const [y, m, d] = String(value || "").split("-").map(Number);
  if (!y || !m || !d) return fmtDate(new Date());
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return fmtDate(date);
}

function isOvernightShift(shift) {
  return String(shift?.end || "00:00") <= String(shift?.start || "00:00");
}

function shiftDatesForAnchor(anchorDate, shift) {
  if (!shift) return { from: anchorDate, to: anchorDate };
  return {
    from: isOvernightShift(shift) ? addDaysDate(anchorDate, -1) : anchorDate,
    to: anchorDate,
  };
}

function currentShiftForNow(shifts, now = new Date()) {
  const list = Array.isArray(shifts) ? shifts : [];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  for (const shift of list) {
    const [sh, sm] = String(shift?.start || "00:00").split(":").map(Number);
    const [eh, em] = String(shift?.end || "00:00").split(":").map(Number);
    const start = (sh || 0) * 60 + (sm || 0);
    const end = (eh || 0) * 60 + (em || 0);
    const active = end > start
      ? currentMinutes >= start && currentMinutes < end
      : currentMinutes >= start || currentMinutes < end;
    if (active) return shift;
  }
  return null;
}

function defaultDashboardRange(shifts) {
  const now = new Date();
  const today = fmtDate(now);
  const active = currentShiftForNow(shifts, now);

  if (!active) {
    return { shiftId: "all", from: today, to: today };
  }

  // For an overnight shift at 03:12 on 27 Sep, this becomes
  // 26 Sep -> 27 Sep, i.e. 26 Sep 20:00 -> 27 Sep 07:30.
  const range = shiftDatesForAnchor(today, active);
  return { shiftId: active.id, ...range };
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 shadow-xl">
      <div className="text-[10px] text-[var(--text-muted)] mb-1">{label}</div>
      {payload.map((p) => (
        <div
          key={p.dataKey}
          className="text-[11px] font-semibold flex items-center gap-1.5"
          style={{ color: p.color }}
        >
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          {p.name}: {p.value}
          {String(p.dataKey || "").startsWith("fpy") ? "%" : ""}
        </div>
      ))}
    </div>
  );
}

function FormulaEditor({ title, formula, onChange }) {
  const f = formula || DEFAULT_SETTINGS.fpy_formula;

  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-[11px] font-bold text-[var(--text-primary)]">{title}</div>
          <div className="text-[9px] text-[var(--text-muted)] mt-0.5">
            {formulaText(f)}
          </div>
        </div>
        <span className="text-[9px] text-[var(--text-muted)]">Numerator ÷ Denominator × Multiplier</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <label className="block">
          <span className="block text-[9px] uppercase font-bold text-[var(--text-muted)] mb-1">
            Numerator
          </span>
          <Select
            value={f.numerator}
            onChange={(v) => onChange({ ...f, numerator: v })}
            options={FORMULA_OPTIONS}
            className="w-full"
          />
        </label>

        <label className="block">
          <span className="block text-[9px] uppercase font-bold text-[var(--text-muted)] mb-1">
            Denominator
          </span>
          <Select
            value={f.denominator}
            onChange={(v) => onChange({ ...f, denominator: v })}
            options={FORMULA_OPTIONS}
            className="w-full"
          />
        </label>

        <label className="block">
          <span className="block text-[9px] uppercase font-bold text-[var(--text-muted)] mb-1">
            Multiplier
          </span>
          <input
            type="number"
            step="0.1"
            value={f.multiplier}
            onChange={(e) =>
              onChange({
                ...f,
                multiplier: Number.isFinite(Number(e.target.value))
                  ? Number(e.target.value)
                  : 100,
              })
            }
            className="w-full h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] px-2 text-xs outline-none focus:border-[#22C55E]/60"
          />
        </label>
      </div>
    </div>
  );
}

function ShiftEditor({ shifts, onChange }) {
  const list = Array.isArray(shifts) && shifts.length ? shifts : DEFAULT_SHIFTS;

  const updateAt = (index, patch) => {
    const next = list.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange(next);
  };

  const addShift = () => {
    if (list.length >= 8) return;
    const index = list.length;
    onChange([
      ...list,
      { id: `shift${index + 1}`, label: `Shift ${index + 1}`, start: "00:00", end: "00:00" },
    ]);
  };

  const removeShift = (index) => {
    if (list.length <= 1) return;
    onChange(list.filter((_, i) => i !== index));
  };

  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <div className="text-[10px] font-bold text-[#22C55E] uppercase tracking-widest">Shift Settings</div>
          <div className="text-[9px] text-[var(--text-muted)] mt-1">Adjust shift name, start and end time. A shift may cross midnight.</div>
        </div>
        <button type="button" onClick={addShift} disabled={list.length >= 8} className="h-8 px-3 rounded-lg border border-[#22C55E]/50 text-[#22C55E] text-[10px] font-bold hover:bg-[#22C55E]/10 disabled:opacity-30 disabled:cursor-not-allowed">
          + Add Shift
        </button>
      </div>

      <div className="space-y-2">
        {list.map((shift, index) => (
          <div key={shift.id || index} className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr_auto] gap-2 items-end rounded-lg border border-[var(--border-soft)] p-2">
            <label className="block">
              <span className="block text-[9px] uppercase font-bold text-[var(--text-muted)] mb-1">Name</span>
              <input value={shift.label || `Shift ${index + 1}`} onChange={(e) => updateAt(index, { label: e.target.value })} className="w-full h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] px-2 text-xs outline-none focus:border-[#22C55E]/60" />
            </label>
            <label className="block">
              <span className="block text-[9px] uppercase font-bold text-[var(--text-muted)] mb-1">Start</span>
              <input type="time" value={shift.start || "00:00"} onChange={(e) => updateAt(index, { start: e.target.value })} className="w-full h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] px-2 text-xs outline-none focus:border-[#22C55E]/60" />
            </label>
            <label className="block">
              <span className="block text-[9px] uppercase font-bold text-[var(--text-muted)] mb-1">End</span>
              <input type="time" value={shift.end || "00:00"} onChange={(e) => updateAt(index, { end: e.target.value })} className="w-full h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] px-2 text-xs outline-none focus:border-[#22C55E]/60" />
            </label>
            <button type="button" onClick={() => removeShift(index)} disabled={list.length <= 1} title="Remove shift" className="h-8 w-8 rounded-lg border border-[#EF4444]/30 text-[#F87171] hover:bg-[#EF4444]/10 disabled:opacity-20 disabled:cursor-not-allowed">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardSettingsModal({
  cp,
  settings,
  columns,
  snResolved,
  onClose,
  onSaved,
}) {
  const [draft, setDraft] = useState(() => cloneSettings(settings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(cloneSettings(settings));
  }, [settings]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/dashboard/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cp, settings: draft }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to save Dashboard Settings");
      }
      onSaved(json);
      onClose();
    } catch (e) {
      setError(e.message || "Failed to save Dashboard Settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="w-[min(820px,96vw)] max-h-[88vh] overflow-hidden rounded-2xl border border-[var(--border)] shadow-2xl"
        style={{ background: "var(--bg-surface-2)" }}
      >
        <div className="px-5 py-4 border-b border-[var(--border-soft)] flex items-center justify-between">
          <div>
            <div className="text-[var(--text-primary)] font-bold text-base">Dashboard Settings</div>
            <div className="text-[9px] text-[var(--text-muted)] mt-0.5">CP{cp} • saved per CP</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-[var(--text-secondary)] hover:text-white hover:bg-[#DC2626]"
          >
            ✕
          </button>
        </div>

        <div className="p-5 overflow-y-auto max-h-[calc(88vh-132px)] space-y-4">
          <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-3">
            <div className="text-[10px] font-bold text-[#22C55E] uppercase tracking-widest mb-3">
              KPI Format
            </div>
            <Select
              value={draft.kpi_format}
              onChange={(v) => setDraft((p) => ({ ...p, kpi_format: v }))}
              options={[
                {
                  value: "fpy_pass_ng_total",
                  label: "FPY / Pass / NG / Total QTY",
                },
                {
                  value: "pass1_pass2_fpy1_fpy2_total",
                  label: "Pass1 / Pass2 / FPY1 / FPY2 / Total QTY",
                },
              ]}
              className="w-full md:w-[420px]"
            />

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] text-[var(--text-muted)]">
              <div className="rounded-lg border border-[var(--border-soft)] p-2">
                <div className="font-bold text-[var(--text-primary)]">Pass1</div>
                SN whose FIRST-EVER test is OK. Later retries do not change it from Pass1.
              </div>
              <div className="rounded-lg border border-[var(--border-soft)] p-2">
                <div className="font-bold text-[var(--text-primary)]">Pass2</div>
                SN whose FIRST-EVER test is NG, then any later test becomes OK.
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-3">
            <div className="text-[10px] font-bold text-[#22C55E] uppercase tracking-widest mb-2">
              Serial Number Column
            </div>
            <Select
              value={draft.sn_column}
              onChange={(v) => setDraft((p) => ({ ...p, sn_column: v }))}
              options={[
                { value: "auto", label: `Auto${snResolved ? ` → ${snResolved}` : ""}` },
                ...columns.map((c) => ({ value: c.key, label: c.label || c.key })),
              ]}
              className="w-full md:w-[420px]"
            />
            <div className="text-[9px] text-[var(--text-muted)] mt-2">
              Total QTY and Pass1/Pass2 classification use this unique SN column.
            </div>
          </div>

          <ShiftEditor
            shifts={draft.shifts}
            onChange={(shifts) => setDraft((p) => ({ ...p, shifts }))}
          />

          <div className="space-y-2">
            <FormulaEditor
              title="FPY Formula (Format 1)"
              formula={draft.fpy_formula}
              onChange={(f) => setDraft((p) => ({ ...p, fpy_formula: f }))}
            />
            <FormulaEditor
              title="FPY1 Formula (Format 2)"
              formula={draft.fpy1_formula}
              onChange={(f) => setDraft((p) => ({ ...p, fpy1_formula: f }))}
            />
            <FormulaEditor
              title="FPY2 Formula (Format 2)"
              formula={draft.fpy2_formula}
              onChange={(f) => setDraft((p) => ({ ...p, fpy2_formula: f }))}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-3 py-2 text-[10px] text-[#EF4444]">
              ✗ {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[var(--border-soft)] flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={save} active disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const RANGE_PRESETS = [
  { label: "Today", days: 0 },
  { label: "Yesterday", days: 1, single: true },
  { label: "7 Days", days: 6 },
  { label: "30 Days", days: 29 },
];

export default function DashboardPage({ cpNumber } = {}) {
  const [cp, setCp] = useState(cpNumber || "");
  const [dateFrom, setDateFrom] = useState(fmtDate(new Date()));
  const [dateTo, setDateTo] = useState(fmtDate(new Date()));
  const [activePreset, setActivePreset] = useState(null);
  const [bucket, setBucket] = useState("auto");
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [columns, setColumns] = useState([]);
  const [snResolved, setSnResolved] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hiddenSeries, setHiddenSeries] = useState({});
  const [selectedShift, setSelectedShift] = useState("all");
  const [dashboardReady, setDashboardReady] = useState(false);
  const defaultRangeCpRef = useRef("");

  useEffect(() => {
    const nextCp = String(cpNumber || "").trim();
    setCp(nextCp);
    setSelectedShift("all");
    setActivePreset(null);
    setDashboardReady(false);
    defaultRangeCpRef.current = "";
  }, [cpNumber]);

  const fetchSettings = useCallback(async () => {
    if (!cp) return;
    setLoadingSettings(true);
    try {
      const res = await fetch(`${API}/api/dashboard/settings?cp=${encodeURIComponent(cp)}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Failed to load Dashboard Settings");
      const loadedSettings = json.settings || DEFAULT_SETTINGS;
      setSettings(loadedSettings);
      setColumns(Array.isArray(json.columns) ? json.columns : []);
      setSnResolved(json.sn_column_resolved || null);

      // On first load for the active CP, automatically select the shift that
      // is active right now and populate the calendar with that shift's
      // actual occurrence. This is deliberately done after loading settings
      // so customized shift hours are respected.
      if (defaultRangeCpRef.current !== cp) {
        const initial = defaultDashboardRange(loadedSettings.shifts || DEFAULT_SHIFTS);
        setSelectedShift(initial.shiftId);
        setDateFrom(initial.from);
        setDateTo(initial.to);
        setActivePreset(null);
        defaultRangeCpRef.current = cp;
      }

      // Do not allow the dashboard to query before the current CP's default
      // shift/date window has been initialized. Previously the first render
      // queried with Shift=All, which could briefly show records such as
      // 03:00 even when the current time was inside Shift 1.
      setDashboardReady(true);
    } catch (e) {
      setError(e.message || "Failed to load Dashboard Settings");
    } finally {
      setLoadingSettings(false);
    }
  }, [cp]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const fetchSummary = useCallback(async () => {
    if (!cp || !dashboardReady) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ cp, date_from: dateFrom, date_to: dateTo });
      if (bucket !== "auto") params.set("bucket", bucket);
      if (selectedShift !== "all") params.set("shift", selectedShift);
      const res = await fetch(`${API}/api/dashboard/summary?${params}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to load dashboard data");
      }
      setData(json);
      setSettings(json.settings || DEFAULT_SETTINGS);
      setSnResolved(json.sn_column_resolved || null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message || "Network error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [cp, dateFrom, dateTo, bucket, selectedShift, dashboardReady]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // Always auto refresh every 15 seconds.
  useEffect(() => {
    const id = setInterval(fetchSummary, 15000);
    return () => clearInterval(id);
  }, [fetchSummary]);

  const configuredShifts = settings.shifts || DEFAULT_SHIFTS;

  const getShift = (value) =>
    configuredShifts.find((shift) => String(shift.id) === String(value));

  const selectShift = (value) => {
    const next = value || "all";
    setSelectedShift(next);
    setActivePreset(null);

    if (next === "all") return;

    const shift = getShift(next);
    if (!shift) return;

    // Keep the currently displayed To-date as the historical anchor.
    // Selecting Shift 2 on 26 Sep therefore reads 25 Sep 20:00 -> 26 Sep 07:30.
    const range = shiftDatesForAnchor(dateTo, shift);
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  const handleDateFromChange = (value) => {
    setActivePreset(null);
    if (selectedShift === "all") {
      setDateFrom(value);
      return;
    }
    const shift = getShift(selectedShift);
    if (!shift) {
      setDateFrom(value);
      return;
    }
    const range = shiftDatesForAnchor(isOvernightShift(shift) ? addDaysDate(value, 1) : value, shift);
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  const handleDateToChange = (value) => {
    setActivePreset(null);
    if (selectedShift === "all") {
      setDateTo(value);
      return;
    }
    const shift = getShift(selectedShift);
    if (!shift) {
      setDateTo(value);
      return;
    }
    const range = shiftDatesForAnchor(value, shift);
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  const applyPreset = (preset) => {
    setSelectedShift("all");
    setActivePreset(preset.label);
    const to = new Date();
    const from = new Date();
    if (preset.single) {
      from.setDate(from.getDate() - preset.days);
      to.setDate(to.getDate() - preset.days);
    } else {
      from.setDate(from.getDate() - preset.days);
    }
    setDateFrom(fmtDate(from));
    setDateTo(fmtDate(to));
  };

  const detailed = settings.kpi_format === "pass1_pass2_fpy1_fpy2_total";

  const pieData = useMemo(() => {
    if (!data) return [];
    return detailed
      ? [
          { name: "Pass1", value: data.pass1, color: PASS_COLOR },
          { name: "Pass2", value: data.pass2, color: PASS2_COLOR },
          { name: "NG", value: data.ng, color: NG_COLOR },
        ].filter((d) => d.value > 0)
      : [
          { name: "Pass", value: data.pass, color: PASS_COLOR },
          { name: "NG", value: data.ng, color: NG_COLOR },
        ].filter((d) => d.value > 0);
  }, [data, detailed]);

  const barSeries = useMemo(() => {
    if (!data) return [];
    return data.series.map((s) =>
      detailed
        ? {
            bucket: s.bucket.slice(5),
            Pass1: s.pass1,
            Pass2: s.pass2,
            NG: s.ng,
          }
        : {
            bucket: s.bucket.slice(5),
            Pass: s.pass,
            NG: s.ng,
          }
    );
  }, [data, detailed]);

  const fpySeries = useMemo(() => {
    if (!data) return [];
    return data.series.map((s) =>
      detailed
        ? {
            bucket: s.bucket.slice(5),
            "FPY1 %": s.fpy1,
            "FPY2 %": s.fpy2,
          }
        : {
            bucket: s.bucket.slice(5),
            "FPY %": s.fpy,
          }
    );
  }, [data, detailed]);

  const toggleSeries = (dataKey) => {
    setHiddenSeries((prev) => ({ ...prev, [dataKey]: !prev[dataKey] }));
  };

  const activeFpy = detailed ? data?.fpy1 ?? 0 : data?.fpy ?? 0;
  const totalQty = data?.total_qty ?? 0;

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-canvas)] overflow-hidden font-sans transition-colors">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-soft)] shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">📊</span>
          <span className="text-[var(--text-primary)] font-bold text-base">PRODUCTION DASHBOARD</span>
          <span className="text-[var(--text-muted)] text-[10px]">
            {detailed ? "Pass1 / Pass2 / FPY1 / FPY2 / Total QTY" : "FPY / Pass / NG / Total QTY"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
          {lastUpdated && <span>Last updated: {lastUpdated.toLocaleTimeString()}</span>}
          <button
            type="button"
            title="Dashboard Settings"
            onClick={() => setShowSettings(true)}
            className="w-8 h-8 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-elevated)]"
          >
            ⚙
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4" style={{ scrollbarWidth: "thin" }}>
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface-2)] p-4 flex items-center gap-3 flex-wrap">
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">CP</span>
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-xs rounded-lg px-3 h-8 min-w-[96px] flex items-center font-semibold" title="Dashboard follows the active CP">
              {cp ? `CP${cp}` : "—"}
            </div>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">From</span>
            <DateInput value={dateFrom} onChange={handleDateFromChange} />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">To</span>
            <DateInput value={dateTo} onChange={handleDateToChange} />
          </div>

          <div className="flex items-end gap-1.5">
            <select
              value={selectedShift}
              onChange={(e) => selectShift(e.target.value || "all")}
              className={`bg-[var(--bg-surface)] border ${selectedShift !== "all" ? "border-[#22C55E]/60 text-[#22C55E] bg-[#22C55E]/10" : "border-[var(--border)] text-[var(--text-secondary)]"} text-[var(--text-primary)] text-[11px] font-bold rounded-lg px-3 h-8 outline-none transition-colors`}
              title="Filter by shift"
            >
              <option value="all">All Shift</option>
              {(settings.shifts || DEFAULT_SHIFTS).map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.label} ({shift.start}–{shift.end})
                </option>
              ))}
            </select>
            {RANGE_PRESETS.map((p) => (
              <Button key={p.label} active={selectedShift === "all" && activePreset === p.label} onClick={() => applyPreset(p)}>
                {p.label}
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-0.5 ml-auto">
            <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Bucket</span>
            <Select
              value={bucket}
              onChange={setBucket}
              options={[
                { value: "auto", label: "Auto" },
                { value: "hour", label: "Hourly" },
                { value: "day", label: "Daily" },
              ]}
            />
          </div>
        </div>

        {(data?.sn_column_resolved || data?.shift_label) && (
          <div className="text-[9px] text-[var(--text-muted)] flex items-center gap-3">
            {data?.sn_column_resolved && <>SN column: <span className="font-mono text-[var(--text-secondary)]">{data.sn_column_resolved}</span></>}
            {data?.shift_label && <>Shift: <span className="font-semibold text-[var(--text-secondary)]">{data.shift_label}</span>{data.shift_start && data.shift_end && <span>{data.shift_start.slice(0,16).replace("T", " ")} → {data.shift_end.slice(0,16).replace("T", " ")}</span>}</>}
            {loadingSettings ? " • loading settings..." : ""}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-3 py-2 text-[10px] text-[#EF4444]">
            ✗ {error}
          </div>
        )}

        <div className="flex gap-3">
          {!detailed && (
            <>
              <FpyHeroCard fpy={data?.fpy ?? 0} totalQty={data?.total_qty ?? 0} />
              <StatCard label="Pass" value={data ? data.pass.toLocaleString() : "-"} color={PASS_COLOR} sub="Pass1 + Pass2" />
              <StatCard label="NG" value={data ? data.ng.toLocaleString() : "-"} color={NG_COLOR} sub="First NG, no later OK" />
              <StatCard label="Total QTY" value={data ? data.total_qty.toLocaleString() : "-"} color="var(--text-primary)" sub="Unique SN" />
            </>
          )}

          {detailed && (
            <>
              <StatCard label="Pass1" value={data ? data.pass1.toLocaleString() : "-"} color={PASS_COLOR} sub="First test → OK" />
              <StatCard label="Pass2" value={data ? data.pass2.toLocaleString() : "-"} color={PASS2_COLOR} sub="First NG → later OK" />
              <StatCard label="FPY1" value={data ? `${Number(data.fpy1).toFixed(1)}%` : "-"} color={PASS_COLOR} sub="Configured formula" />
              <StatCard label="FPY2" value={data ? `${Number(data.fpy2).toFixed(1)}%` : "-"} color={PASS2_COLOR} sub="Configured formula" />
              <StatCard label="Total QTY" value={data ? data.total_qty.toLocaleString() : "-"} color="var(--text-primary)" sub="Unique SN" />
            </>
          )}
        </div>

        {data && totalQty === 0 && (
          <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-4 py-3 text-[11px] text-[var(--text-muted)]">
            Belum ada unique SN dengan hasil OK/NG pada range tanggal ini.
          </div>
        )}

        {data && totalQty > 0 && (
          <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)" }}>
            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface-2)] p-4 flex flex-col gap-2">
              <span className="text-[10px] font-bold text-[#22C55E] uppercase tracking-widest">
                {detailed ? "Pass1 / Pass2 / NG over time" : "Pass / NG over time"}
              </span>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={barSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={{ stroke: "var(--border)" }} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--bg-elevated)" }} />
                  <Legend
                    onClick={(e) => toggleSeries(e.dataKey)}
                    wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
                    formatter={(value) => <span style={{ color: "var(--text-secondary)" }}>{value}</span>}
                  />
                  {detailed ? (
                    <>
                      <Bar dataKey="Pass1" fill={PASS_COLOR} hide={!!hiddenSeries.Pass1} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Pass2" fill={PASS2_COLOR} hide={!!hiddenSeries.Pass2} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="NG" fill={NG_COLOR} hide={!!hiddenSeries.NG} radius={[3, 3, 0, 0]} />
                    </>
                  ) : (
                    <>
                      <Bar dataKey="Pass" fill={PASS_COLOR} hide={!!hiddenSeries.Pass} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="NG" fill={NG_COLOR} hide={!!hiddenSeries.NG} radius={[3, 3, 0, 0]} />
                    </>
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface-2)] p-4 flex flex-col gap-2">
              <span className="text-[10px] font-bold text-[#22C55E] uppercase tracking-widest">
                {detailed ? "Pass1 / Pass2 / NG Split" : "Pass / NG Split"}
              </span>
              <div className="relative">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={65} outerRadius={95} paddingAngle={2}>
                      {pieData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: 11 }}
                      formatter={(value) => <span style={{ color: "var(--text-secondary)" }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ top: -14 }}>
                  <span className="text-xl font-bold" style={{ color: detailed ? PASS_COLOR : PASS_COLOR }}>
                    {detailed ? `${Number(data.fpy1 || 0).toFixed(1)}%` : `${Number(data.fpy || 0).toFixed(1)}%`}
                  </span>
                  <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">
                    {detailed ? "FPY1" : "FPY"}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface-2)] p-4 flex flex-col gap-2 col-span-full">
              <span className="text-[10px] font-bold text-[#22C55E] uppercase tracking-widest">
                {detailed ? "FPY1 / FPY2 Trend" : "FPY % Trend"}
              </span>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={fpySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={{ stroke: "var(--border)" }} unit="%" />
                  <Tooltip content={<ChartTooltip />} />
                  {detailed ? (
                    <>
                      <Line type="monotone" dataKey="FPY1 %" name="FPY1 %" stroke={PASS_COLOR} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="FPY2 %" name="FPY2 %" stroke={PASS2_COLOR} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    </>
                  ) : (
                    <Line type="monotone" dataKey="FPY %" name="FPY %" stroke={ACCENT} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {showSettings && (
        <DashboardSettingsModal
          cp={cp}
          settings={settings}
          columns={columns}
          snResolved={snResolved}
          onClose={() => setShowSettings(false)}
          onSaved={(json) => {
            setSettings(json.settings || DEFAULT_SETTINGS);
            setSnResolved(json.sn_column_resolved || null);
            fetchSummary();
          }}
        />
      )}
    </div>
  );
}
