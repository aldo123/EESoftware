// src/widgets/linechart.jsx
//
// Everything about the "linechart" widget lives in this one file:
//   - LineChartDef            palette entry (label/icon/desc/defaultProps) for the Page Builder sidebar
//   - LineChartPreview        how it looks on the Page Builder canvas (design-time)
//   - LineChartPropertyPanel  the property panel shown when this widget is selected
//   - RuntimeLineChart        how it looks/behaves on the live Dynamic CP Page
//
import { LINECHART_ADDRESS_TYPES, LINECHART_SERIES_COLORS, PropInput, PropSection, createLineChartSeries, DEFAULT_VISUAL } from "./shared";

// ────────────────────────────────────────────────────────────────
//  PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

export const linechartDef = {
    type: "linechart",
    label: "Line Chart",
    icon: "📈",
    desc: "Realtime industrial process trend",
    defaultProps: {
      title: "PROCESS TREND",
      unit: "",

      // Trend history
      historySeconds: 60,
      sampleInterval: 500,

      // Trend trigger
      // When enabled: trigger = 1 starts recording, trigger = 0 stops recording.
      triggerEnabled: false,
      triggerDevice: "",
      triggerAddressType: "holding_register",
      triggerAddress: "",
      triggerStartValue: 1,
      triggerStopValue: 0,
      clearHistoryOnStart: true,

      // Y axis
      autoScale: true,
      yMin: 0,
      yMax: 100,
      decimals: 1,

      // Display
      showGrid: true,
      showLegend: true,
      showCurrentValue: true,
      showTimeAxis: true,

      // Appearance
      backgroundColor: "var(--panel-canvas)",
      borderColor: "var(--panel-mid)",
      gridColor: "var(--panel-mid)",
      textColor: "#FFFFFF",
      labelColor: "var(--panel-line)",
      lineWidth: 1.8,

      // Start with one realtime series. Additional series can be added from the property panel.
      series: [
        createLineChartSeries(0),
      ],

      width: 420,
      height: 220,
      visual: { ...DEFAULT_VISUAL },
    },
  };

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

