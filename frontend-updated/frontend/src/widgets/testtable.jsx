// src/widgets/testtable.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useInternalVariables } from "../hooks/useInternalVariables";
import { API } from "../service/api";
import { LINECHART_ADDRESS_TYPES, PropInput, PropSection, DEFAULT_VISUAL } from "./shared";

export const createTestRow = (index = 0) => ({
  id: `row_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
  item: `Testing Item ${index + 1}`,
  lower: "",
  upper: "",
  mode: "realtime",              // realtime | sequential
  sourceType: "tcp",             // tcp | com
  device: "",
  addressType: "holding_register",
  address: "",
});

export function judgeTestResult(value, lower, upper) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "WAITING";
  }

  const v = Number(value);
  const lo = Number(lower);
  const hi = Number(upper);

  if (!Number.isFinite(v) || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    return "WAITING";
  }

  return v >= lo && v <= hi ? "PASS" : "FAIL";
}


const TEST_TABLE_THEMES = {
  industrial: {
    label: "Industrial Dark",
    backgroundColor: "#0B1220", headerColor: "#162238", rowAltColor: "#0F1A2B", hoverColor: "#17283F",
    borderColor: "#2A3B52", gridColor: "#26364A", titleColor: "#F8FAFC", headerTextColor: "#CBD5E1",
    textColor: "#F8FAFC", secondaryTextColor: "#94A3B8", valueColor: "#FFFFFF", passColor: "#22C55E",
    failColor: "#EF4444", waitingColor: "#94A3B8", waitingBgColor: "#1E293B",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", titleFontSize: 13, headerFontSize: 10, rowFontSize: 11,
    valueFontSize: 12, resultFontSize: 11, titleWeight: 700, headerWeight: 700, rowWeight: 500,
    titleHeight: 38, headerHeight: 34, rowHeight: 34, cellPadding: 8, borderRadius: 8, borderWidth: 1, gridWidth: 1,
    showTitle: true, showGrid: true, zebraRows: true, hoverRows: true, stickyHeader: true, uppercaseHeader: true,
    resultStyle: "badge", resultIcon: true, blinkFail: false, blinkPass: false, valueDecimals: 3, valuePrefix: "", valueSuffix: "",
  },
  midnight: {
    label: "Midnight Blue",
    backgroundColor: "#071426", headerColor: "#0B2A4A", rowAltColor: "#0A1D33", hoverColor: "#123554",
    borderColor: "#1D4E73", gridColor: "#183B59", titleColor: "#E0F2FE", headerTextColor: "#BAE6FD",
    textColor: "#F0F9FF", secondaryTextColor: "#7DD3FC", valueColor: "#E0F2FE", passColor: "#34D399",
    failColor: "#FB7185", waitingColor: "#7DD3FC", waitingBgColor: "#102A43",
    fontFamily: "Segoe UI, Arial, sans-serif", titleFontSize: 13, headerFontSize: 10, rowFontSize: 11,
    valueFontSize: 12, resultFontSize: 11, titleWeight: 700, headerWeight: 700, rowWeight: 500,
    titleHeight: 38, headerHeight: 36, rowHeight: 35, cellPadding: 9, borderRadius: 6, borderWidth: 1, gridWidth: 1,
    showTitle: true, showGrid: true, zebraRows: true, hoverRows: true, stickyHeader: true, uppercaseHeader: true,
    resultStyle: "badge", resultIcon: true, blinkFail: false, blinkPass: false, valueDecimals: 3, valuePrefix: "", valueSuffix: "",
  },
  light: {
    label: "Light Professional",
    backgroundColor: "#FFFFFF", headerColor: "#E8EEF5", rowAltColor: "#F7F9FC", hoverColor: "#EDF4FF",
    borderColor: "#CBD5E1", gridColor: "#D8E0EA", titleColor: "#0F172A", headerTextColor: "#334155",
    textColor: "#0F172A", secondaryTextColor: "#64748B", valueColor: "#0F172A", passColor: "#16A34A",
    failColor: "#DC2626", waitingColor: "#64748B", waitingBgColor: "#F1F5F9",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", titleFontSize: 13, headerFontSize: 10, rowFontSize: 11,
    valueFontSize: 12, resultFontSize: 11, titleWeight: 700, headerWeight: 700, rowWeight: 500,
    titleHeight: 40, headerHeight: 36, rowHeight: 36, cellPadding: 9, borderRadius: 7, borderWidth: 1, gridWidth: 1,
    showTitle: true, showGrid: true, zebraRows: true, hoverRows: true, stickyHeader: true, uppercaseHeader: true,
    resultStyle: "badge", resultIcon: true, blinkFail: false, blinkPass: false, valueDecimals: 3, valuePrefix: "", valueSuffix: "",
  },
  green: {
    label: "Factory Green",
    backgroundColor: "#071A14", headerColor: "#0B3025", rowAltColor: "#09231C", hoverColor: "#104335",
    borderColor: "#1F5D4A", gridColor: "#194936", titleColor: "#ECFDF5", headerTextColor: "#A7F3D0",
    textColor: "#F0FDF4", secondaryTextColor: "#86EFAC", valueColor: "#ECFDF5", passColor: "#4ADE80",
    failColor: "#F87171", waitingColor: "#86EFAC", waitingBgColor: "#12352A",
    fontFamily: "Roboto, Arial, sans-serif", titleFontSize: 13, headerFontSize: 10, rowFontSize: 11,
    valueFontSize: 12, resultFontSize: 11, titleWeight: 700, headerWeight: 700, rowWeight: 500,
    titleHeight: 38, headerHeight: 34, rowHeight: 34, cellPadding: 8, borderRadius: 8, borderWidth: 1, gridWidth: 1,
    showTitle: true, showGrid: true, zebraRows: true, hoverRows: true, stickyHeader: true, uppercaseHeader: true,
    resultStyle: "badge", resultIcon: true, blinkFail: false, blinkPass: false, valueDecimals: 3, valuePrefix: "", valueSuffix: "",
  },
  control: {
    label: "Blue Control Room",
    backgroundColor: "#0A1020", headerColor: "#15244A", rowAltColor: "#0E1830", hoverColor: "#1B2E57",
    borderColor: "#344C7A", gridColor: "#263B63", titleColor: "#EFF6FF", headerTextColor: "#BFDBFE",
    textColor: "#F8FAFC", secondaryTextColor: "#93C5FD", valueColor: "#FFFFFF", passColor: "#22C55E",
    failColor: "#F43F5E", waitingColor: "#93C5FD", waitingBgColor: "#1A2A4B",
    fontFamily: "Segoe UI, Arial, sans-serif", titleFontSize: 14, headerFontSize: 10, rowFontSize: 11,
    valueFontSize: 12, resultFontSize: 11, titleWeight: 700, headerWeight: 700, rowWeight: 500,
    titleHeight: 40, headerHeight: 36, rowHeight: 36, cellPadding: 9, borderRadius: 5, borderWidth: 1, gridWidth: 1,
    showTitle: true, showGrid: true, zebraRows: true, hoverRows: true, stickyHeader: true, uppercaseHeader: true,
    resultStyle: "badge", resultIcon: true, blinkFail: true, blinkPass: false, valueDecimals: 3, valuePrefix: "", valueSuffix: "",
  },
  high: {
    label: "High Contrast",
    backgroundColor: "#000000", headerColor: "#111111", rowAltColor: "#080808", hoverColor: "#202020",
    borderColor: "#FFFFFF", gridColor: "#777777", titleColor: "#FFFFFF", headerTextColor: "#FFFFFF",
    textColor: "#FFFFFF", secondaryTextColor: "#FFFFFF", valueColor: "#FFFFFF", passColor: "#00FF66",
    failColor: "#FF3333", waitingColor: "#FFFFFF", waitingBgColor: "#222222",
    fontFamily: "Arial, Helvetica, sans-serif", titleFontSize: 14, headerFontSize: 11, rowFontSize: 12,
    valueFontSize: 13, resultFontSize: 12, titleWeight: 800, headerWeight: 800, rowWeight: 700,
    titleHeight: 42, headerHeight: 38, rowHeight: 38, cellPadding: 10, borderRadius: 3, borderWidth: 2, gridWidth: 1,
    showTitle: true, showGrid: true, zebraRows: true, hoverRows: true, stickyHeader: true, uppercaseHeader: true,
    resultStyle: "badge", resultIcon: true, blinkFail: true, blinkPass: false, valueDecimals: 3, valuePrefix: "", valueSuffix: "",
  },
  amber: {
    label: "Amber Industrial",
    backgroundColor: "#1A1205", headerColor: "#35250A", rowAltColor: "#211806", hoverColor: "#46310B",
    borderColor: "#71520F", gridColor: "#59410E", titleColor: "#FFFBEB", headerTextColor: "#FDE68A",
    textColor: "#FFFBEB", secondaryTextColor: "#FCD34D", valueColor: "#FEF3C7", passColor: "#84CC16",
    failColor: "#F87171", waitingColor: "#FCD34D", waitingBgColor: "#3B2A08",
    fontFamily: "Tahoma, Arial, sans-serif", titleFontSize: 13, headerFontSize: 10, rowFontSize: 11,
    valueFontSize: 12, resultFontSize: 11, titleWeight: 700, headerWeight: 700, rowWeight: 500,
    titleHeight: 38, headerHeight: 34, rowHeight: 34, cellPadding: 8, borderRadius: 5, borderWidth: 1, gridWidth: 1,
    showTitle: true, showGrid: true, zebraRows: true, hoverRows: true, stickyHeader: true, uppercaseHeader: true,
    resultStyle: "badge", resultIcon: true, blinkFail: true, blinkPass: false, valueDecimals: 3, valuePrefix: "", valueSuffix: "",
  },
  minimal: {
    label: "Minimal",
    backgroundColor: "#111111", headerColor: "#181818", rowAltColor: "#141414", hoverColor: "#222222",
    borderColor: "#333333", gridColor: "#292929", titleColor: "#FFFFFF", headerTextColor: "#BDBDBD",
    textColor: "#F5F5F5", secondaryTextColor: "#999999", valueColor: "#FFFFFF", passColor: "#5EEA8A",
    failColor: "#FF6B6B", waitingColor: "#999999", waitingBgColor: "#222222",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", titleFontSize: 12, headerFontSize: 9, rowFontSize: 10,
    valueFontSize: 11, resultFontSize: 10, titleWeight: 600, headerWeight: 600, rowWeight: 400,
    titleHeight: 34, headerHeight: 32, rowHeight: 32, cellPadding: 7, borderRadius: 2, borderWidth: 1, gridWidth: 1,
    showTitle: true, showGrid: false, zebraRows: false, hoverRows: true, stickyHeader: true, uppercaseHeader: false,
    resultStyle: "text", resultIcon: false, blinkFail: false, blinkPass: false, valueDecimals: 3, valuePrefix: "", valueSuffix: "",
  },
};

// Theme polish: each preset controls not only colors but also visual hierarchy,
// surfaces, separators, status badges, and typography treatment. This is kept
// separate from widget geometry so theme changes never alter x/y/width/height.
const THEME_POLISH = {
  industrial: { titleBackground: "linear-gradient(90deg,#111C2E,#162238)", headerGradient: "linear-gradient(180deg,#1A2A42,#162238)", titleBorder: "#38506D", headerBorder: "#38506D", resultRadius: 7, resultBorderWidth: 1, resultShadow: "0 2px 8px rgba(0,0,0,.22)", titleLetterSpacing: ".08em", headerLetterSpacing: ".055em", rowBorderStyle: "solid" },
  midnight: { titleBackground: "linear-gradient(90deg,#071426,#0D3155)", headerGradient: "linear-gradient(180deg,#0F3A62,#0B2A4A)", titleBorder: "#2D6C99", headerBorder: "#2D6C99", resultRadius: 8, resultBorderWidth: 1, resultShadow: "0 2px 10px rgba(14,165,233,.16)", titleLetterSpacing: ".09em", headerLetterSpacing: ".06em", rowBorderStyle: "solid" },
  light: { titleBackground: "linear-gradient(180deg,#FFFFFF,#F3F6FA)", headerGradient: "linear-gradient(180deg,#EEF3F8,#E1E8F0)", titleBorder: "#CBD5E1", headerBorder: "#CBD5E1", resultRadius: 8, resultBorderWidth: 1, resultShadow: "0 1px 5px rgba(15,23,42,.10)", titleLetterSpacing: ".07em", headerLetterSpacing: ".045em", rowBorderStyle: "solid" },
  green: { titleBackground: "linear-gradient(90deg,#071A14,#0B3025)", headerGradient: "linear-gradient(180deg,#0D3D30,#0B3025)", titleBorder: "#2B735C", headerBorder: "#2B735C", resultRadius: 8, resultBorderWidth: 1, resultShadow: "0 2px 9px rgba(34,197,94,.14)", titleLetterSpacing: ".08em", headerLetterSpacing: ".055em", rowBorderStyle: "solid" },
  control: { titleBackground: "linear-gradient(90deg,#0A1020,#15244A 55%,#1B356B)", headerGradient: "linear-gradient(180deg,#1B315F,#15244A)", titleBorder: "#4162A0", headerBorder: "#4162A0", resultRadius: 6, resultBorderWidth: 1, resultShadow: "0 2px 12px rgba(59,130,246,.18)", titleLetterSpacing: ".10em", headerLetterSpacing: ".065em", rowBorderStyle: "solid" },
  high: { titleBackground: "linear-gradient(90deg,#000,#171717)", headerGradient: "linear-gradient(180deg,#202020,#0D0D0D)", titleBorder: "#FFF", headerBorder: "#FFF", resultRadius: 3, resultBorderWidth: 2, resultShadow: "none", titleLetterSpacing: ".10em", headerLetterSpacing: ".07em", rowBorderStyle: "solid" },
  amber: { titleBackground: "linear-gradient(90deg,#1A1205,#35250A)", headerGradient: "linear-gradient(180deg,#49340C,#35250A)", titleBorder: "#A87814", headerBorder: "#A87814", resultRadius: 6, resultBorderWidth: 1, resultShadow: "0 2px 10px rgba(245,158,11,.16)", titleLetterSpacing: ".09em", headerLetterSpacing: ".06em", rowBorderStyle: "solid" },
  minimal: { titleBackground: "#111111", headerGradient: "#181818", titleBorder: "#333333", headerBorder: "#333333", resultRadius: 2, resultBorderWidth: 0, resultShadow: "none", titleLetterSpacing: ".055em", headerLetterSpacing: ".03em", rowBorderStyle: "solid" },
};

const TEST_TABLE_FONTS = [
  ["Inter, ui-sans-serif, system-ui, sans-serif", "Inter / System"],
  ["Arial, Helvetica, sans-serif", "Arial"],
  ["Segoe UI, Arial, sans-serif", "Segoe UI"],
  ["Roboto, Arial, sans-serif", "Roboto"],
  ["Tahoma, Arial, sans-serif", "Tahoma"],
  ["Verdana, Arial, sans-serif", "Verdana"],
  ["monospace", "Monospace"],
];

const appearanceDefaults = {
  titleBackground: "linear-gradient(90deg,#111C2E,#162238)", headerGradient: "linear-gradient(180deg,#1A2A42,#162238)", titleBorder: "#38506D", headerBorder: "#38506D", resultRadius: 7, resultBorderWidth: 1, resultShadow: "0 2px 8px rgba(0,0,0,.22)", titleLetterSpacing: ".08em", headerLetterSpacing: ".055em", rowBorderStyle: "solid",
  theme: "industrial",
  rowAltColor: "#0F1A2B", hoverColor: "#17283F", gridColor: "#26364A",
  titleColor: "#F8FAFC", headerTextColor: "#CBD5E1", secondaryTextColor: "#94A3B8", valueColor: "#FFFFFF", waitingBgColor: "#1E293B",
  fontFamily: TEST_TABLE_FONTS[0][0], titleFontSize: 13, headerFontSize: 10, rowFontSize: 11, valueFontSize: 12, resultFontSize: 11,
  titleWeight: 700, headerWeight: 700, rowWeight: 500,
  titleHeight: 38, headerHeight: 34, rowHeight: 34, cellPadding: 8, borderRadius: 8, borderWidth: 1, gridWidth: 1,
  showTitle: true, showGrid: true, zebraRows: true, hoverRows: true, stickyHeader: true, uppercaseHeader: true,
  resultStyle: "badge", resultIcon: true, blinkFail: false, blinkPass: false, valueDecimals: 3, valuePrefix: "", valueSuffix: "",
};

const THEME_KEYS = new Set(Object.keys(TEST_TABLE_THEMES));

function normalizeAppearance(p = {}) {
  const isTheme = THEME_KEYS.has(p.theme);
  const themeKey = isTheme ? p.theme : "industrial";
  const theme = TEST_TABLE_THEMES[themeKey] || TEST_TABLE_THEMES.industrial;
  const polish = THEME_POLISH[themeKey] || THEME_POLISH.industrial;

  // IMPORTANT:
  // A named theme is the source of truth for ALL appearance properties.
  // Do not merge old saved appearance values after the theme, otherwise an
  // older theme can mask the newly selected preset and make the dropdown look
  // like it changed while the table stays visually unchanged.
  //
  // Geometry/data are deliberately preserved separately by the caller.
  if (isTheme) {
    // A named theme locks ONLY its COLOR palette.
    // All non-color appearance values saved by the user must override the
    // theme preset, so font/layout/behavior controls remain editable.
    const lockedColorKeys = new Set([
      "tableBg", "headerBg", "headerBg2", "altRowBg", "hoverRowBg",
      "borderColor", "gridColor", "titleColor", "headerTextColor",
      "rowTextColor", "secondaryTextColor", "valueColor", "passColor",
      "failColor", "waitingColor", "waitingBgColor", "passBgColor",
      "failBgColor", "backgroundColor", "headerColor", "rowAltColor",
      "hoverColor", "textColor",
    ]);

    const nonColorOverrides = {};
    Object.keys(p || {}).forEach((key) => {
      if (!lockedColorKeys.has(key) && key !== "theme") {
        nonColorOverrides[key] = p[key];
      }
    });

    return {
      ...p,
      ...appearanceDefaults,
      ...theme,
      ...polish,
      ...nonColorOverrides,
      theme: themeKey,
      // Theme colors are authoritative and cannot be overridden by saved
      // color props while a named theme is active.
      tableBg: theme.tableBg,
      headerBg: theme.headerBg,
      headerBg2: theme.headerBg2,
      altRowBg: theme.altRowBg,
      hoverRowBg: theme.hoverRowBg,
      borderColor: theme.borderColor,
      gridColor: theme.gridColor,
      titleColor: theme.titleColor,
      headerTextColor: theme.headerTextColor,
      rowTextColor: theme.rowTextColor,
      secondaryTextColor: theme.secondaryTextColor,
      valueColor: theme.valueColor,
      passColor: theme.passColor,
      failColor: theme.failColor,
      waitingColor: theme.waitingColor,
      waitingBgColor: theme.waitingBgColor,
      passBgColor: `${theme.passColor}22`,
      failBgColor: `${theme.failColor}22`,
      labelColor: theme.headerTextColor,
    };
  }

  // Custom mode: retain the user's explicit appearance values.
  return {
    ...appearanceDefaults,
    ...p,
    theme: "custom",
    passBgColor: p.passBgColor || `${p.passColor || appearanceDefaults.passColor}22`,
    failBgColor: p.failBgColor || `${p.failColor || appearanceDefaults.failColor}22`,
    waitingBgColor: p.waitingBgColor || p.waitingColor || appearanceDefaults.waitingBgColor,
    labelColor: p.headerTextColor || p.secondaryTextColor || appearanceDefaults.secondaryTextColor,
  };
}

function applyThemePreset(currentProps, themeKey) {
  const theme = TEST_TABLE_THEMES[themeKey] || TEST_TABLE_THEMES.industrial;
  const polish = THEME_POLISH[themeKey] || THEME_POLISH.industrial;

  // Replace the complete visual preset atomically. Keep only widget data and
  // geometry from the existing props; appearance comes entirely from the theme.
  const { width, height, x, y, rows, visual, ...rest } = currentProps || {};
  return {
    ...rest,
    ...appearanceDefaults,
    ...theme,
    ...polish,
    theme: themeKey,
    passBgColor: `${theme.passColor}22`,
    failBgColor: `${theme.failColor}22`,
    waitingBgColor: theme.waitingBgColor,
    labelColor: theme.headerTextColor,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
    ...(rows !== undefined ? { rows } : {}),
    ...(visual !== undefined ? { visual } : {}),
  };
}

export const testtableDef = {
  type: "testtable",
  label: "Test Table",
  icon: "🧪",
  desc: "Testing Item / limits / automatic PASS-FAIL",
  defaultProps: {
    title: "TEST TABLE",
    specificationSource: "internal_variable",
    specificationVariable: "Specification",
    rows: [],
    backgroundColor: "var(--panel-canvas)",
    borderColor: "var(--panel-mid)",
    headerColor: "var(--panel-mid)",
    textColor: "#FFFFFF",
    labelColor: "var(--panel-line)",
    passColor: "var(--accent-green)",
    failColor: "var(--accent-red)",
    waitingColor: "var(--text-muted)",
    ...appearanceDefaults,
    width: 760,
    height: 360,
    visual: { ...DEFAULT_VISUAL },
  },
};

function TableView({ widget, getValue, rowsOverride, resultMap = {} }) {
  const p = normalizeAppearance(widget.props || {});
  const rows = Array.isArray(rowsOverride)
    ? rowsOverride
    : (Array.isArray(p.rows) ? p.rows : []);

  const headers = ["Testing Item", "Lower Limit", "Upper Limit", "Result Test", "Status"];

  const formatValue = (value) => {
    if (value === undefined || value === null || String(value).trim() === "") return "—";
    const n = Number(value);
    const d = Math.max(0, Math.min(8, Number(p.valueDecimals) || 0));
    const text = Number.isFinite(n)
      ? n.toFixed(d).replace(/\.?0+$/, "")
      : String(value);
    return `${p.valuePrefix || ""}${text}${p.valueSuffix || ""}`;
  };

  const formatLimit = (value) => {
    if (value === undefined || value === null || value === "") return "—";
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    const d = Math.max(0, Math.min(8, Number(p.valueDecimals) || 0));
    return n.toFixed(d).replace(/\.?0+$/, "");
  };

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      style={{
        background: p.backgroundColor || "var(--panel-canvas)",
        border: `${Number(p.borderWidth) || 1}px solid ${p.borderColor || "var(--panel-mid)"}`,
        borderRadius: Number(p.borderRadius) || 0,
        boxSizing: "border-box",
        fontFamily: p.fontFamily,
        color: p.textColor,
      }}
    >
      {p.showTitle !== false && (
        <div
          className="shrink-0 flex items-center justify-between"
          style={{
            height: Number(p.titleHeight) || 38,
            padding: `0 ${Number(p.cellPadding) || 0}px`,
            borderBottom: `${Number(p.gridWidth) || 1}px solid ${p.titleBorder || p.gridColor}`,
            background: p.titleBackground || "transparent",
          }}
        >
          <span style={{
            color: p.titleColor,
            fontSize: Number(p.titleFontSize) || 13,
            fontWeight: Number(p.titleWeight) || 700,
            letterSpacing: p.titleLetterSpacing || ".06em",
            textTransform: "uppercase",
          }}>
            {p.title || "TEST TABLE"}
          </span>
          <span style={{ color: p.secondaryTextColor, fontSize: 9, fontWeight: 600 }}>
            {rows.length} TEST ITEM{rows.length === 1 ? "" : "S"}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-auto" style={{ scrollbarWidth: "thin" }}>
        <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "34%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "16%" }} />
          </colgroup>

          <thead
            className={p.stickyHeader !== false ? "sticky top-0 z-10" : ""}
            style={{ background: p.headerGradient || p.headerColor }}
          >
            <tr style={{ height: Number(p.headerHeight) || 34 }}>
              {headers.map((h, i) => (
                <th key={h} style={{
                  padding: `0 ${Number(p.cellPadding) || 0}px`,
                  color: p.headerTextColor || "#FFFFFF",
                  fontSize: Number(p.headerFontSize) || 10,
                  fontWeight: Number(p.headerWeight) || 700,
                  textAlign: i === 0 ? "left" : "center",
                  textTransform: p.uppercaseHeader === false ? "none" : "uppercase",
                  letterSpacing: p.headerLetterSpacing || ".05em",
                  borderBottom: `${Number(p.gridWidth) || 1}px solid ${p.headerBorder || p.gridColor}`,
                  borderRight: p.showGrid === false ? "none" : `${Number(p.gridWidth) || 1}px solid ${p.gridColor}`,
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, i) => {
              // Runtime result is keyed by specification row.id.
              // The backend stores the numeric calculated result in
              // runtime.results[row.id].result.
              const runtimeResult = resultMap[String(row?.id)] || resultMap[row?.id];
              const value = runtimeResult?.result ?? (getValue ? getValue(widget, row) : undefined);

              // UI status is deliberately limited to the three requested states:
              // PASS / FAIL / WAITING.
              // While the backend is waiting/sampling, the row remains WAITING.
              const backendStatus = String(
                runtimeResult?.status ??
                runtimeResult?.result_status ??
                ""
              ).trim().toLowerCase();

              let rowStatus = "WAITING";
              if (backendStatus === "pass" || backendStatus === "passed") {
                rowStatus = "PASS";
              } else if (backendStatus === "fail" || backendStatus === "failed") {
                rowStatus = "FAIL";
              } else if (
                backendStatus === "waiting" ||
                backendStatus === "waiting_trigger" ||
                backendStatus === "running" ||
                backendStatus === "sampling" ||
                backendStatus === "pending" ||
                backendStatus === ""
              ) {
                rowStatus = "WAITING";
              } else {
                // Backward-compatible fallback when the backend only returns
                // a numeric result and no status.
                const judged = judgeTestResult(
                  value,
                  row.lower_limit ?? row.lower,
                  row.upper_limit ?? row.upper
                );
                rowStatus = judged;
              }

              const statusColor =
                rowStatus === "PASS"
                  ? p.passColor
                  : rowStatus === "FAIL"
                    ? p.failColor
                    : p.waitingColor;

              const statusBackground =
                rowStatus === "PASS"
                  ? p.passBgColor
                  : rowStatus === "FAIL"
                    ? p.failBgColor
                    : p.waitingBgColor;

              const baseBg = i % 2 && p.zebraRows !== false
                ? p.rowAltColor
                : p.backgroundColor;

              return (
                <tr
                  key={row.id ?? `${row.parameter_test ?? row.item}-${i}`}
                  style={{
                    height: Number(p.rowHeight) || 34,
                    background: baseBg,
                    fontWeight: Number(p.rowWeight) || 500,
                  }}
                  onMouseEnter={(e) => {
                    if (p.hoverRows !== false) e.currentTarget.style.background = p.hoverColor;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = baseBg;
                  }}
                >
                  <td style={{
                    padding: `0 ${Number(p.cellPadding) || 0}px`,
                    color: p.textColor,
                    fontSize: Number(p.rowFontSize) || 11,
                    borderBottom: `${Number(p.gridWidth) || 1}px ${p.rowBorderStyle || "solid"} ${p.gridColor}`,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {row.parameter_test ?? row.item ?? "—"}
                  </td>

                  <td style={{
                    textAlign: "center",
                    color: p.secondaryTextColor,
                    fontSize: Number(p.rowFontSize) || 11,
                    fontFamily: "monospace",
                    borderBottom: `${Number(p.gridWidth) || 1}px ${p.rowBorderStyle || "solid"} ${p.gridColor}`,
                  }}>
                    {formatLimit(row.lower_limit ?? row.lower)}
                  </td>

                  <td style={{
                    textAlign: "center",
                    color: p.secondaryTextColor,
                    fontSize: Number(p.rowFontSize) || 11,
                    fontFamily: "monospace",
                    borderBottom: `${Number(p.gridWidth) || 1}px ${p.rowBorderStyle || "solid"} ${p.gridColor}`,
                  }}>
                    {formatLimit(row.upper_limit ?? row.upper)}
                  </td>

                  <td style={{
                    textAlign: "center",
                    color: p.valueColor,
                    fontSize: Number(p.valueFontSize) || 12,
                    fontFamily: "monospace",
                    fontWeight: 650,
                    borderBottom: `${Number(p.gridWidth) || 1}px ${p.rowBorderStyle || "solid"} ${p.gridColor}`,
                  }}>
                    {formatValue(value)}
                  </td>

                  <td style={{
                    textAlign: "center",
                    color: statusColor,
                    fontSize: Number(p.resultFontSize) || 11,
                    fontWeight: 800,
                    borderBottom: `${Number(p.gridWidth) || 1}px ${p.rowBorderStyle || "solid"} ${p.gridColor}`,
                  }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minWidth: 64,
                        padding: "3px 8px",
                        borderRadius: Number(p.resultRadius) || 6,
                        border: `${Number(p.resultBorderWidth) || 1}px solid ${statusColor}`,
                        background: statusBackground || "transparent",
                        color: statusColor,
                        boxShadow: p.resultShadow || "none",
                        letterSpacing: ".04em",
                      }}
                    >
                      {rowStatus}
                    </span>
                  </td>
                </tr>
              );
            })}

            {!rows.length && (
              <tr>
                <td colSpan={5} style={{
                  padding: 30,
                  textAlign: "center",
                  color: p.waitingColor,
                }}>
                  No specification loaded
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TestTablePreview({ widget }) {
  const rows = Array.isArray(widget?.props?.rows) ? widget.props.rows : [];
  return <TableView widget={widget} rowsOverride={rows} getValue={() => undefined} />;
}

function normalizeDeviceType(device) {
  const t = String(device?.type ?? device?.Type ?? "").trim().toUpperCase();
  if (t === "TCP" || t === "TCP/IP" || t === "MODBUS_TCP") return "tcp";
  if (t === "COM" || t === "RS232" || t === "SERIAL" || t === "MODBUS_RTU") return "com";
  return "";
}

function normalizeDeviceName(device) {
  return String(
    device?.name ??
    device?.["Device Name"] ??
    device?.device_name ??
    device?.port ??
    device?.["COM Port"] ??
    ""
  ).trim();
}

function mergeImportedRows(imported, current) {
  const currentByItem = new Map(
    (current || []).map((r) => [String(r.item || "").trim().toLowerCase(), r])
  );

  return imported.map((row, index) => {
    const old = currentByItem.get(String(row.item || "").trim().toLowerCase());
    return {
      ...(old || createTestRow(index)),
      id: old?.id || row.id || `row_${Date.now()}_${index}`,
      item: row.item,
      lower: row.lower,
      upper: row.upper,
      // mode/source/device/address remain from Appearance settings.
      mode: old?.mode || "realtime",
      sourceType: old?.sourceType || "tcp",
      device: old?.device || "",
      addressType: old?.addressType || "holding_register",
      address: old?.address || "",
    };
  });
}

function TestItemsSettings({ rows, onSave, onClose, availableDevices = [] }) {
  const [localRows, setLocalRows] = useState(
    rows.length ? rows.map((r) => ({ ...r })) : [createTestRow(0)]
  );
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const devices = useMemo(
    () =>
      (Array.isArray(availableDevices) ? availableDevices : [])
        .map((d) => ({
          raw: d,
          name: normalizeDeviceName(d),
          type: normalizeDeviceType(d),
        }))
        .filter((d) => d.name && d.type),
    [availableDevices]
  );

  const updateRow = (index, key, value) => {
    setLocalRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  };

  const addRow = () => {
    setLocalRows((prev) => [...prev, createTestRow(prev.length)]);
  };

  const removeRow = (index) => {
    setLocalRows((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadExcel = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMessage("");

    try {
      const fd = new FormData();
      fd.append("file", file);

      const response = await fetch(`${API}/api/testtable/parse-excel`, {
        method: "POST",
        body: fd,
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || `HTTP ${response.status}`);
      }

      setLocalRows((current) => mergeImportedRows(data.rows || [], current));
      setMessage(`✓ ${data.count || 0} item dimuat. Setting device/mode/address tetap dipertahankan.`);
    } catch (error) {
      setMessage(`✗ ${error.message}`);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        className="w-[1100px] max-w-[94vw] max-h-[88vh] flex flex-col rounded-2xl overflow-hidden border border-[var(--border)] shadow-2xl"
        style={{ background: "var(--bg-surface-2)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-soft)]">
          <div>
            <div className="text-[var(--text-primary)] font-bold text-sm">
              Testing Table Settings
            </div>
            <div className="text-[var(--text-muted)] text-[10px] mt-1">
              Excel hanya mengisi Testing Item, Lower Limit, Upper Limit. Communication settings diatur di sini.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-3 border-b border-[var(--border-soft)] flex items-center gap-3">
          <input
            id="testtable-excel-upload"
            type="file"
            accept=".xlsx,.xls"
            onChange={uploadExcel}
            className="hidden"
          />
          <label
            htmlFor="testtable-excel-upload"
            className="h-8 px-3 rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] text-white text-xs font-bold cursor-pointer flex items-center"
          >
            {uploading ? "Uploading…" : "Upload Excel"}
          </label>
          <span className="text-[var(--text-muted)] text-[10px]">
            Header: Testing Item | Lower Limit | Upper Limit
          </span>
          {message && (
            <span
              className={`text-[10px] font-bold ml-auto ${
                message.startsWith("✓") ? "text-[#22C55E]" : "text-[#EF4444]"
              }`}
            >
              {message}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-auto px-5 py-3">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[var(--text-muted)] uppercase">
                <th className="text-left py-2 pr-2">Testing Item</th>
                <th className="text-left py-2 pr-2 w-24">Lower Limit</th>
                <th className="text-left py-2 pr-2 w-24">Upper Limit</th>
                <th className="text-left py-2 pr-2 w-28">Type</th>
                <th className="text-left py-2 pr-2 w-28">Source</th>
                <th className="text-left py-2 pr-2 w-36">Device</th>
                <th className="text-left py-2 pr-2 w-36">Address Type</th>
                <th className="text-left py-2 pr-2 w-24">Address</th>
                <th className="w-8"></th>
              </tr>
            </thead>

            <tbody>
              {localRows.map((row, index) => {
                const rowDevices = devices.filter((d) => d.type === row.sourceType);

                return (
                  <tr key={row.id} className="border-t border-[var(--border-soft)]">
                    <td className="py-1 pr-2">
                      <input
                        value={row.item}
                        onChange={(e) => updateRow(index, "item", e.target.value)}
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded px-2 h-8 outline-none"
                      />
                    </td>

                    <td className="py-1 pr-2">
                      <input
                        value={row.lower}
                        onChange={(e) => updateRow(index, "lower", e.target.value)}
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded px-2 h-8 outline-none"
                      />
                    </td>

                    <td className="py-1 pr-2">
                      <input
                        value={row.upper}
                        onChange={(e) => updateRow(index, "upper", e.target.value)}
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded px-2 h-8 outline-none"
                      />
                    </td>

                    <td className="py-1 pr-2">
                      <select
                        value={row.mode}
                        onChange={(e) => updateRow(index, "mode", e.target.value)}
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded px-2 h-8 outline-none"
                      >
                        <option value="realtime">Realtime</option>
                        <option value="sequential">Sequential</option>
                      </select>
                    </td>

                    <td className="py-1 pr-2">
                      <select
                        value={row.sourceType}
                        onChange={(e) => {
                          const sourceType = e.target.value;
                          setLocalRows((prev) =>
                            prev.map((r, i) =>
                              i === index
                                ? { ...r, sourceType, device: "" }
                                : r
                            )
                          );
                        }}
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded px-2 h-8 outline-none"
                      >
                        <option value="tcp">TCP/IP</option>
                        <option value="com">RS232</option>
                      </select>
                    </td>

                    <td className="py-1 pr-2">
                      <select
                        value={row.device}
                        onChange={(e) => updateRow(index, "device", e.target.value)}
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded px-2 h-8 outline-none"
                      >
                        <option value="">Select device…</option>
                        {rowDevices.map((d) => (
                          <option key={`${d.type}:${d.name}`} value={d.name}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="py-1 pr-2">
                      <select
                        value={row.addressType}
                        onChange={(e) => updateRow(index, "addressType", e.target.value)}
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded px-2 h-8 outline-none"
                      >
                        {LINECHART_ADDRESS_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="py-1 pr-2">
                      <input
                        value={row.address}
                        onChange={(e) => updateRow(index, "address", e.target.value)}
                        placeholder={row.sourceType === "tcp" ? "100" : "optional"}
                        className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded px-2 h-8 outline-none"
                      />
                    </td>

                    <td className="py-1 text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        className="text-[#EF4444] hover:text-[#F87171]"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <button
            type="button"
            onClick={addRow}
            className="mt-3 h-8 px-3 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] text-xs"
          >
            + Add Testing Item
          </button>
        </div>

        <div className="px-5 py-3 border-t border-[var(--border-soft)] flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-4 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] text-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(localRows);
              onClose();
            }}
            className="h-8 px-5 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] font-bold text-xs"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}

export function TestTablePropertyPanel({ p, set, setProps, availableDevices = [] }) {
  const { variables, loading: variablesLoading } = useInternalVariables();

  const rows = Array.isArray(p.rows) ? p.rows : [];

  const specificationVariable =
    String(p.specificationVariable || "Specification").trim() ||
    "Specification";
  const ap = normalizeAppearance(p);
  // Named themes lock ONLY these color properties.
  // Every other Appearance property remains editable.
  const THEME_COLOR_KEYS = new Set([
    "tableBg",
    "headerBg",
    "headerBg2",
    "altRowBg",
    "hoverRowBg",
    "borderColor",
    "gridColor",
    "titleColor",
    "headerTextColor",
    "rowTextColor",
    "secondaryTextColor",
    "valueColor",
    "passColor",
    "failColor",
    "waitingColor",
    "waitingBgColor",
    "passBgColor",
    "failBgColor",
  ]);

  const setAppearance = (key, value) => {
    // If a named preset is active, only its COLOR palette is locked.
    // Typography, dimensions, spacing, result style, behavior, formatting,
    // etc. remain fully editable.
    if (THEME_KEYS.has(p.theme) && THEME_COLOR_KEYS.has(key)) {
      return;
    }

    if (typeof setProps === "function") {
      setProps({ [key]: value });
      return;
    }

    set(key, value);
  };

  const color = (label, key) => (
    <PropInput label={label} type="color" value={/^#[0-9a-f]{6}$/i.test(String(ap[key] || "")) ? ap[key] : "#111827"} onChange={(v) => setAppearance(key, v)} />
  );
  const number = (label, key, min, max, step = 1) => (
    <PropInput label={label} type="number" min={min} max={max} step={step} value={ap[key]} onChange={(v) => setAppearance(key, Number(v))} />
  );
  const toggle = (label, key) => (
    <label className="flex items-center justify-between h-7 text-[9px] text-[var(--text-secondary)]">
      <span>{label}</span><input type="checkbox" checked={ap[key] !== false} onChange={(e) => setAppearance(key, e.target.checked)} />
    </label>
  );

  return (
    <>
      <PropSection title="Test Table">
        <PropInput
          label="Title"
          value={p.title || "TEST TABLE"}
          onChange={(v) => set("title", v)}
        />

        <label className="block text-[9px] text-[var(--text-secondary)] mt-2">
          Specification Source
          <select
            value={p.specificationSource || "internal_variable"}
            onChange={(e) => set("specificationSource", e.target.value)}
            className="mt-1 w-full h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-2 text-[var(--text-primary)] text-[10px] font-semibold"
          >
            <option value="internal_variable">Internal Variable</option>
          </select>
        </label>

        <label className="block text-[9px] text-[var(--text-secondary)] mt-2">
          Internal Variable
          <select
            value={specificationVariable}
            onChange={(e) => set("specificationVariable", e.target.value)}
            disabled={variablesLoading && variables.length === 0}
            className="mt-1 w-full h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-2 text-[var(--text-primary)] text-[10px] font-semibold"
          >
            <option value="">
              {variablesLoading ? "Loading variables..." : "Select variable..."}
            </option>
            {variables.map((variable) => (
              <option
                key={String(variable.id ?? variable.name)}
                value={variable.name}
              >
                {variable.name}
              </option>
            ))}
          </select>

          <div className="mt-1 text-[8px] text-[var(--text-muted)]">
            Nilai variable ini menentukan Specification yang dimuat.
          </div>
        </label>

        <div className="mt-2 text-[8px] text-[var(--text-muted)]">
          Test Table hanya mengambil Testing Item, Lower Limit, Upper Limit, dan Result Test.
        </div>
      </PropSection>

      <PropSection title="Appearance">
        <div className="text-[8px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Theme</div>
        <select
          value={THEME_KEYS.has(p.theme) ? p.theme : "custom"}
          onChange={(e) => {
            const key = e.currentTarget.value;

            // Materialize the selected preset into props. This makes the
            // change visible immediately, keeps it after Save/Reload, and
            // gives Custom a real editable starting point.
            if (key === "custom") {
              // Keep all current appearance values. Only switch the mode.
              // From this point every Appearance control is independently
              // editable and writes directly to its own prop.
              if (typeof setProps === "function") {
                setProps({ theme: "custom" });
              } else {
                set("theme", "custom");
              }
              return;
            }

            if (!THEME_KEYS.has(key)) return;

            const next = applyThemePreset(p, key);

            if (typeof setProps === "function") {
              setProps(next);
            } else {
              Object.entries(next).forEach(([k, v]) => {
                if (k !== "rows" && k !== "width" && k !== "height" && k !== "x" && k !== "y") {
                  set(k, v);
                }
              });
              set("theme", key);
            }
          }}
          className="w-full h-9 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-2 text-[var(--text-primary)] text-[10px] font-semibold"
        >
          <option value="custom">Custom / Manual</option>
          {Object.entries(TEST_TABLE_THEMES).map(([key, theme]) => (
            <option key={key} value={key}>{theme.label}</option>
          ))}
        </select>
        <div className="mt-1 text-[8px] text-[var(--text-muted)]">
          Preset theme locks only its color palette. All other Appearance settings remain editable. Choose Custom / Manual to edit colors too.
        </div>
        <label className="block mt-2 text-[9px] text-[var(--text-secondary)]">Font Family<select value={ap.fontFamily} onChange={(e) => setAppearance("fontFamily", e.target.value)} className="mt-1 w-full h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-2 text-[var(--text-primary)]">{TEST_TABLE_FONTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="grid grid-cols-3 gap-1.5 mt-2">
          <label className="text-[8px] text-[var(--text-secondary)]">Title Weight<select value={ap.titleWeight} onChange={(e) => setAppearance("titleWeight", Number(e.target.value))} className="mt-1 w-full h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-1 text-[var(--text-primary)]"><option value="400">400</option><option value="500">500</option><option value="600">600</option><option value="700">700</option><option value="800">800</option></select></label>
          <label className="text-[8px] text-[var(--text-secondary)]">Header Weight<select value={ap.headerWeight} onChange={(e) => setAppearance("headerWeight", Number(e.target.value))} className="mt-1 w-full h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-1 text-[var(--text-primary)]"><option value="400">400</option><option value="500">500</option><option value="600">600</option><option value="700">700</option><option value="800">800</option></select></label>
          <label className="text-[8px] text-[var(--text-secondary)]">Row Weight<select value={ap.rowWeight} onChange={(e) => setAppearance("rowWeight", Number(e.target.value))} className="mt-1 w-full h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-1 text-[var(--text-primary)]"><option value="400">400</option><option value="500">500</option><option value="600">600</option><option value="700">700</option><option value="800">800</option></select></label>
        </div>

        <div className="text-[8px] uppercase tracking-wider text-[var(--text-muted)] mt-3 mb-1">Colors</div>
        {[["Table Background","backgroundColor"],["Header Background","headerColor"],["Alternate Row","rowAltColor"],["Hover Row","hoverColor"],["Border","borderColor"],["Grid","gridColor"],["Title Text","titleColor"],["Header Text","headerTextColor"],["Text","textColor"],["Secondary Text","secondaryTextColor"],["Testing Value","valueColor"],["PASS Text","passColor"],["PASS Background","passBgColor"],["FAIL Text","failColor"],["FAIL Background","failBgColor"],["WAITING Text","waitingColor"],["WAITING Background","waitingBgColor"]].map(([l,k]) => color(l,k))}

        <div className="text-[8px] uppercase tracking-wider text-[var(--text-muted)] mt-3 mb-1">Typography & Layout</div>
        {[["Title Size","titleFontSize",8,28],["Header Size","headerFontSize",7,24],["Row Size","rowFontSize",7,24],["Value Size","valueFontSize",7,28],["Result Size","resultFontSize",7,24],["Title Height","titleHeight",20,80],["Header Height","headerHeight",20,80],["Row Height","rowHeight",20,100],["Cell Padding","cellPadding",0,24],["Border Radius","borderRadius",0,24],["Border Width","borderWidth",0,5],["Grid Width","gridWidth",0,5]].map(([l,k,min,max]) => number(l,k,min,max))}

        <div className="text-[8px] uppercase tracking-wider text-[var(--text-muted)] mt-3 mb-1">Behavior</div>
        {[["Show Title","showTitle"],["Show Grid","showGrid"],["Zebra Rows","zebraRows"],["Hover Rows","hoverRows"],["Sticky Header","stickyHeader"],["Uppercase Header","uppercaseHeader"],["Result Icon","resultIcon"],["Blink FAIL","blinkFail"],["Blink PASS","blinkPass"]].map(([l,k]) => toggle(l,k))}
        <label className="block text-[9px] text-[var(--text-secondary)] mt-1">Result Style<select value={ap.resultStyle} onChange={(e) => setAppearance("resultStyle", e.target.value)} className="mt-1 w-full h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-2 text-[var(--text-primary)]"><option value="badge">Badge</option><option value="text">Text</option></select></label>
        {number("Decimal Digits","valueDecimals",0,8)}
        <PropInput label="Value Prefix" value={ap.valuePrefix || ""} onChange={(v) => setAppearance("valuePrefix", v)} />
        <PropInput label="Value Suffix" value={ap.valueSuffix || ""} onChange={(v) => setAppearance("valueSuffix", v)} />
      </PropSection>
    </>
  );
}

export function RuntimeTestTable({ widget, getValue }) {
  const { getValue: getInternalValue } = useInternalVariables();

  const specificationVariable =
    String(widget?.props?.specificationVariable || "Specification").trim() ||
    "Specification";

  const [specRows, setSpecRows] = useState([]);
  const [resultMap, setResultMap] = useState({});
  const [specName, setSpecName] = useState("");
  const [status, setStatus] = useState("WAITING");
  const [internalValue, setInternalValue] = useState("");
  const [error, setError] = useState("");
  const runtimeSpecIdRef = useRef(null);

  // IMPORTANT: the Internal Variable NAME is "Specification".
  // Its VALUE is the specification number/name, for example 110.
  const specificationValue = getInternalValue(specificationVariable, "");
  const requestedSpec = String(specificationValue ?? "").trim();

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let retryTimer = null;
    let pollInFlight = false;

    const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

    const fetchJson = async (url, options = {}, retries = 3) => {
      let lastError = null;

      for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (cancelled) throw new Error("Request cancelled");

        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 5000);

        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            cache: "no-store",
          });

          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            const error = new Error(
              data?.message || data?.error || `HTTP ${response.status}`
            );
            error.status = response.status;
            throw error;
          }

          return data;
        } catch (error) {
          lastError = error;

          if (attempt < retries && !cancelled) {
            await sleep(400 * (attempt + 1));
          }
        } finally {
          window.clearTimeout(timeout);
        }
      }

      const reason = lastError?.name === "AbortError"
        ? "API request timeout"
        : lastError?.message || "Unknown network error";

      throw new Error(
        `Cannot connect to API ${API || "(empty API URL)"}: ${reason}`
      );
    };

    const stopRuntime = async (id) => {
      if (id == null) return;
      try {
        await fetchJson(
          `${API}/api/specifications/runtime/stop/${encodeURIComponent(id)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          },
          1
        );
      } catch (_) {
        // Cleanup must never block loading a new specification.
      }
    };

    const startRuntime = async (specId) => {
      const data = await fetchJson(
        `${API}/api/specifications/runtime/start/${encodeURIComponent(specId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        3
      );

      if (!data?.success) {
        throw new Error(data?.message || "Failed to start specification runtime");
      }

      runtimeSpecIdRef.current = specId;
      return data;
    };

    const loadSpecification = async () => {
      setError("");
      setResultMap({});
      setSpecRows([]);
      setSpecName("");
      setStatus("WAITING");

      if (!requestedSpec) {
        await stopRuntime(runtimeSpecIdRef.current);
        runtimeSpecIdRef.current = null;
        if (!cancelled) setError("Internal Variable 'Specification' is empty");
        return;
      }

      try {
        // 1. Read all specifications. Network errors are retried automatically.
        const listData = await fetchJson(
          `${API}/api/specifications`,
          { headers: { "Content-Type": "application/json" } },
          4
        );

        const list = Array.isArray(listData?.specifications)
          ? listData.specifications
          : [];

        const found = list.find((item) =>
          String(item?.name ?? "").trim().toLowerCase() === requestedSpec.toLowerCase()
        );

        if (!found) {
          await stopRuntime(runtimeSpecIdRef.current);
          runtimeSpecIdRef.current = null;
          if (!cancelled) {
            setSpecName(requestedSpec);
            setStatus("SPEC NOT FOUND");
            setError(`Specification "${requestedSpec}" not found`);
          }
          return;
        }

        // 2. Load complete specification rows.
        const detailData = await fetchJson(
          `${API}/api/specifications/${encodeURIComponent(found.id)}`,
          { headers: { "Content-Type": "application/json" } },
          4
        );

        const spec = detailData?.specification ?? detailData;
        const rows = Array.isArray(spec?.rows)
          ? spec.rows.map((row, index) => ({
              ...row,
              id: row?.id ?? `spec_${found.id}_${index}`,
            }))
          : [];

        if (cancelled) return;

        setSpecRows(rows);
        setSpecName(String(spec?.name ?? found?.name ?? requestedSpec));

        if (!rows.length) {
          await stopRuntime(runtimeSpecIdRef.current);
          runtimeSpecIdRef.current = null;
          if (!cancelled) setStatus("NO ITEMS");
          return;
        }

        const foundId = String(found.id);

        // Always call start. The backend start endpoint is idempotent and
        // returns "Already running" when the runtime is already alive. This
        // also recovers after the Python backend has been restarted.
        await startRuntime(foundId);

        const poll = async () => {
          if (cancelled || pollInFlight) return;
          pollInFlight = true;

          try {
            const data = await fetchJson(
              `${API}/api/specifications/runtime/status/${encodeURIComponent(foundId)}`,
              { headers: { "Content-Type": "application/json" } },
              2
            );

            if (cancelled) return;

            setError("");
            setResultMap(
              data?.results && typeof data.results === "object"
                ? data.results
                : {}
            );

            const running = Boolean(data?.running);
            const message = String(data?.message || "").toLowerCase();

            if (running) {
              setStatus("RUNNING");
            } else if (message.includes("stopped")) {
              setStatus("STOPPED");
            } else if (message.includes("completed") || message.includes("complete")) {
              // The new backend normally remains RUNNING while waiting for
              // the next trigger, but keep this fallback for old runtimes.
              setStatus("COMPLETED");
            } else {
              setStatus("WAITING");
            }
          } catch (pollError) {
            if (cancelled) return;

            // If the Python process was restarted, its in-memory runtime is
            // gone. Re-create it automatically instead of leaving the UI in
            // permanent "Failed to fetch" state.
            if (pollError?.status === 404) {
              try {
                await startRuntime(foundId);
                setError("");
                setStatus("RUNNING");
              } catch (restartError) {
                setStatus("ERROR");
                setError(restartError?.message || "Failed to restart specification runtime");
              }
            } else {
              setError(pollError?.message || "Failed to read specification runtime");
              // Keep polling. A temporary backend/network outage should
              // recover automatically when the API becomes available again.
            }
          } finally {
            pollInFlight = false;
          }
        };

        await poll();
        if (!cancelled) timer = window.setInterval(poll, 50);
      } catch (err) {
        if (cancelled) return;

        setStatus("ERROR");
        setError(err?.message || "Failed to load Specification");

        // Keep retrying the complete load. This specifically fixes the case
        // where the widget appears before Flask/Electron's Python backend is
        // ready: no manual page refresh is required.
        retryTimer = window.setTimeout(() => {
          if (!cancelled) loadSpecification();
        }, 1500);
      }
    };

    loadSpecification();

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [requestedSpec]);

  // Stop the active runtime when the widget is removed/unmounted.
  useEffect(() => {
    return () => {
      const id = runtimeSpecIdRef.current;
      if (id != null) {
        fetch(`${API}/api/specifications/runtime/stop/${encodeURIComponent(id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }).catch(() => {});
      }
    };
  }, []);

  const runtimeWidget = useMemo(
    () => ({
      ...widget,
      props: {
        ...(widget?.props || {}),
        rows: specRows,
        specificationSource: "internal_variable",
        title: widget?.props?.title || "TEST TABLE",
      },
    }),
    [widget, specRows]
  );

  return (
    <div
      style={{
        position: "absolute",
        left: widget.x,
        top: widget.y,
        width: widget.props?.width,
        height: widget.props?.height,
      }}
    >
      <TableView
        widget={runtimeWidget}
        getValue={getValue}
        rowsOverride={specRows}
        resultMap={resultMap}
      />

      <div
        style={{
          position: "absolute",
          left: 6,
          bottom: 6,
          zIndex: 30,
          fontSize: 8,
          fontWeight: 700,
          color:
            status === "ERROR" || status === "SPEC NOT FOUND"
              ? "#F87171"
              : status === "COMPLETED"
                ? "#4ADE80"
                : "#94A3B8",
          background: "rgba(0,0,0,.55)",
          padding: "3px 6px",
          borderRadius: 4,
          pointerEvents: "none",
        }}
      >
        {specName
          ? `Specification: ${specName} · ${status}`
          : `Specification: ${status}`}
        {error ? ` · ${error}` : ""}
      </div>
    </div>
  );
}