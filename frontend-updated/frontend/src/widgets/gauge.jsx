// src/widgets/gauge.jsx
//
// Everything about the "gauge" widget lives in this one file:
//   - GaugeDef            palette entry (label/icon/desc/defaultProps) for the Page Builder sidebar
//   - GaugePreview        how it looks on the Page Builder canvas (design-time)
//   - GaugePropertyPanel  the property panel shown when this widget is selected
//   - RuntimeGauge        how it looks/behaves on the live Dynamic CP Page
//
import { useInternalVariables } from "../hooks/useInternalVariables";
import { GAUGE_ADDRESS_TYPES, GAUGE_TYPES, GaugeTypeIcon, PropInput, PropSection, DEFAULT_VISUAL } from "./shared";

// ────────────────────────────────────────────────────────────────
//  PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

export const gaugeDef = {
    type: "gauge",
    label: "Gauge",
    icon: "◔",
    desc: "Industrial analog value gauge",
    defaultProps: {
      // Data source:
      // "device"   = TCP/IP/device value supplied by DynamicCPPage
      // "internal" = shared Internal Variable value
      dataSource: "device",

      // Legacy TCP/IP binding fields - kept for compatibility.
      addressType: "holding_register",
      device: "",
      address: "",
      variable: "",

      // Shared Internal Variable binding.
      internalVariable: "",

      simulationValue: 50,

      // Gauge semantic type / icon
      gaugeType: "temp",
      title: "TEMPERATURE",
      unit: "°C",

      // Value range
      min: 0,
      max: 100,
      decimals: 1,

      // Visual behavior
      showValue: true,
      showScale: true,
      showMinMax: true,
      showIcon: true,
      showTitle: true,
      titleSize: 10,
      iconSize: 25,

      // Needle / arc
      startAngle: -135,
      endAngle: 135,
      trackColor: "var(--panel-mid)",
      progressColor: "var(--accent-cyan)",
      backgroundColor: "var(--panel-canvas)",
      textColor: "#FFFFFF",
      iconColor: "var(--accent-cyan)",
      unitColor: "var(--accent-cyan)",
      labelColor: "var(--panel-line)",
      glow: true,

      width: 220,
      height: 190,
      visual: { ...DEFAULT_VISUAL }
    }
  };

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

