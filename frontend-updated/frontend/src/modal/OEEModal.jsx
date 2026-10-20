import { useMemo, useState, useEffect, useCallback } from "react";

import { API } from "../service/api";



const clampPercent = (n) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

const percent = (n) => `${clampPercent(n).toFixed(1)}%`;



function MetricCard({ title, value, subtitle, color }) {

  return (

    <div className="rounded-xl border border-[var(--border)] p-4 min-w-0" style={{ background: "var(--bg-surface-2)" }}>

      <div className="text-[10px] font-bold tracking-widest uppercase text-[var(--text-muted)]">{title}</div>

      <div className="mt-2 text-3xl font-black tabular-nums" style={{ color }}>{value}</div>

      <div className="mt-1 text-[10px] text-[var(--text-muted)]">{subtitle}</div>

      <div className="mt-3 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">

        <div className="h-full rounded-full transition-all" style={{ width: value, background: color }} />

      </div>

    </div>

  );

}



function NumberField({ label, value, onChange, unit = "", min = 0, step = "1" }) {

  return (

    <label className="block min-w-0">

      <span className="block text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">{label}</span>

      <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--bg-input)] overflow-hidden focus-within:border-[#22C55E]">

        <input type="number" min={min} step={step} value={value} onChange={(e) => onChange(e.target.value)} className="w-full min-w-0 bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] outline-none" />

        {unit && <span className="px-3 text-xs text-[var(--text-muted)]">{unit}</span>}

      </div>

    </label>

  );

}



