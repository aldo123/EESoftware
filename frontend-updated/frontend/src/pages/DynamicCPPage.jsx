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

            return null;
          })}
        </div>
      </div>
    </div>
  );
}