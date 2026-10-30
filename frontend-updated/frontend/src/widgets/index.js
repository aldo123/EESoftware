// src/widgets/index.js
//
import { memo } from "react";
// Central registry. Add a new widget by creating one file (e.g. slider.jsx)
// that exports `sliderDef`, `SliderPreview`, `SliderPropertyPanel`, and
// `RuntimeSlider`, then add one line to each list below.

import { buttonDef, ButtonPreview, ButtonPropertyPanel, RuntimeButton } from "./button";
import { lightDef, LightPreview, LightPropertyPanel, RuntimeLight } from "./light";
import { shapeDef, ShapePreview, ShapePropertyPanel, RuntimeShape } from "./shape";
import { textboxDef, TextBoxPreview, TextBoxPropertyPanel, RuntimeTextBox } from "./textbox";
import { gaugeDef, GaugePreview, GaugePropertyPanel, RuntimeGauge } from "./gauge";
import { linechartDef, LineChartPreview, LineChartPropertyPanel, RuntimeLineChart } from "./linechart";
import { cameraFeedDef, CameraFeedPreview, CameraFeedPropertyPanel, RuntimeCameraFeed } from "./camerafeed";
import { testtableDef, TestTablePreview, TestTablePropertyPanel, RuntimeTestTable } from "./testtable";
import { imageDef, ImagePreview, ImagePropertyPanel, RuntimeImage } from "./image";
import { alarmBannerDef, AlarmBannerPreview, AlarmBannerPropertyPanel, RuntimeAlarmBanner } from "./alarmbanner";
import { progressBarDef, ProgressBarPreview, ProgressBarPropertyPanel, RuntimeProgressBar } from "./progressbar";
import { selectorSwitchDef, SelectorSwitchPreview, SelectorSwitchPropertyPanel, RuntimeSelectorSwitch } from "./selectorswitch";
import { messageDef, MessagePreview, MessagePropertyPanel, RuntimeMessage } from "./message";
import { popupDef, PopupPreview, PopupPropertyPanel, RuntimePopup } from "./popup";




// Runtime widgets with stable inputs are memoized so parent updates caused by
// unrelated live values (for example, another widget's chart sample or log)
// do not force their SVG/DOM trees to render again. Context consumers still
// update normally when their subscribed React context changes. Interactive
// widgets whose event callbacks are currently recreated by DynamicCPPage are
// intentionally left unwrapped until their callback lifecycle is stabilized.
const memoRuntime = (Component, displayName) => {
  const Memoized = memo(Component);
  Memoized.displayName = displayName;
  return Memoized;
};

const MemoRuntimeLight = memoRuntime(RuntimeLight, "RuntimeLight");
const MemoRuntimeShape = memoRuntime(RuntimeShape, "RuntimeShape");
const MemoRuntimeGauge = memoRuntime(RuntimeGauge, "RuntimeGauge");
const MemoRuntimeLineChart = memoRuntime(RuntimeLineChart, "RuntimeLineChart");
const MemoRuntimeCameraFeed = memoRuntime(RuntimeCameraFeed, "RuntimeCameraFeed");
const MemoRuntimeTestTable = memoRuntime(RuntimeTestTable, "RuntimeTestTable");
const MemoRuntimeImage = memoRuntime(RuntimeImage, "RuntimeImage");
const MemoRuntimeAlarmBanner = memoRuntime(RuntimeAlarmBanner, "RuntimeAlarmBanner");
const MemoRuntimeProgressBar = memoRuntime(RuntimeProgressBar, "RuntimeProgressBar");

// Palette shown in the Page Builder sidebar (drag source).
// CPK Analyzer is NOT here — it moved to its own full-page sidebar menu
// (src/modal/CpkAnalyzerModal.jsx) instead of being a Page Builder widget.
export const COMPONENT_TYPES = [
  buttonDef,
  lightDef,
  shapeDef,
  textboxDef,
  gaugeDef,
  linechartDef,
  cameraFeedDef,
  testtableDef,
  imageDef,
  alarmBannerDef,
  progressBarDef,
  selectorSwitchDef,
  messageDef,
  popupDef,
];

// type -> canvas preview component (Page Builder, design-time)
export const WIDGET_PREVIEWS = {
  button: ButtonPreview,
  light: LightPreview,
  shape: ShapePreview,
  textbox: TextBoxPreview,
  gauge: GaugePreview,
  linechart: LineChartPreview,
  camerafeed: CameraFeedPreview,
  testtable: TestTablePreview,
  image: ImagePreview,
  alarmbanner: AlarmBannerPreview,
  progressbar: ProgressBarPreview,
  selectorswitch: SelectorSwitchPreview,
  message: MessagePreview,
  popup: PopupPreview,
};

// type -> property panel component (Page Builder, right sidebar)
export const WIDGET_PROPERTY_PANELS = {
  button: ButtonPropertyPanel,
  light: LightPropertyPanel,
  shape: ShapePropertyPanel,
  textbox: TextBoxPropertyPanel,
  gauge: GaugePropertyPanel,
  linechart: LineChartPropertyPanel,
  camerafeed: CameraFeedPropertyPanel,
  testtable: TestTablePropertyPanel,
  image: ImagePropertyPanel,
  alarmbanner: AlarmBannerPropertyPanel,
  progressbar: ProgressBarPropertyPanel,
  selectorswitch: SelectorSwitchPropertyPanel,
  message: MessagePropertyPanel,
  popup: PopupPropertyPanel,
};

// type -> runtime component (Dynamic CP Page, live/production)
export const WIDGET_RUNTIME = {
  button: RuntimeButton,
  light: MemoRuntimeLight,
  shape: MemoRuntimeShape,
  textbox: RuntimeTextBox,
  gauge: MemoRuntimeGauge,
  linechart: MemoRuntimeLineChart,
  camerafeed: MemoRuntimeCameraFeed,
  testtable: MemoRuntimeTestTable,
  image: MemoRuntimeImage,
  alarmbanner: MemoRuntimeAlarmBanner,
  progressbar: MemoRuntimeProgressBar,
  selectorswitch: RuntimeSelectorSwitch,
  message: RuntimeMessage,
  popup: RuntimePopup,
};

// Also re-export each runtime component by name, since DynamicCPPage.jsx
// renders each widget type as its own JSX tag (<RuntimeButton />, etc.)
// rather than always going through the WIDGET_RUNTIME map above.
export {
  RuntimeButton,
  MemoRuntimeLight as RuntimeLight,
  MemoRuntimeShape as RuntimeShape,
  RuntimeTextBox,
  MemoRuntimeGauge as RuntimeGauge,
  MemoRuntimeLineChart as RuntimeLineChart,
  MemoRuntimeCameraFeed as RuntimeCameraFeed,
  MemoRuntimeTestTable as RuntimeTestTable,
  MemoRuntimeImage as RuntimeImage,
  MemoRuntimeAlarmBanner as RuntimeAlarmBanner,
  MemoRuntimeProgressBar as RuntimeProgressBar,
  RuntimeSelectorSwitch,
  RuntimeMessage,
  RuntimePopup,
};

export * from "./shared";