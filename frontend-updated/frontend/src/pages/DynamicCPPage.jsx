// src/pages/DynamicCPPage.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { API } from "../service/api";

// ──────────────────────────────────────────────────────────────────
//  HMI DESIGN SYSTEM - THEME & VISUAL PROPS
// ──────────────────────────────────────────────────────────────────

const THEME_PRESETS = {
  "wik_cyan": {
    accent: "#00BFFF", background: "#07111F", border: "#123B5A", text: "#FFFFFF", secondary: "#7F9DB8", success: "#39FF88", warning: "#FFB020", danger: "#FF3B4D"
  },
  "industrial_blue": {
    accent: "#3B82F6", background: "#080E1A", border: "#1E3A5F", text: "#E2E8F0", secondary: "#94A3B8", success: "#22C55E", warning: "#F59E0B", danger: "#EF4444"
  },
  "emerald": {
    accent: "#22C55E", background: "#07150F", border: "#155E3A", text: "#FFFFFF", secondary: "#8BA99A", success: "#39FF88", warning: "#FFB020", danger: "#FF3B4D"
  },
  "amber": {
    accent: "#FFB020", background: "#181107", border: "#654B15", text: "#FFFFFF", secondary: "#B6A27A", success: "#39FF88", warning: "#FFB020", danger: "#FF3B4D"
  },
  "red_alert": {
    accent: "#EF4444", background: "#1A0C0C", border: "#5F1A1A", text: "#FCA5A5", secondary: "#A66E6E", success: "#22C55E", warning: "#FFB020", danger: "#EF4444"
  }
};

