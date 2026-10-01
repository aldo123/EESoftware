// src/modal/CpkAnalyzerModal.jsx
//
// CPK Analyzer — full-page port of the standalone cpk_analyzer2.py Tkinter
// tool (Function Tester CPK Analyzer V2.4). Lives as its own sidebar menu
// item (not a Page Builder widget) so it gets the whole page to work with.
//
// The file is loaded once into memory here (rows + columns), same as the
// desktop tool kept a pandas DataFrame in memory — filtering, summary, and
// failure analysis all run client-side against that array. Only the actual
// CPK/assessment/calibration math (backend/cpk_engine.py, a straight port
// of the tool's CPKCalculator/CPKAssessment/CalibrationEngine classes) and
// the Excel import/export round-trip through the backend.
import { useState, useCallback, useMemo, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import { API } from "../service/api";
import { ModalBackdrop, ModalPanel } from "../components/motion";

// ────────────────────────────────────────────────────────────────
//  SMALL UI ATOMS
// ────────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{label}</span>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = "text", ...rest }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="bg-[var(--bg-surface)] border border-[var(--border)] focus:border-[#22C55E]/60 text-[var(--text-primary)] text-xs rounded-lg px-3 h-8 outline-none transition-colors placeholder-[var(--text-faint)]"
      {...rest}
    />
  );
}

function Select({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="bg-[var(--bg-surface)] border border-[var(--border)] focus:border-[#22C55E]/60 text-[var(--text-primary)] text-xs rounded-lg px-2 h-8 outline-none transition-colors"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
      ))}
    </select>
  );
}

function Button({ children, onClick, disabled, variant = "default", className = "" }) {
  const variants = {
    default: "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]",
    primary: "border-[#22C55E]/60 text-[#22C55E] hover:bg-[#22C55E]/10",
    accent: "border-[#3B82F6]/60 text-[#3B82F6] hover:bg-[#3B82F6]/10",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-8 px-3 rounded-lg border text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

function StatBox({ label, value, big }) {
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-surface)] px-2 py-2.5 flex flex-col items-center gap-1 flex-1 min-w-[110px]">
      <span className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider text-center">{label}</span>
      <span className={`font-bold text-[var(--text-primary)] ${big ? "text-lg" : "text-base"}`}>{value}</span>
    </div>
  );
}

function Dialog({ title, icon, onClose, children, width = 640 }) {
  return (
    <ModalBackdrop className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <ModalPanel
        className="flex flex-col rounded-2xl overflow-hidden border border-[var(--border)] shadow-2xl"
        style={{ width, maxWidth: "92vw", maxHeight: "86vh", background: "var(--bg-surface-2)" }}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)] shrink-0">
          <div className="flex items-center gap-2">
            {icon && <span className="text-base">{icon}</span>}
            <span className="text-[var(--text-primary)] font-bold text-sm">{title}</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </ModalPanel>
    </ModalBackdrop>
  );
}

// ────────────────────────────────────────────────────────────────
//  DATA HELPERS
// ────────────────────────────────────────────────────────────────

// Columns that are always identifiers/filters, never a CPK measurement
// parameter, even when their values happen to parse as numbers (e.g. a
// LINE column containing "01").
const NON_PARAMETER_COLS = new Set(["DATETIME", "RESULT", "STATION", "LINE", "BARCODE"]);

function isNumeric(v) {
  if (v === null || v === undefined || v === "") return false;
  return Number.isFinite(Number(v));
}

function detectNumericColumns(rows, columns) {
  return columns.filter((col) => {
    if (NON_PARAMETER_COLS.has(col.toUpperCase())) return false;
    let count = 0;
    for (const row of rows) {
      if (isNumeric(row[col])) count += 1;
      if (count >= 2) return true;
    }
    return false;
  });
}

function uniqueSorted(rows, col) {
  const set = new Set();
  rows.forEach((r) => { if (r[col] !== undefined && r[col] !== null && r[col] !== "") set.add(String(r[col])); });
  return [...set].sort();
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / (arr.length || 1); }
function std(arr) {
  const m = mean(arr);
  if (arr.length < 2) return 0;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
}

function findColumn(columns, name) {
  return columns.find((c) => c.toUpperCase() === name) || null;
}