export function GaugePreview({ widget }) {
  const p = widget.props || {};

  const min = Number(p.min ?? 0);
  const maxRaw = Number(p.max ?? 100);
  const max = maxRaw === min ? min + 1 : maxRaw;

  const previewValue = Math.min(
    max,
    Math.max(min, Number(p.simulationValue ?? min))
  );

  const progress = (previewValue - min) / (max - min);
  const start = Number(p.startAngle ?? -135);
  const end = Number(p.endAngle ?? 135);
  const angle = start + progress * (end - start);

  const unit = p.unit || "";
  const decimals = Math.max(0, Number(p.decimals ?? 0));
  const title = p.title || "VALUE";
  const gaugeType = p.gaugeType || "temp";

  const accent = p.progressColor || "var(--accent-cyan)";
  const track = p.trackColor || "var(--panel-line)";
  const textColor = p.textColor || "#FFFFFF";
  const labelColor = p.labelColor || "var(--panel-line)";
  const needleColor = p.needleColor || "#FFFFFF";

  const gaugeId = `dialGauge-${widget.id || "preview"}`;
  const cx = 100;
  const cy = 108;

  // Main arc radius and inner decorative radius.
  const radius = 72;

  const polar = (a, r = radius) => {
    const rad = (a - 90) * Math.PI / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad)
    };
  };

  const arcPath = (a1, a2, r = radius) => {
    const s = polar(a1, r);
    const e = polar(a2, r);
    const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
    const sweep = a2 > a1 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} ${sweep} ${e.x} ${e.y}`;
  };

  const needlePoint = polar(angle, 56);

  return (
    <div className="w-full h-full flex items-center justify-center overflow-hidden">
      <svg
        viewBox="0 0 200 200"
        className="w-full h-full"
        style={{ overflow: "visible" }}
      >
        <defs>
          <filter
            id={gaugeId}
            x="-70%"
            y="-70%"
            width="240%"
            height="240%"
          >
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <linearGradient
            id={`${gaugeId}-arc`}
            x1="0%"
            y1="100%"
            x2="100%"
            y2="0%"
          >
            <stop offset="0%" stopColor={accent} stopOpacity="0.72" />
            <stop offset="100%" stopColor={accent} />
          </linearGradient>

          <radialGradient id={`${gaugeId}-face`} cx="50%" cy="45%" r="70%">
            <stop offset="0%" stopColor={p.backgroundColor || "var(--panel-mid)"} />
            <stop offset="72%" stopColor={p.backgroundColor || "var(--panel-canvas)"} />
            <stop offset="100%" stopColor={p.backgroundColor || "var(--panel-canvas)"} />
          </radialGradient>

          <filter
            id={`${gaugeId}-glow`}
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation="5" result="blur1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur2" />
            <feMerge>
              <feMergeNode in="blur1" />
              <feMergeNode in="blur2" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Dark instrument face */}
        <circle
          cx={cx}
          cy={cy}
          r="88"
          fill={`url(#${gaugeId}-face)`}
          stroke={p.borderColor || "var(--panel-mid)"}
          strokeWidth="1"
        />

        {/* Outer technical ring */}
        <path
          d={arcPath(start, end, 84)}
          fill="none"
          stroke="var(--panel-line)"
          strokeWidth="2"
          strokeDasharray="1 4"
        />

        {/* Main inactive arc */}
        <path
          d={arcPath(start, end, 72)}
          fill="none"
          stroke={track}
          strokeWidth="15"
          strokeLinecap="round"
        />

        {/* Soft halo behind active arc */}
        {p.glow !== false && (
          <path
            d={arcPath(start, angle, 72)}
            fill="none"
            stroke={accent}
            strokeWidth="22"
            strokeLinecap="round"
            opacity="0.28"
            filter={`url(#${gaugeId}-glow)`}
          />
        )}

        {/* Active colored arc */}
        <path
          d={arcPath(start, angle, 72)}
          fill="none"
          stroke={`url(#${gaugeId}-arc)`}
          strokeWidth="15"
          strokeLinecap="round"
          filter={p.glow !== false ? `url(#${gaugeId}-glow)` : undefined}
        />

        {/* Inner arc highlight */}
        <path
          d={arcPath(start, angle, 64)}
          fill="none"
          stroke={accent}
          strokeWidth="1.5"
          opacity="0.28"
        />

        {/* Dense industrial ticks */}
        {p.showScale !== false && Array.from({ length: 41 }, (_, i) => {
          const t = i / 40;
          const a = start + t * (end - start);

          const outer = polar(a, 86);
          const inner = polar(a, i % 5 === 0 ? 78 : 82);

          return (
            <line
              key={i}
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              stroke={t <= progress ? accent : labelColor}
              strokeWidth={i % 5 === 0 ? 1.7 : 0.8}
              opacity={t <= progress ? 0.95 : 0.42}
            />
          );
        })}

        {/* Major scale values */}
        {p.showScale !== false && [0, 0.25, 0.5, 0.75, 1].map((t, i) => {
          const a = start + t * (end - start);
          const pos = polar(a, 89);
          const val = min + t * (max - min);

          return (
            <text
              key={i}
              x={pos.x}
              y={pos.y + 2}
              textAnchor="middle"
              fill={t <= progress ? accent : labelColor}
              fontSize="6.5"
              fontWeight="600"
            >
              {Number(val).toFixed(decimals > 0 ? 0 : 0)}
            </text>
          );
        })}

        {/* Gauge header — icon LEFT of title, locked as one centered group */}
        {(p.showIcon !== false || p.showTitle !== false) && (
          <g transform={`translate(${cx} 88)`}>
            {(() => {
              const iconSize = Math.max(12, Number(p.iconSize ?? 18));
              const titleSize = Math.max(7, Number(p.titleSize ?? 8));
              const gap = Math.max(4, Number(p.iconGap ?? 7));

              // SVG text width is approximate, so use a conservative estimate
              // and center the COMPLETE icon + title group around x=0.
              const titleWidth = p.showTitle !== false
                ? Math.max(24, String(title).length * titleSize * 0.60)
                : 0;
              const iconWidth = p.showIcon !== false ? iconSize : 0;
              const totalWidth = iconWidth + (iconWidth && titleWidth ? gap : 0) + titleWidth;
              const left = -totalWidth / 2;

              return (
                <g>
                  {p.showIcon !== false && (
                    <g transform={`translate(${left} ${-iconSize / 2})`}>
                      <GaugeTypeIcon
                        type={gaugeType}
                        color={p.iconColor || accent}
                        size={iconSize}
                      />
                    </g>
                  )}

                  {p.showTitle !== false && (
                    <text
                      x={left + iconWidth + (iconWidth ? gap : 0) + titleWidth / 2}
                      y={0}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={textColor}
                      fontSize={titleSize}
                      fontWeight="700"
                      letterSpacing="0.7"
                    >
                      {title}
                    </text>
                  )}
                </g>
              );
            })()}
          </g>
        )}

        {/* Value */}
        {p.showValue !== false && (
          <text
            x={cx}
            y="132"
            textAnchor="middle"
            fill={textColor}
            fontSize="20"
            fontWeight="700"
            letterSpacing="-0.4"
          >
            {previewValue.toFixed(decimals)}
          </text>
        )}

        {/* Unit - same size as title */}
        <text
          x={cx}
          y="145"
          textAnchor="middle"
          fill={p.unitColor || accent}
          fontSize={Number(p.titleSize ?? 8)}
          fontWeight="600"
          letterSpacing="1.1"
        >
          {unit}
        </text>

        {/* Bottom technical labels */}
        {p.showMinMax !== false && (
          <>
            <text
              x="31"
              y="172"
              textAnchor="middle"
              fill={labelColor}
              fontSize="6.5"
            >
              MIN {min}
            </text>

            <text
              x="169"
              y="172"
              textAnchor="middle"
              fill={labelColor}
              fontSize="6.5"
            >
              MAX {max}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────
export function GaugePropertyPanel({ p, set, availableDevices = [] }) {
  const {
    variables: internalVariables,
    loading: internalVariablesLoading,
    error: internalVariablesError,
  } = useInternalVariables();

  return (
  <>


    <PropSection title="Data Source">
      <PropInput
        label="Source"
        options={[
          { label: "TCP/IP Device", value: "device" },
          { label: "Internal Variable", value: "internal" }
        ]}
        value={p.dataSource || "device"}
        onChange={(v) => set("dataSource", v)}
      />

      {(p.dataSource || "device") === "device" && (
        <>
          <PropInput
            label="Address Type"
            options={GAUGE_ADDRESS_TYPES}
            value={p.addressType || "holding_register"}
            onChange={(v) => set("addressType", v)}
          />

          <PropInput
            label="Address"
            value={p.address || ""}
            onChange={(v) => set("address", v)}
            placeholder="D100 / M100"
          />

          <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
            Gauge is READ only. Runtime value comes from the TCP/IP/device binding.
          </div>
        </>
      )}

      {(p.dataSource || "device") === "internal" && (
        <>
          <div>
            <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">
              Internal Variable
            </label>

            <select
              value={p.internalVariable || ""}
              onChange={(e) => set("internalVariable", e.target.value)}
              className="w-full h-8 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none focus:border-[var(--accent-green)]"
            >
              <option value="">
                {internalVariablesLoading
                  ? "Loading variables..."
                  : "Select variable..."}
              </option>

              {internalVariables.map((item) => (
                <option
                  key={item.id}
                  value={item.name}
                >
                  {item.name} ({item.data_type})
                </option>
              ))}
            </select>

            {internalVariablesError && (
              <div className="text-[8px] text-red-400 mt-1">
                {internalVariablesError}
              </div>
            )}
          </div>

          <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
            Gauge is READ only. Runtime value comes from the shared Internal Variable store.
          </div>
        </>
      )}
    </PropSection>

    <PropSection title="Gauge Type & Header">
      <div className="flex flex-col gap-1">
        <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
          Instrument
        </span>

        <div className="grid grid-cols-2 gap-1.5">
          {GAUGE_TYPES.map(item => {
            const active = (p.gaugeType || "temp") === item.value;

            return (
              <button
                key={item.value}
                type="button"
                onClick={() => set("gaugeType", item.value)}
                className="h-9 rounded-lg border flex items-center gap-2 px-2 text-left transition-all"
                style={{
                  background: active ? "rgba(0,191,255,0.10)" : "var(--bg-canvas)",
                  borderColor: active ? "var(--accent-cyan)" : "var(--border)",
                  color: active ? "#FFFFFF" : "var(--text-secondary)",
                  boxShadow: active ? "0 0 10px rgba(0,191,255,0.12)" : "none"
                }}
              >
                <span
                  className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                  style={{
                    background: active ? "rgba(0,191,255,0.12)" : "var(--panel-canvas)",
                    color: active ? "var(--accent-cyan)" : "var(--text-dim)"
                  }}
                >
                  <GaugeTypeIcon
                    type={item.value}
                    color={active ? "var(--accent-cyan)" : "var(--text-dim)"}
                    size={17}
                  />
                </span>

                <span className="text-[9px] font-bold truncate">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <PropInput
        label="Title"
        value={p.title || "VALUE"}
        onChange={v => set("title", v)}
      />

      <PropInput
        label="Unit"
        value={p.unit || ""}
        onChange={v => set("unit", v)}
      />
      <div className="text-[8px] text-[var(--text-dim)] -mt-1">
        Suggested: {GAUGE_TYPES.find(g => g.value === (p.gaugeType || "temp"))?.unit || ""}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropInput
          label="Icon Size"
          type="number"
          min={12}
          max={48}
          value={p.iconSize ?? 25}
          onChange={v => set("iconSize", Number(v))}
        />

        <PropInput
          label="Title Size"
          type="number"
          min={7}
          max={24}
          value={p.titleSize ?? 10}
          onChange={v => set("titleSize", Number(v))}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropInput
          label="Show Icon"
          type="checkbox"
          value={p.showIcon !== false}
          onChange={v => set("showIcon", v)}
        />

        <PropInput
          label="Show Title"
          type="checkbox"
          value={p.showTitle !== false}
          onChange={v => set("showTitle", v)}
        />
      </div>
    </PropSection>

    <PropSection title="Value Range">
      <div className="grid grid-cols-2 gap-2">
        <PropInput
          label="Min"
          type="number"
          value={p.min ?? 0}
          onChange={v => set("min", Number(v))}
        />

        <PropInput
          label="Max"
          type="number"
          value={p.max ?? 100}
          onChange={v => set("max", Number(v))}
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

    <PropSection title="Simulation State">
      <PropInput
        label="Value"
        type="number"
        value={p.simulationValue ?? p.min ?? 0}
        min={Number(p.min ?? 0)}
        max={Number(p.max ?? 100)}
        onChange={v => set("simulationValue", Number(v))}
      />

      <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
        Builder preview only. Runtime value will come from the bound variable.
      </div>
    </PropSection>

    <PropSection title="Display">
      <PropInput
        label="Show Value"
        type="checkbox"
        value={p.showValue !== false}
        onChange={v => set("showValue", v)}
      />

      <PropInput
        label="Show Scale"
        type="checkbox"
        value={p.showScale !== false}
        onChange={v => set("showScale", v)}
      />

      <PropInput
        label="Show Min / Max"
        type="checkbox"
        value={p.showMinMax !== false}
        onChange={v => set("showMinMax", v)}
      />

      <PropInput
        label="Glow"
        type="checkbox"
        value={p.glow !== false}
        onChange={v => set("glow", v)}
      />
    </PropSection>

    <PropSection title="Appearance">
      <PropInput
        label="Gauge Background"
        type="color"
        value={p.backgroundColor || "var(--panel-canvas)"}
        onChange={v => set("backgroundColor", v)}
      />

      <PropInput
        label="Gauge Border"
        type="color"
        value={p.borderColor || "var(--panel-mid)"}
        onChange={v => set("borderColor", v)}
      />

      <PropInput
        label="Progress Color"
        type="color"
        value={p.progressColor || "var(--accent-cyan)"}
        onChange={v => set("progressColor", v)}
      />

      <PropInput
        label="Track Color"
        type="color"
        value={p.trackColor || "var(--panel-mid)"}
        onChange={v => set("trackColor", v)}
      />

      <PropInput
        label="Text / Value Color"
        type="color"
        value={p.textColor || "#FFFFFF"}
        onChange={v => set("textColor", v)}
      />

      <PropInput
        label="Icon Color"
        type="color"
        value={p.iconColor || p.progressColor || "var(--accent-cyan)"}
        onChange={v => set("iconColor", v)}
      />

      <PropInput
        label="Unit Color"
        type="color"
        value={p.unitColor || p.progressColor || "var(--accent-cyan)"}
        onChange={v => set("unitColor", v)}
      />

      <PropInput
        label="Tick / Scale Color"
        type="color"
        value={p.labelColor || "var(--panel-line)"}
        onChange={v => set("labelColor", v)}
      />
    </PropSection>
  </>
  );
}

// ────────────────────────────────────────────────────────────────
//  DYNAMIC CP PAGE — RUNTIME
// ────────────────────────────────────────────────────────────────

export function RuntimeGauge({ widget, value }) {
  const p = widget.props || {};
    const min = Number(p.min ?? 0);
    const maxRaw = Number(p.max ?? 100);
    const max = maxRaw === min ? min + 1 : maxRaw;

    const rawValue = value === undefined || value === null || value === ""
      ? (p.simulationValue ?? min)
      : Number(value);

    const previewValue = Math.min(
      max,
      Math.max(min, Number.isFinite(Number(rawValue)) ? Number(rawValue) : min)
    );

    const progress = (previewValue - min) / (max - min);
    const start = Number(p.startAngle ?? -135);
    const end = Number(p.endAngle ?? 135);
    const angle = start + progress * (end - start);

    const unit = p.unit || "";
    const decimals = Math.max(0, Number(p.decimals ?? 0));
    const title = p.title || "VALUE";
    const gaugeType = p.gaugeType || "temp";

    const accent = p.progressColor || "var(--accent-cyan)";
    const track = p.trackColor || "var(--panel-line)";
    const textColor = p.textColor || "#FFFFFF";
    const labelColor = p.labelColor || "var(--panel-line)";

    const gaugeId = `gauge-${widget.id}`;
    const cx = 100;
    const cy = 108;

    // Main arc radius and inner decorative radius.
    const radius = 72;

    const polar = (a, r = radius) => {
      const rad = (a - 90) * Math.PI / 180;
      return {
        x: cx + r * Math.cos(rad),
        y: cy + r * Math.sin(rad)
      };
    };

    const arcPath = (a1, a2, r = radius) => {
      const s = polar(a1, r);
      const e = polar(a2, r);
      const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
      const sweep = a2 > a1 ? 1 : 0;
      return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} ${sweep} ${e.x} ${e.y}`;
    };

    return (
      <div
        className="absolute flex items-center justify-center overflow-hidden"
        style={{
          left: widget.x,
          top: widget.y,
          width: p.width,
          height: p.height
        }}
      >
        <svg
          viewBox="0 0 200 200"
          className="w-full h-full"
          style={{ overflow: "visible" }}
        >
          <defs>
            <filter
              id={gaugeId}
              x="-70%"
              y="-70%"
              width="240%"
              height="240%"
            >
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            <linearGradient
              id={`${gaugeId}-arc`}
              x1="0%"
              y1="100%"
              x2="100%"
              y2="0%"
            >
              <stop offset="0%" stopColor={accent} stopOpacity="0.72" />
              <stop offset="100%" stopColor={accent} />
            </linearGradient>

            <radialGradient id={`${gaugeId}-face`} cx="50%" cy="45%" r="70%">
              <stop offset="0%" stopColor={p.backgroundColor || "var(--panel-mid)"} />
              <stop offset="72%" stopColor={p.backgroundColor || "var(--panel-canvas)"} />
              <stop offset="100%" stopColor={p.backgroundColor || "var(--panel-canvas)"} />
            </radialGradient>

            <filter
              id={`${gaugeId}-glow`}
              x="-100%"
              y="-100%"
              width="300%"
              height="300%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur stdDeviation="5" result="blur1" />
              <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur2" />
              <feMerge>
                <feMergeNode in="blur1" />
                <feMergeNode in="blur2" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Dark instrument face */}
          <circle
            cx={cx}
            cy={cy}
            r="88"
            fill={`url(#${gaugeId}-face)`}
            stroke={p.borderColor || "var(--panel-mid)"}
            strokeWidth="1"
          />

          {/* Outer technical ring */}
          <path
            d={arcPath(start, end, 84)}
            fill="none"
            stroke="var(--panel-line)"
            strokeWidth="2"
            strokeDasharray="1 4"
          />

          {/* Main inactive arc */}
          <path
            d={arcPath(start, end, 72)}
            fill="none"
            stroke={track}
            strokeWidth="15"
            strokeLinecap="round"
          />

          {/* Soft halo behind active arc */}
          {p.glow !== false && (
            <path
              d={arcPath(start, angle, 72)}
              fill="none"
              stroke={accent}
              strokeWidth="22"
              strokeLinecap="round"
              opacity="0.28"
              filter={`url(#${gaugeId}-glow)`}
            />
          )}

          {/* Active colored arc */}
          <path
            d={arcPath(start, angle, 72)}
            fill="none"
            stroke={`url(#${gaugeId}-arc)`}
            strokeWidth="15"
            strokeLinecap="round"
            filter={p.glow !== false ? `url(#${gaugeId}-glow)` : undefined}
          />

          {/* Inner arc highlight */}
          <path
            d={arcPath(start, angle, 64)}
            fill="none"
            stroke={accent}
            strokeWidth="1.5"
            opacity="0.28"
          />

          {/* Dense industrial ticks */}
          {p.showScale !== false && Array.from({ length: 41 }, (_, i) => {
            const t = i / 40;
            const a = start + t * (end - start);

            const outer = polar(a, 86);
            const inner = polar(a, i % 5 === 0 ? 78 : 82);

            return (
              <line
                key={i}
                x1={outer.x}
                y1={outer.y}
                x2={inner.x}
                y2={inner.y}
                stroke={t <= progress ? accent : labelColor}
                strokeWidth={i % 5 === 0 ? 1.7 : 0.8}
                opacity={t <= progress ? 0.95 : 0.42}
              />
            );
          })}

          {/* Major scale values */}
          {p.showScale !== false && [0, 0.25, 0.5, 0.75, 1].map((t, i) => {
            const a = start + t * (end - start);
            const pos = polar(a, 89);
            const val = min + t * (max - min);

            return (
              <text
                key={i}
                x={pos.x}
                y={pos.y + 2}
                textAnchor="middle"
                fill={t <= progress ? accent : labelColor}
                fontSize="6.5"
                fontWeight="600"
              >
                {Number(val).toFixed(decimals > 0 ? 0 : 0)}
              </text>
            );
          })}

          {/* Gauge header — icon LEFT of title, locked as one centered group */}
          {(p.showIcon !== false || p.showTitle !== false) && (
            <g transform={`translate(${cx} 88)`}>
              {(() => {
                const iconSize = Math.max(12, Number(p.iconSize ?? 18));
                const titleSize = Math.max(7, Number(p.titleSize ?? 8));
                const gap = Math.max(4, Number(p.iconGap ?? 7));

                // SVG text width is approximate, so use a conservative estimate
                // and center the COMPLETE icon + title group around x=0.
                const titleWidth = p.showTitle !== false
                  ? Math.max(24, String(title).length * titleSize * 0.60)
                  : 0;
                const iconWidth = p.showIcon !== false ? iconSize : 0;
                const totalWidth = iconWidth + (iconWidth && titleWidth ? gap : 0) + titleWidth;
                const left = -totalWidth / 2;

                return (
                  <g>
                    {p.showIcon !== false && (
                      <g transform={`translate(${left} ${-iconSize / 2})`}>
                        <GaugeTypeIcon
                          type={gaugeType}
                          color={p.iconColor || accent}
                          size={iconSize}
                        />
                      </g>
                    )}

                    {p.showTitle !== false && (
                      <text
                        x={left + iconWidth + (iconWidth ? gap : 0) + titleWidth / 2}
                        y={0}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={textColor}
                        fontSize={titleSize}
                        fontWeight="700"
                        letterSpacing="0.7"
                      >
                        {title}
                      </text>
                    )}
                  </g>
                );
              })()}
            </g>
          )}

          {/* Value */}
          {p.showValue !== false && (
            <text
              x={cx}
              y="132"
              textAnchor="middle"
              fill={textColor}
              fontSize="20"
              fontWeight="700"
              letterSpacing="-0.4"
            >
              {previewValue.toFixed(decimals)}
            </text>
          )}

          {/* Unit - same size as title */}
          <text
            x={cx}
            y="145"
            textAnchor="middle"
            fill={p.unitColor || accent}
            fontSize={Number(p.titleSize ?? 8)}
            fontWeight="600"
            letterSpacing="1.1"
          >
            {unit}
          </text>

          {/* Bottom technical labels */}
          {p.showMinMax !== false && (
            <>
              <text
                x="31"
                y="172"
                textAnchor="middle"
                fill={labelColor}
                fontSize="6.5"
              >
                MIN {min}
              </text>

              <text
                x="169"
                y="172"
                textAnchor="middle"
                fill={labelColor}
                fontSize="6.5"
              >
                MAX {max}
              </text>
            </>
          )}
        </svg>
      </div>
    );
 }