export function LineChartPreview({ widget }) {
  const p = widget.props || {};

  const series = Array.isArray(p.series)
    ? p.series.filter(s => s && s.enabled !== false)
    : [];

  /*
   * Industrial trend-card preview.
   * NOTE:
   * - This only changes the Page Builder preview appearance.
   * - Data binding, trigger logic, history, series configuration and
   *   runtime behavior are intentionally untouched.
   */
  const W = 720;
  const H = 220;

  // Layout based on the reference HMI style:
  // left = Y axis, center = trend plot, right = realtime/value panel.
  const left = 48;
  const plotRight = 500;
  const separatorX = 520;
  const right = 18;
  const top = 52;
  const bottom = 28;
  const chartW = plotRight - left;
  const chartH = H - top - bottom;
  const previewPoints = 52;

  const chartId = `lineChart-${widget.id || "preview"}`;

  // Keep the preview data synthetic; this is only to make the builder
  // visually represent a realistic industrial trend.
  const previewSeries = series.map((s, seriesIndex) => {
    const points = Array.from({ length: previewPoints }, (_, i) => {
      let value;

      if (seriesIndex === 0) {
        // Low steady area -> small disturbance -> sharp process step.
        if (i < 14) {
          value = 28 + Math.sin(i * 0.45) * 0.8;
        } else if (i < 17) {
          value = 28 + (i - 14) * 1.4;
        } else if (i < 31) {
          value = 30 + Math.sin(i * 0.32) * 0.7;
        } else if (i < 35) {
          value = 30 + (i - 31) * 18;
        } else {
          value = 92 + Math.sin(i * 0.22) * 1.8 + (i - 35) * 0.05;
        }
      } else if (seriesIndex === 1) {
        // Secondary signal with a different industrial step profile.
        if (i < 7) {
          value = 4 + Math.sin(i * 0.8) * 2;
        } else if (i < 11) {
          value = 70 + Math.sin(i * 0.55) * 7;
        } else if (i < 23) {
          value = 0;
        } else if (i < 38) {
          value = 48 + Math.sin(i * 0.3) * 3;
        } else if (i < 43) {
          value = 18 + Math.sin(i * 0.5) * 4;
        } else if (i < 48) {
          value = 52 + Math.sin(i * 0.28) * 4;
        } else {
          value = 0;
        }
      } else {
        value =
          50 +
          Math.sin(i * 0.24 + seriesIndex) * (8 + seriesIndex * 2) +
          Math.sin(i * 0.07 + seriesIndex) * 4;
      }

      return value;
    });

    return { ...s, points };
  });

  const allValues = previewSeries.flatMap(s => s.points);
  let min = p.autoScale !== false
    ? Math.min(...allValues)
    : Number(p.yMin ?? 0);
  let max = p.autoScale !== false
    ? Math.max(...allValues)
    : Number(p.yMax ?? 100);

  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max) || max <= min) max = min + 1;

  if (p.autoScale !== false) {
    const range = max - min;
    const pad = Math.max(1, range * 0.10);
    min -= pad;
    max += pad;
  }

  const yFor = value =>
    top + chartH - ((value - min) / (max - min)) * chartH;

  const pointsFor = values =>
    values
      .map((value, index) => {
        const x =
          left +
          (index / Math.max(1, values.length - 1)) * chartW;
        return `${x},${yFor(value)}`;
      })
      .join(" ");

  const decimals = Math.max(0, Number(p.decimals ?? 1));
  const currentValues = previewSeries.map(
    s => s.points[s.points.length - 1]
  );

  const background = p.backgroundColor || "var(--panel-canvas)";
  const borderColor = p.borderColor || "var(--panel-mid)";
  const gridColor = p.gridColor || "var(--panel-mid)";
  const textColor = p.textColor || "#FFFFFF";
  const labelColor = p.labelColor || "var(--panel-line)";
  const unit = p.unit || "";

  const formatValue = value =>
    Number(value).toFixed(decimals);

  const gridRatios = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div
      className="w-full h-full overflow-hidden rounded-xl"
      style={{
        background: `
          radial-gradient(circle at 24% 40%, rgba(0,191,255,0.055), transparent 35%),
          linear-gradient(180deg, var(--panel-canvas) 0%, ${background} 100%)
        `,
        border: `1px solid ${borderColor}`,
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.025), 0 0 18px rgba(0,0,0,0.22)",
        boxSizing: "border-box",
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full"
        preserveAspectRatio="none"
      >
        <defs>
          <filter
            id={`${chartId}-glow`}
            x="-50%"
            y="-100%"
            width="200%"
            height="300%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <linearGradient
            id={`${chartId}-panel`}
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop offset="0%" stopColor="var(--panel-mid)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--panel-canvas)" stopOpacity="0.72" />
          </linearGradient>
        </defs>

        {/* ───────── HEADER ───────── */}
        <text
          x="48"
          y="22"
          fill={textColor}
          fontSize="11"
          fontWeight="700"
          letterSpacing="0.9"
        >
          {(p.title || "PROCESS TREND").toUpperCase()}
        </text>

        {/* Unit at the upper-left of the trend plot */}
        {unit && (
          <text
            x="10"
            y="28"
            fill={labelColor}
            fontSize="8"
            fontWeight="600"
          >
            {unit}
          </text>
        )}

        {/* Small industrial status badge */}
        <g transform="translate(585 9)">
          <rect
            x="0"
            y="0"
            width="106"
            height="22"
            rx="7"
            fill="var(--status-green-bg)"
            fillOpacity="0.88"
            stroke="var(--status-green-solid)"
            strokeWidth="0.6"
          />
          <path
            d="M10 12 L13 12 L15 7 L18 16 L21 10 L24 12 L29 12"
            fill="none"
            stroke="var(--accent-green-neon)"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text
            x="34"
            y="14"
            fill="var(--accent-green-neon-2)"
            fontSize="8"
            fontWeight="700"
            letterSpacing="0.5"
          >
            REALTIME
          </text>
          <text
            x="92"
            y="14"
            fill="var(--accent-green-neon)"
            fontSize="9"
            fontWeight="800"
          >
            +
          </text>
        </g>

        {/* ───────── TREND GRID ───────── */}
        {p.showGrid !== false &&
          gridRatios.map((ratio, index) => {
            const y = top + chartH - ratio * chartH;
            return (
              <line
                key={`h-${index}`}
                x1={left}
                y1={y}
                x2={plotRight}
                y2={y}
                stroke={gridColor}
                strokeWidth="0.65"
                strokeDasharray="2 5"
                opacity={index === 0 ? 0.9 : 0.72}
              />
            );
          })}

        {p.showGrid !== false &&
          gridRatios.map((ratio, index) => {
            const x = left + ratio * chartW;
            return (
              <line
                key={`v-${index}`}
                x1={x}
                y1={top}
                x2={x}
                y2={top + chartH}
                stroke={gridColor}
                strokeWidth="0.65"
                strokeDasharray="2 5"
                opacity="0.62"
              />
            );
          })}

        {/* ───────── Y AXIS LABELS ───────── */}
        {gridRatios.map((ratio, index) => {
          const value = max - ratio * (max - min);
          const y = top + ratio * chartH + 2.5;

          return (
            <text
              key={`ylabel-${index}`}
              x="38"
              y={y}
              textAnchor="end"
              fill={labelColor}
              fontSize="7"
              fontWeight={index === 0 || index === 4 ? "600" : "500"}
            >
              {formatValue(value)}
            </text>
          );
        })}

        {/* Axis baseline */}
        <line
          x1={left}
          y1={top + chartH}
          x2={plotRight}
          y2={top + chartH}
          stroke="var(--panel-line)"
          strokeWidth="0.8"
          opacity="0.85"
        />

        {/* ───────── LINE SERIES ───────── */}
        {previewSeries.map((s, index) => {
          const color =
            s.color || LINECHART_SERIES_COLORS[index % 4];

          return (
            <g key={s.id}>
              {p.glow !== false && (
                <polyline
                  points={pointsFor(s.points)}
                  fill="none"
                  stroke={color}
                  strokeWidth={Number(p.lineWidth ?? 1.8) + 2.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.16"
                  filter={`url(#${chartId}-glow)`}
                />
              )}

              <polyline
                points={pointsFor(s.points)}
                fill="none"
                stroke={color}
                strokeWidth={Number(p.lineWidth ?? 1.8)}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.98"
              />

              {/* Current-value marker */}
              {p.showCurrentValue !== false && (
                <circle
                  cx={plotRight}
                  cy={yFor(s.points[s.points.length - 1])}
                  r="2.2"
                  fill={color}
                  stroke="var(--panel-canvas)"
                  strokeWidth="1"
                />
              )}
            </g>
          );
        })}

        {/* ───────── TIME AXIS ───────── */}
        {p.showTimeAxis !== false && (
          <>
            <text
              x={left}
              y={H - 7}
              fill={labelColor}
              fontSize="7"
            >
              0s
            </text>
            <text
              x={left + chartW / 2}
              y={H - 7}
              textAnchor="middle"
              fill={labelColor}
              fontSize="7"
            >
              {Math.round((p.historySeconds || 60) / 2)}s
            </text>
            <text
              x={plotRight}
              y={H - 7}
              textAnchor="end"
              fill={labelColor}
              fontSize="7"
            >
              {p.historySeconds || 60}s
            </text>
          </>
        )}

        {/* ───────── RIGHT INFORMATION PANEL ───────── */}
        <rect
          x={separatorX}
          y="0"
          width={W - separatorX}
          height={H}
          fill={`url(#${chartId}-panel)`}
        />

        <line
          x1={separatorX}
          y1="36"
          x2={separatorX}
          y2={H - 15}
          stroke="var(--panel-line)"
          strokeWidth="0.8"
        />

        {p.showLegend !== false &&
          previewSeries.map((s, index) => {
            const color =
              s.color || LINECHART_SERIES_COLORS[index % 4];
            const y = 62 + index * 28;

            return (
              <g key={`legend-${s.id}`}>
                <line
                  x1={separatorX + 20}
                  y1={y - 3}
                  x2={separatorX + 36}
                  y2={y - 3}
                  stroke={color}
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <text
                  x={separatorX + 43}
                  y={y}
                  fill="var(--text-soft)"
                  fontSize="8"
                  fontWeight="600"
                  letterSpacing="0.35"
                >
                  {(s.label || `SERIES ${index + 1}`).toUpperCase()}
                </text>
              </g>
            );
          })}

        {p.showCurrentValue !== false &&
          previewSeries.map((s, index) => {
            const color =
              s.color || LINECHART_SERIES_COLORS[index % 4];
            const y = 92 + index * 57;

            return (
              <g key={`value-${s.id}`}>
                <text
                  x={separatorX + 20}
                  y={y - 19}
                  fill="var(--text-soft)"
                  fontSize="8"
                  fontWeight="500"
                  letterSpacing="0.4"
                >
                  {(s.label || `SERIES ${index + 1}`).toUpperCase()}
                </text>

                <text
                  x={separatorX + 20}
                  y={y + 5}
                  fill={color}
                  fontSize="20"
                  fontWeight="500"
                  letterSpacing="-0.4"
                >
                  {formatValue(currentValues[index])}
                </text>

                {unit && (
                  <text
                    x={separatorX + 92}
                    y={y + 4}
                    fill={color}
                    fontSize="8"
                    fontWeight="600"
                  >
                    {unit}
                  </text>
                )}

                {index < previewSeries.length - 1 && (
                  <line
                    x1={separatorX + 20}
                    y1={y + 23}
                    x2={W - 18}
                    y2={y + 23}
                    stroke="var(--panel-line)"
                    strokeWidth="0.7"
                  />
                )}
              </g>
            );
          })}

        {/* Empty-series state */}
        {previewSeries.length === 0 && (
          <text
            x={left + chartW / 2}
            y={top + chartH / 2}
            textAnchor="middle"
            fill={labelColor}
            fontSize="9"
            letterSpacing="0.7"
          >
            NO ACTIVE SERIES
          </text>
        )}
      </svg>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function LineChartPropertyPanel({ p, set, availableDevices = [] }) {
  return (
  <>
    <PropSection title="Chart">
      <PropInput
        label="Title"
        value={p.title || "PROCESS TREND"}
        onChange={v => set("title", v)}
      />
      <PropInput
        label="Unit"
        value={p.unit || ""}
        onChange={v => set("unit", v)}
      />
      <div className="grid grid-cols-2 gap-2">
        <PropInput
          label="Max Duration (sec)"
          type="number"
          min={5}
          max={3600}
          value={p.historySeconds ?? 60}
          onChange={v => set("historySeconds", Number(v))}
        />
        <PropInput
          label="Sample (ms)"
          type="number"
          min={100}
          max={5000}
          value={p.sampleInterval ?? 500}
          onChange={v => set("sampleInterval", Number(v))}
        />
      </div>
      <PropInput
        label="Decimals"
        type="number"
        min={0}
        max={4}
        value={p.decimals ?? 1}
        onChange={v => set("decimals", Number(v))}
      />
    </PropSection>

    <PropSection title="Y Axis">
      <PropInput
        label="Auto Scale"
        type="checkbox"
        value={p.autoScale !== false}
        onChange={v => set("autoScale", v)}
      />
      {p.autoScale === false && (
        <div className="grid grid-cols-2 gap-2">
          <PropInput
            label="Min"
            type="number"
            value={p.yMin ?? 0}
            onChange={v => set("yMin", Number(v))}
          />
          <PropInput
            label="Max"
            type="number"
            value={p.yMax ?? 100}
            onChange={v => set("yMax", Number(v))}
          />
        </div>
      )}
    </PropSection>

    <PropSection title="Trend Trigger">
      <div className="text-[8px] text-[var(--text-dim)] leading-relaxed">
        When enabled, the configured trigger address controls the trend: value 1 starts recording and value 0 stops recording.
      </div>

      <PropInput
        label="Enable Trigger"
        type="checkbox"
        value={p.triggerEnabled === true}
        onChange={v => set("triggerEnabled", v)}
      />

      <div>
        <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
          Trigger Device
        </label>
        <select
          value={p.triggerDevice || ""}
          onChange={e => set("triggerDevice", e.target.value)}
          className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none focus:border-[var(--accent-green)]"
        >
          <option value="">Select device...</option>
          {availableDevices
            .filter(dev => String(dev.type || "").toUpperCase() === "TCP")
            .map(dev => (
              <option key={`${dev.type || "TCP"}-${dev.name}`} value={dev.name}>
                {dev.name}{dev.connection ? ` — ${dev.connection}` : ""}
              </option>
            ))}
        </select>
      </div>

      <PropInput
        label="Trigger Address Type"
        options={LINECHART_ADDRESS_TYPES}
        value={p.triggerAddressType || "holding_register"}
        onChange={v => set("triggerAddressType", v)}
      />

      <PropInput
        label="Trigger Address"
        value={p.triggerAddress ?? ""}
        onChange={v => set("triggerAddress", v)}
        placeholder="0 / 10 / 100"
      />

      <div className="grid grid-cols-2 gap-2">
        <PropInput
          label="Start Value"
          type="number"
          value={p.triggerStartValue ?? 1}
          onChange={v => set("triggerStartValue", Number(v))}
        />
        <PropInput
          label="Stop Value"
          type="number"
          value={p.triggerStopValue ?? 0}
          onChange={v => set("triggerStopValue", Number(v))}
        />
      </div>

      <PropInput
        label="Clear History On Start"
        type="checkbox"
        value={p.clearHistoryOnStart !== false}
        onChange={v => set("clearHistoryOnStart", v)}
      />
    </PropSection>

    <PropSection title="Realtime Series">
      <div className="text-[8px] text-[var(--text-dim)]">
        One realtime signal is shown by default. Add more PLC series only when needed.
      </div>

      {(Array.isArray(p.series) ? p.series : []).map((series, index) => {
        const updateSeries = (key, value) => {
          const next = [...(Array.isArray(p.series) ? p.series : [])];
          next[index] = { ...next[index], [key]: value };
          set("series", next);
        };

        return (
          <div
            key={series.id || `series-${index}`}
            className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-canvas)] p-2.5 flex flex-col gap-2"
          >
            <div className="flex items-center justify-between gap-2 pb-1 border-b border-[var(--border-soft)]">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: series.color || LINECHART_SERIES_COLORS[index % 4], boxShadow: `0 0 7px ${series.color || LINECHART_SERIES_COLORS[index % 4]}` }}
                />
                <div className="min-w-0">
                  <div className="text-[9px] text-[var(--text-primary)] font-bold truncate">SERIES {index + 1}</div>
                  <div className="text-[7px] text-[var(--text-dim)] uppercase tracking-wider">Realtime PLC signal</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <label className="flex items-center gap-1.5 cursor-pointer text-[8px] text-[var(--text-soft)]">
                  <input
                    type="checkbox"
                    checked={series.enabled !== false}
                    onChange={e => updateSeries("enabled", e.target.checked)}
                    className="accent-[var(--accent-green)]"
                  />
                  ON
                </label>
                {(Array.isArray(p.series) ? p.series : []).length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = [...(Array.isArray(p.series) ? p.series : [])];
                      next.splice(index, 1);
                      set("series", next);
                    }}
                    className="w-6 h-6 rounded border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent-red)] hover:border-[var(--accent-red)]/60 hover:bg-[var(--status-red-bg)] text-[11px] transition-colors"
                    title="Remove series"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            <PropInput
              label="Label"
              value={series.label || `SERIES ${index + 1}`}
              onChange={v => updateSeries("label", v)}
            />

            <div>
              <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
                Device
              </label>
              <select
                value={series.device || ""}
                onChange={e => updateSeries("device", e.target.value)}
                className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none focus:border-[var(--accent-green)]"
              >
                <option value="">Select device...</option>
                {availableDevices
                  .filter(dev => String(dev.type || "").toUpperCase() === "TCP")
                  .map(dev => (
                    <option key={`${dev.type || "TCP"}-${dev.name}`} value={dev.name}>
                      {dev.name}{dev.connection ? ` — ${dev.connection}` : ""}
                    </option>
                  ))}
              </select>
            </div>

            <PropInput
              label="Address Type"
              options={LINECHART_ADDRESS_TYPES}
              value={series.addressType || "holding_register"}
              onChange={v => updateSeries("addressType", v)}
            />

            <PropInput
              label="Address"
              value={series.address ?? ""}
              onChange={v => updateSeries("address", v)}
              placeholder="0 / 10 / 100"
            />

            <PropInput
              label="Line Color"
              type="color"
              value={series.color || LINECHART_SERIES_COLORS[index % 4]}
              onChange={v => updateSeries("color", v)}
            />
          </div>
        );
      })}

      {(Array.isArray(p.series) ? p.series : []).length < 4 && (
        <button
          type="button"
          onClick={() => {
            const current = Array.isArray(p.series) ? p.series : [];
            set("series", [...current, createLineChartSeries(current.length)]);
          }}
          className="h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] text-[var(--accent-green)] text-[9px] font-bold hover:bg-[var(--border-soft)] transition-colors"
        >
          + ADD SERIES
        </button>
      )}
    </PropSection>

    <PropSection title="Display">
      <PropInput
        label="Show Grid"
        type="checkbox"
        value={p.showGrid !== false}
        onChange={v => set("showGrid", v)}
      />
      <PropInput
        label="Show Legend"
        type="checkbox"
        value={p.showLegend !== false}
        onChange={v => set("showLegend", v)}
      />
      <PropInput
        label="Show Current Value"
        type="checkbox"
        value={p.showCurrentValue !== false}
        onChange={v => set("showCurrentValue", v)}
      />
      <PropInput
        label="Show Time Axis"
        type="checkbox"
        value={p.showTimeAxis !== false}
        onChange={v => set("showTimeAxis", v)}
      />
    </PropSection>

    <PropSection title="Appearance">
      <div className="flex flex-col gap-2">

        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-canvas)] p-2">
          <PropInput
            label="Background"
            type="color"
            value={p.backgroundColor || "var(--panel-canvas)"}
            onChange={v => set("backgroundColor", v)}
          />
        </div>

        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-canvas)] p-2">
          <PropInput
            label="Border"
            type="color"
            value={p.borderColor || "var(--panel-mid)"}
            onChange={v => set("borderColor", v)}
          />
        </div>

        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-canvas)] p-2">
          <PropInput
            label="Grid"
            type="color"
            value={p.gridColor || "var(--panel-mid)"}
            onChange={v => set("gridColor", v)}
          />
        </div>

        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-canvas)] p-2">
          <PropInput
            label="Axis Text"
            type="color"
            value={p.labelColor || "var(--panel-line)"}
            onChange={v => set("labelColor", v)}
          />
        </div>

        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-canvas)] p-2">
          <PropInput
            label="Chart Text"
            type="color"
            value={p.textColor || "#FFFFFF"}
            onChange={v => set("textColor", v)}
          />
        </div>

        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-canvas)] p-2">
          <PropInput
            label="Line Width"
            type="number"
            min={1}
            max={5}
            step={0.1}
            value={p.lineWidth ?? 1.8}
            onChange={v => set("lineWidth", Number(v))}
          />
        </div>

      </div>
    </PropSection>
  </>
  );
}

