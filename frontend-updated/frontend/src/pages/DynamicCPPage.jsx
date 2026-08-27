// src/pages/DynamicCPPage.jsx
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { API } from "../service/api";
import { useTCPPLC } from "../hooks/useTCPPLC";
import {
  RuntimeButton,
  RuntimeLight,
  RuntimeShape,
  RuntimeTextBox,
  RuntimeGauge,
  RuntimeLineChart,
  RuntimeCameraFeed,
  RuntimeTestTable,
  RuntimeManualControl,
  RuntimeCalibration,
  RuntimeTimingLimit,
} from "../widgets";

// ──────────────────────────────────────────────────────────────────
// Every widget's live/runtime rendering now lives in its own file under
// src/widgets/<type>.jsx (Runtime{Name} export), shared with the Page
// Builder's design-time preview in the same file. This page only owns
// the runtime shell: layout scaling, TCP/PLC bindings, chart history,
// and the per-widget dispatch below. See src/widgets/index.js.
// ──────────────────────────────────────────────────────────────────

// ------------------------------------------------------------------
// RUNTIME DISPLAY RESOLUTIONS
// The Page Builder resolution is the DESIGN/source coordinate system.
// Dynamic Page has its own TARGET/display resolution and scales the
// complete design from source -> target.
// ------------------------------------------------------------------
const RUNTIME_RESOLUTION_PRESETS = [
  { label: "Full HD • 1920 × 1080", width: 1920, height: 1080 },
];

const DEFAULT_RUNTIME_RESOLUTION = { width: 1920, height: 1080 };

const resolutionKey = (w, h) => `${w}x${h}`;