export default function OEEPage({ cpNumber, machineStatus, downtimeActive, downtimeStart }) {

  // Persist Ideal Cycle Time locally so it survives page refreshes and app restarts.
  const [idealCycleSeconds, setIdealCycleSeconds] = useState(() => {
    try {
      const saved = window.localStorage.getItem("ee-interlock:oee:ideal-cycle-seconds");
      return saved !== null && saved.trim() !== "" && Number.isFinite(Number(saved)) && Number(saved) >= 0
        ? saved
        : "10";
    } catch {
      return "10";
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem("ee-interlock:oee:ideal-cycle-seconds", idealCycleSeconds);
    } catch (error) {
      console.warn("Unable to persist Ideal Cycle Time in local storage:", error);
    }
  }, [idealCycleSeconds]);

  const [productionData, setProductionData] = useState(null);

  const [downtimeData, setDowntimeData] = useState([]);

  const [snRows, setSnRows] = useState([]);

  const [loadingData, setLoadingData] = useState(false);

  const [dataError, setDataError] = useState("");

  const todayISO = () => {

    const d = new Date();

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  };

  const [filterCP, setFilterCP] = useState(cpNumber ? `CP${String(cpNumber).replace(/^CP/i, "")}` : "CP101");

  const [dateFrom, setDateFrom] = useState(todayISO);

  const [dateTo, setDateTo] = useState(todayISO);

  const [selectedShift, setSelectedShift] = useState("Shift 1 (08:00–19:30)");

  const [bucket, setBucket] = useState("Auto");



  const applyDatePreset = (preset) => {

    const end = new Date();

    const start = new Date(end);

    if (preset === "yesterday") {

      start.setDate(start.getDate() - 1);

      end.setDate(end.getDate() - 1);

    } else {

      const days = preset === "today" ? 1 : Number(preset);

      start.setDate(start.getDate() - (days - 1));

    }

    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    setDateFrom(fmt(start));

    setDateTo(fmt(end));

  };



  const fetchOEEData = useCallback(async () => {

    setLoadingData(true);

    setDataError("");

    try {

      const cp = String(filterCP || cpNumber || "1").replace(/^CP/i, "");

      const shift = selectedShift === "All Shifts" ? "all" : selectedShift.startsWith("Shift 1") ? "shift1" : "shift2";

      const dashboardParams = new URLSearchParams({ cp, date_from: dateFrom, date_to: dateTo, shift });

      const snParams = new URLSearchParams({ cp, date_from: `${dateFrom} 00:00:00`, date_to: `${dateTo} 23:59:59`, page: "1", per: "5000" });

      const downtimeParams = new URLSearchParams({ start_date: dateFrom, end_date: dateTo, page: "1", per: "5000" });

      const [dashRes, snRes, downRes] = await Promise.all([

        fetch(`${API}/api/dashboard/summary?${dashboardParams}`),

        fetch(`${API}/api/snlist/data?${snParams}`),

        fetch(`${API}/api/maintenance/events?${downtimeParams}`),

      ]);

      const [dash, sn, down] = await Promise.all([dashRes.json(), snRes.json(), downRes.json()]);

      if (!dashRes.ok || !dash.success) throw new Error(dash.message || "Gagal mengambil data Dashboard");

      setProductionData(dash);

      setSnRows(Array.isArray(sn.data) ? sn.data : []);

      setDowntimeData(Array.isArray(down.data) ? down.data : []);

    } catch (e) {

      setDataError(e.message || "Gagal mengambil data OEE");

    } finally {

      setLoadingData(false);

    }

  }, [cpNumber, filterCP, dateFrom, dateTo, selectedShift]);



  useEffect(() => { fetchOEEData(); }, [fetchOEEData]);

  useEffect(() => {

    const timer = setInterval(fetchOEEData, 15000);

    return () => clearInterval(timer);

  }, [fetchOEEData]);



  const parseTimestamp = (value) => {

    if (!value) return NaN;

    // Backend timestamps are local machine time; preserve local wall-clock interpretation.

    const text = String(value).trim().replace(" ", "T");

    const parsed = new Date(text).getTime();

    return Number.isFinite(parsed) ? parsed : NaN;

  };



  const filteredSnRows = useMemo(() => {

    const inSelectedShift = (timestamp) => {

      if (selectedShift === "All Shifts") return true;

      const d = new Date(timestamp);

      const minutes = d.getHours() * 60 + d.getMinutes();

      if (selectedShift.startsWith("Shift 1")) return minutes >= 8 * 60 && minutes <= 19 * 60 + 30;

      // Shift 2 runs overnight: 20:00 through 07:30.

      return minutes >= 20 * 60 || minutes <= 7 * 60 + 30;

    };

    return snRows.filter((row) => {

      const ts = parseTimestamp(row.date_time || row.datetime || row.timestamp || row.created_at || row.test_time);

      return Number.isFinite(ts) && inSelectedShift(ts);

    });

  }, [snRows, selectedShift]);



  const isOkResult = (row) => {

    const value = String(row.result ?? row.results ?? row.final_result ?? row.test_result ?? "").trim().toUpperCase().replace(/[ _-]+/g, "");

    return ["OK", "PASS", "PASS1", "PASS2", "GOOD"].includes(value);

  };



  // Calculate duration for ONE SN from its own row. Never substitute the gap

  // between different SN records because that is production interval, not test CT.

  const getActualTestDurationSeconds = (row) => {

    const normalized = Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [

      String(key).toLowerCase().replace(/[^a-z0-9]/g, ""), value

    ]));

    const firstEntry = (keys) => {

      for (const key of keys) {

        const value = normalized[key];

        if (value !== undefined && value !== null && String(value).trim() !== "") return { key, value };

      }

      return null;

    };

    const parseDuration = (value, key = "") => {

      if (value === undefined || value === null || String(value).trim() === "") return null;

      const text = String(value).trim().toLowerCase();

      // Supports duration strings HH:MM:SS or MM:SS, including fractional seconds.

      if (/^\d{1,3}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)) {

        const parts = text.split(":").map(Number);

        const seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];

        return Number.isFinite(seconds) && seconds > 0 ? seconds : null;

      }

      const match = text.match(/^\s*(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?)?\s*$/i);

      if (!match) return null;

      const amount = Number(match[1]);

      if (!Number.isFinite(amount) || amount <= 0) return null;

      const unit = (match[2] || "").toLowerCase();

      if (unit === "ms" || /millisecond/.test(unit) || /ms$/.test(key)) return amount / 1000;

      if (["m", "min", "mins", "minute", "minutes"].includes(unit)) return amount * 60;

      return amount;

    };



    const durationEntry = firstEntry([

      "actualtestdurationseconds", "testdurationseconds", "testingdurationseconds", "testtimeseconds",

      "actualctseconds", "ctseconds", "durationseconds", "durationsec", "testdurationsec", "testingtimeinseconds",

      "actualtestdurationms", "testdurationms", "testingdurationms", "durationms", "testtimems", "actualctms", "ctms",

      "actualtestduration", "testduration", "testingduration", "testtime", "actualct", "cycletime", "ct",

      "duration", "testingtime", "testelapsed", "elapsedtime", "elapsed", "testdurationvalue"

    ]);

    if (durationEntry) {

      const seconds = parseDuration(durationEntry.value, durationEntry.key);

      if (seconds !== null) return seconds;

    }



    // SN List configurations can use different column labels for the start/end

    // timestamps. Normalize the column names above, then match common variants.

    const startEntry = firstEntry([

      "teststarttime", "testingstarttime", "starttesttime", "starttime", "teststart", "startedat", "start",

      "starttimestamp", "teststartdatetime", "startdatetime", "startdatatime", "testingstart",

      "teststartedat", "testbegin", "begintime", "startdateandtime", "datetime_start", "date_time_start",

      "teststarted", "testingstartdatetime", "starttest", "beginningtime"

    ]);

    let endEntry = firstEntry([

      "testendtime", "testingendtime", "endtesttime", "endtime", "testend", "completedat", "end",

      "endtimestamp", "testenddatetime", "enddatetime", "completiontime", "testcompletedat",

      "testfinish", "finishtime", "enddateandtime", "datetime_end", "date_time_end", "testcompleted",

      "testingenddatetime", "endtest", "finishdatetime", "completedtime"

    ]);

    // If a row has a start timestamp but stores only the standard SN date_time,

    // use date_time as completion time for that same SN row.

    if (!endEntry && startEntry) {

      const completion = firstEntry(["datetime", "date_time", "timestamp", "createdat", "testtime", "recordedat", "completedtime"]);

      if (completion && completion.value !== startEntry.value) endEntry = completion;

    }

    if (startEntry && endEntry) {

      const startMs = parseTimestamp(startEntry.value);

      const endMs = parseTimestamp(endEntry.value);

      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {

        const seconds = (endMs - startMs) / 1000;

        // Reject clearly invalid values to avoid a date/column mismatch becoming CT.

        if (seconds > 0 && seconds <= 24 * 60 * 60) return seconds;

      }

    }

    return null;

  };

  const timeMetrics = useMemo(() => {

    const timestamps = filteredSnRows

      .map((row) => parseTimestamp(row.date_time || row.datetime || row.timestamp || row.created_at || row.test_time))

      .filter(Number.isFinite)

      .sort((a, b) => a - b);

    if (!timestamps.length) return { planned: 0, down: 0, operating: 0, firstTest: null, lastTest: null, testIntervals: [] };



    const fromBoundary = new Date(`${dateFrom}T00:00:00`).getTime();

    const toBoundary = Math.min(Date.now(), new Date(`${dateTo}T23:59:59`).getTime());

    const firstTest = timestamps.find((t) => t >= fromBoundary && t <= toBoundary);

    const testsInRange = timestamps.filter((t) => t >= fromBoundary && t <= toBoundary);

    if (firstTest == null || !testsInRange.length) return { planned: 0, down: 0, operating: 0, firstTest: null, lastTest: null, testIntervals: [] };



    const lastTest = testsInRange[testsInRange.length - 1];

    const activeStart = downtimeActive ? parseTimestamp(downtimeStart) : NaN;

    const nowInRange = Math.min(Date.now(), toBoundary);



    // A downtime event keeps the production-line timeline alive through its end,

    // even if no SN record was written during that downtime. If there is no

    // downtime after the last test, the production window stops at the last test.

    const downtimeIntervals = downtimeData.map((row) => ({

      start: parseTimestamp(row.start_time || row.started_at || row.downtime_start),

      end: row.end_time ? parseTimestamp(row.end_time) : NaN,

    })).filter((item) => Number.isFinite(item.start) && item.start <= toBoundary && item.start >= firstTest);



    let windowEnd = lastTest;

    for (const interval of downtimeIntervals) {

      if (Number.isFinite(interval.end)) windowEnd = Math.max(windowEnd, Math.min(interval.end, toBoundary));

    }

    if (downtimeActive && Number.isFinite(activeStart) && activeStart <= toBoundary && activeStart >= firstTest) {

      windowEnd = Math.max(windowEnd, nowInRange);

    }

    const planned = Math.max(0, (windowEnd - firstTest) / 60000);



    let down = 0;

    for (const interval of downtimeIntervals) {

      const end = Number.isFinite(interval.end) ? Math.min(interval.end, windowEnd) : (downtimeActive ? nowInRange : NaN);

      if (!Number.isFinite(end)) continue;

      down += Math.max(0, Math.min(end, windowEnd) - Math.max(interval.start, firstTest)) / 60000;

    }

    if (downtimeActive && Number.isFinite(activeStart) && activeStart >= firstTest && activeStart <= windowEnd &&

        !downtimeIntervals.some((item) => Math.abs(item.start - activeStart) < 1000)) {

      down += Math.max(0, Math.min(nowInRange, windowEnd) - Math.max(activeStart, firstTest)) / 60000;

    }

    down = Math.min(planned, down);



    // Actual CT is the interval from one test record to the next; ignore zero/negative gaps.

    const testIntervals = testsInRange.slice(1).map((t, i) => (t - testsInRange[i]) / 1000).filter((v) => v > 0 && Number.isFinite(v));

    return { planned, down, operating: Math.max(0, planned - down), firstTest, lastTest, testIntervals };

  }, [filteredSnRows, downtimeData, dateFrom, dateTo, downtimeActive, downtimeStart]);



  const metrics = useMemo(() => {

    const planned = timeMetrics.planned;

    const down = timeMetrics.down;

    const operating = timeMetrics.operating;

    // Output is counted from SN List OK results so it follows the selected date range and shift.

    const total = filteredSnRows.filter(isOkResult).length;

    // Quality: prioritize FPY1 when both FPY1 and FPY2 are available.
    // Fall back to FPY2, then FPY only if FPY1 is not provided.
    const firstAvailable = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
    const rawFpyValue = firstAvailable(
      productionData?.fpy1, productionData?.FPY1, productionData?.fpy_1,
      productionData?.fpy2, productionData?.FPY2, productionData?.fpy_2,
      productionData?.fpy, productionData?.FPY
    );
    const rawFpy = Number(rawFpyValue);
    const quality = rawFpyValue == null || !Number.isFinite(rawFpy)
      ? 0
      : clampPercent(rawFpy <= 1 ? rawFpy * 100 : rawFpy);

    // User-defined Actual CT: minimum positive interval between consecutive

    // SN test timestamps, considering only records whose result is OK/PASS.

    // This is the minimum test-to-test gap, not an average per-SN duration.

    const chronologicalTests = filteredSnRows

      .map((row) => ({

        timestamp: parseTimestamp(row.date_time || row.datetime || row.timestamp || row.created_at || row.test_time),

        isOK: isOkResult(row),

      }))

      .filter((test) => Number.isFinite(test.timestamp))

      .sort((a, b) => a.timestamp - b.timestamp);

    // Each interval is from one test record to the immediately following test;

    // only count intervals whose following product has an OK result.

    const actualCtSamples = chronologicalTests.slice(1)

      .map((test, index) => ({ seconds: (test.timestamp - chronologicalTests[index].timestamp) / 1000, isOK: test.isOK }))

      .filter((sample) => sample.isOK && Number.isFinite(sample.seconds) && sample.seconds > 0)

      .map((sample) => sample.seconds);

    const avgCT = actualCtSamples.length ? Math.min(...actualCtSamples) : null;

    const targetCT = Math.max(0, Number(idealCycleSeconds) || 0);

    const performance = avgCT && targetCT > 0 ? (targetCT / avgCT) * 100 : 0;

    const availability = planned > 0 ? (operating / planned) * 100 : 0;

    const oee = (clampPercent(availability) * clampPercent(performance) * quality) / 10000;

    return { planned, down, operating, total, availability: clampPercent(availability), performance: clampPercent(performance), quality, oee: clampPercent(oee), avgCT, ctSamples: actualCtSamples.length };

  }, [timeMetrics, idealCycleSeconds, productionData, filteredSnRows]);



  const currentDownMinutes = downtimeActive && downtimeStart ? Math.max(0, (Date.now() - new Date(downtimeStart).getTime()) / 60000) : 0;

  const statusText = String(machineStatus || "IDLE").toUpperCase();



  return (

    <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6" style={{ background: "var(--bg-base, var(--bg-surface))" }}>

      <div className="w-full max-w-none min-h-full rounded-xl border border-[var(--border)] overflow-hidden shadow-sm flex flex-col" style={{ background: "var(--bg-surface)" }}>

        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-soft)] shrink-0">

          <div>

            <div className="text-[#22C55E] text-xs font-bold tracking-[0.18em] uppercase">Overall Equipment Effectiveness</div>

            <div className="text-[var(--text-primary)] text-lg font-bold mt-1">OEE Monitor <span className="text-[var(--text-muted)] text-xs font-normal">{filterCP ? `· ${filterCP}` : ""}</span></div>

          </div>

        </div>

        <div className="p-5 overflow-y-auto space-y-5">

          {/* OEE filters: aligned with Production Dashboard filters */}

          <section className="rounded-xl border border-[var(--border)] p-3" style={{ background: "var(--bg-surface-2)" }}>

            <div className="flex flex-wrap items-end gap-2.5">

              <label className="block w-[76px]">

                <span className="block text-[9px] font-bold uppercase text-[var(--text-muted)] mb-1">CP</span>

                <input value={filterCP} onChange={(e) => setFilterCP(e.target.value)} className="w-full h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)] outline-none focus:border-[#22C55E]" />

              </label>

              <label className="block w-[110px]">

                <span className="block text-[9px] font-bold uppercase text-[var(--text-muted)] mb-1">From</span>

                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)] outline-none focus:border-[#22C55E]" />

              </label>

              <label className="block w-[110px]">

                <span className="block text-[9px] font-bold uppercase text-[var(--text-muted)] mb-1">To</span>

                <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="w-full h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)] outline-none focus:border-[#22C55E]" />

              </label>

              <label className="block min-w-[145px]">

                <span className="block text-[9px] font-bold uppercase text-[var(--text-muted)] mb-1">Shift</span>

                <select value={selectedShift} onChange={(e) => setSelectedShift(e.target.value)} className="w-full h-8 rounded-lg border border-[#22C55E] bg-[var(--bg-input)] px-2 text-xs font-semibold text-[var(--text-primary)] outline-none">

                  <option>All Shifts</option><option>Shift 1 (08:00–19:30)</option><option>Shift 2 (20:00–07:30)</option>

                </select>

              </label>

              <div className="flex items-end gap-1.5 pb-0.5">

                <button type="button" onClick={() => applyDatePreset("today")} className="h-8 px-3 rounded-lg border border-[var(--border)] text-xs text-[var(--text-primary)] hover:border-[#22C55E]">Today</button>

                <button type="button" onClick={() => applyDatePreset("yesterday")} className="h-8 px-3 rounded-lg border border-[var(--border)] text-xs text-[var(--text-primary)] hover:border-[#22C55E]">Yesterday</button>

                <button type="button" onClick={() => applyDatePreset(7)} className="h-8 px-3 rounded-lg border border-[var(--border)] text-xs text-[var(--text-primary)] hover:border-[#22C55E]">7 Days</button>

                <button type="button" onClick={() => applyDatePreset(30)} className="h-8 px-3 rounded-lg border border-[var(--border)] text-xs text-[var(--text-primary)] hover:border-[#22C55E]">30 Days</button>

              </div>

              <label className="block ml-auto w-[80px]">

                <span className="block text-[9px] font-bold uppercase text-[var(--text-muted)] mb-1">Bucket</span>

                <select value={bucket} onChange={(e) => setBucket(e.target.value)} className="w-full h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)] outline-none focus:border-[#22C55E]">

                  <option>Auto</option><option>Hour</option><option>Day</option>

                </select>

              </label>

            </div>

          </section>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">

            <MetricCard title="OEE" value={percent(metrics.oee)} subtitle="Availability × Performance × Quality" color="#22C55E" />

            <MetricCard title="Availability" value={percent(metrics.availability)} subtitle="Running time / (Running time + downtime)" color="#3B82F6" />

            <MetricCard title="Performance" value={percent(metrics.performance)} subtitle="Target CT dibandingkan average actual CT" color="#8B5CF6" />

            <MetricCard title="Quality" value={percent(metrics.quality)} subtitle="FPY dari Dashboard" color="#F59E0B" />

          </div>



          <section className="rounded-xl border border-[var(--border)] p-4" style={{ background: "var(--bg-surface-2)" }}>

            <div className="flex flex-wrap items-start justify-between gap-2 mb-4">

              <div>

                <h3 className="text-sm font-bold text-[var(--text-primary)]">OEE Data & Parameters</h3>

                <p className="text-[10px] text-[var(--text-muted)] mt-1">Output dan FPY diambil dari Dashboard, riwayat downtime dari Downtime, dan Actual CT dari interval minimum antar-test berurutan pada SN List yang hasilnya OK.</p>

              </div>

              <span className="text-[10px] rounded-full px-2 py-1 border border-[var(--border)] text-[var(--text-secondary)]">Machine: {statusText}</span>

            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">

              <div className="rounded-lg border border-[var(--border)] px-3 py-2"><span className="block text-[10px] uppercase font-bold text-[var(--text-muted)]">Planned Production Time</span><span className="text-lg font-bold text-[var(--text-primary)]">{metrics.planned.toFixed(1)} min</span><span className="text-[10px] text-[var(--text-muted)]">Data test pertama sampai test terakhir / downtime aktif</span></div>

              <div className="rounded-lg border border-[var(--border)] px-3 py-2"><span className="block text-[10px] uppercase font-bold text-[var(--text-muted)]">Total Downtime</span><span className="text-lg font-bold text-[var(--text-primary)]">{metrics.down.toFixed(1)} min</span><span className="text-[10px] text-[var(--text-muted)]">Otomatis dari Downtime</span></div>

              <NumberField label="Ideal Cycle Time" value={idealCycleSeconds} onChange={setIdealCycleSeconds} unit="sec/pcs" step="0.01" />

              <div className="rounded-lg border border-[var(--border)] px-3 py-2"><span className="block text-[10px] uppercase font-bold text-[var(--text-muted)]">Total Output</span><span className="text-lg font-bold text-[var(--text-primary)]">{metrics.total.toLocaleString()} pcs</span><span className="text-[10px] text-[var(--text-muted)]">Otomatis dari SN List (hasil OK)</span></div>

              <div className="rounded-lg border border-[var(--border)] px-3 py-2"><span className="block text-[10px] uppercase font-bold text-[var(--text-muted)]">Actual CT (Min. Interval)</span><span className="text-lg font-bold text-[var(--text-primary)]">{metrics.avgCT == null ? "—" : `${metrics.avgCT.toFixed(2)} sec/pcs`}</span><span className="text-[10px] text-[var(--text-muted)]">SN List OK · minimum jarak test-ke-test · {metrics.ctSamples} interval valid</span></div>

              <div className="rounded-lg border border-[var(--border)] px-3 py-2 flex flex-col justify-center">

                <span className="text-[10px] uppercase font-bold text-[var(--text-muted)]">Running Time</span>

                <span className="text-lg font-bold text-[var(--text-primary)] tabular-nums">{metrics.operating.toFixed(1)} min</span>

                <span className="text-[10px] text-[var(--text-muted)]">Planned time − downtime</span>

              </div>

            </div>

            {downtimeActive && <p className="mt-3 text-xs text-amber-500">Downtime sedang aktif sekitar {currentDownMinutes.toFixed(1)} menit dan dihitung otomatis.</p>}

            <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-[var(--text-muted)]"><span>{loadingData ? "Mengambil data..." : "Data otomatis diperbarui setiap 15 detik"}</span><button type="button" onClick={fetchOEEData} className="rounded-md border border-[var(--border)] px-2 py-1 hover:border-[#22C55E]">Refresh Data</button></div>

            {dataError && <p className="mt-2 text-xs text-red-500">{dataError}</p>}

          </section>

          <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">Rumus: Availability = (Planned Time − Downtime) / Planned Time × 100%; Performance = Target CT / Actual CT minimum × 100% (interval minimum antar-test SN OK dari SN List); Quality = FPY Dashboard; OEE = Availability × Performance × Quality. Performance dan OEE ditampilkan maksimal 100%.</p>

        </div>

      </div>

    </div>

  );

}