// ────────────────────────────────────────────────────────────────
//  DYNAMIC CP PAGE — RUNTIME
// ────────────────────────────────────────────────────────────────

export function RuntimeLineChart({ widget, history = [], running = true }) {
  const p = widget.props || {};

  // Page Builder starts with ONE realtime series.
  // Additional series created with "Add Series" remain fully supported.
  const series = Array.isArray(p.series)
    ? p.series.filter(s => s && s.enabled !== false)
    : [];

  // Industrial HMI trend-card proportions.
  // The chart occupies the left side and the live-value panel occupies the right.
  const W = 760;
  const H = 220;
  const left = 52;
  const rightPanel = 176;
  const chartRight = W - rightPanel;
  const top = 48;
  const bottom = 30;
  const chartW = chartRight - left;
  const chartH = H - top - bottom;
  const decimals = Math.max(0, Number(p.decimals ?? 1));

  const colors = ["var(--accent-cyan)", "var(--accent-red)", "var(--accent-green)", "var(--accent-orange)"];

  const getColor = (s, index) =>
    s?.color || colors[index % colors.length];

  const values = [];
  series.forEach(s => {
    history.forEach(point => {
      const value = Number(point?.[s.id]);
      if (Number.isFinite(value)) values.push(value);
    });
  });

  let min = Number(p.yMin ?? 0);
  let max = Number(p.yMax ?? 100);

  if (p.autoScale !== false && values.length) {
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const span = Math.max(1, dataMax - dataMin);
    const padding = span * 0.10;
    min = dataMin - padding;
    max = dataMax + padding;
  }

  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max) || max <= min) max = min + 1;

  const yFor = value => {
    const ratio = (value - min) / (max - min);
    return top + chartH - ratio * chartH;
  };

  // X-axis is elapsed seconds from trend START: 0s -> max duration.
  const maxDuration = Math.max(1, Number(p.historySeconds ?? 60));

  const xForElapsed = elapsed => {
    const seconds = Number(elapsed);
    if (!Number.isFinite(seconds)) return left;

    const ratio = Math.max(
      0,
      Math.min(1, seconds / maxDuration)
    );

    return left + ratio * chartW;
  };

  const getSeriesPoints = s => {
    const points = [];

    history.forEach(point => {
      const elapsed = Number(point?.elapsed);
      const value = Number(point?.[s.id]);

      if (!Number.isFinite(elapsed) || !Number.isFinite(value)) {
        return;
      }

      points.push(
        `${xForElapsed(elapsed)},${yFor(value)}`
      );
    });

    return points.join(" ");
  };

  const getLatestValue = s => {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const value = Number(history[i]?.[s.id]);

      if (Number.isFinite(value)) {
        return value;
      }
    }

    return null;
  };

  const hasHistory =
    history.length > 0 && values.length > 0;

  const chartId = `linechart-${widget.id}`;
  const bg = p.backgroundColor || "var(--panel-canvas)";
  const border = p.borderColor || "var(--panel-mid)";
  const textColor = p.textColor || "#FFFFFF";
  const labelColor = p.labelColor || "var(--panel-line)";
  const gridColor = p.gridColor || "var(--panel-mid)";
  const accent = p.accentColor || "var(--accent-cyan)";

  const title = p.title || "PROCESS TREND";
  const unit = p.unit || "";

  // Keep the badge compact so it stays visually similar to the reference HMI.
  const badgeX = chartRight + 18;
  const badgeW = Math.min(112, rightPanel - 34);
  const badgeY = 14;

  return (
    <div
      className="absolute overflow-hidden"
      style={{
        left: widget.x,
        top: widget.y,
        width: p.width,
        height: p.height,
        background: bg,
        border: `${Math.max(
          0,
          Number(p.borderWidth ?? 1)
        )}px solid ${border}`,
        borderRadius: `${Math.max(
          0,
          Number(p.borderRadius ?? 8)
        )}px`,
        boxSizing: "border-box",
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full"
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        <defs>
          {/* Soft glow for realtime trend lines */}
          <filter
            id={`${chartId}-glow`}
            x="-30%"
            y="-100%"
            width="160%"
            height="300%"
          >
            <feGaussianBlur
              stdDeviation="1.5"
              result="blur"
            />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <clipPath id={`${chartId}-clip`}>
            <rect
              x={left}
              y={top}
              width={chartW}
              height={chartH}
            />
          </clipPath>
        </defs>

        {/* ========================================================
            HEADER
            ======================================================== */}
        {p.showTitle !== false && (
          <text
            x="14"
            y="22"
            fill={textColor}
            fontSize="11"
            fontWeight="700"
            letterSpacing="0.35"
          >
            {title}
          </text>
        )}

        {/* Unit label at the left of the chart */}
        {unit && (
          <text
            x="12"
            y={top - 8}
            fill={labelColor}
            fontSize="8"
            fontWeight="600"
          >
            {unit}
          </text>
        )}

        {/* ========================================================
            REALTIME STATUS BADGE
            ======================================================== */}
        <g>
          <rect
            x={badgeX}
            y={badgeY}
            width={badgeW}
            height="24"
            rx="6"
            fill={running ? "var(--status-green-bg)" : "var(--panel-line)"}
            stroke={
              running
                ? "var(--status-green-solid)"
                : "var(--panel-line)"
            }
            strokeWidth="0.7"
          />

          {/* waveform / heartbeat icon */}
          <path
            d={`M ${badgeX + 8} ${badgeY + 12}
                L ${badgeX + 12} ${badgeY + 12}
                L ${badgeX + 15} ${badgeY + 7}
                L ${badgeX + 18} ${badgeY + 17}
                L ${badgeX + 21} ${badgeY + 11}
                L ${badgeX + 26} ${badgeY + 11}`}
            fill="none"
            stroke={running ? "var(--accent-green-neon)" : "var(--text-dim)"}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <text
            x={badgeX + 33}
            y={badgeY + 15}
            fill={running ? "var(--accent-green-neon)" : "var(--text-secondary)"}
            fontSize="8"
            fontWeight="700"
            letterSpacing="0.35"
          >
            {running ? "REALTIME" : "STOPPED"}
          </text>

          {running && (
            <text
              x={badgeX + badgeW - 9}
              y={badgeY + 15}
              textAnchor="middle"
              fill="var(--accent-green-neon)"
              fontSize="10"
              fontWeight="700"
            >
              +
            </text>
          )}
        </g>

        

        {/* ========================================================
            RIGHT LIVE VALUE PANEL
            ======================================================== */}
        <line
          x1={chartRight}
          y1="14"
          x2={chartRight}
          y2={H - 14}
          stroke="var(--panel-line)"
          strokeWidth="0.8"
        />

        {p.showLegend !== false &&
          series.map((s, index) => {
            const color = getColor(s, index);
            const latest = getLatestValue(s);

            const rowTop =
              52 + index * 56;

            return (
              <g key={`value-panel-${s.id}`}>
                {/* Series legend line */}
                <line
                  x1={chartRight + 18}
                  y1={rowTop - 1}
                  x2={chartRight + 34}
                  y2={rowTop - 1}
                  stroke={color}
                  strokeWidth="2"
                  strokeLinecap="round"
                />

                <text
                  x={chartRight + 42}
                  y={rowTop + 2}
                  fill="var(--text-soft)"
                  fontSize="8"
                  fontWeight="600"
                  letterSpacing="0.35"
                >
                  {(s.label ||
                    `SERIES ${index + 1}`)
                    .toUpperCase()}
                </text>

                {p.showCurrentValue !== false && (
                  <text
                    x={chartRight + 18}
                    y={rowTop + 29}
                    fill={color}
                    fontSize="20"
                    fontWeight="500"
                    letterSpacing="-0.3"
                  >
                    {latest === null
                      ? "--"
                      : latest.toFixed(decimals)}
                  </text>
                )}

                {unit &&
                  p.showCurrentValue !== false && (
                    <text
                      x={chartRight + 104}
                      y={rowTop + 29}
                      fill={color}
                      fontSize="9"
                      fontWeight="600"
                    >
                      {unit}
                    </text>
                  )}

                {index < series.length - 1 && (
                  <line
                    x1={chartRight + 18}
                    y1={rowTop + 42}
                    x2={W - 14}
                    y2={rowTop + 42}
                    stroke="var(--panel-line)"
                    strokeWidth="0.7"
                  />
                )}
              </g>
            );
          })}

        {/* ========================================================
            GRID
            ======================================================== */}
        {p.showGrid !== false &&
          [0, 0.25, 0.5, 0.75, 1].map(
            (ratio, index) => {
              const y =
                top +
                chartH -
                ratio * chartH;

              return (
                <line
                  key={`h-${index}`}
                  x1={left}
                  y1={y}
                  x2={chartRight}
                  y2={y}
                  stroke={gridColor}
                  strokeWidth="0.65"
                  strokeDasharray="2 5"
                  opacity="0.85"
                />
              );
            }
          )}

        {p.showGrid !== false &&
          [0, 0.25, 0.5, 0.75, 1].map(
            (ratio, index) => {
              const x =
                left + ratio * chartW;

              return (
                <line
                  key={`v-${index}`}
                  x1={x}
                  y1={top}
                  x2={x}
                  y2={top + chartH}
                  stroke={gridColor}
                  strokeWidth="0.65"
                  strokeDasharray="2 5"
                  opacity="0.65"
                />
              );
            }
          )}

        {/* ========================================================
            Y AXIS
            ======================================================== */}
        <text
          x="10"
          y={top + 4}
          fill={labelColor}
          fontSize="8"
        >
          {max.toFixed(
            decimals > 0 ? 1 : 0
          )}
        </text>

        <text
          x="10"
          y={top + chartH + 2}
          fill={labelColor}
          fontSize="8"
        >
          {min.toFixed(
            decimals > 0 ? 1 : 0
          )}
        </text>

        {/* ========================================================
            TREND LINES
            ======================================================== */}
        <g
          clipPath={`url(#${chartId}-clip)`}
        >
          {series.map((s, index) => {
            const color = getColor(
              s,
              index
            );

            return (
              <g key={`trend-${s.id}`}>
                {/* subtle glow layer */}
                {p.glow !== false && (
                  <polyline
                    points={getSeriesPoints(s)}
                    fill="none"
                    stroke={color}
                    strokeWidth={Math.max(
                      1,
                      Number(
                        p.lineWidth ?? 1.8
                      ) + 2.5
                    )}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.10"
                    filter={`url(#${chartId}-glow)`}
                  />
                )}

                {/* main line */}
                <polyline
                  points={getSeriesPoints(s)}
                  fill="none"
                  stroke={color}
                  strokeWidth={Math.max(
                    1,
                    Number(
                      p.lineWidth ?? 1.8
                    )
                  )}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.98"
                />
              </g>
            );
          })}
        </g>

        {/* ========================================================
            NO DATA STATE
            ======================================================== */}
        {!hasHistory && (
          <g>
            <text
              x={left + chartW / 2}
              y={top + chartH / 2}
              textAnchor="middle"
              fill="var(--panel-line)"
              fontSize="9"
              fontWeight="600"
              letterSpacing="0.8"
            >
              {p.triggerEnabled === true &&
              !running
                ? "TREND STOPPED — TRIGGER = 0"
                : "WAITING FOR PLC DATA..."}
            </text>
          </g>
        )}

        {/* ========================================================
            ELAPSED TIME AXIS
            ======================================================== */}
        {p.showTimeAxis !== false && (
          <>
            <line
              x1={left}
              y1={top + chartH}
              x2={chartRight}
              y2={top + chartH}
              stroke="var(--panel-line)"
              strokeWidth="0.8"
            />

            <text
              x={left}
              y={H - 8}
              fill={labelColor}
              fontSize="8"
            >
              0s
            </text>

            <text
              x={left + chartW / 2}
              y={H - 8}
              textAnchor="middle"
              fill={labelColor}
              fontSize="8"
            >
              {Math.round(
                maxDuration / 2
              )}s
            </text>

            <text
              x={chartRight}
              y={H - 8}
              textAnchor="end"
              fill={labelColor}
              fontSize="8"
            >
              {maxDuration}s
            </text>
          </>
        )}

        {/* Bottom-right status accent */}
        {p.triggerEnabled === true && (
          <circle
            cx={W - 10}
            cy={H - 10}
            r="3"
            fill={
              running
                ? "var(--accent-green-neon)"
                : "var(--text-muted)"
            }
            opacity="0.9"
          />
        )}
      </svg>
    </div>
  );
}
