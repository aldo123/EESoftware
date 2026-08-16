// src/pages/DynamicCPPage.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { API } from "../service/api";
import { useTCPPLC } from "../hooks/useTCPPLC";

// ──────────────────────────────────────────────────────────────────
//  HMI DESIGN SYSTEM - THEME & VISUAL PROPS
// ──────────────────────────────────────────────────────────────────

const THEME_PRESETS = {
  "wik_cyan": {
    accent: "var(--accent-cyan)", background: "var(--panel-canvas)", border: "var(--panel-mid)", text: "#FFFFFF", secondary: "var(--panel-line)", success: "var(--accent-green-neon)", warning: "var(--accent-orange)", danger: "var(--accent-red-bright)"
  },
  "industrial_blue": {
    accent: "var(--accent-blue)", background: "var(--panel-canvas)", border: "var(--bg-hover)", text: "var(--text-primary)", secondary: "var(--text-secondary)", success: "var(--accent-green)", warning: "var(--accent-orange-alt)", danger: "var(--accent-red)"
  },
  "emerald": {
    accent: "var(--accent-green)", background: "var(--status-green-bg)", border: "var(--status-green-solid)", text: "#FFFFFF", secondary: "var(--swatch-sage)", success: "var(--accent-green-neon)", warning: "var(--accent-orange)", danger: "var(--accent-red-bright)"
  },
  "amber": {
    accent: "var(--accent-orange)", background: "var(--status-orange-bg)", border: "var(--status-orange-bg)", text: "#FFFFFF", secondary: "var(--swatch-tan)", success: "var(--accent-green-neon)", warning: "var(--accent-orange)", danger: "var(--accent-red-bright)"
  },
  "red_alert": {
    accent: "var(--accent-red)", background: "var(--status-red-bg)", border: "var(--status-red-bg)", text: "var(--accent-red-soft)", secondary: "var(--swatch-rose)", success: "var(--accent-green)", warning: "var(--accent-orange)", danger: "var(--accent-red)"
  }
};

const DEFAULT_VISUAL = {
  theme: "wik_cyan",
  accentColor: "var(--accent-cyan)",
  backgroundColor: "var(--panel-canvas)",
  borderColor: "var(--panel-mid)",
  textColor: "#FFFFFF",
  secondaryTextColor: "var(--panel-line)",
  borderWidth: 1,
  borderRadius: 12,
  glow: true,
  glowIntensity: 18
};

const getVisual = (props) => {
  if (!props.visual) return { ...DEFAULT_VISUAL, ...(props.color ? { accentColor: props.color } : {}) };
  const themeColors = THEME_PRESETS[props.visual.theme] || THEME_PRESETS["wik_cyan"];
  return { ...DEFAULT_VISUAL, ...themeColors, ...props.visual };
};

// ──────────────────────────────────────────────────────────────────
//  END OF DESIGN SYSTEM
// ──────────────────────────────────────────────────────────────────

function GaugeTypeIcon({ type = "temp", color = "var(--accent-cyan)", size = 28 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };

  if (type === "power") return (
    <svg {...common}>
      <path d="M12 2v8" />
      <path d="M7.05 4.93a9 9 0 1 0 9.9 0" />
      <path d="M12 12l-2 4h3l-1 6 4-7h-3l2-3z" />
    </svg>
  );

  if (type === "water") return (
    <svg {...common}>
      <path d="M12 2.8S6.5 9.3 6.5 13.5a5.5 5.5 0 0 0 11 0C17.5 9.3 12 2.8 12 2.8z" />
      <path d="M9 14.5c.4 1.2 1.3 2 2.8 2.3" />
    </svg>
  );

  if (type === "pressure") return (
    <svg {...common}>
      <circle cx="12" cy="13" r="8" />
      <path d="M7.5 13a4.5 4.5 0 0 1 9 0" />
      <path d="M12 13l3.2-3.2" />
      <path d="M5 5l1.7 1.7M19 5l-1.7 1.7" />
    </svg>
  );

  if (type === "flow") return (
    <svg {...common}>
      <path d="M3 7h12" />
      <path d="m11 4 4 3-4 3" />
      <path d="M21 17H9" />
      <path d="m13 14-4 3 4 3" />
      <path d="M4 12h5" />
    </svg>
  );

  if (type === "level") return (
    <svg {...common}>
      <path d="M7 3v18M17 3v18" />
      <path d="M7 7h10M7 17h10" />
      <path d="M9.5 12c1.2-1.2 1.8-1.2 3 0s1.8 1.2 3 0" />
    </svg>
  );

  if (type === "speed") return (
    <svg {...common}>
      <path d="M4.5 16a8 8 0 1 1 15 0" />
      <path d="M12 12l4-4" />
      <path d="M6 18h12" />
    </svg>
  );

  if (type === "current") return (
    <svg {...common}>
      <path d="M7 3v7a5 5 0 0 0 10 0V3" />
      <path d="M9 21h6M12 15v6M9 3h6" />
    </svg>
  );

  return (
    <svg {...common}>
      <path d="M14 14.7V5a2 2 0 0 0-4 0v9.7a4.5 4.5 0 1 0 4 0z" />
      <path d="M12 11v6" />
    </svg>
  );
}

// ── RUNTIME WIDGETS ──────────────────────────────────────────────

