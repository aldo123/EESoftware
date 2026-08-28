// src/modal/DashboardModal.jsx
//
// FPY / Output / OK / NG production dashboard — its own full-page sidebar
// menu item. Reads from the same SN List SQLite tables (snlist_cp{cp})
// SN List's own page already writes to; the `result` column (OK/NG) is
// filled in by a Logic Builder flow calling record_result(True/False)
// from a Custom Script node (backend/logic_builder/custom_script.py) —
// there's no separate "production results" table, this is that same log,
// aggregated. See backend/routes/dashboard.py for the query side.
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { API } from "../service/api";

const OK_COLOR = "#22C55E";
const NG_COLOR = "#EF4444";
const ACCENT = "#3B82F6";

// ────────────────────────────────────────────────────────────────
//  UI ATOMS
// ────────────────────────────────────────────────────────────────

// Hero card (leftmost) — same shape as Downtime page's "Machine Status"
// card: fixed width, gradient background, glow blob, big colored headline.
function FpyHeroCard({ fpy, output }) {
  const color = output === 0 ? "var(--text-muted)" : fpy >= 95 ? OK_COLOR : fpy >= 85 ? "#F59E0B" : NG_COLOR;
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
      <div className="absolute top-0 right-0 w-28 h-28 rounded-full blur-2xl" style={{ background: `${color}18` }} />
      <div className="relative z-10 flex flex-col h-full justify-between">
        <span className="text-[var(--text-secondary)] text-xs font-bold tracking-widest uppercase mb-2">FPY</span>
        <span className="font-bold text-4xl leading-none mb-2" style={{ color }}>
          {output === 0 ? "—" : `${fpy.toFixed(1)}%`}
        </span>
        <span className="text-[var(--text-secondary)] text-xs">First Pass Yield</span>
      </div>
    </div>
  );
}

// Uniform KPI card — same shape as Downtime page's TOTAL DOWNTIME /
// OCCURRENCES / MTTR / MTBF cards: icon, big colored number, small sub label.
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
      <span className="text-[var(--text-secondary)] text-xs font-bold tracking-widest uppercase mb-2">{label}</span>
      <span className="font-bold text-3xl leading-tight" style={{ color }}>{value}</span>
      {sub && <span className="text-[var(--text-secondary)] text-xs mt-1">{sub}</span>}
    </div>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-[var(--bg-surface)] border border-[var(--border)] focus:border-[#22C55E]/60 text-[var(--text-primary)] text-xs rounded-lg px-2 h-8 outline-none transition-colors"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
  return d.toISOString().slice(0, 10);
}

// ────────────────────────────────────────────────────────────────
//  CUSTOM RECHARTS TOOLTIP/LEGEND (dark theme)
// ────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 shadow-xl">
      <div className="text-[10px] text-[var(--text-muted)] mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="text-[11px] font-semibold flex items-center gap-1.5" style={{ color: p.color }}>
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          {p.name}: {p.value}
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  MAIN PAGE
// ────────────────────────────────────────────────────────────────

const RANGE_PRESETS = [
  { label: "Today", days: 0 },
  { label: "Yesterday", days: 1, single: true },
  { label: "7 Days", days: 6 },
  { label: "30 Days", days: 29 },
];