function fmtNum(value, decimals) {
  if (value === null || value === undefined) return "-";
  if (value === Infinity || value === "Infinity") return "∞";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ────────────────────────────────────────────────────────────────
//  CHARTS — plain SVG (Distribution histogram / Box Plot)
// ────────────────────────────────────────────────────────────────

const RED = "#EF4444";
const DARK_LINE = "#0F172A";

function ChartLegendRow({ items }) {
  return (
    <div className="flex items-center justify-center gap-3 flex-wrap px-1 py-1">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1 text-[9px] text-[#475569] whitespace-nowrap">
          <span className="inline-block w-3" style={{ borderTop: `2px ${it.dash ? "dashed" : "solid"} ${it.color}` }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function DistributionChart({ title, hist, lsl, usl, mean: meanVal, accent, decimals, xDomain }) {
  const w = 360, h = 220;
  const padL = 40, padR = 10, padT = 26, padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const legendItems = [
    { label: `LSL = ${fmtNum(lsl, decimals)}`, color: RED, dash: true },
    { label: `USL = ${fmtNum(usl, decimals)}`, color: RED, dash: true },
    { label: `Mean = ${fmtNum(meanVal, decimals)}`, color: DARK_LINE },
  ];

  if (!hist || !Array.isArray(hist.counts) || hist.counts.length === 0) {
    return (
      <div className="flex flex-col rounded-lg overflow-hidden" style={{ background: "#F8FAFC" }}>
        <svg width="100%" viewBox={`0 0 ${w} ${h}`}><text x={w / 2} y={h / 2} fontSize={11} fill="#94A3B8" textAnchor="middle">No data</text></svg>
      </div>
    );
  }

  const { counts, edges } = hist;
  const maxCount = Math.max(...counts, 1);
  const lo = xDomain ? xDomain[0] : Math.min(edges[0], lsl);
  const hi = xDomain ? xDomain[1] : Math.max(edges[edges.length - 1], usl);
  const span = hi - lo || 1;
  const xFor = (val) => padL + ((val - lo) / span) * plotW;
  const barW = plotW / counts.length;

  return (
    <div className="flex flex-col rounded-lg overflow-hidden" style={{ background: "#F8FAFC" }}>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
        <text x={w / 2} y={16} fontSize={12} fontWeight="bold" fill="#1E293B" textAnchor="middle">{title}</text>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={padL} y1={padT + plotH * (1 - f)} x2={w - padR} y2={padT + plotH * (1 - f)} stroke="#E2E8F0" strokeWidth={0.5} />
        ))}
        {counts.map((c, i) => {
          const barH = (c / maxCount) * plotH;
          return (
            <rect key={i} x={xFor(edges[i]) + 0.5} y={padT + plotH - barH} width={Math.max(barW - 1, 0.5)} height={barH} fill={accent} opacity={0.85} />
          );
        })}
        <line x1={padL} y1={padT + plotH} x2={w - padR} y2={padT + plotH} stroke="#94A3B8" strokeWidth={1} />
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#94A3B8" strokeWidth={1} />
        {[lsl, usl].map((val, i) => (
          <line key={`spec-${i}`} x1={xFor(val)} y1={padT} x2={xFor(val)} y2={padT + plotH} stroke={RED} strokeWidth={1.5} strokeDasharray="5,3" />
        ))}
        {meanVal !== undefined && meanVal !== null && (
          <line x1={xFor(meanVal)} y1={padT} x2={xFor(meanVal)} y2={padT + plotH} stroke={DARK_LINE} strokeWidth={1.5} />
        )}
        <text x={6} y={padT + 8} fontSize={8} fill="#64748B">{maxCount}</text>
        <text x={6} y={padT + plotH} fontSize={8} fill="#64748B">0</text>
        <text x={padL} y={h - 8} fontSize={8} fill="#64748B">{fmtNum(lo, decimals)}</text>
        <text x={w - padR} y={h - 8} fontSize={8} fill="#64748B" textAnchor="end">{fmtNum(hi, decimals)}</text>
      </svg>
      <ChartLegendRow items={legendItems} />
    </div>
  );
}

function BoxPlotChart({ title, box, lsl, usl, mean: meanVal, accent, decimals, xDomain }) {
  const w = 360, h = 220;
  const padL = 40, padR = 10, padT = 26, padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const legendItems = [
    { label: `LSL = ${fmtNum(lsl, decimals)}`, color: RED, dash: true },
    { label: `USL = ${fmtNum(usl, decimals)}`, color: RED, dash: true },
    { label: `Mean = ${fmtNum(meanVal, decimals)}`, color: DARK_LINE },
  ];

  if (!box) {
    return (
      <div className="flex flex-col rounded-lg overflow-hidden" style={{ background: "#F8FAFC" }}>
        <svg width="100%" viewBox={`0 0 ${w} ${h}`}><text x={w / 2} y={h / 2} fontSize={11} fill="#94A3B8" textAnchor="middle">No data</text></svg>
      </div>
    );
  }

  const allVals = [box.whisker_low, box.whisker_high, box.q1, box.q3, box.median, lsl, usl, ...(box.outliers || [])];
  const lo = xDomain ? xDomain[0] : Math.min(...allVals);
  const hi = xDomain ? xDomain[1] : Math.max(...allVals);
  const span = (hi - lo) || 1;
  const padSpan = xDomain ? 0 : span * 0.08;
  const yLo = lo - padSpan, yHi = hi + padSpan;
  const yFor = (val) => padT + plotH - ((val - yLo) / (yHi - yLo)) * plotH;

  const cx = padL + plotW / 2;
  const boxHalfW = Math.min(plotW * 0.18, 46);

  return (
    <div className="flex flex-col rounded-lg overflow-hidden" style={{ background: "#F8FAFC" }}>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
        <text x={w / 2} y={16} fontSize={12} fontWeight="bold" fill="#1E293B" textAnchor="middle">{title}</text>
        <line x1={padL} y1={padT + plotH} x2={w - padR} y2={padT + plotH} stroke="#94A3B8" strokeWidth={1} />
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#94A3B8" strokeWidth={1} />
        {[lsl, usl].map((val, i) => (
          <line key={`spec-${i}`} x1={padL} y1={yFor(val)} x2={w - padR} y2={yFor(val)} stroke={RED} strokeWidth={1.5} strokeDasharray="5,3" />
        ))}
        {meanVal !== undefined && meanVal !== null && (
          <line x1={padL} y1={yFor(meanVal)} x2={w - padR} y2={yFor(meanVal)} stroke={DARK_LINE} strokeWidth={1.5} />
        )}
        <line x1={cx} y1={yFor(box.whisker_low)} x2={cx} y2={yFor(box.q1)} stroke="#334155" strokeWidth={1.3} />
        <line x1={cx} y1={yFor(box.q3)} x2={cx} y2={yFor(box.whisker_high)} stroke="#334155" strokeWidth={1.3} />
        <line x1={cx - boxHalfW / 2} y1={yFor(box.whisker_low)} x2={cx + boxHalfW / 2} y2={yFor(box.whisker_low)} stroke="#334155" strokeWidth={1.3} />
        <line x1={cx - boxHalfW / 2} y1={yFor(box.whisker_high)} x2={cx + boxHalfW / 2} y2={yFor(box.whisker_high)} stroke="#334155" strokeWidth={1.3} />
        <rect x={cx - boxHalfW} y={yFor(box.q3)} width={boxHalfW * 2} height={Math.max(yFor(box.q1) - yFor(box.q3), 1)} fill={accent} opacity={0.55} stroke="#334155" strokeWidth={1.3} />
        <line x1={cx - boxHalfW} y1={yFor(box.median)} x2={cx + boxHalfW} y2={yFor(box.median)} stroke="#0F172A" strokeWidth={1.8} />
        {(box.outliers || []).map((val, i) => (
          <circle key={i} cx={cx} cy={yFor(val)} r={2.6} fill="none" stroke="#334155" strokeWidth={1.1} />
        ))}
        <text x={6} y={yFor(yHi) + 9} fontSize={8} fill="#64748B">{fmtNum(yHi, decimals)}</text>
        <text x={6} y={yFor(yLo)} fontSize={8} fill="#64748B">{fmtNum(yLo, decimals)}</text>
      </svg>
      <ChartLegendRow items={legendItems} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  MAIN PAGE
// ────────────────────────────────────────────────────────────────

const INDUSTRY_OPTIONS = ["Automotive", "Medical", "Electronics", "General Manufacturing", "Consumer Products"];

export default function CpkAnalyzerPage() {
  const fileInputRef = useRef(null);

  // Loaded dataset
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [fileName, setFileName] = useState("");
  const [fileLoading, setFileLoading] = useState(false);

  // Filters / spec
  const [parameter, setParameter] = useState("");
  const [lineFilter, setLineFilter] = useState("ALL");
  const [stationFilter, setStationFilter] = useState("ALL");
  const [resultFilter, setResultFilter] = useState("ALL");
  const [lsl, setLsl] = useState("");
  const [usl, setUsl] = useState("");

  // Settings
  const [decimalPlaces, setDecimalPlaces] = useState(3);
  const [industry, setIndustry] = useState("General Manufacturing");
  const [axisAuto, setAxisAuto] = useState(true);
  const [axisMin, setAxisMin] = useState("");
  const [axisMax, setAxisMax] = useState("");

  // Calibration
  const [calibration, setCalibration] = useState(null); // { k, b, calibrated: stats, calibrated_histogram, calibrated_boxplot, improvement_pct }

  // Result
  const [result, setResult] = useState(null); // { stats, assessment, histogram, boxplot }
  const [lastFilteredRows, setLastFilteredRows] = useState([]);
  const [lastValues, setLastValues] = useState(null);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState("Load data untuk memulai analisis.");
  const [error, setError] = useState("");

  // Dialogs
  const [dialog, setDialog] = useState(null); // "data" | "summary" | "failure" | "assessment" | "standards" | "axis" | "manualcalib" | "about"
  const [standards, setStandards] = useState(null);

  const numericColumns = useMemo(() => detectNumericColumns(rows, columns), [rows, columns]);
  const lineCol = useMemo(() => findColumn(columns, "LINE"), [columns]);
  const stationCol = useMemo(() => findColumn(columns, "STATION"), [columns]);
  const resultCol = useMemo(() => findColumn(columns, "RESULT"), [columns]);
  const datetimeCol = useMemo(() => findColumn(columns, "DATETIME"), [columns]);

  const lineOptions = useMemo(() => (lineCol ? ["ALL", ...uniqueSorted(rows, lineCol)] : ["ALL"]), [rows, lineCol]);
  const stationOptions = useMemo(() => (stationCol ? ["ALL", ...uniqueSorted(rows, stationCol)] : ["ALL"]), [rows, stationCol]);

  // ── Auto-detect LSL/USL from a parameter's distribution ─────
  const autoDetectSpecs = useCallback((paramName, rowsSource) => {
    if (!paramName) return;
    const values = rowsSource.map((r) => Number(r[paramName])).filter((v) => Number.isFinite(v));
    if (values.length < 10) return;
    const m = mean(values), s = std(values);
    const dec = decimalPlaces;
    setLsl(Number((m - 3 * s).toFixed(dec)));
    setUsl(Number((m + 3 * s).toFixed(dec)));
    setInfo(`Auto-suggested LSL/USL based on data distribution for "${paramName}".`);
  }, [decimalPlaces]);

  // ── File load ─────────────────────────────────────────────
  const handleFilePicked = async (file) => {
    if (!file) return;
    setFileLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/api/cpk/parse-file`, { method: "POST", body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Parse failed");

      setRows(data.rows);
      setColumns(data.columns);
      setFileName(file.name);
      setResult(null);
      setCalibration(null);
      setLineFilter("ALL");
      setStationFilter("ALL");
      setResultFilter("ALL");

      const numeric = detectNumericColumns(data.rows, data.columns);
      const preferred = ["MAX_HOT_POWER", "STAND_BY_POWER", "MAX_PRESSURE", "VOLTAGE", "HOT_TEMP_MAX"];
      const chosen = preferred.find((p) => numeric.includes(p)) || numeric[0] || "";
      setParameter(chosen);
      if (chosen) autoDetectSpecs(chosen, data.rows);

      setInfo(`Data loaded. ${data.rows.length.toLocaleString()} records available.`);
    } catch (e) {
      setError(e.message || "Failed to read file");
    }
    setFileLoading(false);
  };

  const handleParameterChange = (name) => {
    setParameter(name);
    if (name) autoDetectSpecs(name, rows);
  };

  // ── Filtering ─────────────────────────────────────────────
  const getFilteredData = useCallback(() => {
    let data = rows;
    if (lineCol && lineFilter !== "ALL") data = data.filter((r) => String(r[lineCol]) === lineFilter);
    if (stationCol && stationFilter !== "ALL") data = data.filter((r) => String(r[stationCol]) === stationFilter);
    if (resultCol && resultFilter !== "ALL") data = data.filter((r) => String(r[resultCol] || "").toLowerCase() === resultFilter.toLowerCase());
    const values = data.map((r) => Number(r[parameter])).filter((v) => Number.isFinite(v));
    return { data, values };
  }, [rows, lineCol, stationCol, resultCol, lineFilter, stationFilter, resultFilter, parameter]);

  // ── Calculate ─────────────────────────────────────────────
  const calculate = async () => {
    setError("");
    if (!rows.length) { setError("Load CSV/Excel terlebih dahulu."); return; }
    if (!parameter) { setError("Pilih parameter terlebih dahulu."); return; }
    if (lsl === "" || usl === "") { setError("Masukkan LSL dan USL."); return; }

    const { data, values } = getFilteredData();
    if (values.length < 2) { setError(`Data valid kurang dari 2. (Current: ${values.length})`); return; }

    setLoading(true);
    setCalibration(null);
    try {
      const res = await fetch(`${API}/api/cpk/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, lsl: Number(lsl), usl: Number(usl), industry }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Calculate failed");
      setResult(json);
      setLastFilteredRows(data);
      setLastValues(values);
      setInfo(`Calculation complete. ${values.length.toLocaleString()} data points analyzed.`);
    } catch (e) {
      setError(e.message || "Network error");
    }
    setLoading(false);
  };

  // ── Calibration ───────────────────────────────────────────
  const autoCalibrate = async () => {
    if (!lastValues) { setError("Hitung CPK terlebih dahulu."); return; }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/cpk/calibrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: lastValues, lsl: Number(lsl), usl: Number(usl) }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Calibrate failed");
      setCalibration(json);
      setInfo(`Auto-calibrated: k=${json.k.toFixed(4)}, b=${json.b.toFixed(4)}, Cpk improved from ${fmtNum(json.original.cpk, decimalPlaces)} to ${fmtNum(json.calibrated.cpk, decimalPlaces)}.`);
    } catch (e) {
      setError(e.message || "Network error");
    }
    setLoading(false);
  };

  const manualCalibrateApply = async (k, b) => {
    if (!lastValues) { setError("Hitung CPK terlebih dahulu."); return; }
    setError("");
    setLoading(true);
    try {
      const calibratedValues = lastValues.map((v) => k * v + b);
      const res = await fetch(`${API}/api/cpk/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: calibratedValues, lsl: Number(lsl), usl: Number(usl), industry }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Calibrate failed");
      const originalCpk = result?.stats?.cpk ?? 0;
      const newCpk = json.stats.cpk;
      const improvement = originalCpk === Infinity ? 0 : newCpk === Infinity ? 100 : (originalCpk > 0 ? ((newCpk - originalCpk) / originalCpk) * 100 : 0);
      setCalibration({
        k, b,
        original: result?.stats,
        calibrated: json.stats,
        calibrated_histogram: json.histogram,
        calibrated_boxplot: json.boxplot,
        improvement_pct: improvement,
      });
      setInfo(`Manual calibration applied: k=${k.toFixed(4)}, b=${b.toFixed(4)}.`);
      setDialog(null);
    } catch (e) {
      setError(e.message || "Network error");
    }
    setLoading(false);
  };

  const resetCalibration = () => {
    setCalibration(null);
    setInfo("Calibration reset to default (k=1.0, b=0.0).");
  };

  // ── Reset filters ─────────────────────────────────────────
  const resetFilters = () => {
    setLineFilter("ALL");
    setStationFilter("ALL");
    setResultFilter("ALL");
    setResult(null);
    setCalibration(null);
    setAxisAuto(true);
    setAxisMin("");
    setAxisMax("");
    if (parameter) autoDetectSpecs(parameter, rows);
    setInfo("Filters reset. Select parameter and calculate CPK.");
  };

  // ── Export ────────────────────────────────────────────────
  const exportResult = async () => {
    if (!result) { setError("Hitung CPK terlebih dahulu."); return; }
    try {
      const res = await fetch(`${API}/api/cpk/export-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stats: result.stats,
          assessment: result.assessment,
          rows: lastFilteredRows,
          parameter,
          industry,
          filters: { line: lineFilter, station: stationFilter, result: resultFilter },
          calibration: calibration ? { k: calibration.k, b: calibration.b } : null,
        }),
      });
      if (!res.ok) throw new Error("Export failed");
      downloadBlob(await res.blob(), "cpk_result.xlsx");
    } catch (e) {
      setError(e.message || "Export failed");
    }
  };

  const exportAllData = async () => {
    if (!rows.length) { setError("Load data terlebih dahulu."); return; }
    try {
      const summary = buildSummary();
      const res = await fetch(`${API}/api/cpk/export-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, summary }),
      });
      if (!res.ok) throw new Error("Export failed");
      downloadBlob(await res.blob(), "cpk_all_data.xlsx");
    } catch (e) {
      setError(e.message || "Export failed");
    }
  };

  // ── Summary ───────────────────────────────────────────────
  function buildSummary() {
    const s = { total_rows: rows.length, total_columns: columns.length };
    if (resultCol) {
      const pass = rows.filter((r) => String(r[resultCol]).toLowerCase() === "pass").length;
      const fail = rows.filter((r) => String(r[resultCol]).toLowerCase() === "fail").length;
      s.pass_count = pass; s.fail_count = fail;
      s.pass_rate = rows.length ? (pass / rows.length) * 100 : 0;
    }
    if (datetimeCol) {
      const dates = rows.map((r) => new Date(r[datetimeCol])).filter((d) => !Number.isNaN(d.getTime()));
      if (dates.length) {
        const min = new Date(Math.min(...dates)), max = new Date(Math.max(...dates));
        s.date_min = min.toISOString(); s.date_max = max.toISOString();
        s.date_range_days = Math.round((max - min) / 86400000);
      }
    }
    if (stationCol) s.station_counts = countBy(rows, stationCol);
    if (lineCol) s.line_counts = countBy(rows, lineCol);
    s.numeric_columns = numericColumns;
    return s;
  }

  function countBy(list, col) {
    const out = {};
    list.forEach((r) => { const k = String(r[col] ?? ""); if (k) out[k] = (out[k] || 0) + 1; });
    return out;
  }

  // ── Failure analysis ──────────────────────────────────────
  function buildFailureAnalysis() {
    if (!resultCol) return null;
    const failRows = rows.filter((r) => String(r[resultCol]).toLowerCase() === "fail");
    if (!failRows.length) return { empty: true };

    const otherCols = columns.filter((c) => c !== resultCol && c !== datetimeCol && c !== lineCol && c !== stationCol);
    const categorical = [];
    const numeric = [];

    otherCols.forEach((col) => {
      const nums = failRows.map((r) => Number(r[col])).filter((v) => Number.isFinite(v));
      if (nums.length >= failRows.length * 0.5 && nums.length > 0) {
        numeric.push({ col, mean: mean(nums), std: std(nums), min: Math.min(...nums), max: Math.max(...nums), n: nums.length });
      } else {
        const counts = countBy(failRows, col);
        const uniq = Object.keys(counts).length;
        if (uniq > 0 && uniq <= 6) categorical.push({ col, counts });
      }
    });

    let byHour = null;
    if (datetimeCol) {
      const hours = failRows.map((r) => new Date(r[datetimeCol])).filter((d) => !Number.isNaN(d.getTime())).map((d) => d.getHours());
      if (hours.length) {
        byHour = {};
        hours.forEach((h) => { byHour[h] = (byHour[h] || 0) + 1; });
      }
    }

    const byStation = stationCol ? countBy(failRows, stationCol) : null;

    return {
      total: failRows.length,
      rate: (failRows.length / rows.length) * 100,
      categorical,
      numeric,
      byHour,
      byStation,
    };
  }

  // ── Derived render values ─────────────────────────────────
  const stats = result?.stats;
  const assessment = result?.assessment;
  const statusColor = !assessment ? "var(--text-muted)"
    : assessment.status === "EXCELLENT" || assessment.status === "CAPABLE" ? "#22C55E"
      : assessment.status === "MARGINAL" ? "#F59E0B" : "#EF4444";

  const xDomain = !axisAuto && axisMin !== "" && axisMax !== "" && Number(axisMin) < Number(axisMax)
    ? [Number(axisMin), Number(axisMax)]
    : null;

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-canvas)] overflow-hidden font-sans transition-colors">
      {/* ── HEADER ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-soft)] shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">🏭</span>
          <span className="text-[var(--text-primary)] font-bold text-base">FUNCTION TESTER</span>
          <span className="text-[var(--text-primary)] font-bold text-base">CPK ANALYZER</span>
          <span className="text-[var(--text-muted)] text-[10px]">v2.4</span>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-[var(--text-secondary)]">📁 {fileName || "No file loaded"}</span>
          <span className="text-[#1abc9c] font-semibold">🏭 {industry}</span>
          <span className="text-[#3B82F6] font-semibold">🔢 {decimalPlaces} decimal places</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4" style={{ scrollbarWidth: "thin" }}>
        {/* ── CONTROL PANEL ─────────────────────────────────── */}
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface-2)] p-4 flex flex-col gap-3">
          <span className="text-[10px] font-bold text-[#22C55E] uppercase tracking-widest">Control Panel</span>

          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFilePicked(e.target.files[0])}
            />
            <Button variant="primary" onClick={() => fileInputRef.current?.click()} disabled={fileLoading}>
              {fileLoading ? "Loading..." : "📂 LOAD DATA"}
            </Button>
            <span className="text-[11px] text-[var(--text-secondary)]">
              {rows.length ? `${fileName} | ${rows.length.toLocaleString()} rows | ${columns.length} columns` : "No file loaded"}
            </span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Field label="Parameter">
              <Select value={parameter} onChange={handleParameterChange} options={numericColumns} placeholder={numericColumns.length ? "Select..." : "No numeric columns"} />
            </Field>
            <Field label="Line">
              <Select value={lineFilter} onChange={setLineFilter} options={lineOptions} />
            </Field>
            <Field label="Station">
              <Select value={stationFilter} onChange={setStationFilter} options={stationOptions} />
            </Field>
            <Field label="Result">
              <Select value={resultFilter} onChange={setResultFilter} options={["ALL", "Pass", "Fail"]} />
            </Field>
          </div>

          <div className="flex items-end gap-2 flex-wrap">
            <Field label="LSL"><TextInput type="number" value={lsl} onChange={(v) => setLsl(v === "" ? "" : Number(v))} /></Field>
            <Field label="USL"><TextInput type="number" value={usl} onChange={(v) => setUsl(v === "" ? "" : Number(v))} /></Field>
            <Button variant="primary" onClick={calculate} disabled={loading}>{loading ? "Calculating..." : "🧮 CALCULATE CPK"}</Button>
            <Button onClick={resetFilters}>🔄 RESET</Button>

            <Field label="Decimals">
              <Select value={String(decimalPlaces)} onChange={(v) => setDecimalPlaces(Number(v))} options={["0", "1", "2", "3", "4", "5", "6"]} />
            </Field>

            <Button onClick={() => setDialog("axis")}>📏 AXIS</Button>
            <Button onClick={autoCalibrate} disabled={!lastValues || loading}>🔧 AUTO CALIB</Button>
            <Button onClick={() => setDialog("manualcalib")} disabled={!lastValues}>🔧 MANUAL CALIB</Button>
            {calibration && <Button onClick={resetCalibration}>↩ RESET CALIB</Button>}
            <Button onClick={() => setDialog("assessment")} disabled={!result}>📋 ASSESS</Button>

            <span className="text-[10px] text-[var(--text-muted)] ml-auto">{info}</span>
          </div>

          {calibration && (
            <div className="text-[10px] text-[#1abc9c] font-semibold">
              🔧 Calibrated: k={calibration.k.toFixed(4)}, b={calibration.b.toFixed(4)} — Cpk {fmtNum(calibration.original?.cpk ?? stats?.cpk, decimalPlaces)} → {fmtNum(calibration.calibrated.cpk, decimalPlaces)} ({calibration.improvement_pct >= 0 ? "+" : ""}{calibration.improvement_pct.toFixed(1)}%)
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-3 py-2 text-[10px] text-[#EF4444]">✗ {error}</div>
          )}
        </div>

        {/* ── RESULT PANEL ──────────────────────────────────── */}
        {stats && (
          <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface-2)] p-4 flex flex-col gap-3">
            <span className="text-[10px] font-bold text-[#22C55E] uppercase tracking-widest">CPK Result</span>
            <div className="flex flex-wrap gap-2">
              <StatBox label="Sample Size" value={stats.sample_size.toLocaleString()} />
              <StatBox label="Mean" value={fmtNum(stats.mean, decimalPlaces)} />
              <StatBox label="Std Dev" value={fmtNum(stats.std, decimalPlaces)} />
              <StatBox label="Minimum" value={fmtNum(stats.minimum, decimalPlaces)} />
              <StatBox label="Maximum" value={fmtNum(stats.maximum, decimalPlaces)} />
              <StatBox label="Range" value={fmtNum(stats.range, decimalPlaces)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <StatBox label="Cp" value={fmtNum(stats.cp, decimalPlaces)} big />
              <StatBox label="Cpu" value={fmtNum(stats.cpu, decimalPlaces)} big />
              <StatBox label="Cpl" value={fmtNum(stats.cpl, decimalPlaces)} big />
              <StatBox label="Cpk" value={fmtNum(stats.cpk, decimalPlaces)} big />
              <StatBox label="Z-Score" value={fmtNum(stats.z_score, decimalPlaces)} big />
              <StatBox label="PPM" value={fmtNum(stats.ppm, decimalPlaces)} big />
            </div>
            <div className="flex flex-wrap gap-2">
              <StatBox label="Below LSL" value={stats.below_lsl} />
              <StatBox label="Above USL" value={stats.above_usl} />
              <StatBox label="Out of Spec" value={stats.out_of_spec} />
              <StatBox label="Capability" value={stats.capability} />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <span className="text-[var(--text-primary)] font-bold text-xs uppercase">Process Capability:</span>
              <span className="font-bold text-base" style={{ color: statusColor }}>
                {assessment.status === "EXCELLENT" || assessment.status === "CAPABLE" ? "✓" : assessment.status === "MARGINAL" ? "⚠" : "✗"} {assessment.status}
              </span>
            </div>
          </div>
        )}

        {/* ── DATA VISUALIZATION ────────────────────────────── */}
        {stats && (
          <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface-2)] p-4 flex flex-col gap-3">
            <span className="text-[10px] font-bold text-[#22C55E] uppercase tracking-widest">Data Visualization</span>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
              <DistributionChart title="Distribution" hist={result.histogram} lsl={Number(lsl)} usl={Number(usl)} mean={stats.mean} accent="#3B82F6" decimals={decimalPlaces} xDomain={xDomain} />
              <BoxPlotChart title="Box Plot" box={result.boxplot} lsl={Number(lsl)} usl={Number(usl)} mean={stats.mean} accent="#3B82F6" decimals={decimalPlaces} xDomain={xDomain} />
              {calibration ? (
                <DistributionChart title="Calibrated Distribution" hist={calibration.calibrated_histogram} lsl={Number(lsl)} usl={Number(usl)} mean={calibration.calibrated.mean} accent="#22C55E" decimals={decimalPlaces} xDomain={xDomain} />
              ) : (
                <div className="flex items-center justify-center rounded-lg" style={{ background: "#F8FAFC", minHeight: 220 }}>
                  <span className="text-[10px] text-[#64748B] text-center px-4">Klik "Auto Calibrate" atau "Manual Calibrate"<br />untuk lihat Calibrated Distribution</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── BOTTOM ACTIONS ────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap pb-2">
          <Button onClick={() => setDialog("data")} disabled={!rows.length}>📋 SHOW DATA</Button>
          <Button onClick={() => setDialog("summary")} disabled={!rows.length}>📊 SUMMARY</Button>
          <Button onClick={() => setDialog("failure")} disabled={!rows.length}>❌ FAILURE ANALYSIS</Button>
          <Button onClick={() => setDialog("standards")}>📐 CPK STANDARDS</Button>
          <Button onClick={() => setDialog("about")}>ℹ ABOUT</Button>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="accent" onClick={exportResult} disabled={!result}>💾 EXPORT RESULT</Button>
            <Button variant="accent" onClick={exportAllData} disabled={!rows.length}>📤 EXPORT ALL DATA</Button>
          </div>
        </div>
      </div>

      {/* ── DIALOGS ─────────────────────────────────────────── */}
      <AnimatePresence>
        {dialog === "data" && (
          <Dialog title="Data Viewer" icon="📋" onClose={() => setDialog(null)} width={1000}>
            <div className="overflow-auto max-h-[60vh]" style={{ scrollbarWidth: "thin" }}>
              <table className="text-[10px] border-collapse w-full">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c} className="text-left px-2 py-1.5 border-b border-[var(--border-soft)] text-[var(--text-muted)] font-bold sticky top-0 bg-[var(--bg-surface-2)] whitespace-nowrap">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 500).map((r, i) => (
                    <tr key={i} className="hover:bg-[var(--bg-elevated)]">
                      {columns.map((c) => (
                        <td key={c} className="px-2 py-1 border-b border-[var(--border-soft)]/50 text-[var(--text-secondary)] whitespace-nowrap">{String(r[c] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-[var(--text-muted)] pt-2">Showing {Math.min(500, rows.length).toLocaleString()} of {rows.length.toLocaleString()} records.</p>
          </Dialog>
        )}

        {dialog === "summary" && (() => {
          const s = buildSummary();
          return (
            <Dialog title="Summary Statistics" icon="📊" onClose={() => setDialog(null)} width={560}>
              <div className="flex flex-col gap-3 text-[11px] text-[var(--text-secondary)]">
                <div>Total Records: <b className="text-[var(--text-primary)]">{s.total_rows.toLocaleString()}</b> | Total Columns: <b className="text-[var(--text-primary)]">{s.total_columns}</b></div>
                {"pass_count" in s && (
                  <div>
                    <div className="font-bold text-[var(--text-primary)] mb-1">📈 Result Analysis</div>
                    Pass: {s.pass_count.toLocaleString()} | Fail: {s.fail_count.toLocaleString()} | Pass Rate: {s.pass_rate.toFixed(2)}%
                  </div>
                )}
                {s.date_min && (
                  <div>
                    <div className="font-bold text-[var(--text-primary)] mb-1">📅 Date Range</div>
                    {new Date(s.date_min).toLocaleString()} → {new Date(s.date_max).toLocaleString()} ({s.date_range_days} days)
                  </div>
                )}
                {s.station_counts && (
                  <div>
                    <div className="font-bold text-[var(--text-primary)] mb-1">🏭 Stations ({Object.keys(s.station_counts).length})</div>
                    {Object.entries(s.station_counts).map(([k, v]) => <div key={k}>{k}: {v.toLocaleString()}</div>)}
                  </div>
                )}
                {s.line_counts && (
                  <div>
                    <div className="font-bold text-[var(--text-primary)] mb-1">🏢 Lines ({Object.keys(s.line_counts).length})</div>
                    {Object.entries(s.line_counts).map(([k, v]) => <div key={k}>Line {k}: {v.toLocaleString()}</div>)}
                  </div>
                )}
                <div>
                  <div className="font-bold text-[var(--text-primary)] mb-1">📐 Numeric Parameters ({s.numeric_columns.length})</div>
                  <div className="flex flex-wrap gap-1">
                    {s.numeric_columns.map((c) => <span key={c} className="px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-soft)]">{c}</span>)}
                  </div>
                </div>
              </div>
            </Dialog>
          );
        })()}

        {dialog === "failure" && (() => {
          const f = buildFailureAnalysis();
          return (
            <Dialog title="Failure Analysis" icon="❌" onClose={() => setDialog(null)} width={620}>
              {!f ? (
                <p className="text-[11px] text-[var(--text-muted)]">Dataset ini tidak punya kolom RESULT.</p>
              ) : f.empty ? (
                <p className="text-[11px] text-[#22C55E]">✓ Tidak ada kegagalan ditemukan!</p>
              ) : (
                <div className="flex flex-col gap-3 text-[11px] text-[var(--text-secondary)]">
                  <div>Total Failures: <b className="text-[var(--text-primary)]">{f.total.toLocaleString()}</b> | Failure Rate: <b className="text-[var(--text-primary)]">{f.rate.toFixed(2)}%</b></div>

                  {f.categorical.length > 0 && (
                    <div>
                      <div className="font-bold text-[var(--text-primary)] mb-1">🏷 Status Columns on Failures</div>
                      {f.categorical.map(({ col, counts }) => (
                        <div key={col} className="mb-1">
                          <span className="font-semibold">{col}:</span>{" "}
                          {Object.entries(counts).map(([v, c]) => `${v}: ${c} (${((c / f.total) * 100).toFixed(1)}%)`).join(", ")}
                        </div>
                      ))}
                    </div>
                  )}

                  {f.numeric.length > 0 && (
                    <div>
                      <div className="font-bold text-[var(--text-primary)] mb-1">📐 Parameter Analysis on Failures</div>
                      {f.numeric.map((p) => (
                        <div key={p.col} className="mb-1">
                          <span className="font-semibold">{p.col}:</span> Mean={fmtNum(p.mean, decimalPlaces)}, Std={fmtNum(p.std, decimalPlaces)}, Min={fmtNum(p.min, decimalPlaces)}, Max={fmtNum(p.max, decimalPlaces)}, N={p.n}
                        </div>
                      ))}
                    </div>
                  )}

                  {f.byHour && (
                    <div>
                      <div className="font-bold text-[var(--text-primary)] mb-1">⏰ Failure by Hour</div>
                      {Object.entries(f.byHour).sort((a, b) => Number(a[0]) - Number(b[0])).map(([h, c]) => (
                        <div key={h}>{String(h).padStart(2, "0")}:00 — {c} failures</div>
                      ))}
                    </div>
                  )}

                  {f.byStation && (
                    <div>
                      <div className="font-bold text-[var(--text-primary)] mb-1">🏭 Failure by Station</div>
                      {Object.entries(f.byStation).map(([s2, c]) => <div key={s2}>{s2}: {c}</div>)}
                    </div>
                  )}
                </div>
              )}
            </Dialog>
          );
        })()}

        {dialog === "assessment" && assessment && (
          <Dialog title="CPK Assessment Report" icon="📋" onClose={() => setDialog(null)} width={620}>
            <div className="flex flex-col gap-3 text-[11px] text-[var(--text-secondary)] font-mono">
              <div>Industry Standard: <b className="text-[var(--text-primary)]">{industry}</b></div>
              <div>Parameter: <b className="text-[var(--text-primary)]">{parameter || "N/A"}</b></div>
              <div>Sample Size: <b className="text-[var(--text-primary)]">{stats.sample_size.toLocaleString()}</b></div>
              <div className="h-px bg-[var(--border-soft)]" />
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                <div>Cpk: <b className="text-[var(--text-primary)]">{fmtNum(stats.cpk, decimalPlaces)}</b></div>
                <div>Cp: <b className="text-[var(--text-primary)]">{fmtNum(stats.cp, decimalPlaces)}</b></div>
                <div>Cpu: <b className="text-[var(--text-primary)]">{fmtNum(stats.cpu, decimalPlaces)}</b></div>
                <div>Cpl: <b className="text-[var(--text-primary)]">{fmtNum(stats.cpl, decimalPlaces)}</b></div>
                <div>Mean: <b className="text-[var(--text-primary)]">{fmtNum(stats.mean, decimalPlaces)}</b></div>
                <div>Std Dev: <b className="text-[var(--text-primary)]">{fmtNum(stats.std, decimalPlaces)}</b></div>
                <div>LSL: <b className="text-[var(--text-primary)]">{fmtNum(stats.lsl, decimalPlaces)}</b></div>
                <div>USL: <b className="text-[var(--text-primary)]">{fmtNum(stats.usl, decimalPlaces)}</b></div>
                <div>Out of Spec: <b className="text-[var(--text-primary)]">{stats.out_of_spec}</b></div>
                <div>PPM: <b className="text-[var(--text-primary)]">{fmtNum(stats.ppm, decimalPlaces)}</b></div>
              </div>
              <div className="h-px bg-[var(--border-soft)]" />
              <div className="font-bold text-base" style={{ color: statusColor }}>🎯 ASSESSMENT: {assessment.status}</div>
              <div className="h-px bg-[var(--border-soft)]" />
              <div>
                <div className="font-bold text-[var(--text-primary)] mb-1">📐 Standards Comparison</div>
                <div>Excellent: ≥ {assessment.standards.excellent.toFixed(2)}</div>
                <div>Capable: ≥ {assessment.standards.capable.toFixed(2)}</div>
                <div>Marginal: ≥ {assessment.standards.marginal.toFixed(2)}</div>
                <div>Minimum: ≥ {assessment.standards.minimum.toFixed(2)}</div>
                <div>Current: {fmtNum(stats.cpk, decimalPlaces)}</div>
              </div>
              {assessment.improvement_needed > 0 && (
                <div className="text-[#F59E0B]">⚠ Improvement needed: {fmtNum(assessment.improvement_needed, decimalPlaces)} to reach CAPABLE</div>
              )}
              <div className="h-px bg-[var(--border-soft)]" />
              <div>
                <div className="font-bold text-[var(--text-primary)] mb-1">💡 Recommendations</div>
                {assessment.recommendations.map((rec, i) => (
                  <div key={i} className="mb-2 border-l-2 pl-2" style={{ borderColor: statusColor }}>
                    <div className="font-semibold text-[var(--text-primary)]">⚠ {rec.issue}</div>
                    <div>{rec.detail}</div>
                    <div className="text-[#3B82F6]">💡 {rec.action}</div>
                  </div>
                ))}
              </div>
            </div>
          </Dialog>
        )}

        {dialog === "standards" && (
          <StandardsDialog
            standards={standards}
            onLoaded={setStandards}
            onClose={() => setDialog(null)}
          />
        )}

        {dialog === "axis" && (
          <Dialog title="Axis Range Settings" icon="📏" onClose={() => setDialog(null)} width={420}>
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)] cursor-pointer">
                <input type="checkbox" checked={axisAuto} onChange={(e) => setAxisAuto(e.target.checked)} className="accent-[#22C55E]" />
                Auto Range (based on data)
              </label>
              {!axisAuto && (
                <div className="flex items-center gap-3">
                  <Field label="Min"><TextInput type="number" value={axisMin} onChange={setAxisMin} /></Field>
                  <Field label="Max"><TextInput type="number" value={axisMax} onChange={setAxisMax} /></Field>
                </div>
              )}
              {lastValues && (
                <p className="text-[10px] text-[var(--text-muted)]">Data Range: {fmtNum(Math.min(...lastValues), decimalPlaces)} - {fmtNum(Math.max(...lastValues), decimalPlaces)}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="primary" onClick={() => setDialog(null)}>Apply</Button>
              </div>
            </div>
          </Dialog>
        )}

        {dialog === "manualcalib" && (
          <ManualCalibrateDialog
            currentMean={stats?.mean}
            targetMean={lsl !== "" && usl !== "" ? (Number(lsl) + Number(usl)) / 2 : null}
            onApply={manualCalibrateApply}
            onClose={() => setDialog(null)}
          />
        )}

        {dialog === "about" && (
          <Dialog title="About" icon="ℹ" onClose={() => setDialog(null)} width={480}>
            <div className="flex flex-col gap-2 text-[11px] text-[var(--text-secondary)]">
              <p className="font-bold text-[var(--text-primary)] text-sm">FUNCTION TESTER CPK ANALYZER v2.4</p>
              <p>Ported from the standalone cpk_analyzer2.py desktop tool into a full page inside WIK Interlock &amp; Traceability.</p>
              <p className="font-bold text-[var(--text-primary)] mt-2">Features</p>
              <ul className="list-disc list-inside">
                <li>Load Excel files, filter by Line / Station / Result</li>
                <li>CPK calculation with full statistics (Cp, Cpu, Cpl, Cpk, Z-Score, PPM)</li>
                <li>Data visualization: Distribution, Box Plot, Calibrated Distribution</li>
                <li>Auto &amp; Manual Calibration (y = k·x + b)</li>
                <li>CPK Assessment with industry-specific recommendations</li>
                <li>Summary statistics &amp; failure analysis</li>
                <li>Export result / raw data to Excel</li>
              </ul>
              <p className="text-[var(--text-muted)] mt-2">Calibration: y = k * x + b — Auto Calibrate finds optimal k &amp; b targeting Cpk 1.33; Manual Calibrate lets you set k &amp; b yourself.</p>
            </div>
          </Dialog>
        )}
      </AnimatePresence>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  STANDARDS DIALOG (fetches /api/cpk/standards once)
// ────────────────────────────────────────────────────────────────

function StandardsDialog({ standards, onLoaded, onClose }) {
  useState(() => {
    if (!standards) {
      fetch(`${API}/api/cpk/standards`).then((r) => r.json()).then((d) => { if (d.success) onLoaded(d.standards); }).catch(() => {});
    }
  });

  return (
    <Dialog title="CPK Standards Reference" icon="📐" onClose={onClose} width={560}>
      <div className="flex flex-col gap-3 text-[11px] text-[var(--text-secondary)]">
        <p>CPK is a measure of process capability. Higher CPK indicates better process performance.</p>
        <div>
          <div className="font-bold text-[var(--text-primary)] mb-1">🎯 CPK Interpretation</div>
          <div>CPK ≥ 2.00 : EXCELLENT — World class</div>
          <div>CPK ≥ 1.67 : CAPABLE — Good for critical processes</div>
          <div>CPK ≥ 1.33 : MARGINAL — Acceptable for most processes</div>
          <div>CPK ≥ 1.00 : POOR — Needs improvement</div>
          <div>CPK &lt; 1.00 : NOT CAPABLE — Urgent improvement needed</div>
        </div>
        {standards ? (
          <div>
            <div className="font-bold text-[var(--text-primary)] mb-1">🏭 Industry Standards</div>
            {Object.entries(standards).map(([name, t]) => (
              <div key={name} className="mb-1.5">
                <span className="font-semibold text-[var(--text-primary)]">{name}:</span>{" "}
                Excellent ≥ {t.excellent.toFixed(2)}, Capable ≥ {t.capable.toFixed(2)}, Marginal ≥ {t.marginal.toFixed(2)}, Minimum ≥ {t.minimum.toFixed(2)}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[var(--text-muted)]">Loading...</p>
        )}
      </div>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────
//  MANUAL CALIBRATE DIALOG
// ────────────────────────────────────────────────────────────────

function ManualCalibrateDialog({ currentMean, targetMean, onApply, onClose }) {
  const [k, setK] = useState(1);
  const [b, setB] = useState(0);

  return (
    <Dialog title="Manual Calibration Settings" icon="🔧" onClose={onClose} width={420}>
      <div className="flex flex-col gap-3">
        <p className="text-center text-[var(--text-secondary)] text-sm">y = k * x + b</p>
        <Field label="k"><TextInput type="number" value={k} onChange={(v) => setK(Number(v))} /></Field>
        <Field label="b"><TextInput type="number" value={b} onChange={(v) => setB(Number(v))} /></Field>
        {targetMean !== null && (
          <p className="text-[10px] text-[var(--text-muted)]">Target Mean: {targetMean.toFixed(3)} | Current Mean: {(currentMean ?? 0).toFixed(3)}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onApply(k, b)}>Apply</Button>
        </div>
      </div>
    </Dialog>
  );
}