const DEFAULT_VISUAL = {
  theme: "wik_cyan",
  accentColor: "#00BFFF",
  backgroundColor: "#07111F",
  borderColor: "#123B5A",
  textColor: "#FFFFFF",
  secondaryTextColor: "#7F9DB8",
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

function GaugeTypeIcon({ type = "temp", color = "#00BFFF", size = 28 }) {
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

  const onBg = p.onBackground || v.accentColor || "#00BFFF";
  const offBg = p.offBackground || v.backgroundColor || "#0F172A";
  const onBorder = p.onBorder || v.accentColor || "#00BFFF";
  const offBorder = p.offBorder || v.borderColor || "#123B5A";
  const onText = p.onTextColor || v.textColor || "#FFFFFF";
  const offText = p.offTextColor || v.secondaryTextColor || "#7F9DB8";
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
    btnStyle.background = `linear-gradient(135deg, ${v.backgroundColor || "#07111F"}, ${isOn ? onBg : offBg})`;
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
  const onColor = p.onColor || v.accentColor || "#00BFFF";
  const offColor = p.offColor || "#1E293B";
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
  const fill = p.fill || "#123B5A";
  const borderColor = p.borderColor || "#00BFFF";
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

    const accent = p.progressColor || "#00BFFF";
    const track = p.trackColor || "#1A2C3D";
    const textColor = p.textColor || "#FFFFFF";
    const labelColor = p.labelColor || "#71879B";

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
              <stop offset="0%" stopColor={p.backgroundColor || "#102133"} />
              <stop offset="72%" stopColor={p.backgroundColor || "#071421"} />
              <stop offset="100%" stopColor={p.backgroundColor || "#050D16"} />
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
            stroke={p.borderColor || "#18334A"}
            strokeWidth="1"
          />

          {/* Outer technical ring */}
          <path
            d={arcPath(start, end, 84)}
            fill="none"
            stroke="#24445C"
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

export default function DynamicCPPage({ cpNumber, user }) {
  const [widgets, setWidgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fieldValues, setFieldValues] = useState({});
  const [logs, setLogs] = useState([]);
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 1260, height: 800 });

  const resetAll = useCallback(() => {
    setFieldValues({});
    setLogs([]);
    console.log(`[DynamicCPPage] Reset all states for CP${cpNumber}`);
  }, [cpNumber]);

  useEffect(() => { resetAll(); }, [cpNumber]);
  useEffect(() => { return () => { resetAll(); }; }, [resetAll]);
  useEffect(() => {
    const resetHandler = () => resetAll();
    window.addEventListener("cp-reset", resetHandler);
    return () => window.removeEventListener("cp-reset", resetHandler);
  }, [resetAll]);

  useEffect(() => {
    if (!cpNumber) { setError("CP Number is not defined."); setLoading(false); return; }
    setLoading(true); setError("");
    fetch(`${API}/api/page-config/${cpNumber}`)
      .then(r => r.ok ? r.json() : { widgets: [] })
      .then(d => {
        const loadedWidgets = d.widgets || [];
        setWidgets(loadedWidgets); setLoading(false);
        let maxW = 1260, maxH = 800;
        loadedWidgets.forEach(w => {
          const right = w.x + (w.props?.width || 0);
          const bottom = w.y + (w.props?.height || 0);
          if (right > maxW) maxW = right;
          if (bottom > maxH) maxH = bottom;
        });
        setCanvasSize({ width: Math.max(1260, maxW + 40), height: Math.max(800, maxH + 40) });
      })
      .catch(e => { setError("Failed to load page layout"); setLoading(false); });
  }, [cpNumber]);

  useEffect(() => {
    const updateScale = () => {
      if (containerRef.current) {
        const availableWidth = containerRef.current.clientWidth;
        let newScale = Math.max(0.4, availableWidth / canvasSize.width);
        setScale(newScale);
      }
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [canvasSize.width]);

  const addLog = useCallback((message, color = "#22C55E") => {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLogs(prev => [...prev.slice(-199), { time, message, color }]);
  }, []);

  const handleScan = useCallback(async (source, value) => {
    console.log(`[handleScan] source=${source}, cpNumber=${cpNumber}`);
    try {
      const res = await fetch(`${API}/api/logic-run/${cpNumber}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device: source,
          value: value,
          fields: fieldValues,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        addLog(`Logic error: ${data.message}`, "#EF4444");
        return;
      }
      const commands = data.commands || [];
      for (const cmd of commands) {
        switch (cmd.cmd) {
          case "set_field":
            setFieldValues(prev => ({ ...prev, [cmd.key]: cmd.value }));
            break;
          case "log":
            addLog(cmd.message, cmd.color || "#22C55E");
            break;
          default:
            console.warn("Unknown command:", cmd);
        }
      }
    } catch (err) {
      addLog(`Scan error: ${err.message}`, "#EF4444");
      console.error(err);
    }
  }, [cpNumber, fieldValues, addLog]);

  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.cpNumber === cpNumber) {
        console.log(`[DynamicCPPage] Received cp-scan for ${e.detail.source} → ${e.detail.value}`);
        handleScan(e.detail.source, e.detail.value);
      }
    };
    window.addEventListener("cp-scan", handler);
    return () => { window.removeEventListener("cp-scan", handler); console.log(`[DynamicCPPage] Removed cp-scan listener`); };
  }, [cpNumber, handleScan]);

  if (!cpNumber) return <div className="flex-1 flex items-center justify-center text-[#EF4444] text-xs font-mono">Error: No CP Number provided.</div>;
  if (loading) return (<div className="flex-1 flex items-center justify-center"><div className="flex items-center gap-2 text-[#22C55E] text-xs"><div className="w-4 h-4 border-2 border-[#22C55E] border-t-transparent rounded-full animate-spin" /> Loading page layout…</div></div>);
  if (error) return (<div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8"><span className="text-3xl opacity-30">⚠</span><p className="text-[#EF4444] text-sm">{error}</p><p className="text-[#475569] text-xs">Make sure you have saved a layout in the Page Builder.</p></div>);
  if (widgets.length === 0) return (<div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8"><span className="text-4xl opacity-20">🔧</span><p className="text-white font-semibold">No layout configured for CP{cpNumber}</p><p className="text-[#475569] text-xs">Open Page Builder (Engineer → Settings) to design this CP page.</p></div>);

  const displayWidth = canvasSize.width * scale;
  const displayHeight = canvasSize.height * scale;

  return (
    <div ref={containerRef} className="flex-1 bg-[#0F172A] overflow-hidden font-sans p-4 flex justify-center">
      <div style={{ width: displayWidth, height: displayHeight, position: 'relative' }}>
        <div className="relative origin-top-left" style={{ width: canvasSize.width, height: canvasSize.height, transform: `scale(${scale})` }}>
          {widgets.map(widget => {
            const { type, id, props: p } = widget;
            
            const variableName = p.variable || p.fieldKey;

            if (type === "button") {
              return (
                <RuntimeButton
                  key={id}
                  widget={widget}
                  value={fieldValues[variableName]}
                  onChange={val => {
                    if (!variableName) return;
                    setFieldValues(prev => ({ ...prev, [variableName]: val }));
                  }}
                />
              );
            }

            if (type === "light") {
              return (
                <RuntimeLight
                  key={id}
                  widget={widget}
                  value={fieldValues[variableName]}
                />
              );
            }

            if (type === "shape") {
              return <RuntimeShape key={id} widget={widget} />;
            }

            if (type === "textbox") {
              return (
                <RuntimeTextBox
                  key={id}
                  widget={widget}
                  value={fieldValues[variableName]}
                />
              );
            }

            if (type === "gauge") {
              return (
                <RuntimeGauge
                  key={id}
                  widget={widget}
                  value={fieldValues[variableName]}
                />
              );
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
}