export default function DashboardPage() {
  const [cps, setCps] = useState([]);
  const [cp, setCp] = useState("");
  const [dateFrom, setDateFrom] = useState(fmtDate(new Date()));
  const [dateTo, setDateTo] = useState(fmtDate(new Date()));
  const [activePreset, setActivePreset] = useState("Today");
  const [bucket, setBucket] = useState("auto");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hiddenSeries, setHiddenSeries] = useState({});

  // ── Load CP list once ─────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/dashboard/cps`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.cps.length) {
          setCps(d.cps);
          setCp((prev) => prev || d.cps[0]);
        }
      })
      .catch(() => {});
  }, []);

  // ── Fetch summary ─────────────────────────────────────────
  const fetchSummary = useCallback(async () => {
    if (!cp) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ cp, date_from: dateFrom, date_to: dateTo });
      if (bucket !== "auto") params.set("bucket", bucket);
      const res = await fetch(`${API}/api/dashboard/summary?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to load dashboard data");
      setData(json);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message || "Network error");
    }
    setLoading(false);
  }, [cp, dateFrom, dateTo, bucket]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // ── Auto refresh every 15s ────────────────────────────────
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchSummary, 15000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchSummary]);

  const applyPreset = (preset) => {
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

  const pieData = useMemo(() => {
    if (!data) return [];
    return [
      { name: "OK", value: data.ok, color: OK_COLOR },
      { name: "NG", value: data.ng, color: NG_COLOR },
    ].filter((d) => d.value > 0);
  }, [data]);

  const fpySeries = useMemo(() => {
    if (!data) return [];
    return data.series.map((s) => {
      const total = s.ok + s.ng;
      return { bucket: s.bucket.slice(5), fpy: total ? Number(((s.ok / total) * 100).toFixed(1)) : 0 };
    });
  }, [data]);

  const barSeries = useMemo(() => {
    if (!data) return [];
    return data.series.map((s) => ({ bucket: s.bucket.slice(5), OK: s.ok, NG: s.ng }));
  }, [data]);

  const toggleSeries = (dataKey) => {
    setHiddenSeries((prev) => ({ ...prev, [dataKey]: !prev[dataKey] }));
  };

  const fpyColor = !data ? "var(--text-primary)" : data.fpy >= 95 ? OK_COLOR : data.fpy >= 85 ? "#F59E0B" : NG_COLOR;

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-canvas)] overflow-hidden font-sans transition-colors">
      {/* ── HEADER ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-soft)] shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">📊</span>
          <span className="text-[var(--text-primary)] font-bold text-base">PRODUCTION DASHBOARD</span>
          <span className="text-[var(--text-muted)] text-[10px]">FPY / Output / OK / NG</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
          {lastUpdated && <span>Last updated: {lastUpdated.toLocaleTimeString()}</span>}
          <Button active={autoRefresh} onClick={() => setAutoRefresh((v) => !v)}>
            {autoRefresh ? "⏸ Auto-refresh ON" : "▶ Auto-refresh OFF"}
          </Button>
          <Button onClick={fetchSummary}>{loading ? "Loading..." : "🔄 Refresh"}</Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4" style={{ scrollbarWidth: "thin" }}>
        {/* ── FILTERS ───────────────────────────────────────── */}
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface-2)] p-4 flex items-center gap-3 flex-wrap">
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">CP</span>
            <Select value={cp} onChange={setCp} options={cps.map((c) => ({ value: c, label: `CP${c}` }))} />
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">From</span>
            <DateInput value={dateFrom} onChange={(v) => { setDateFrom(v); setActivePreset(null); }} />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">To</span>
            <DateInput value={dateTo} onChange={(v) => { setDateTo(v); setActivePreset(null); }} />
          </div>

          <div className="flex items-end gap-1.5">
            {RANGE_PRESETS.map((p) => (
              <Button key={p.label} active={activePreset === p.label} onClick={() => applyPreset(p)}>{p.label}</Button>
            ))}
          </div>

          <div className="flex flex-col gap-0.5 ml-auto">
            <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Bucket</span>
            <Select value={bucket} onChange={setBucket} options={[{ value: "auto", label: "Auto" }, { value: "hour", label: "Hourly" }, { value: "day", label: "Daily" }]} />
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-3 py-2 text-[10px] text-[#EF4444]">✗ {error}</div>
        )}

        {/* ── STAT CARDS ────────────────────────────────────── */}
        <div className="flex gap-3">
          <FpyHeroCard fpy={data ? data.fpy : 0} output={data ? data.output : 0} />
          <StatCard label="Output" value={data ? data.output.toLocaleString() : "-"} color="var(--text-primary)" sub="Total units logged" />
          <StatCard label="OK" value={data ? data.ok.toLocaleString() : "-"} color={OK_COLOR} sub="Passed" />
          <StatCard label="NG" value={data ? data.ng.toLocaleString() : "-"} color={NG_COLOR} sub="Failed" />
        </div>

        {data && data.output === 0 && (
          <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-4 py-3 text-[11px] text-[var(--text-muted)]">
            Belum ada data OK/NG untuk CP{cp} di rentang tanggal ini. Data di sini terisi otomatis saat flow Logic Builder memanggil{" "}
            <code className="text-[var(--accent-cyan)]">record_result(True)</code> / <code className="text-[var(--accent-cyan)]">record_result(False)</code>{" "}
            dari node Custom Script — tambahkan pemanggilan itu di titik flow yang menentukan unit selesai OK/NG.
          </div>
        )}

        {/* ── CHARTS ────────────────────────────────────────── */}
        {data && data.output > 0 && (
          <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)" }}>
            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface-2)] p-4 flex flex-col gap-2">
              <span className="text-[10px] font-bold text-[#22C55E] uppercase tracking-widest">OK vs NG over time</span>
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
                  <Bar dataKey="OK" fill={OK_COLOR} hide={!!hiddenSeries.OK} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="NG" fill={NG_COLOR} hide={!!hiddenSeries.NG} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface-2)] p-4 flex flex-col gap-2">
              <span className="text-[10px] font-bold text-[#22C55E] uppercase tracking-widest">OK / NG Split</span>
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
                  <span className="text-xl font-bold" style={{ color: fpyColor }}>{data.fpy.toFixed(1)}%</span>
                  <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">FPY</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface-2)] p-4 flex flex-col gap-2 col-span-full">
              <span className="text-[10px] font-bold text-[#22C55E] uppercase tracking-widest">FPY % Trend</span>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={fpySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={{ stroke: "var(--border)" }} unit="%" />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="fpy" name="FPY %" stroke={ACCENT} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
