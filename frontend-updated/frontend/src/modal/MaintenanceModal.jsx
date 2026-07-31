// src/modal/MaintenancePage.jsx
import { Fragment, useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { API } from "../service/api";

const MaintenancePage = forwardRef(({
  user,
  machineStatus: externalStatus,
  downtimeActive: externalDowntimeActive,
  downtimeStart: externalDowntimeStart,
  downtimeId: externalDowntimeId,
  onStatusChange,
  onDowntimeStart,
  onDowntimeEnd,
}, ref) => {
  // ── State ────────────────────────────────────────────────────
  const [status, setStatus] = useState(externalStatus || "IDLE");
  const [downtimeActive, setDowntimeActive] = useState(externalDowntimeActive || false);
  const [downtimeStart, setDowntimeStart] = useState(externalDowntimeStart || null);
  const [downtimeId, setDowntimeId] = useState(externalDowntimeId || null);
  const [duration, setDuration] = useState(0);

  const [kpi, setKpi] = useState({
    totalDowntime: "00:00",
    occurrences: 0,
    mttr: 0,
    mtbf: "00:00",
  });

  const [chartData, setChartData] = useState(Array(24).fill(0));
  const [tableData, setTableData] = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const today = new Date().toISOString().split("T")[0];
  const [filterStartDate, setFilterStartDate] = useState(today);
  const [filterEndDate, setFilterEndDate] = useState(today);

  const [rootCause, setRootCause] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [downtimeType, setDowntimeType] = useState("");
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tooltip, setTooltip] = useState(null);
  const chartRef = useRef(null);
  const durationInterval = useRef(null);

  useImperativeHandle(ref, () => ({
    startDowntime: (type) => handleStartDowntime(type),
  }));

  useEffect(() => {
    if (externalStatus) setStatus(externalStatus);
    if (externalDowntimeActive !== undefined) setDowntimeActive(externalDowntimeActive);
    if (externalDowntimeStart) setDowntimeStart(externalDowntimeStart);
    if (externalDowntimeId) setDowntimeId(externalDowntimeId);
  }, [externalStatus, externalDowntimeActive, externalDowntimeStart, externalDowntimeId]);

  useEffect(() => {
    if (downtimeActive && downtimeStart) {
      const update = () => {
        const diff = Math.floor((new Date() - new Date(downtimeStart)) / 1000);
        setDuration(diff);
      };
      update();
      durationInterval.current = setInterval(update, 1000);
    } else {
      setDuration(0);
      if (durationInterval.current) clearInterval(durationInterval.current);
    }
    return () => clearInterval(durationInterval.current);
  }, [downtimeActive, downtimeStart]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [statsRes, hourlyRes, eventsRes] = await Promise.all([
        fetch(`${API}/api/maintenance/stats?start_date=${filterStartDate}&end_date=${filterEndDate}`),
        fetch(`${API}/api/maintenance/hourly?start_date=${filterStartDate}&end_date=${filterEndDate}`),
        fetch(`${API}/api/maintenance/events?start_date=${filterStartDate}&end_date=${filterEndDate}&page=${currentPage}&per=10`),
      ]);
      const stats = await statsRes.json();
      const hourly = await hourlyRes.json();
      const events = await eventsRes.json();
      setKpi({
        totalDowntime: stats.total_downtime || "00:00",
        occurrences: stats.occurrences || 0,
        mttr: stats.mttr || 0,
        mtbf: stats.mtbf || "00:00",
      });
      setChartData(hourly || Array(24).fill(0));
      setTableData(events.data || []);
      setTotalRecords(events.total || 0);
      setTotalPages(Math.ceil((events.total || 0) / 10));
    } catch (err) {
      setError(err.message || "Failed to load data.");
      setKpi({ totalDowntime: "00:00", occurrences: 0, mttr: 0, mtbf: "00:00" });
      setChartData(Array(24).fill(0));
      setTableData([]);
      setTotalRecords(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [filterStartDate, filterEndDate, currentPage]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleStartDowntime = async (type) => {
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API}/api/maintenance/downtime/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          technician: user?.username || "system",
          shift: "Shift A",
          machine_code: "CP2-PCBAVM3",
          downtime_type: type === "maintenance" ? "MACHINE DOWN" : "WAITING MATERIAL",
        }),
      });
      const data = await res.json();
      if (data.success) {
        const start = new Date(data.start_time);
        setDowntimeActive(true); setDowntimeStart(start);
        setDowntimeId(data.downtime_id);
        const newStatus = type === "maintenance" ? "MACHINE DOWN" : "WAITING MATERIAL";
        setStatus(newStatus);
        onDowntimeStart?.(start, data.downtime_id);
        onStatusChange?.(newStatus);
        fetchData();
      } else { setError(data.message || "Failed to start downtime"); }
    } catch (err) { setError(err.message || "Network error"); }
    finally { setLoading(false); }
  };

  const endDowntime = async () => {
    if (!rootCause.trim() || !correctiveAction.trim() || !downtimeType) {
      setError("Root Cause, Corrective Action & Downtime Type are required!");
      return;
    }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API}/api/maintenance/downtime/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ downtime_id: downtimeId, downtime_type: downtimeType, root_cause: rootCause, corrective_action: correctiveAction, notes }),
      });
      const data = await res.json();
      if (data.success) {
        setDowntimeActive(false); setDowntimeStart(null); setDowntimeId(null);
        setStatus("IDLE"); setRootCause(""); setCorrectiveAction(""); setDowntimeType(""); setNotes("");
        onDowntimeEnd?.(); onStatusChange?.("IDLE"); fetchData();
      } else { setError(data.message || "Failed to save RCA"); }
    } catch (err) { setError(err.message || "Network error"); }
    finally { setLoading(false); }
  };

  const exportCSV = () => {
    window.open(`${API}/api/maintenance/export?start_date=${filterStartDate}&end_date=${filterEndDate}&start_time=00:00&end_time=23:59`, "_blank");
  };

  const formatDuration = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  };

  const statusColor = status === "MACHINE DOWN" ? "#EF4444" : status === "WAITING MATERIAL" ? "#F59E0B" : "#22C55E";
  const statusLabel = status === "MACHINE DOWN" ? "MACHINE DOWN" : status === "WAITING MATERIAL" ? "WAITING MATERIAL" : "RUNNING / IDLE";

  const typeColors = {
    MECHANICAL: "#EF4444", ELECTRICAL: "#3B82F6",
    QUALITY: "#A855F7", SOFTWARE: "#F97316", OTHERS: "#94A3B8",
  };

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col bg-[#0B1120] overflow-hidden font-sans" style={{ padding: "12px 12px 12px 12px" }}>

      {/* ══════════════════════════════════════════════════════════
          ROW 1 — KPI STRIP (full width)
      ══════════════════════════════════════════════════════════ */}
      <div className="flex gap-3 mb-3 shrink-0">

        {/* Machine Status */}
        <div
          className="relative overflow-hidden rounded-2xl flex-shrink-0"
          style={{
            width: 260,
            background: "linear-gradient(135deg,#1A2540 0%,#0F172A 100%)",
            border: "1px solid #2A3A5C",
            padding: "14px 16px",
          }}
        >
          <div className="absolute top-0 right-0 w-28 h-28 rounded-full blur-2xl" style={{ background: "#22C55E18" }} />
          <div className="relative z-10 flex flex-col h-full justify-between">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[#7A8FB0] text-[10px] font-bold tracking-widest uppercase">Machine Status</span>
              {status !== "IDLE" && (
                <span className="px-1.5 py-0.5 text-white text-[9px] font-bold rounded-full animate-pulse" style={{ background: "#EF4444" }}>LIVE</span>
              )}
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl leading-none" style={{ color: statusColor }}>●</span>
              <span className="font-bold text-lg leading-tight" style={{ color: statusColor }}>{statusLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#7A8FB0] text-[10px]">
                Since {downtimeStart ? new Date(downtimeStart).toLocaleTimeString() : "—"}
              </span>
              <span
                className="font-mono font-bold text-white text-sm px-2 py-1 rounded-lg"
                style={{ background: "#0B1120", border: "1px solid #2A3A5C" }}
              >
                {formatDuration(duration)}
              </span>
            </div>
          </div>
        </div>

        {/* KPI Cards — stretch evenly to fill remaining width */}
        {[
          { label: "TOTAL DOWNTIME", icon: "⏱", value: kpi.totalDowntime, sub: "hh:mm",  color: "#F97316" },
          { label: "OCCURRENCES",    icon: "⚡", value: kpi.occurrences,   sub: "Times",  color: "#EAB308" },
          { label: "MTTR",           icon: "🛠", value: kpi.mttr,          sub: "min",    color: "#3B82F6" },
          { label: "MTBF",           icon: "📊", value: kpi.mtbf,          sub: "hh:mm",  color: "#22C55E" },
        ].map((item) => (
          <div
            key={item.label}
            className="flex-1 flex flex-col items-center justify-center rounded-xl text-center"
            style={{
              background: "linear-gradient(135deg,#1A2540 0%,#0F172A 100%)",
              border: "1px solid #2A3A5C",
              padding: "10px 8px",
            }}
          >
            <span className="text-[#7A8FB0] text-[9px] font-bold tracking-widest uppercase mb-1">{item.label}</span>
            <span className="text-2xl leading-none mb-1">{item.icon}</span>
            <span className="font-bold text-xl leading-tight" style={{ color: item.color }}>{item.value}</span>
            <span className="text-[#7A8FB0] text-[10px] mt-0.5">{item.sub}</span>
          </div>
        ))}

        {/* Active Downtime Info */}
        <div
          className="rounded-xl flex-shrink-0"
          style={{
            width: 220,
            background: "linear-gradient(135deg,#1A2540 0%,#0F172A 100%)",
            border: "1px solid #2A3A5C",
            padding: "12px 14px",
          }}
        >
          <span className="text-[#7A8FB0] text-[9px] font-bold tracking-widest uppercase block mb-2">Active Downtime Info</span>
          <div className="grid gap-y-1" style={{ gridTemplateColumns: "auto 1fr" }}>
            {[
                ["ID", downtimeId || "—"],
                ["Start", downtimeStart ? new Date(downtimeStart).toLocaleTimeString() : "—"],
                ["Technician", user?.username || "—"],
            ].map(([k, v]) => (
                <Fragment key={k}>
                    <span className="text-[#7A8FB0] text-[10px] pr-2">
                        {k}
                    </span>

                    <span className="text-white text-[10px] font-bold font-mono truncate">
                        {v}
                    </span>
                </Fragment>
            ))}
          </div>
        </div>

      </div>

      {/* ══════════════════════════════════════════════════════════
          ROW 2 — Chart + Table  |  RCA Sidebar
          Both columns fill the remaining height exactly
      ══════════════════════════════════════════════════════════ */}
      <div className="flex gap-3 flex-1 overflow-hidden min-h-0">

        {/* ── LEFT: Chart + Table ──────────────────────────── */}
        <div className="flex-1 flex flex-col gap-3 overflow-hidden min-h-0">

          {/* Chart */}
          <div
            ref={chartRef}
            className="rounded-xl flex flex-col shrink-0 relative"
            style={{
              height: 188,
              background: "linear-gradient(135deg,#1A2540 0%,#0F172A 100%)",
              border: "1px solid #2A3A5C",
              padding: "10px 14px 8px 8px",
              overflow: "visible",
            }}
            onMouseLeave={() => setTooltip(null)}
          >
            {/* Title row */}
            <div className="flex justify-between items-center mb-2 shrink-0 pl-2">
              <span className="text-white font-bold text-xs">
                HOURLY DOWNTIME ({filterStartDate} to {filterEndDate})
              </span>
              <span className="text-[#22C55E] text-xs font-mono">Total : {kpi.totalDowntime}</span>
            </div>

            {/* Floating tooltip — positioned inside chart, above bars */}
            {tooltip && (
              <div
                className="absolute z-50 pointer-events-none"
                style={{ left: tooltip.x, top: 34, transform: "translateX(-50%)" }}
              >
                <div
                  className="rounded-lg px-3 py-2 text-center"
                  style={{
                    background: "#0B1120",
                    border: "1px solid #3B82F6",
                    boxShadow: "0 4px 24px #00000099",
                    minWidth: 120,
                  }}
                >
                  <p className="text-[#7A8FB0] text-[9px] font-mono mb-0.5 whitespace-nowrap">
                    {String(tooltip.hour).padStart(2,"0")}:00 – {String(tooltip.hour).padStart(2,"0")}:59
                  </p>
                  <p className={`text-[12px] font-bold font-mono whitespace-nowrap ${tooltip.val > 0 ? "text-[#22C55E]" : "text-[#475569]"}`}>
                    {tooltip.val > 0 ? `${tooltip.val} min` : "No downtime"}
                  </p>
                </div>
              </div>
            )}

            {/* Y-axis + bars */}
            <div className="flex-1 flex gap-1 min-h-0 overflow-hidden">
              {/* Y-axis */}
              {(() => {
                const maxVal = Math.max(...chartData, 1);
                const ticks = [maxVal, Math.round(maxVal * 0.75), Math.round(maxVal * 0.5), Math.round(maxVal * 0.25), 0];
                return (
                  <div className="flex flex-col justify-between items-end shrink-0 pb-[18px]" style={{ width: 26 }}>
                    {ticks.map((t, i) => (
                      <span key={i} className="text-[8px] text-[#475569] font-mono leading-none">{t}</span>
                    ))}
                  </div>
                );
              })()}

              {/* Bars column */}
              <div className="flex-1 flex flex-col min-h-0 min-w-0">
                {/* Bar area */}
                <div className="flex-1 flex items-end gap-px relative min-h-0">
                  {/* Grid lines */}
                  <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                    {[0,1,2,3].map(i => (
                      <div key={i} className="w-full" style={{ borderTop: "1px solid #1E293B" }} />
                    ))}
                    <div />
                  </div>
                  {/* Baseline */}
                  <div className="absolute bottom-0 left-0 right-0" style={{ borderTop: "1px solid #334155" }} />

                  {(() => {
                    const maxVal = Math.max(...chartData, 1);
                    return chartData.map((val, i) => {
                      const pct = (val / maxVal) * 100;
                      const isHovered = tooltip?.hour === i;
                      return (
                        <div
                          key={i}
                          className="flex-1 flex flex-col justify-end items-center relative min-w-0 cursor-pointer"
                          style={{ height: "100%" }}
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const chartRect = chartRef.current.getBoundingClientRect();
                            setTooltip({ hour: i, val, x: rect.left - chartRect.left + rect.width / 2 });
                          }}
                        >
                          <div
                            className="w-full rounded-t-sm relative z-[1]"
                            style={{
                              height: val > 0 ? `${pct}%` : "1px",
                              minHeight: val > 0 ? 3 : 1,
                              background: isHovered
                                ? "linear-gradient(to top,#2563EB,#60A5FA,#93C5FD)"
                                : val > 0
                                  ? "linear-gradient(to top,#1D4ED8,#3B82F6,#60A5FA)"
                                  : isHovered ? "#2A3A5C" : "#1E293B",
                              boxShadow: isHovered ? "0 0 8px #60A5FA80" : val > 0 ? "0 0 4px #3B82F640" : "none",
                              transition: "height 0.5s cubic-bezier(0.34,1.2,0.64,1), background 0.15s",
                            }}
                          />
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* X-axis labels — all 24 hours */}
                <div className="flex gap-px shrink-0" style={{ height: 16, marginTop: 2 }}>
                  {chartData.map((_, i) => (
                    <div key={i} className="flex-1 flex items-center justify-center min-w-0">
                      <span className="text-[7px] text-[#475569] font-mono leading-none">{String(i).padStart(2,"0")}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Table */}
          <div
            className="flex-1 flex flex-col overflow-hidden rounded-xl min-h-0"
            style={{
              background: "linear-gradient(135deg,#1A2540 0%,#0F172A 100%)",
              border: "1px solid #2A3A5C",
            }}
          >
            {/* Filter bar */}
            <div
              className="flex items-center gap-2 px-3 py-2 shrink-0"
              style={{ borderBottom: "1px solid #2A3A5C", background: "#0F172A80" }}
            >
              <span className="text-[#7A8FB0] text-[10px] font-semibold">Date Start</span>
              <input type="date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)}
                className="bg-[#0B1120] border border-[#2A3A5C] text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[#22C55E]" />
              <span className="text-[#7A8FB0] text-[10px] font-semibold">Date End</span>
              <input type="date" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)}
                className="bg-[#0B1120] border border-[#2A3A5C] text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[#22C55E]" />
              <button onClick={fetchData} disabled={loading}
                className="bg-[#22C55E] hover:bg-[#16A34A] text-[#0B1120] px-3 py-1 rounded-lg text-xs font-bold transition-colors disabled:opacity-50">
                🔄 Refresh
              </button>
              <button onClick={exportCSV}
                className="bg-[#3B82F6] hover:bg-[#2563EB] text-white px-3 py-1 rounded-lg text-xs font-bold transition-colors">
                ⬇ Export CSV
              </button>
              <div className="flex-1" />
              {loading && <span className="text-[#22C55E] text-[10px] animate-pulse">Loading…</span>}
              {error   && <span className="text-[#EF4444] text-[10px] truncate max-w-[200px]">{error}</span>}
            </div>

            {/* Scrollable table body */}
            <div className="flex-1 overflow-auto custom-scrollbar min-h-0">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10" style={{ background: "#0F172A" }}>
                  <tr className="text-[#7A8FB0] uppercase tracking-wider text-[10px]">
                    {["No","Date","Start Time","End Time","Duration","Downtime Type","Root Cause","Corrective Action","Technician"].map(h => (
                      <th key={h} className="p-2 text-center whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E293B]">
                  {tableData.map((row, idx) => {
                    const dateStr  = row.start_time ? new Date(row.start_time).toLocaleDateString("id-ID") : "—";
                    const startT   = row.start_time ? new Date(row.start_time).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"}) : "—";
                    const endT     = row.end_time   ? new Date(row.end_time).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"}) : "—";
                    const tc       = typeColors[row.downtime_type];
                    return (
                      <tr key={row.downtime_id ?? row.id ?? `${row.start_time}-${idx}`} className="hover:bg-[#1E3A5F]/30 transition-colors">
                        <td className="p-2 text-center text-white font-mono">{(currentPage-1)*10+idx+1}</td>
                        <td className="p-2 text-center text-white">{dateStr}</td>
                        <td className="p-2 text-center text-white">{startT}</td>
                        <td className="p-2 text-center text-white">{endT}</td>
                        <td className="p-2 text-center text-white font-mono">{row.duration || "—"}</td>
                        <td className="p-2 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                            style={{ background: (tc||"#94A3B8")+"20", color: tc||"#E2E8F0" }}>
                            {row.downtime_type || "—"}
                          </span>
                        </td>
                        <td className="p-2 text-white max-w-[110px] truncate">{row.root_cause       || "—"}</td>
                        <td className="p-2 text-white max-w-[110px] truncate">{row.corrective_action|| "—"}</td>
                        <td className="p-2 text-white">{row.technician || "—"}</td>
                      </tr>
                    );
                  })}
                  {tableData.length === 0 && (
                    <tr>
                      <td colSpan="9" className="p-10 text-center text-[#7A8FB0]">No downtime records found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div
              className="flex justify-between items-center px-3 py-2 shrink-0"
              style={{ borderTop: "1px solid #2A3A5C", background: "#0F172A80" }}
            >
              <div className="flex gap-1">
                {[
                  { label: "«", action: () => setCurrentPage(1) },
                  { label: "‹", action: () => setCurrentPage(p => Math.max(1, p-1)) },
                  ...Array.from({ length: Math.min(5, totalPages) }, (_, i) => ({ label: String(i+1), action: () => setCurrentPage(i+1), page: i+1 })),
                  { label: "›", action: () => setCurrentPage(p => Math.min(totalPages, p+1)) },
                  { label: "»", action: () => setCurrentPage(totalPages) },
                ].map((b, i) => (
                  <button key={b.page ?? b.label} onClick={b.action}
                    className="px-2.5 py-1 rounded-lg text-xs transition-colors"
                    style={{
                      background: b.page === currentPage ? "#22C55E" : "#1A2540",
                      color:      b.page === currentPage ? "#0B1120"  : "#7A8FB0",
                      fontWeight: b.page === currentPage ? "700"      : "400",
                    }}>
                    {b.label}
                  </button>
                ))}
              </div>
              <span className="text-[#7A8FB0] text-[10px] font-mono">Total Records : {totalRecords}</span>
            </div>
          </div>
        </div>

        {/* ── RIGHT: RCA Sidebar — same height as left column ─── */}
        <div
          className="flex flex-col rounded-xl shrink-0"
          style={{
            width: 320,
            background: "linear-gradient(135deg,#1A2540 0%,#0F172A 100%)",
            border: "1px solid #2A3A5C",
            padding: "14px 14px",
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 mb-3 shrink-0">
            <span className="text-[#EF4444] text-base">⚡</span>
            <span className="text-white font-bold text-xs tracking-wide">ROOT CAUSE &amp; CORRECTIVE ACTION</span>
            {downtimeActive && (
              <span className="ml-auto px-2 py-0.5 text-white text-[9px] font-bold rounded-full animate-pulse" style={{ background: "#EF4444" }}>ACTIVE</span>
            )}
          </div>

          {/* Fields — flex-1 so they fill the space */}
          <div className="flex-1 flex flex-col gap-3 overflow-hidden min-h-0">

            {/* Root Cause */}
            <div className="flex flex-col" style={{ flex: "1 1 0" }}>
              <label className="text-[#EF4444] text-[10px] font-bold mb-1">Root Cause *</label>
              <textarea
                value={rootCause}
                onChange={e => setRootCause(e.target.value)}
                disabled={!downtimeActive}
                placeholder="Describe the root cause..."
                maxLength={500}
                className="flex-1 w-full bg-[#0B1120] border border-[#2A3A5C] text-white rounded-lg p-2 text-xs focus:outline-none focus:border-[#22C55E] transition-colors resize-none disabled:opacity-40"
              />
              <div className="text-right text-[#7A8FB0] text-[9px] mt-0.5">{rootCause.length} / 500</div>
            </div>

            {/* Corrective Action */}
            <div className="flex flex-col" style={{ flex: "1 1 0" }}>
              <label className="text-[#EF4444] text-[10px] font-bold mb-1">Corrective Action *</label>
              <textarea
                value={correctiveAction}
                onChange={e => setCorrectiveAction(e.target.value)}
                disabled={!downtimeActive}
                placeholder="What action was taken?"
                maxLength={500}
                className="flex-1 w-full bg-[#0B1120] border border-[#2A3A5C] text-white rounded-lg p-2 text-xs focus:outline-none focus:border-[#22C55E] transition-colors resize-none disabled:opacity-40"
              />
              <div className="text-right text-[#7A8FB0] text-[9px] mt-0.5">{correctiveAction.length} / 500</div>
            </div>

            {/* Downtime Type */}
            <div className="shrink-0">
              <label className="text-[#EF4444] text-[10px] font-bold block mb-1">Downtime Type *</label>
              <select
                value={downtimeType}
                onChange={e => setDowntimeType(e.target.value)}
                disabled={!downtimeActive}
                className="w-full bg-[#0B1120] border border-[#2A3A5C] text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-[#22C55E] transition-colors disabled:opacity-40"
              >
                <option value="">Select downtime type...</option>
                <option value="MECHANICAL">⚙️ MECHANICAL</option>
                <option value="ELECTRICAL">⚡ ELECTRICAL</option>
                <option value="QUALITY">📊 QUALITY</option>
                <option value="SOFTWARE">💻 SOFTWARE</option>
                <option value="OTHERS">📦 OTHERS</option>
              </select>
            </div>

            {/* Notes */}
            <div className="flex flex-col" style={{ flex: "0.6 1 0" }}>
              <label className="text-[#7A8FB0] text-[10px] font-bold mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                disabled={!downtimeActive}
                placeholder="Additional notes..."
                maxLength={500}
                className="flex-1 w-full bg-[#0B1120] border border-[#2A3A5C] text-white rounded-lg p-2 text-xs focus:outline-none focus:border-[#22C55E] transition-colors resize-none disabled:opacity-40"
              />
              <div className="text-right text-[#7A8FB0] text-[9px] mt-0.5">{notes.length} / 500</div>
            </div>

            {/* Error / warning */}
            {error && (
              <div className="shrink-0 bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#FCA5A5] text-[10px] px-3 py-2 rounded-lg text-center">
                ⚠ {error}
              </div>
            )}
            {downtimeActive && !error && (
              <div className="shrink-0 text-[#EAB308] text-[10px] text-center px-2 py-1.5 rounded-lg border border-[#EAB308]/20" style={{ background: "#EAB30808" }}>
                ⚠ Root Cause, Corrective Action &amp; Downtime Type must be filled.
              </div>
            )}

            {/* Save / Idle placeholder — pinned to bottom */}
            <div className="mt-auto shrink-0">
              {downtimeActive ? (
                <button
                  onClick={endDowntime}
                  disabled={loading}
                  className="w-full font-bold py-3 rounded-xl transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                  style={{
                    background: "linear-gradient(90deg,#22C55E,#16A34A)",
                    color: "#0B1120",
                    boxShadow: "0 0 16px #22C55E28",
                  }}
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                      </svg>
                      Saving…
                    </>
                  ) : "✔ SAVE RCA & RETURN TO IDLE"}
                </button>
              ) : (
                <div className="text-center text-[#7A8FB0] text-[10px] py-4 border border-dashed border-[#2A3A5C] rounded-xl">
                  <span className="block mb-0.5">No active downtime</span>
                  <span className="block text-[9px]">Use the <strong className="text-white">Downtime</strong> button in the header to start.</span>
                </div>
              )}
            </div>

          </div>
        </div>

      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track  { background: #0F172A; }
        .custom-scrollbar::-webkit-scrollbar-thumb  { background: #3B82F6; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #60A5FA; }
      `}</style>
    </div>
  );
});

export default MaintenancePage;