function RuntimeButton({ widget, value, onChange }) {
  const p = widget.props || {};
  const v = getVisual(p);
  const variant = p.variant || "neon";
  const isOn = Number(value) === 1;

  const handleToggle = () => {
    onChange?.(isOn ? 0 : 1);
  };

  const onBg = p.onBackground || v.accentColor || "var(--accent-cyan)";
  const offBg = p.offBackground || v.backgroundColor || "var(--bg-canvas)";
  const onBorder = p.onBorder || v.accentColor || "var(--accent-cyan)";
  const offBorder = p.offBorder || v.borderColor || "var(--panel-mid)";
  const onText = p.onTextColor || v.textColor || "#FFFFFF";
  const offText = p.offTextColor || v.secondaryTextColor || "var(--panel-line)";
  const label = isOn ? (p.labelOn || "ON") : (p.labelOff || "OFF");
  const fontSize = p.fontSize || 18;

  let btnStyle = {
    background: isOn ? onBg : offBg,
    border: `${v.borderWidth || 1}px solid ${isOn ? onBorder : offBorder}`,
    boxShadow: isOn ? `0 0 ${v.glowIntensity || 18}px ${onBg}` : "none",
    textColor: isOn ? onText : offText,
    showLed: variant === "neon"
  };

  if (variant === "neon") {
    btnStyle.background = `linear-gradient(135deg, ${v.backgroundColor || "var(--panel-canvas)"}, ${isOn ? onBg : offBg})`;
  }

  return (
    <div className="absolute" style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}>
      <button
        onClick={handleToggle}
        className="w-full h-full rounded-xl flex flex-col items-center justify-center relative overflow-hidden transition-all duration-300 active:scale-[0.97]"
        style={{
          background: btnStyle.background,
          border: btnStyle.border,
          boxShadow: btnStyle.boxShadow,
          borderRadius: v.borderRadius ?? 12
        }}
      >
        {btnStyle.showLed && (
          <div
            className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full transition-all duration-300"
            style={{
              background: isOn ? onBg : offBg,
              boxShadow: isOn ? `0 0 8px ${onBg}` : "none"
            }}
          />
        )}
        <span
          className="font-bold uppercase tracking-widest"
          style={{
            color: btnStyle.textColor,
            fontSize,
            textShadow: isOn ? `0 0 12px ${onBg}` : "none"
          }}
        >
          {label}
        </span>
      </button>
    </div>
  );
}

function RuntimeLight({ widget, value }) {
  const p = widget.props || {};
  const v = getVisual(p);
  const isOn = Number(value) === 1;
  const onColor = p.onColor || v.accentColor || "var(--accent-cyan)";
  const offColor = p.offColor || "var(--border-soft)";
  const showLabel = p.showLabel !== false;

  return (
    <div className="absolute flex items-center justify-center" style={{
      left: widget.x, top: widget.y, width: p.width, height: p.height
    }}>
      <div
        className="transition-all duration-300"
        style={{
          width: 36,
          height: 36,
          borderRadius: p.shape === "square" ? 6 : "50%",
          background: isOn
            ? `radial-gradient(circle at 35% 35%, #FFFFFF, ${onColor} 42%, ${onColor})`
            : offColor,
          border: `1px solid ${isOn ? onColor : v.borderColor}`,
          boxShadow: isOn
            ? `0 0 24px ${onColor}, inset 0 -2px 4px rgba(0,0,0,0.4)`
            : "inset 0 2px 6px rgba(0,0,0,0.6)"
        }}
      />
      {showLabel && (
        <span className="ml-4 font-bold uppercase tracking-widest text-sm" style={{
          color: isOn ? onColor : v.secondaryTextColor,
          textShadow: isOn ? `0 0 12px ${onColor}` : "none"
        }}>
          {p.label || "STATUS"}
        </span>
      )}
    </div>
  );
}

function RuntimeShape({ widget }) {
  const p = widget.props || {};
  const type = p.shapeType || "rectangle";
  const fill = p.fill || "var(--panel-mid)";
  const borderColor = p.borderColor || "var(--accent-cyan)";
  const borderWidth = Number(p.borderWidth ?? 1);
  const radius = Number(p.radius ?? 8);
  const rotation = Number(p.rotation ?? 0);

  const wrapper = {
    left: widget.x,
    top: widget.y,
    width: p.width,
    height: p.height
  };

  if (type === "line") {
    return (
      <div className="absolute flex items-center" style={wrapper}>
        <div style={{
          width: "100%",
          height: Math.max(1, borderWidth),
          background: borderColor,
          transform: `rotate(${rotation}deg)`
        }} />
      </div>
    );
  }

  if (type === "triangle") {
    return (
      <div className="absolute flex items-center justify-center" style={wrapper}>
        <div style={{
          width: "100%",
          height: "100%",
          background: fill,
          clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)",
          transform: `rotate(${rotation}deg)`
        }} />
      </div>
    );
  }

  return (
    <div className="absolute" style={wrapper}>
      <div className="w-full h-full" style={{
        background: fill,
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius: type === "circle" || type === "ellipse" ? "50%" : `${radius}px`,
        transform: `rotate(${rotation}deg)`,
        boxSizing: "border-box"
      }} />
    </div>
  );
}