export default function DynamicCPPage({ cpNumber, user }) {
  const [widgets, setWidgets] = useState([]);
  const [pages, setPages] = useState({ dynamic: { widgets: [] }, manual: { widgets: [] }, calibration: { widgets: [] } });
  const [activePopupPage, setActivePopupPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fieldValues, setFieldValues] = useState({});
  // COM + Realtime TextBox values are kept separately from Logic Builder fields.
  // Sequential TextBoxes continue to use fieldValues only when Logic Builder
  // explicitly writes to their variable.
  const [comTextBoxValues, setComTextBoxValues] = useState({});
  // Realtime RS232 values for Testing Table rows. Sequential values are written by Logic Builder.
  const [testTableComValues, setTestTableComValues] = useState({});
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
  const [viewportScale, setViewportScale] = useState(1);
  const [viewportOffsetX, setViewportOffsetX] = useState(0);

  // Source/design resolution loaded from Page Builder.
  // Widget coordinates are always stored in these pixels.
  const [designCanvas, setDesignCanvas] = useState({ width: 1920, height: 1080 });

  // Target/runtime resolution selected on Dynamic Page.
  // This is independent from the Page Builder design resolution.
  const [runtimeResolution, setRuntimeResolution] = useState(DEFAULT_RUNTIME_RESOLUTION);

  // First scale the Page Builder design into the selected runtime resolution.
  // A second, uniform viewport scale then fits the complete runtime canvas
  // inside the Dynamic Page area. This keeps the HMI aspect ratio intact and
  // removes both horizontal and vertical scrollbars.
  const scaleX = designCanvas.width > 0 ? runtimeResolution.width / designCanvas.width : 1;
  const scaleY = designCanvas.height > 0 ? runtimeResolution.height / designCanvas.height : 1;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateViewportScale = () => {
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      // The main navigation can be a fixed/overlay sidebar which sits on top
      // of the Dynamic Page.  IMPORTANT: probe the *global* left edge of the
      // viewport, not rect.left + 1.  When the page itself starts underneath
      // the sidebar, rect.left may already be 0 and the old probe could land
      // inside the Dynamic Page instead of the sidebar.
      //
      // We only treat a tall element at the left edge as a sidebar. This keeps
      // the HMI out from underneath the navigation while allowing the sidebar
      // to disappear and the HMI to expand automatically.
      let leftInset = 0;
      const probeX = 8;
      const probeY = Math.max(120, Math.min(window.innerHeight - 40, rect.top + rect.height * 0.5));
      const probe = document.elementFromPoint(probeX, probeY);
      if (probe) {
        let el = probe;
        let best = null;
        for (let i = 0; el && i < 12; i++, el = el.parentElement) {
          const r = el.getBoundingClientRect?.();
          if (!r) continue;

          const style = window.getComputedStyle(el);
          const tallEnough = r.height >= Math.min(window.innerHeight * 0.60, rect.height * 0.60);
          const leftEdge = r.left <= 2;
          const reasonableWidth = r.width >= 40 && r.width <= Math.min(420, window.innerWidth * 0.35);
          const visible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0.01;
          const positioned = style.position === 'fixed' || style.position === 'absolute' || style.position === 'sticky';

          if (leftEdge && tallEnough && reasonableWidth && visible && positioned) {
            best = r;
            break;
          }
        }

        if (best) {
          // Convert the sidebar's viewport-right edge into the container's
          // local coordinate system. Clamp it so it can never consume the
          // complete HMI area.
          leftInset = Math.max(0, Math.min(rect.width - 1, best.right - rect.left));
        }
      }

      // If the Dynamic Page itself already begins after the sidebar, do not
      // double-count the sidebar width. The container's left edge is the true
      // usable-area origin in that layout.
      if (rect.left >= 1 && leftInset > 0) {
        leftInset = Math.max(0, leftInset - rect.left);
      }

      // Measure the usable area AFTER the sidebar overlap. The HMI is then
      // centered only in the free area, so no widget can sit underneath the
      // sidebar. No scrollbar is needed.
      const availableWidth = Math.max(1, rect.width - leftInset - 8);
      const availableHeight = Math.max(1, rect.height - 8);
      const sx = availableWidth / runtimeResolution.width;
      const sy = availableHeight / runtimeResolution.height;
      const nextScale = Math.min(1, sx, sy);

      setViewportOffsetX(prev => Math.abs(prev - leftInset) < 0.5 ? prev : leftInset);
      setViewportScale(prev => Math.abs(prev - nextScale) < 0.001 ? prev : nextScale);
    };

    updateViewportScale();
    const observer = new ResizeObserver(updateViewportScale);
    observer.observe(container);
    const mutationObserver = new MutationObserver(updateViewportScale);
    mutationObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener('resize', updateViewportScale);
    window.addEventListener('scroll', updateViewportScale, true);

    const timer = setInterval(updateViewportScale, 250);
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('resize', updateViewportScale);
      window.removeEventListener('scroll', updateViewportScale, true);
      clearInterval(timer);
    };
  }, [runtimeResolution.width, runtimeResolution.height]);

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
  //
  // Test Table bindings:
  //   <widgetId>:<rowId>
  //
  // Icon-popup widgets (Manual Control / Calibration / Timing & Limit)
  // bindings:
  //   <widgetId>:<fieldId>
  // ============================================================

  const {
    values: tcpValues,
    writeValue: writeTCPValue,
    registerBinding,
    clearBindings,
    getValue: getTCPRuntimeValue,
  } = useTCPPLC({
    devices: tcpDevices,
    enabled: Boolean(cpNumber),
    pollInterval: 300,
  });

  // ============================================================
  // Helpers
  // ============================================================

  const normalizeInputSource = useCallback((source) => {
    const value = String(source || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_/-]/g, "");

    if (value === "tcp" || value === "tcpip") return "tcp";
    if (value === "com" || value === "rs232" || value === "serial") return "com";
    if (value === "internal" || value === "variable" || value === "internalvariable" || value === "internalvar") return "internal";
    return value;
  }, []);

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
  //
  // Icon-popup widgets reuse these same rules per-field:
  //   "jog" fields are write-only (validated as "button")
  //   "value"/"boolean" fields are read (validated as "light")
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

    if (widgetType === "textbox") {
      return (
        type === "coil" ||
        type === "discrete_input" ||
        type === "holding_register" ||
        type === "input_register"
      );
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

      if (widget.type === "textbox") {
        const source = normalizeInputSource(p.inputSource);
        const inputType = String(p.inputType || "realtime").trim().toLowerCase();

        // Internal variables are stored in fieldValues and are not PLC bindings.
        if (source === "internal") {
          return false;
        }

        // COM + Realtime is fed by cp-scan, not Modbus/TCP.
        // Sequential is controlled by Logic Builder.
        if (source !== "tcp" || inputType !== "realtime") {
          return false;
        }
      }

      if (!isValidPLCBinding(widget.type, addressType)) {
        return false;
      }

      return Boolean(getTCPDevice(p.device));
    },
    [getTCPDevice, isValidPLCBinding, normalizeInputSource, normalizeType]
  );


  // ============================================================
  // TEXTBOX CALCULATION
  // ============================================================
  const resolveCalculationSource = useCallback(
    (widget, source) => {
      const s = source || {};
      const sourceType = String(s.sourceType || "internal").trim().toLowerCase();

      if (sourceType === "internal") {
        const name = String(s.variable || "").trim();
        if (!name) return undefined;

        const value = fieldValues[name];
        const number = Number(value);
        return value === undefined || value === null || value === ""
          ? undefined
          : Number.isFinite(number)
            ? number
            : undefined;
      }

      if (sourceType === "tcp") {
        const device = getTCPDevice(s.device);
        const addressType = normalizeType(s.addressType);
        const address = s.address;

        if (
          !device ||
          !addressType ||
          address === undefined ||
          address === null ||
          String(address).trim() === ""
        ) {
          return undefined;
        }

        const bindingId =
          `${widget.id}:calc:${s.id || s.alias || "source"}`;

        const value = tcpValues[bindingId];
        const number = Number(value);

        return Number.isFinite(number) ? number : undefined;
      }

      return undefined;
    },
    [fieldValues, getTCPDevice, normalizeType, tcpValues]
  );

  const evaluateCalculation = useCallback((formula, variables) => {
    const expression = String(formula || "").trim();
    if (!expression) return undefined;

    const tokens = [];
    let i = 0;

    while (i < expression.length) {
      const ch = expression[i];

      if (/\s/.test(ch)) {
        i += 1;
        continue;
      }

      if (/[0-9.]/.test(ch)) {
        let j = i + 1;
        while (j < expression.length && /[0-9.eE]/.test(expression[j])) {
          j += 1;
        }

        const value = Number(expression.slice(i, j));
        if (!Number.isFinite(value)) return undefined;

        tokens.push({ type: "number", value });
        i = j;
        continue;
      }

      if (/[A-Za-z_]/.test(ch)) {
        let j = i + 1;
        while (j < expression.length && /[A-Za-z0-9_.]/.test(expression[j])) {
          j += 1;
        }

        const name = expression.slice(i, j);

        if (!Object.prototype.hasOwnProperty.call(variables, name)) {
          return undefined;
        }

        const value = Number(variables[name]);
        if (!Number.isFinite(value)) return undefined;

        tokens.push({ type: "number", value });
        i = j;
        continue;
      }

      if ("+-*/%()".includes(ch)) {
        tokens.push({ type: "operator", value: ch });
        i += 1;
        continue;
      }

      return undefined;
    }

    const output = [];
    const operators = [];
    const precedence = {
      "+": 1,
      "-": 1,
      "*": 2,
      "/": 2,
      "%": 2,
    };

    const isOperator = (value) =>
      ["+", "-", "*", "/", "%"].includes(value);

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (token.type === "number") {
        output.push(token);
        continue;
      }

      let op = token.value;

      // Unary +/-.
      if (
        (op === "+" || op === "-") &&
        (index === 0 ||
          tokens[index - 1]?.value === "(" ||
          isOperator(tokens[index - 1]?.value))
      ) {
        output.push({ type: "number", value: 0 });
      }

      if (op === "(") {
        operators.push(op);
        continue;
      }

      if (op === ")") {
        let matched = false;

        while (operators.length) {
          const top = operators.pop();

          if (top === "(") {
            matched = true;
            break;
          }

          output.push({ type: "operator", value: top });
        }

        if (!matched) return undefined;
        continue;
      }

      while (
        operators.length &&
        operators[operators.length - 1] !== "(" &&
        precedence[operators[operators.length - 1]] >= precedence[op]
      ) {
        output.push({
          type: "operator",
          value: operators.pop(),
        });
      }

      operators.push(op);
    }

    while (operators.length) {
      const top = operators.pop();

      if (top === "(") return undefined;

      output.push({ type: "operator", value: top });
    }

    const stack = [];

    for (const token of output) {
      if (token.type === "number") {
        stack.push(token.value);
        continue;
      }

      if (stack.length < 2) return undefined;

      const b = stack.pop();
      const a = stack.pop();

      let result;

      switch (token.value) {
        case "+":
          result = a + b;
          break;
        case "-":
          result = a - b;
          break;
        case "*":
          result = a * b;
          break;
        case "/":
          if (b === 0) return undefined;
          result = a / b;
          break;
        case "%":
          if (b === 0) return undefined;
          result = a % b;
          break;
        default:
          return undefined;
      }

      if (!Number.isFinite(result)) return undefined;

      stack.push(result);
    }

    return stack.length === 1 && Number.isFinite(stack[0])
      ? stack[0]
      : undefined;
  }, []);

  const calculateTextBox = useCallback(
    (widget) => {
      const p = widget?.props || {};
      const sources = Array.isArray(p.calculationInputs)
        ? p.calculationInputs
        : [];

      const variables = {};

      for (const source of sources) {
        const alias = String(source?.alias || "").trim();
        if (!alias) continue;

        const value = resolveCalculationSource(widget, source);

        if (value === undefined) {
          return undefined;
        }

        variables[alias] = value;
      }

      const result = evaluateCalculation(
        p.calculationFormula,
        variables
      );

      if (result === undefined) {
        return undefined;
      }

      return Number(result.toFixed(3));
    },
    [evaluateCalculation, resolveCalculationSource]
  );

  const getRuntimeValue = useCallback(
    (widget) => {
      const p = widget?.props || {};

      // ----------------------------------------------------------
      // TEXTBOX COMMUNICATION SOURCES
      // ----------------------------------------------------------
      if (widget?.type === "textbox") {
        const mode = String(p.textMode || "read").trim().toLowerCase();
        const source = normalizeInputSource(p.inputSource);
        const inputType = String(p.inputType || "realtime").trim().toLowerCase();
        const fallback = p.defaultText ?? p.text ?? "TEXT";

        if (mode === "static") return fallback;

        if (mode === "calculation") {
          const resultVariable = String(
            p.calculationResultVariable || ""
          ).trim();

          if (!resultVariable) return fallback;

          return fieldValues[resultVariable] ?? fallback;
        }

        // COM + Realtime: value comes directly from cp-scan.
        if (source === "com" && inputType === "realtime") {
          const value = comTextBoxValues[String(widget.id)];
          return value !== undefined ? value : fallback;
        }

        // TCP/IP + Realtime: value comes from useTCPPLC.
        // Internal Variable: the variable name is the source of truth.
        if (source === "internal") {
          const variableName = String(p.variable || p.fieldKey || "").trim();
          if (!variableName) return fallback;
          const internalValue = fieldValues[variableName];
          return internalValue !== undefined && internalValue !== null
            ? internalValue
            : fallback;
        }

        if (source === "tcp" && inputType === "realtime" && hasPLCBinding(widget)) {
          const direct = tcpValues[String(widget.id)];
          if (direct !== undefined) return direct;

          const device = getTCPDevice(p.device);
          const resolved = device
            ? getTCPRuntimeValue({
              widgetId: widget.id,
              device,
              addressType: p.addressType,
              address: p.address,
            })
            : undefined;

          return resolved !== undefined ? resolved : fallback;
        }
      }

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
    [
      comTextBoxValues,
      fieldValues,
      getTCPDevice,
      getTCPRuntimeValue,
      hasPLCBinding,
      normalizeInputSource,
      tcpValues,
    ]
  );

  // ============================================================
  // RESET
  // ============================================================

  const resetAll = useCallback(() => {
    setFieldValues({});
    setComTextBoxValues({});
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

        const legacyDynamic = Array.isArray(data?.widgets) ? data.widgets : [];
        const savedPages = data?.pages && typeof data.pages === "object" ? data.pages : {};
        const loadedPages = {
          dynamic: { widgets: Array.isArray(savedPages.dynamic?.widgets) ? savedPages.dynamic.widgets : legacyDynamic },
          manual: { widgets: Array.isArray(savedPages.manual?.widgets) ? savedPages.manual.widgets : [] },
          calibration: { widgets: Array.isArray(savedPages.calibration?.widgets) ? savedPages.calibration.widgets : [] },
        };
        setPages(loadedPages);
        setWidgets(loadedPages.dynamic.widgets);
        setActivePopupPage(null);
        setLoading(false);

        // Page Builder resolution is the SOURCE/DESIGN coordinate system.
        // Dynamic Page does NOT replace it with the runtime resolution.
        // Page Builder design canvas is fixed to Full HD.
        // Ignore legacy canvas dimensions from older layouts.
        setDesignCanvas({ width: 1920, height: 1080 });
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

  const runtimeWidgets = useMemo(() => [
    ...(Array.isArray(pages.dynamic?.widgets) ? pages.dynamic.widgets : []),
    ...(Array.isArray(pages.manual?.widgets) ? pages.manual.widgets : []),
    ...(Array.isArray(pages.calibration?.widgets) ? pages.calibration.widgets : []),
  ], [pages]);

  useEffect(() => {
    if (!runtimeWidgets.length) return;

    const calculationWidgets = runtimeWidgets.filter(
      (widget) =>
        widget?.type === "textbox" &&
        String(widget?.props?.textMode || "").trim().toLowerCase() ===
        "calculation"
    );

    if (!calculationWidgets.length) return;

    const updates = {};

    calculationWidgets.forEach((widget) => {
      const variable = String(
        widget?.props?.calculationResultVariable || ""
      ).trim();

      if (!variable) return;

      const result = calculateTextBox(widget);

      if (result !== undefined) {
        updates[variable] = result;
      }
    });

    const keys = Object.keys(updates);
    if (!keys.length) return;

    setFieldValues((previous) => {
      let changed = false;
      const next = { ...previous };

      keys.forEach((key) => {
        if (next[key] !== updates[key]) {
          next[key] = updates[key];
          changed = true;
        }
      });

      return changed ? next : previous;
    });
  }, [runtimeWidgets, calculateTextBox]);

  // ============================================================
  // REGISTER PAGE BUILDER PLC BINDINGS
  // ============================================================

  useEffect(() => {
    clearBindings();

    if (!runtimeWidgets.length) {
      return;
    }

    /*
     * One binding = one PLC address.
     *
     * Button / Light / Gauge keep the original widget.id binding.
     * Line Chart uses `${widget.id}:${series.id}` so one chart can
     * read multiple PLC addresses independently.
     * Test Table uses `${widget.id}:${row.id}` the same way.
     * Icon-popup widgets (Manual Control / Calibration / Timing & Limit)
     * use `${widget.id}:${field.id}` the same way.
     */
    runtimeWidgets.forEach((widget) => {
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

          // Field-variable series (no PLC device): sampled straight from
          // fieldValues in the capture effect below, no binding needed.
          if (s?.fieldKey && !s?.device) {
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
      // TEST TABLE: one binding per realtime TCP/IP row.
      // RS232 realtime is updated from cp-scan below.
      // Sequential is intentionally not polled here; Logic Builder owns it.
      // ----------------------------------------------------------
      if (type === "testtable") {
        const rows = Array.isArray(p.rows) ? p.rows : [];

        rows.forEach((row) => {
          const mode = String(row.mode || "realtime").trim().toLowerCase();
          const source = String(row.sourceType || "tcp").trim().toLowerCase();

          if (mode !== "realtime" || source !== "tcp") return;
          if (!row.device || row.address === undefined || row.address === null || String(row.address).trim() === "") return;

          const device = getTCPDevice(row.device);
          if (!device) {
            console.warn(`[DynamicCPPage] Test Table TCP device not found: ${row.device}`);
            return;
          }

          const addressType = normalizeType(row.addressType);
          if (!addressType) return;

          const bindingId = `${widget.id}:${row.id}`;
          registerBinding({
            widgetId: bindingId,
            widgetType: "testtable",
            device,
            addressType,
            address: row.address,
          });
        });

        return;
      }

      // ----------------------------------------------------------
      // ICON-POPUP WIDGETS: Manual Control / Calibration / Timing & Limit
      // Each configured field is its own PLC binding, keyed the same
      // way Line Chart series / Test Table rows are: `${widget.id}:${field.id}`.
      // ----------------------------------------------------------
      if (type === "manualcontrol" || type === "calibration" || type === "timinglimit") {
        const fields = Array.isArray(p.fields) ? p.fields : [];

        fields.forEach((field) => {
          if (!field?.device) return;
          if (field.address === undefined || field.address === null || String(field.address).trim() === "") return;

          const device = getTCPDevice(field.device);
          if (!device) {
            console.warn(`[DynamicCPPage] ${type} field device not found: ${widget.id}/${field.id}`);
            return;
          }

          const addressType = normalizeType(field.addressType);
          if (!addressType) return;

          // "jog" fields are write-only (like a Button); everything else is read (like a Light).
          const capabilityType = field.kind === "jog" ? "button" : "light";

          if (!isValidPLCBinding(capabilityType, addressType)) {
            console.warn(`[DynamicCPPage] Invalid ${type} binding: ${addressType}`);
            return;
          }

          registerBinding({
            widgetId: `${widget.id}:${field.id}`,
            widgetType: capabilityType,
            device,
            addressType,
            address: field.address,
          });

          console.log(
            `[DynamicCPPage] ${type} field binding: ${widget.id}:${field.id} -> ${device.name} / ${addressType} / ${field.address}`
          );
        });

        return;
      }

      // ----------------------------------------------------------
      // TextBox data sources:
      // - Internal Variable: no PLC binding; runtime fieldValues is used.
      // - TCP/IP + Realtime: use Modbus/TCP polling.
      // - COM + Realtime: handled by cp-scan.
      // Sequential remains handled by Logic Builder.
      // ----------------------------------------------------------
      if (type === "textbox") {
        const textMode = String(p.textMode || "read").trim().toLowerCase();
        const source = normalizeInputSource(p.inputSource);
        const inputType = String(p.inputType || "realtime").trim().toLowerCase();

        // Static Text has no PLC binding.
        if (textMode === "static") return;

        // Calculation TextBox:
        // Internal sources are read from fieldValues.
        // TCP sources are registered individually below.
        if (textMode === "calculation") {
          const inputs = Array.isArray(p.calculationInputs)
            ? p.calculationInputs
            : [];

          inputs.forEach((item, index) => {
            const itemSource = String(
              item?.sourceType || "internal"
            ).trim().toLowerCase();

            if (itemSource !== "tcp") return;
            if (!item?.device) return;

            if (
              item?.address === undefined ||
              item?.address === null ||
              String(item.address).trim() === ""
            ) {
              return;
            }

            const device = getTCPDevice(item.device);
            if (!device) return;

            const addressType = normalizeType(item.addressType);
            if (!addressType) return;

            if (!isValidPLCBinding("textbox", addressType)) return;

            const bindingId =
              `${widget.id}:calc:${item.id || item.alias || `source_${index + 1}`}`;

            registerBinding({
              widgetId: bindingId,
              widgetType: "textbox",
              device,
              addressType,
              address: item.address,
            });
          });

          return;
        }

        // Internal Variable mode is stored in fieldValues, not PLC polling.
        if (source === "internal") {
          return;
        }

        // Read / Display and Input + Write use the existing TCP realtime path.
        if (source !== "tcp" || inputType !== "realtime") {
          return;
        }

        if (textMode === "write") {
          const writeType = normalizeType(p.addressType);

          if (writeType !== "coil" && writeType !== "holding_register") {
            console.warn(
              `[DynamicCPPage] TextBox write binding must use Coil or Holding Register: ${widget.id}`
            );
            return;
          }
        }
      } else if (
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
    runtimeWidgets,
    tcpDevices,
    clearBindings,
    getTCPDevice,
    normalizeType,
    normalizeInputSource,
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
    if (!runtimeWidgets.length) return;

    const chartWidgets = runtimeWidgets.filter(widget => widget?.type === "linechart");
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
        const raw = s?.fieldKey && !s?.device
          ? fieldValues[s.fieldKey]
          : tcpValues[`${widget.id}:${s.id || `series_${index + 1}`}`];
        const numeric = Number(raw);
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
  }, [runtimeWidgets, tcpValues, fieldValues]);

  // ============================================================
  // RUNTIME DISPLAY RESOLUTION
  // ============================================================

  // The selected runtime resolution is stored per CP in localStorage so
  // operators can choose the HMI/monitor resolution without changing the
  // Page Builder design.
  useEffect(() => {
    if (!cpNumber) return;
    try {
      const raw = localStorage.getItem(`hmi-runtime-resolution:${cpNumber}`);
      if (!raw) return;
      // Runtime display is fixed to Full HD; ignore legacy saved resolutions.
      setRuntimeResolution(DEFAULT_RUNTIME_RESOLUTION);
    } catch (err) {
      console.warn("[DynamicCPPage] Invalid saved runtime resolution", err);
    }
  }, [cpNumber]);

  const changeRuntimeResolution = useCallback(() => {
    const next = DEFAULT_RUNTIME_RESOLUTION;
    setRuntimeResolution(next);
    if (cpNumber) {
      try {
        localStorage.setItem(`hmi-runtime-resolution:${cpNumber}`, JSON.stringify(next));
      } catch { }
    }
  }, [cpNumber]);

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

      const source = String(event.detail?.source ?? "");
      const value = String(event.detail?.value ?? "");

      console.log(
        `[DynamicCPPage] Received cp-scan for ${source} → ${value}`
      );

      // ------------------------------------------------------------
      // COM + REALTIME TEXTBOX
      // ------------------------------------------------------------
      // The RS232 hook dispatches:
      //   { cpNumber, source, value }
      //
      // Match sourceDevice against the COM source name. A few legacy
      // property names are accepted so existing saved layouts continue
      // to work. Sequential TextBoxes are intentionally ignored here.
      const normalizeDeviceToken = (v) =>
        String(v ?? "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "");

      const sourceToken = normalizeDeviceToken(source);

      setComTextBoxValues((previous) => {
        const next = { ...previous };
        let changed = false;

        runtimeWidgets.forEach((widget) => {
          if (widget?.type !== "textbox") return;

          const p = widget.props || {};
          const inputSource = normalizeInputSource(p.inputSource);
          const inputType = String(p.inputType || "realtime").trim().toLowerCase();

          if (inputSource !== "com" || inputType !== "realtime") {
            return;
          }

          const configuredSources = [
            p.sourceDevice,
            p.comPort,
            p.portName,
            p.device,
            p.source,
          ]
            .filter(Boolean)
            .map(normalizeDeviceToken);

          if (!configuredSources.includes(sourceToken)) {
            return;
          }

          if (next[String(widget.id)] !== value) {
            next[String(widget.id)] = value;
            changed = true;
          }

          console.log(
            `[DynamicCPPage] COM TextBox realtime update: ${widget.id} <- ${source} = ${value}`
          );
        });

        return changed ? next : previous;
      });

      // ------------------------------------------------------------
      // COM + REALTIME TEST TABLE ROWS
      // ------------------------------------------------------------
      setTestTableComValues((previous) => {
        const next = { ...previous };
        let changed = false;

        runtimeWidgets.forEach((widget) => {
          if (widget?.type !== "testtable") return;

          const rows = Array.isArray(widget.props?.rows) ? widget.props.rows : [];

          rows.forEach((row) => {
            const mode = String(row.mode || "realtime").trim().toLowerCase();
            const sourceType = String(row.sourceType || "tcp").trim().toLowerCase();

            if (mode !== "realtime" || sourceType !== "com") return;

            const configuredSources = [
              row.sourceDevice,
              row.comPort,
              row.device,
            ]
              .filter(Boolean)
              .map(normalizeDeviceToken);

            if (!configuredSources.includes(sourceToken)) return;

            const key = `${widget.id}:${row.id}`;
            if (next[key] !== value) {
              next[key] = value;
              changed = true;
            }
          });
        });

        return changed ? next : previous;
      });

      // Keep the existing Logic Builder scan flow unchanged.
      handleScan(source, value);
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
    normalizeInputSource,
    widgets,
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
         * If the button is wired to a Logic Builder flow, run it
         * exactly like a scanner trigger (device = triggerDevice).
         * The flow's own scan_input node stores the field and any
         * downstream nodes' set_field commands update fieldValues.
         */
        if (p.triggerLogic) {
          handleScan(p.triggerDevice || p.fieldKey || p.variable || "Button", value);
          return;
        }

        /*
         * Otherwise, preserve Page Builder variable behavior.
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
        handleScan,
        hasPLCBinding,
        normalizeType,
        writeTCPValue,
      ]
    );

  // ============================================================
  // TEXTBOX TCP/IP WRITE
  // ============================================================
  const handleTextBoxWrite = useCallback(
    async (widget, rawValue) => {
      const p = widget?.props || {};
      const mode = String(p.textMode || "read").trim().toLowerCase();

      if (mode !== "write") return;

      const source = normalizeInputSource(p.inputSource);
      const variableName = String(p.variable || "").trim();
      const dataType = String(p.dataType || "number").trim().toLowerCase();

      // ----------------------------------------------------------
      // INTERNAL VARIABLE WRITE
      // ----------------------------------------------------------
      // The variable name is the key in DynamicCPPage.fieldValues.
      // No PLC/device is involved.
      if (source === "internal") {
        if (!variableName) {
          addLog("TextBox internal variable name is empty", "var(--accent-red)");
          return;
        }

        let value = rawValue;

        if (dataType === "boolean") {
          const normalized = String(rawValue ?? "").trim().toLowerCase();
          if (["1", "true", "on"].includes(normalized)) value = 1;
          else if (["0", "false", "off"].includes(normalized)) value = 0;
          else {
            addLog("Internal boolean value must be 0/1 or ON/OFF", "var(--accent-red)");
            return;
          }
        } else if (dataType === "integer") {
          value = Number.parseInt(String(rawValue).trim(), 10);
          if (!Number.isFinite(value)) {
            addLog("Internal variable value must be an integer", "var(--accent-red)");
            return;
          }
        } else if (dataType === "number") {
          value = Number(String(rawValue).trim());
          if (!Number.isFinite(value)) {
            addLog("Internal variable value must be numeric", "var(--accent-red)");
            return;
          }
        } else {
          value = String(rawValue ?? "");
        }

        setFieldValues((previous) => ({
          ...previous,
          [variableName]: value,
        }));

        console.log(
          `[DynamicCPPage] TextBox internal variable write: ${widget.id} -> ${variableName} =`,
          value
        );

        addLog(
          `TextBox variable ${variableName} = ${String(value)}`,
          "var(--accent-green)"
        );
        return;
      }

      // ----------------------------------------------------------
      // TCP/IP WRITE
      // ----------------------------------------------------------
      if (source !== "tcp") {
        addLog("TextBox write requires Internal Variable or TCP/IP source", "var(--accent-red)");
        return;
      }

      const device = getTCPDevice(p.device);
      const addressType = normalizeType(p.addressType);

      if (!device || !addressType || p.address === undefined || p.address === null || String(p.address).trim() === "") {
        addLog("TextBox TCP/IP write configuration is incomplete", "var(--accent-red)");
        return;
      }

      if (addressType !== "coil" && addressType !== "holding_register") {
        addLog("TextBox TCP/IP write supports Coil or Holding Register only", "var(--accent-red)");
        return;
      }

      let value;

      if (dataType === "boolean") {
        const normalized = String(rawValue ?? "").trim().toLowerCase();
        if (["1", "true", "on"].includes(normalized)) value = 1;
        else if (["0", "false", "off"].includes(normalized)) value = 0;
        else {
          addLog("TextBox boolean value must be 0/1 or ON/OFF", "var(--accent-red)");
          return;
        }
      } else if (dataType === "integer") {
        value = Number.parseInt(String(rawValue).trim(), 10);
        if (!Number.isFinite(value)) {
          addLog("TextBox value must be an integer", "var(--accent-red)");
          return;
        }
      } else {
        value = Number(String(rawValue).trim());
        if (!Number.isFinite(value)) {
          addLog("TextBox TCP/IP value must be numeric", "var(--accent-red)");
          return;
        }
      }

      if (addressType === "coil") {
        value = value ? 1 : 0;
      } else if (!Number.isInteger(value) || value < 0 || value > 65535) {
        addLog("Holding Register value must be an integer from 0 to 65535", "var(--accent-red)");
        return;
      }

      try {
        const result = await writeTCPValue({
          widgetId: widget.id,
          device,
          addressType,
          address: p.address,
          value,
        });

        if (result && result.success === false) {
          throw new Error(result.message || "PLC write failed");
        }

        console.log(
          `[DynamicCPPage] TextBox PLC write: ${widget.id} -> ${device.name} / ${addressType} / ${p.address} = ${value}`
        );
      } catch (err) {
        console.error(`[DynamicCPPage] TextBox PLC write failed for ${widget.id}:`, err);
        addLog(`TextBox PLC write failed: ${err.message}`, "var(--accent-red)");
      }
    },
    [
      addLog,
      getTCPDevice,
      normalizeInputSource,
      normalizeType,
      setFieldValues,
      writeTCPValue,
    ]
  );

  // ============================================================
  // TEST TABLE VALUE RESOLUTION
  // ============================================================
  const getTestTableValue = useCallback((widget, row) => {
    const mode = String(row?.mode || "realtime").trim().toLowerCase();
    const source = String(row?.sourceType || "tcp").trim().toLowerCase();
    const key = `${widget.id}:${row.id}`;

    if (mode === "realtime" && source === "tcp") {
      return tcpValues[key];
    }

    if (mode === "realtime" && source === "com") {
      return testTableComValues[key];
    }

    // Sequential: Logic Builder can expose the value using either
    // testtable:<widget>:<row>, the testing item text, or fieldKey.
    return (
      fieldValues[`testtable:${widget.id}:${row.id}`] ??
      fieldValues[`testtable:${widget.id}:${row.item}`] ??
      fieldValues[row.item] ??
      fieldValues[row.fieldKey]
    );
  }, [tcpValues, testTableComValues, fieldValues]);

  const openPopupPage = useCallback((page) => {
    if (page === "manual" || page === "calibration") setActivePopupPage(page);
  }, []);

  const closePopupPage = useCallback(() => setActivePopupPage(null), []);

  const renderRuntimeWidget = useCallback((widget) => {
    const { type, id } = widget;
    const runtimeValue = getRuntimeValue(widget);

    if (type === "button") return <RuntimeButton key={id} widget={widget} value={runtimeValue} onChange={(value) => handleButtonChange(widget, value)} />;
    if (type === "light") return <RuntimeLight key={id} widget={widget} value={runtimeValue} />;
    if (type === "shape") return <RuntimeShape key={id} widget={widget} />;
    if (type === "textbox") return (
      <RuntimeTextBox
        key={id}
        widget={widget}
        value={runtimeValue}
        onWrite={(value) => handleTextBoxWrite(widget, value)}
      />
    );
    if (type === "linechart") return <RuntimeLineChart key={id} widget={widget} history={chartHistory[id] || []} running={chartRunning[id] !== false} />;
    if (type === "gauge") return <RuntimeGauge key={id} widget={widget} value={runtimeValue} />;
    if (type === "testtable") return <RuntimeTestTable key={id} widget={widget} getValue={getTestTableValue} />;
    if (type === "camerafeed") return <RuntimeCameraFeed key={id} widget={widget} cpNumber={cpNumber} />;

    if (type === "manualcontrol" || type === "calibration" || type === "timinglimit") {
      const plcBundle = { tcpValues, writeTCPValue, getTCPDevice, normalizeType };
      if (type === "manualcontrol") return <RuntimeManualControl key={id} widget={widget} plc={plcBundle} onOpenPage={openPopupPage} />;
      if (type === "calibration") return <RuntimeCalibration key={id} widget={widget} plc={plcBundle} onOpenPage={openPopupPage} />;
      return <RuntimeTimingLimit key={id} widget={widget} plc={plcBundle} />;
    }
    return null;
  }, [cpNumber, chartHistory, chartRunning, getRuntimeValue, handleButtonChange, handleTextBoxWrite, getTestTableValue, tcpValues, writeTCPValue, getTCPDevice, normalizeType, openPopupPage]);

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

  // The OUTER canvas is the selected runtime resolution.
  // The INNER design remains in Page Builder pixels and is transformed
  // to fill the runtime canvas exactly.
  // ============================================================
  // RENDER PAGE
  // ============================================================

  return (
    <div
      ref={containerRef}
      className="relative flex-1 bg-[var(--bg-canvas)] overflow-hidden font-sans flex items-center justify-center"
      style={{ minWidth: 0, minHeight: 0 }}
    >
      <div
        style={{
          // Runtime HMI is scaled as one complete 1920×1080 surface.
          // IMPORTANT: only X is repositioned when the sidebar changes.
          // Y is intentionally fixed at the top of the Dynamic Page so
          // opening/closing the sidebar never moves the HMI vertically.
          width: runtimeResolution.width * viewportScale,
          height: runtimeResolution.height * viewportScale,
          position: "absolute",
          // IMPORTANT: X=0 in Page Builder must remain the LEFT EDGE
          // of the usable Dynamic Page canvas. Do not center the HMI
          // horizontally because that would add an invisible X offset
          // even when the first widget is at x=0.
          // Sidebar visibility changes only this left origin.
          left: `${viewportOffsetX}px`,
          top: 0,
          margin: 0,
          transform: "none",
          transformOrigin: "top left",
          flex: "0 0 auto",
        }}
      >
        {/* Clean HMI surface: no debug labels or runtime overlays are drawn
            inside the 1920×1080 coordinate space. */}
        <div
          className="relative origin-top-left"
          style={{
            width: designCanvas.width,
            height: designCanvas.height,
            transform: `scale(${scaleX}, ${scaleY})`,
            transformOrigin: "top left",
          }}
        >
          {widgets.map(renderRuntimeWidget)}
        </div>
      </div>


      {activePopupPage && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) closePopupPage(); }}>
          <div className="relative w-[96vw] h-[92vh] max-w-[1800px] overflow-hidden rounded-2xl border border-[var(--border)] shadow-2xl bg-[var(--bg-canvas)]" onMouseDown={(e) => e.stopPropagation()}>
            <div className="absolute z-20 top-0 left-0 right-0 h-12 flex items-center justify-between px-4 border-b border-[var(--border-soft)] bg-[var(--bg-surface-2)]/95 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <span className="text-lg">{activePopupPage === "manual" ? "🕹" : "🎯"}</span>
                <span className="text-[var(--text-primary)] font-bold text-sm">{activePopupPage === "manual" ? "Manual Control" : "Calibration"}</span>
                <span className="text-[9px] font-mono text-[var(--text-muted)] px-2 py-1 rounded bg-[var(--border-soft)]">Popup Page</span>
              </div>
              <button type="button" onClick={closePopupPage} className="h-8 px-3 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-soft)] text-[10px] font-bold">← Back</button>
            </div>
            <div className="absolute inset-0 pt-12 overflow-hidden flex items-center justify-center">
              {(pages[activePopupPage]?.widgets || []).length === 0 ? (
                <div className="text-center px-6">
                  <div className="text-5xl opacity-20 mb-3">{activePopupPage === "manual" ? "🕹" : "🎯"}</div>
                  <div className="text-[var(--text-primary)] font-bold text-sm">{activePopupPage === "manual" ? "Manual Control Page" : "Calibration Page"}</div>
                  <div className="text-[var(--text-muted)] text-xs mt-1">This page is empty. Open Page Builder to design it.</div>
                </div>
              ) : (
                <div className="relative overflow-hidden w-[94vw] h-[84vh] max-w-[1600px] max-h-[850px]" style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-soft)", borderRadius: 10 }}>
                  <div className="absolute left-0 top-0 origin-top-left" style={{ width: designCanvas.width, height: designCanvas.height, transform: `scale(${Math.min(1, (window.innerWidth * 0.94) / designCanvas.width, (window.innerHeight * 0.84) / designCanvas.height)})` }}>
                    {(pages[activePopupPage]?.widgets || []).map(renderRuntimeWidget)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Optional communication diagnostic */}
      {tcpDeviceError && (
        <div className="fixed bottom-2 right-2 px-3 py-1.5 rounded-lg bg-[var(--border-soft)]/95 border border-[var(--status-red-bg)] text-[var(--accent-red-soft)] text-[9px] font-mono shadow-xl">
          TCP device list: {tcpDeviceError}
        </div>
      )}
    </div>
  );
}