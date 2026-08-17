// src/pages/DynamicCPPage.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { API } from "../service/api";
import { useTCPPLC } from "../hooks/useTCPPLC";
import {
  RuntimeButton,
  RuntimeLight,
  RuntimeShape,
  RuntimeTextBox,
  RuntimeGauge,
  RuntimeLineChart,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fieldValues, setFieldValues] = useState({});
  // COM + Realtime TextBox values are kept separately from Logic Builder fields.
  // Sequential TextBoxes continue to use fieldValues only when Logic Builder
  // explicitly writes to their variable.
  const [comTextBoxValues, setComTextBoxValues] = useState({});
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

  const getRuntimeValue = useCallback(
    (widget) => {
      const p = widget?.props || {};

      // ----------------------------------------------------------
      // TEXTBOX COMMUNICATION SOURCES
      // ----------------------------------------------------------
      if (widget?.type === "textbox") {
        const source = normalizeInputSource(p.inputSource);
        const inputType = String(p.inputType || "realtime").trim().toLowerCase();

        // COM + Realtime: value comes directly from cp-scan.
        if (source === "com" && inputType === "realtime") {
          const value = comTextBoxValues[String(widget.id)];
          return value !== undefined ? value : (p.text ?? "");
        }

        // TCP/IP + Realtime: value comes from useTCPPLC.
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

          return resolved !== undefined ? resolved : (p.text ?? "");
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

        const loadedWidgets =
          Array.isArray(data.widgets)
            ? data.widgets
            : [];

        setWidgets(loadedWidgets);
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
      // TextBox: TCP/IP + Realtime only.
      // COM + Realtime is handled by cp-scan.
      // Sequential is handled by Logic Builder.
      // ----------------------------------------------------------
      if (type === "textbox") {
        const source = normalizeInputSource(p.inputSource);
        const inputType = String(p.inputType || "realtime").trim().toLowerCase();

        if (source !== "tcp" || inputType !== "realtime") {
          return;
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
    widgets,
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
      } catch {}
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

        widgets.forEach((widget) => {
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