function RuntimeTextBox({ widget, value }) {
  const p = widget.props || {};
  const v = getVisual(p);

  const displayText =
    value === undefined || value === null
      ? (p.text ?? "TEXT")
      : String(value);

  const icon = p.icon || "";
  const iconPosition = p.iconPosition || "left";
  const iconSize = Number(p.iconSize ?? 20);
  const fontSize = Number(p.fontSize ?? 18);
  const fontWeight = p.fontWeight || "600";
  const textColor = p.textColor || v.textColor || "#FFFFFF";
  const iconColor = p.iconColor || textColor;
  const textAlign = p.textAlign || "center";
  const backgroundColor = p.backgroundColor || "transparent";
  const borderColor = p.borderColor || "transparent";
  const borderWidth = Math.max(0, Number(p.borderWidth ?? 0));
  const radius = Math.max(0, Number(p.radius ?? 6));
  const padding = Math.max(0, Number(p.padding ?? 8));
  const rotation = Number(p.rotation ?? 0);

  const textJustify =
    textAlign === "left" ? "flex-start" :
    textAlign === "right" ? "flex-end" : "center";

  return (
    <div
      className="absolute relative"
      style={{
        left: widget.x,
        top: widget.y,
        width: p.width,
        height: p.height,
        background: backgroundColor,
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius: `${radius}px`,
        transform: `rotate(${rotation}deg)`,
        boxSizing: "border-box",
        overflow: "hidden"
      }}
    >
      <div
        className="absolute inset-0 flex items-center pointer-events-none"
        style={{
          justifyContent: textJustify,
          padding: `${padding}px`,
          boxSizing: "border-box"
        }}
      >
        <span
          style={{
            color: textColor,
            fontSize: `${fontSize}px`,
            fontWeight,
            lineHeight: 1.2,
            textAlign,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          }}
        >
          {displayText}
        </span>
      </div>

      {icon && iconPosition === "left" && (
        <div
          className="absolute inset-y-0 left-0 flex items-center pointer-events-none"
          style={{ paddingLeft: `${padding}px` }}
        >
          <span style={{ color: iconColor, fontSize: `${iconSize}px`, lineHeight: 1 }}>
            {icon}
          </span>
        </div>
      )}

      {icon && iconPosition === "right" && (
        <div
          className="absolute inset-y-0 right-0 flex items-center pointer-events-none"
          style={{ paddingRight: `${padding}px` }}
        >
          <span style={{ color: iconColor, fontSize: `${iconSize}px`, lineHeight: 1 }}>
            {icon}
          </span>
        </div>
      )}

      {icon && iconPosition === "center" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span style={{ color: iconColor, fontSize: `${iconSize}px`, lineHeight: 1 }}>
            {icon}
          </span>
        </div>
      )}
    </div>
  );
}

