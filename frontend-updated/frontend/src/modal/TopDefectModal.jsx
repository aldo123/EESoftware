import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { API } from "../service/api";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const COLORS = ["#ef4444", "#f97316", "#eab308", "#8b5cf6", "#3b82f6", "#14b8a6", "#64748b"];

export default function TopDefectModal({ cpNumber = "1" }) {
  const [bucket, setBucket] = useState("day");
  const [dateFrom, setDateFrom] = useState(today());
  const [dateTo, setDateTo] = useState(today());
  const [data, setData] = useState({ summary: [], trend: [], details: [], records_scanned: 0, defects_total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedDefect, setSelectedDefect] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const q = new URLSearchParams({ cp: String(cpNumber || "1"), bucket, date_from: dateFrom, date_to: dateTo });
      const res = await fetch(`${API}/api/snlist/top-defects?${q}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || body.message || `HTTP ${res.status}`);
      setData(body); setSelectedDefect("");
    } catch (e) { setError(e.message || "Failed to load top defects"); }
    finally { setLoading(false); }
  }, [cpNumber, bucket, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const chartData = useMemo(() => (data.summary || []).slice(0, 15), [data.summary]);
  const detailRows = useMemo(() => {
    const all = data.details || [];
    return selectedDefect ? all.filter(x => x.defect === selectedDefect) : all;
  }, [data.details, selectedDefect]);

  const exportDetailsCsv = () => {
    // Export exactly the currently filtered Detail Rows (date range + selected defect).
    const rows = detailRows.slice().reverse();
    if (!rows.length) {
      setError("Tidak ada data pada filter saat ini untuk diekspor.");
      return;
    }
    const headers = ["Time", "SN", "Defect", "Reason", "Value", "Lower Limit", "Upper Limit"];
    const fields = ["date_time", "sn", "defect", "reason", "value", "lower_limit", "upper_limit"];
    const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [headers.map(csvCell).join(","), ...rows.map(row => fields.map(key => csvCell(row[key])).join(","))].join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `TopDefect_CP${cpNumber}_${dateFrom}_to_${dateTo}${selectedDefect ? "_" + selectedDefect.replace(/[^a-z0-9_-]+/gi, "_") : ""}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const preset = (mode) => {
    const end = today();
    setBucket(mode);
    if (mode === "hour") { setDateFrom(end); setDateTo(end); }
    else if (mode === "day") { setDateFrom(end); setDateTo(end); }
    else if (mode === "7days") { setDateFrom(daysAgo(6)); setDateTo(end); }
    else if (mode === "month") { setDateFrom(`${end.slice(0, 7)}-01`); setDateTo(end); }
  };

  return (
    <div className="w-full h-full min-h-0 flex flex-col gap-3 p-3 md:p-4 overflow-hidden" style={{ background: "var(--bg-page, transparent)" }}>
      <section className="w-full h-full min-h-0 rounded-xl border border-[var(--border)] overflow-hidden flex flex-col" style={{ background: "var(--bg-surface)" }}>
        <header className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div><h2 className="text-lg font-bold text-[#22C55E]">TOP DEFECT</h2><p className="text-xs text-[var(--text-secondary)] mt-1">Defect analysis from SN List inspection data · CP{cpNumber}</p></div>
        </header>
        <div className="p-3 md:p-4 flex-1 min-h-0 overflow-hidden">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="flex flex-wrap gap-1.5">
              {[["hour","Per Day (Hours)"],["day","Per Day"],["7days","7 Days"],["month","Monthly"]].map(([v,label]) =>
                <button key={v} onClick={() => preset(v)} className={`px-3 py-2 rounded-lg text-xs font-semibold border ${bucket===v ? "bg-[#22C55E] text-[#052e16] border-[#22C55E]" : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"}`}>{label}</button>
              )}
            </div>
            <label className="text-xs text-[var(--text-secondary)]">From<input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="block mt-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm" style={{background:"var(--bg-input)",color:"var(--text-primary)"}} /></label>
            <label className="text-xs text-[var(--text-secondary)]">To<input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="block mt-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm" style={{background:"var(--bg-input)",color:"var(--text-primary)"}} /></label>
            <button onClick={load} disabled={loading || !dateFrom || !dateTo || dateFrom>dateTo} className="px-4 py-2 rounded-lg bg-[#22C55E] text-[#052e16] font-bold text-sm disabled:opacity-50">{loading ? "Loading..." : "Apply Range"}</button>
          </div>
          {error && <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <Kpi title="SN List Records Scanned" value={data.records_scanned ?? 0}/>
            <Kpi title="Detected Defect Occurrences" value={data.defects_total ?? 0}/>
            <Kpi title="Defect Categories" value={(data.summary || []).length}/>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-xl border border-[var(--border)] p-4 min-w-0">
              <h3 className="text-sm font-bold text-[#22C55E] mb-3">TOP DEFECTS (CLICK BAR TO FILTER)</h3>
              <div className="h-[min(34vh,300px)] min-h-[210px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{top:8,right:15,bottom:65,left:0}} onClick={e=>{if(e?.activePayload?.[0]?.payload?.defect)setSelectedDefect(e.activePayload[0].payload.defect);}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
                    <XAxis dataKey="defect" angle={-35} textAnchor="end" interval={0} height={95} tick={{fontSize:10,fill:"var(--text-secondary)"}}/>
                    <YAxis allowDecimals={false} tick={{fontSize:11,fill:"var(--text-secondary)"}}/>
                    <Tooltip contentStyle={{background:"var(--bg-surface)",border:"1px solid var(--border)",borderRadius:8,color:"var(--text-primary)"}}/>
                    <Bar dataKey="count" name="Count" fill="#ef4444" radius={[4,4,0,0]} cursor="pointer"/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border)] p-4 min-w-0">
              <h3 className="text-sm font-bold text-[#22C55E] mb-3">{bucket==="hour"?"DEFECTS BY HOUR":bucket==="7days"?"DEFECTS BY WEEK":bucket==="month"?"DEFECTS BY MONTH":"DEFECTS BY DAY"}</h3>
              <div className="h-[min(34vh,300px)] min-h-[210px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.trend || []} margin={{top:8,right:10,bottom:25,left:0}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
                    <XAxis dataKey="period" tick={{fontSize:10,fill:"var(--text-secondary)"}} angle={-20} textAnchor="end" height={45}/>
                    <YAxis allowDecimals={false} tick={{fontSize:11,fill:"var(--text-secondary)"}}/>
                    <Tooltip contentStyle={{background:"var(--bg-surface)",border:"1px solid var(--border)",borderRadius:8,color:"var(--text-primary)"}}/>
                    <Legend wrapperStyle={{fontSize:10}}/>
                    {chartData.slice(0,7).map((x,i)=><Bar key={x.defect} dataKey={x.defect} stackId="a" fill={COLORS[i%COLORS.length]} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold">DEFECT DETAILS {selectedDefect ? `— ${selectedDefect}` : ""}</h3>
              <div className="flex gap-2 items-center">
                {selectedDefect && <button onClick={()=>setSelectedDefect("")} className="text-xs text-[#22C55E]">Clear filter</button>}
                <button onClick={exportDetailsCsv} disabled={!detailRows.length} className="px-3 py-1.5 rounded-lg border border-[#22C55E] text-[#22C55E] text-xs font-bold disabled:opacity-40">Export CSV</button>
                <span className="text-xs text-[var(--text-secondary)]">{detailRows.length} shown (max 500 detail rows)</span>
              </div>
            </div>
            <div className="overflow-auto max-h-[min(25vh,220px)]">
              <table className="w-full text-xs">
                <thead className="sticky top-0" style={{background:"var(--bg-elevated)"}}><tr>{["Time","SN","Defect","Reason","Value","Lower Limit","Upper Limit"].map(h=><th key={h} className="text-left px-3 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody>{detailRows.slice().reverse().map((r,i)=><tr key={`${r.date_time}-${r.sn}-${r.defect}-${i}`} className="border-t border-[var(--border)]"><td className="px-3 py-2 whitespace-nowrap">{r.date_time}</td><td className="px-3 py-2 whitespace-nowrap">{r.sn||"—"}</td><td className="px-3 py-2">{r.defect}</td><td className="px-3 py-2">{r.reason}</td><td className="px-3 py-2">{r.value ?? "—"}</td><td className="px-3 py-2">{r.lower_limit ?? "—"}</td><td className="px-3 py-2">{r.upper_limit ?? "—"}</td></tr>)}</tbody>
              </table>
              {!detailRows.length && <p className="p-6 text-center text-sm text-[var(--text-secondary)]">No defects found for this range.</p>}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-[var(--text-secondary)]">Source: SN List only. Numeric measurements are compared against their Lowlimit/Uplimit columns. RESULT NG/FAIL is not counted as a defect category; only identified parameter defects and incomplete tests are shown.</p>
        </div>
      </section>
    </div>
  );
}

function Kpi({title,value}) {
 return <div className="rounded-xl border border-[var(--border)] p-4" style={{background:"var(--bg-elevated)"}}><p className="text-xs text-[var(--text-secondary)]">{title}</p><p className="text-2xl font-bold mt-2" style={{color:"var(--text-primary)"}}>{Number(value).toLocaleString()}</p></div>;
}