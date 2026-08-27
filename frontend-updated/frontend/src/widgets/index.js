// src/widgets/index.js
//
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



// Palette shown in the Page Builder sidebar (drag source).
export const COMPONENT_TYPES = [
  buttonDef,
  lightDef,
  shapeDef,
  textboxDef,
  gaugeDef,
  linechartDef,
  cameraFeedDef,
  testtableDef,

 
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

 
};

// type -> runtime component (Dynamic CP Page, live/production)
export const WIDGET_RUNTIME = {
  button: RuntimeButton,
  light: RuntimeLight,
  shape: RuntimeShape,
  textbox: RuntimeTextBox,
  gauge: RuntimeGauge,
  linechart: RuntimeLineChart,
  camerafeed: RuntimeCameraFeed,
  testtable: RuntimeTestTable,

 
};

// Also re-export each runtime component by name, since DynamicCPPage.jsx
// renders each widget type as its own JSX tag (<RuntimeButton />, etc.)
// rather than always going through the WIDGET_RUNTIME map above.
export {
  RuntimeButton,
  RuntimeLight,
  RuntimeShape,
  RuntimeTextBox,
  RuntimeGauge,
  RuntimeLineChart,
  RuntimeCameraFeed,
  RuntimeTestTable,


};

export * from "./shared";