function RuntimeGauge({ widget, value }) {
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

function RuntimeLineChart({ widget, history = [], running = true }) {
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

        {/* Optional trigger status, kept subtle */}
        {p.triggerEnabled === true && !running && (
          <text
            x={badgeX}
            y="48"
            fill="var(--text-dim)"
            fontSize="7"
            fontWeight="600"
          >
            TRIGGER STOP
          </text>
        )}

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

export default function DynamicCPPage({ cpNumber, user }) {
  const [widgets, setWidgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fieldValues, setFieldValues] = useState({});
  const [logs, setLogs] = useState([]);
  const [tcpDevices, setTcpDevices] = useState([]);
  const [tcpDeviceError, setTcpDeviceError] = useState("");

  // Realtime trend history is intentionally kept in browser memory.
  // It is not written to the database on every PLC poll.
  const [chartHistory, setChartHistory] = useState({});
  const [chartRunning, setChartRunning] = useState({});
  const chartSampleRef = useRef({});
  const chartTriggerRef = useRef({});
  // Trend start time per chart. X-axis is elapsed seconds from START.
  const chartStartTimeRef = useRef({});

  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 1260, height: 800 });

  // ============================================================
  // TCP PLC RUNTIME
  //
  // Page Builder stores:
  //   props.device
  //   props.addressType
  //   props.address
  //
  // Dynamic Page resolves the device name against
  // /api/tcp/devices and registers Button / Light / Gauge / LineChart.
  //
  // LineChart bindings:
  //   <widgetId>:<seriesId>
  //   <widgetId>:__trend_trigger__
  // ============================================================

  const {
    values: tcpValues,
    writeValue: writeTCPValue,
    registerBinding,
    clearBindings,
  } = useTCPPLC({
    devices: tcpDevices,
    enabled: Boolean(cpNumber),
    pollInterval: 300,
  });

  // ============================================================
  // Helpers
  // ============================================================

  const normalizeType = useCallback((type) => {
    const value = String(type || "")
      .trim()
      .toLowerCase()
      .replace(/[_\s-]/g, "");

    if (value === "coil" || value === "coils") return "coil";

    if (
      value === "discreteinput" ||
      value === "discreteinputs" ||
      value === "digitalinput"
    ) {
      return "discrete_input";
    }

    if (
      value === "holdingregister" ||
      value === "holdingregisters" ||
      value === "holding"
    ) {
      return "holding_register";
    }

    if (
      value === "inputregister" ||
      value === "inputregisters" ||
      value === "analoginput"
    ) {
      return "input_register";
    }

    return "";
  }, []);

  // Component capability rules:
  // Button    = WRITE only: Coil / Holding Register
  // Light     = READ only: Coil / Discrete Input / Holding Register / Input Register
  // Gauge     = READ only: Holding Register
  // LineChart = READ only: Coil / Discrete Input / Holding Register / Input Register
  //
  // LineChart has:
  //   - series bindings for plotted values
  //   - optional trigger binding for start/stop recording
  const isValidPLCBinding = useCallback((widgetType, addressType) => {
    const type = normalizeType(addressType);

    if (widgetType === "button") {
      return type === "coil" || type === "holding_register";
    }

    if (widgetType === "light") {
      return (
        type === "coil" ||
        type === "discrete_input" ||
        type === "holding_register" ||
        type === "input_register"
      );
    }

    if (widgetType === "gauge") {
      return type === "holding_register";
    }

    if (widgetType === "linechart") {
      return (
        type === "coil" ||
        type === "discrete_input" ||
        type === "holding_register" ||
        type === "input_register"
      );
    }

    return false;
  }, [normalizeType]);

  const getTCPDevice = useCallback(
    (deviceName) => {
      if (!deviceName) return null;

      const wanted = String(deviceName).trim().toLowerCase();

      return (
        tcpDevices.find(
          (device) =>
            String(device.name || "")
              .trim()
              .toLowerCase() === wanted
        ) || null
      );
    },
    [tcpDevices]
  );

  const hasPLCBinding = useCallback(
    (widget) => {
      const p = widget?.props || {};

      if (!p.device) return false;

      if (
        p.address === undefined ||
        p.address === null ||
        String(p.address).trim() === ""
      ) {
        return false;
      }

      const addressType = normalizeType(p.addressType);

      if (!addressType) return false;

      // Enforce Page Builder capability at runtime.
      if (!isValidPLCBinding(widget.type, addressType)) {
        return false;
      }

      return Boolean(getTCPDevice(p.device));
    },
    [getTCPDevice, normalizeType]
  );

  const getRuntimeValue = useCallback(
    (widget) => {
      const p = widget?.props || {};

      // ----------------------------------------------------------
      // PLC is the source of truth when Device + Address exist.
      // Do NOT fall back to simulationValue at runtime.
      // ----------------------------------------------------------
      if (hasPLCBinding(widget)) {
        return tcpValues[String(widget.id)] ?? 0;
      }

      // ----------------------------------------------------------
      // Non-PLC widgets can still use the existing logic variable.
      // ----------------------------------------------------------
      const variableName = p.variable || p.fieldKey;

      if (!variableName) {
        return undefined;
      }

      return fieldValues[variableName];
    },
    [fieldValues, hasPLCBinding, tcpValues]
  );

  // ============================================================
  // RESET
  // ============================================================

  const resetAll = useCallback(() => {
    setFieldValues({});
    setLogs([]);
    setChartHistory({});
    setChartRunning({});
    chartSampleRef.current = {};
    chartTriggerRef.current = {};
    chartStartTimeRef.current = {};

    console.log(
      `[DynamicCPPage] Reset all states for CP${cpNumber}`
    );
  }, [cpNumber]);

  useEffect(() => {
    resetAll();
  }, [cpNumber]);

  useEffect(() => {
    return () => {
      resetAll();
    };
  }, [resetAll]);

  useEffect(() => {
    const resetHandler = () => resetAll();

    window.addEventListener("cp-reset", resetHandler);

    return () => {
      window.removeEventListener(
        "cp-reset",
        resetHandler
      );
    };
  }, [resetAll]);

  // ============================================================
  // LOAD TCP DEVICES
  // ============================================================

  useEffect(() => {
    let cancelled = false;

    const loadTCPDevices = async () => {
      try {
        setTcpDeviceError("");

        const response = await fetch(
          `${API}/api/tcp/devices`
        );

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}`
          );
        }

        const data = await response.json();

        const devices = Array.isArray(data)
          ? data
          : Array.isArray(data.devices)
            ? data.devices
            : [];

        const normalized = devices
          .filter(Boolean)
          .map((device) => ({
            ...device,
            name:
              device.name ||
              device.device_name ||
              device["Device Name"] ||
              "",
            host:
              device.host ||
              device.ip ||
              device.IP ||
              device["IP Address"] ||
              "",
            port:
              Number(
                device.port ||
                device.Port ||
                502
              ) || 502,
            unitId:
              Number(
                device.unitId ??
                device.unit_id ??
                device["Unit ID"] ??
                device["Device ID"] ??
                1
              ) || 1,
          }))
          .filter((device) => device.name);

        if (!cancelled) {
          setTcpDevices(normalized);

          console.log(
            "[DynamicCPPage] TCP devices loaded:",
            normalized
          );
        }
      } catch (err) {
        if (!cancelled) {
          setTcpDevices([]);
          setTcpDeviceError(err.message);

          console.error(
            "[DynamicCPPage] TCP device load error:",
            err
          );
        }
      }
    };

    loadTCPDevices();

    return () => {
      cancelled = true;
    };
  }, []);

  // ============================================================
  // LOAD PAGE BUILDER CONFIG
  // ============================================================

  useEffect(() => {
    let cancelled = false;

    if (!cpNumber) {
      setError("CP Number is not defined.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    fetch(
      `${API}/api/page-config/${cpNumber}`
    )
      .then((response) =>
        response.ok
          ? response.json()
          : { widgets: [] }
      )
      .then((data) => {
        if (cancelled) return;

        const loadedWidgets =
          Array.isArray(data.widgets)
            ? data.widgets
            : [];

        setWidgets(loadedWidgets);
        setLoading(false);

        let maxW = 1260;
        let maxH = 800;

        loadedWidgets.forEach((widget) => {
          const right =
            Number(widget.x || 0) +
            Number(widget.props?.width || 0);

          const bottom =
            Number(widget.y || 0) +
            Number(widget.props?.height || 0);

          if (right > maxW) maxW = right;
          if (bottom > maxH) maxH = bottom;
        });

        setCanvasSize({
          width: Math.max(
            1260,
            maxW + 40
          ),
          height: Math.max(
            800,
            maxH + 40
          ),
        });
      })
      .catch((err) => {
        if (cancelled) return;

        console.error(
          "[DynamicCPPage] Page config error:",
          err
        );

        setError(
          "Failed to load page layout"
        );

        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cpNumber]);

  // ============================================================
  // REGISTER PAGE BUILDER PLC BINDINGS
  // ============================================================

  useEffect(() => {
    clearBindings();

    if (!widgets.length) {
      return;
    }

    /*
     * One binding = one PLC address.
     *
     * Button / Light / Gauge keep the original widget.id binding.
     * Line Chart uses `${widget.id}:${series.id}` so one chart can
     * read multiple PLC addresses independently.
     */
    widgets.forEach((widget) => {
      const type = widget?.type;
      const p = widget?.props || {};

      // ----------------------------------------------------------
      // LINE CHART: multiple read bindings
      // ----------------------------------------------------------
      if (type === "linechart") {
        const series = Array.isArray(p.series) ? p.series : [];

        console.log(
          `[DynamicCPPage] Registering line chart ${widget.id}: ${series.filter(s => s && s.enabled !== false).length} enabled series`
        );

        // TREND TRIGGER: value 1 starts recording, value 0 stops recording.
        if (p.triggerEnabled === true && p.triggerDevice &&
            p.triggerAddress !== undefined && p.triggerAddress !== null &&
            String(p.triggerAddress).trim() !== "") {
          const triggerDevice = getTCPDevice(p.triggerDevice);
          const triggerAddressType = normalizeType(p.triggerAddressType);

          if (!triggerDevice) {
            console.warn(
              `[DynamicCPPage] Line chart trigger device not found for ${widget.id}: ${p.triggerDevice}`
            );
          } else if (!triggerAddressType) {
            console.warn(
              `[DynamicCPPage] Invalid line chart trigger address type for ${widget.id}:`,
              p.triggerAddressType
            );
          } else if (!isValidPLCBinding(type, triggerAddressType)) {
            console.warn(
              `[DynamicCPPage] Invalid line chart trigger binding: ${triggerAddressType}`
            );
          } else {
            const triggerBindingId = `${widget.id}:__trend_trigger__`;

            registerBinding({
              widgetId: triggerBindingId,
              widgetType: type,
              device: triggerDevice,
              addressType: triggerAddressType,
              address: p.triggerAddress,
            });

            console.log(
              `[DynamicCPPage] Line chart trigger binding: ${triggerBindingId} -> ${triggerDevice.name} / ${triggerAddressType} / ${p.triggerAddress}`
            );
          }
        }

        series.forEach((s, index) => {
          if (s?.enabled === false) {
            return;
          }

          if (!s?.device) {
            console.warn(
              `[DynamicCPPage] Line chart series has no device: ${widget.id}/${s.id || index}`
            );
            return;
          }

          if (
            s.address === undefined ||
            s.address === null ||
            String(s.address).trim() === ""
          ) {
            console.warn(
              `[DynamicCPPage] Line chart series has no address: ${widget.id}/${s.id || index}`
            );
            return;
          }

          const device = getTCPDevice(s.device);

          if (!device) {
            console.warn(
              `[DynamicCPPage] Line chart device not found for ${widget.id}/${s.id || index}: ${s.device}`
            );
            return;
          }

          const addressType = normalizeType(s.addressType);

          if (!addressType) {
            console.warn(
              `[DynamicCPPage] Invalid line chart address type for ${widget.id}/${s.id || index}:`,
              s.addressType
            );
            return;
          }

          if (!isValidPLCBinding(type, addressType)) {
            console.warn(
              `[DynamicCPPage] Invalid line chart binding: ${addressType}`
            );
            return;
          }

          const bindingId = `${widget.id}:${s.id || `series_${index + 1}`}`;

          registerBinding({
            widgetId: bindingId,
            widgetType: type,
            device,
            addressType,
            address: s.address,
          });

          console.log(
            `[DynamicCPPage] Line chart PLC binding: ${bindingId} -> ${device.name} / ${addressType} / ${s.address}`
          );
        });

        return;
      }

      // ----------------------------------------------------------
      // Existing single-value widgets
      // ----------------------------------------------------------
      if (
        type !== "button" &&
        type !== "light" &&
        type !== "gauge"
      ) {
        return;
      }

      if (!p.device) {
        return;
      }

      if (
        p.address === undefined ||
        p.address === null ||
        String(p.address).trim() === ""
      ) {
        return;
      }

      const device = getTCPDevice(p.device);

      if (!device) {
        console.warn(
          `[DynamicCPPage] Device not found for widget ${widget.id}: ${p.device}`
        );
        return;
      }

      const addressType = normalizeType(p.addressType);

      if (!addressType) {
        console.warn(
          `[DynamicCPPage] Invalid address type for widget ${widget.id}:`,
          p.addressType
        );
        return;
      }

      if (!isValidPLCBinding(type, addressType)) {
        console.warn(
          `[DynamicCPPage] Invalid binding: ${type} cannot use ${addressType}`
        );
        return;
      }

      registerBinding({
        widgetId: widget.id,
        widgetType: type,
        device,
        addressType,
        address: p.address,
      });

      console.log(
        `[DynamicCPPage] PLC binding: ${widget.id} -> ${device.name} / ${addressType} / ${p.address}`
      );
    });
  }, [
    widgets,
    tcpDevices,
    clearBindings,
    getTCPDevice,
    normalizeType,
    isValidPLCBinding,
    registerBinding,
  ]);

  // ============================================================
  // CAPTURE REALTIME LINE CHART HISTORY
  //
  // IMPORTANT: each trend starts at elapsed = 0 seconds.
  // The PLC trigger controls START/STOP. Timestamp is only used
  // internally to calculate elapsed seconds and is not displayed.
  // ============================================================

  useEffect(() => {
    if (!widgets.length) return;

    const chartWidgets = widgets.filter(widget => widget?.type === "linechart");
    if (!chartWidgets.length) return;

    const now = Date.now();
    const nextPoints = {};
    const nextRunning = {};
    const chartsToClear = new Set();
    let shouldUpdate = false;

    chartWidgets.forEach(widget => {
      const p = widget.props || {};
      const triggerConfigured =
        p.triggerEnabled === true &&
        p.triggerDevice &&
        p.triggerAddress !== undefined &&
        p.triggerAddress !== null &&
        String(p.triggerAddress).trim() !== "";

      let running = true;
      let startedNow = false;

      if (!triggerConfigured) {
        // No trigger = trend starts automatically from 0 seconds.
        running = true;
        if (!chartStartTimeRef.current[widget.id]) {
          chartStartTimeRef.current[widget.id] = now;
          startedNow = true;
        }

        chartTriggerRef.current[widget.id] = {
          running: true,
          raw: undefined,
        };
      } else {
        const triggerBindingId = `${widget.id}:__trend_trigger__`;
        const rawTrigger = tcpValues[triggerBindingId];
        const numericTrigger = Number(rawTrigger);
        const startValue = Number(p.triggerStartValue ?? 1);
        const stopValue = Number(p.triggerStopValue ?? 0);
        const previous = chartTriggerRef.current[widget.id];
        const previousRunning = previous?.running === true;
        running = previousRunning;

        if (Number.isFinite(numericTrigger)) {
          if (numericTrigger === startValue) running = true;
          else if (numericTrigger === stopValue) running = false;
        }

        // 0 -> 1 : new trend cycle. Start X-axis at exactly 0s.
        if (running && !previousRunning) {
          chartStartTimeRef.current[widget.id] = now;
          startedNow = true;
          chartsToClear.add(widget.id);
        }

        // If trigger is already ON when page first loads, start at 0s.
        if (running && !chartStartTimeRef.current[widget.id]) {
          chartStartTimeRef.current[widget.id] = now;
          startedNow = true;
          chartsToClear.add(widget.id);
        }

        // If stopped, preserve the last trend and do not add samples.
        if (!running) {
          chartTriggerRef.current[widget.id] = {
            running: false,
            raw: numericTrigger,
          };
          nextRunning[widget.id] = false;

          if (
            previous?.running !== false &&
            Number.isFinite(numericTrigger)
          ) {
            console.log(
              `[DynamicCPPage] Line chart trigger ${widget.id}: ${rawTrigger} -> STOPPED`
            );
          }
          return;
        }

        chartTriggerRef.current[widget.id] = {
          running: true,
          raw: numericTrigger,
        };
        nextRunning[widget.id] = true;

        if (
          previous?.running !== true &&
          Number.isFinite(numericTrigger)
        ) {
          console.log(
            `[DynamicCPPage] Line chart trigger ${widget.id}: ${rawTrigger} -> RUNNING (elapsed reset to 0s)`
          );
        }
      }

      nextRunning[widget.id] = running;

      // Do not wait for the PLC value to change. A new sample is created
      // every configured sample interval while the trend is running.
      const interval = Math.max(100, Number(p.sampleInterval ?? 500));
      const lastSample = Number(chartSampleRef.current[widget.id] || 0);

      // Always allow the first point of a new trend immediately.
      if (!startedNow && now - lastSample < interval) return;

      chartSampleRef.current[widget.id] = now;

      const series = Array.isArray(p.series)
        ? p.series.filter(s => s && s.enabled !== false)
        : [];

      const startTime = Number(chartStartTimeRef.current[widget.id] || now);
      const elapsedSeconds = Math.max(0, (now - startTime) / 1000);
      const maxDuration = Math.max(1, Number(p.historySeconds ?? 60));

      // Do not record beyond the configured maximum trend duration.
      if (elapsedSeconds > maxDuration) return;

      const point = {
        elapsed: elapsedSeconds,
      };

      let hasValue = false;

      series.forEach((s, index) => {
        const bindingId = `${widget.id}:${s.id || `series_${index + 1}`}`;
        const numeric = Number(tcpValues[bindingId]);
        if (Number.isFinite(numeric)) {
          point[s.id || `series_${index + 1}`] = numeric;
          hasValue = true;
        }
      });

      if (hasValue) {
        nextPoints[widget.id] = point;
        shouldUpdate = true;

        console.debug(
          `[DynamicCPPage] Line chart sample ${widget.id}: ${elapsedSeconds.toFixed(2)}s`,
          point
        );
      }
    });

    if (Object.keys(nextRunning).length) {
      setChartRunning(previous => {
        let changed = false;
        const next = { ...previous };
        Object.entries(nextRunning).forEach(([id, running]) => {
          if (next[id] !== running) {
            next[id] = running;
            changed = true;
          }
        });
        return changed ? next : previous;
      });
    }

    if (!shouldUpdate && !chartsToClear.size) return;

    setChartHistory(previous => {
      const next = { ...previous };

      chartWidgets.forEach(widget => {
        const point = nextPoints[widget.id];
        const p = widget.props || {};

        if (!point) {
          if (chartsToClear.has(widget.id)) {
            next[widget.id] = [];
          }
          return;
        }

        const interval = Math.max(100, Number(p.sampleInterval ?? 500));
        const maxPoints = Math.min(5000, Math.max(10, Math.ceil((Number(p.historySeconds ?? 60) * 1000) / interval) + 1));
        const history = chartsToClear.has(widget.id)
          ? []
          : (Array.isArray(previous[widget.id]) ? previous[widget.id] : []);

        // Keep only points from the current START cycle and max duration.
        const maxDuration = Math.max(1, Number(p.historySeconds ?? 60));
        const merged = [...history, point]
          .filter(item => Number(item?.elapsed) >= 0 && Number(item?.elapsed) <= maxDuration)
          .slice(-maxPoints);

        next[widget.id] = merged;
      });

      return next;
    });
  }, [widgets, tcpValues]);

  // ============================================================
  // SCALE
  // ============================================================

  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) {
        return;
      }

      const availableWidth =
        containerRef.current.clientWidth;

      const newScale = Math.max(
        0.4,
        availableWidth / canvasSize.width
      );

      setScale(newScale);
    };

    updateScale();

    window.addEventListener(
      "resize",
      updateScale
    );

    return () => {
      window.removeEventListener(
        "resize",
        updateScale
      );
    };
  }, [canvasSize.width]);

  // ============================================================
  // LOG
  // ============================================================

  const addLog = useCallback(
    (
      message,
      color = "var(--accent-green)"
    ) => {
      const time =
        new Date().toLocaleTimeString(
          "en-US",
          { hour12: false }
        );

      setLogs((previous) => [
        ...previous.slice(-199),
        {
          time,
          message,
          color,
        },
      ]);
    },
    []
  );

  // ============================================================
  // RS232 / SCANNER LOGIC
  // ============================================================

  const handleScan = useCallback(
    async (source, value) => {
      console.log(
        `[handleScan] source=${source}, cpNumber=${cpNumber}`
      );

      try {
        const response = await fetch(
          `${API}/api/logic-run/${cpNumber}`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              device: source,
              value,
              fields: fieldValues,
            }),
          }
        );

        const data =
          await response.json();

        if (!data.success) {
          addLog(
            `Logic error: ${data.message}`,
            "var(--accent-red)"
          );
          return;
        }

        const commands =
          data.commands || [];

        for (const command of commands) {
          switch (command.cmd) {
            case "set_field":
              setFieldValues(
                (previous) => ({
                  ...previous,
                  [command.key]:
                    command.value,
                })
              );
              break;

            case "log":
              addLog(
                command.message,
                command.color ||
                  "var(--accent-green)"
              );
              break;

            default:
              console.warn(
                "Unknown command:",
                command
              );
          }
        }
      } catch (err) {
        addLog(
          `Scan error: ${err.message}`,
          "var(--accent-red)"
        );

        console.error(err);
      }
    },
    [
      cpNumber,
      fieldValues,
      addLog,
    ]
  );

  useEffect(() => {
    const handler = (event) => {
      if (
        String(event.detail?.cpNumber) !==
        String(cpNumber)
      ) {
        return;
      }

      console.log(
        `[DynamicCPPage] Received cp-scan for ${event.detail.source} → ${event.detail.value}`
      );

      handleScan(
        event.detail.source,
        event.detail.value
      );
    };

    window.addEventListener(
      "cp-scan",
      handler
    );

    return () => {
      window.removeEventListener(
        "cp-scan",
        handler
      );
    };
  }, [
    cpNumber,
    handleScan,
  ]);

  // ============================================================
  // BUTTON PLC WRITE
  // ============================================================

  const handleButtonChange =
    useCallback(
      async (widget, value) => {
        const p = widget?.props || {};

        /*
         * If this button is PLC bound:
         * write directly to configured Coil or Holding Register.
         */
        if (hasPLCBinding(widget)) {
          const device =
            getTCPDevice(p.device);

          const addressType =
            normalizeType(
              p.addressType
            );

          try {
            const result =
              await writeTCPValue({
                widgetId: widget.id,
                device,
                addressType,
                address: p.address,
                value,
              });

            if (
              result &&
              result.success === false
            ) {
              throw new Error(
                result.message ||
                "PLC write failed"
              );
            }

            console.log(
              `[DynamicCPPage] PLC write: ${device.name} / ${addressType} / ${p.address} = ${value}`
            );

            return;
          } catch (err) {
            console.error(
              `[DynamicCPPage] PLC write failed for ${widget.id}:`,
              err
            );

            addLog(
              `PLC write failed: ${err.message}`,
              "var(--accent-red)"
            );

            return;
          }
        }

        /*
         * If no PLC binding exists,
         * preserve Page Builder variable behavior.
         */
        const variableName =
          p.variable ||
          p.fieldKey;

        if (variableName) {
          setFieldValues(
            (previous) => ({
              ...previous,
              [variableName]:
                value,
            })
          );
        }
      },
      [
        addLog,
        getTCPDevice,
        hasPLCBinding,
        normalizeType,
        writeTCPValue,
      ]
    );

  // ============================================================
  // RENDER STATES
  // ============================================================

  if (!cpNumber) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--accent-red)] text-xs font-mono">
        Error: No CP Number provided.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2 text-[var(--accent-green)] text-xs">
          <div className="w-4 h-4 border-2 border-[var(--accent-green)] border-t-transparent rounded-full animate-spin" />
          Loading page layout…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
        <span className="text-3xl opacity-30">
          ⚠
        </span>

        <p className="text-[var(--accent-red)] text-sm">
          {error}
        </p>

        <p className="text-[var(--text-muted)] text-xs">
          Make sure you have saved a layout
          in the Page Builder.
        </p>
      </div>
    );
  }

  if (widgets.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
        <span className="text-4xl opacity-20">
          🔧
        </span>

        <p className="text-[var(--text-primary)] font-semibold">
          No layout configured for CP
          {cpNumber}
        </p>

        <p className="text-[var(--text-muted)] text-xs">
          Open Page Builder (Engineer →
          Settings) to design this CP page.
        </p>
      </div>
    );
  }

  const displayWidth =
    canvasSize.width * scale;

  const displayHeight =
    canvasSize.height * scale;

  // ============================================================
  // RENDER PAGE
  // ============================================================

  return (
    <div
      ref={containerRef}
      className="flex-1 bg-[var(--bg-canvas)] overflow-hidden font-sans p-4 flex justify-center"
    >
      <div
        style={{
          width: displayWidth,
          height: displayHeight,
          position: "relative",
        }}
      >
        <div
          className="relative origin-top-left"
          style={{
            width: canvasSize.width,
            height: canvasSize.height,
            transform: `scale(${scale})`,
          }}
        >
          {widgets.map((widget) => {
            const {
              type,
              id,
              props: p = {},
            } = widget;

            const variableName =
              p.variable ||
              p.fieldKey;

            /*
             * IMPORTANT:
             *
             * Runtime value is resolved from:
             *
             * PLC binding → tcpValues[widget.id]
             *
             * otherwise:
             *
             * Logic variable → fieldValues[variable]
             */
            const runtimeValue =
              getRuntimeValue(widget);

            // ----------------------------------------------------
            // BUTTON
            // ----------------------------------------------------

            if (type === "button") {
              return (
                <RuntimeButton
                  key={id}
                  widget={widget}
                  value={runtimeValue}
                  onChange={(value) =>
                    handleButtonChange(
                      widget,
                      value
                    )
                  }
                />
              );
            }

            // ----------------------------------------------------
            // LIGHT
            // ----------------------------------------------------

            if (type === "light") {
              return (
                <RuntimeLight
                  key={id}
                  widget={widget}
                  value={runtimeValue}
                />
              );
            }

            // ----------------------------------------------------
            // SHAPE
            // ----------------------------------------------------

            if (type === "shape") {
              return (
                <RuntimeShape
                  key={id}
                  widget={widget}
                />
              );
            }

            // ----------------------------------------------------
            // TEXT BOX
            // ----------------------------------------------------

            if (type === "textbox") {
              return (
                <RuntimeTextBox
                  key={id}
                  widget={widget}
                  value={runtimeValue}
                />
              );
            }

            // ----------------------------------------------------
            // LINE CHART
            // ----------------------------------------------------

            if (type === "linechart") {
              return (
                <RuntimeLineChart
                  key={id}
                  widget={widget}
                  history={chartHistory[id] || []}
                  running={chartRunning[id] !== false}
                />
              );
            }

            // ----------------------------------------------------
            // GAUGE
            // ----------------------------------------------------

            if (type === "gauge") {
              return (
                <RuntimeGauge
                  key={id}
                  widget={widget}
                  value={runtimeValue}
                />
              );
            }

            return null;
          })}
        </div>
      </div>

      {/* Optional communication diagnostic */}
      {tcpDeviceError && (
        <div className="fixed bottom-2 right-2 px-3 py-1.5 rounded-lg bg-[var(--border-soft)]/95 border border-[var(--status-red-bg)] text-[var(--accent-red-soft)] text-[9px] font-mono shadow-xl">
          TCP device list: {tcpDeviceError}
        </div>
      )}
    </div>
  );
}