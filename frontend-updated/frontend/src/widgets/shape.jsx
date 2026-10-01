// src/widgets/shape.jsx
//
// Everything about the "shape" widget lives in this one file:
//   - ShapeDef            palette entry (label/icon/desc/defaultProps) for the Page Builder sidebar
//   - ShapePreview        how it looks on the Page Builder canvas (design-time)
//   - ShapePropertyPanel  the property panel shown when this widget is selected
//   - RuntimeShape        how it looks/behaves on the live Dynamic CP Page
//
import { PropInput, PropSection, DEFAULT_VISUAL } from "./shared";

// ────────────────────────────────────────────────────────────────
//  PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

export const shapeDef = {
    type: "shape",
    label: "Shape",
    icon: "◇",
    desc: "Basic graphic shape",
    defaultProps: {
      shapeType: "rectangle",
      fill: "var(--panel-mid)",
      borderColor: "var(--accent-cyan)",
      borderWidth: 1,
      radius: 8,
      rotation: 0,
      width: 160,
      height: 80,
      visual: { ...DEFAULT_VISUAL }
    }
  };

// ────────────────────────────────────────────────────────────────
//  SHAPE TYPE LIST (shown in the property panel dropdown)
// ────────────────────────────────────────────────────────────────

export const SHAPE_TYPES = [
  { value: "rectangle", label: "Rectangle" },
  { value: "circle", label: "Circle" },
  { value: "ellipse", label: "Ellipse" },
  { value: "triangle", label: "Triangle" },
  { value: "line", label: "Line" },
  { value: "arrow", label: "Arrow" },
  { value: "double-arrow", label: "Double Arrow" },
  { value: "chevron", label: "Chevron" },
  { value: "diamond", label: "Diamond" },
  { value: "hexagon", label: "Hexagon" },
  { value: "pentagon", label: "Pentagon" },
  { value: "star", label: "Star" },
  { value: "cross", label: "Cross" },
];

// Polygon-based shapes are all drawn the same way (fill + stroke on a
// 0..100 viewBox that stretches to whatever size the widget is resized
// to), so their geometry only needs a set of points.
const POLYGON_POINTS = {
  diamond: "50,0 100,50 50,100 0,50",
  hexagon: "25,0 75,0 100,50 75,100 25,100 0,50",
  pentagon: "50,0 100,38 82,100 18,100 0,38",
  star: "50,2 61,37 98,37 68,59 79,95 50,73 21,95 32,59 2,37 39,37",
  // Flag/tag shape pointing right, used for step-sequence indicators.
  chevron: "0,0 75,0 100,50 75,100 0,100 20,50",
  arrow: "0,30 60,30 60,10 100,50 60,90 60,70 0,70",
  "double-arrow": "0,50 20,30 20,42 80,42 80,30 100,50 80,70 80,58 20,58 20,70",
};

// ────────────────────────────────────────────────────────────────
//  SHARED SURFACE
//  Preview and Runtime render the exact same markup so they never
//  visually drift apart from each other.
// ────────────────────────────────────────────────────────────────

function ShapeSurface({ p }) {
  const shapeType = p.shapeType || "rectangle";
  const fill = p.fill || "transparent";
  const borderColor = p.borderColor || "var(--accent-cyan)";
  const borderWidth = Math.max(0, Number(p.borderWidth ?? 1));
  const radius = Math.max(0, Number(p.radius ?? 8));
  const rotation = Number(p.rotation ?? 0);

  const outerStyle = {
    width: "100%",
    height: "100%",
    transform: `rotate(${rotation}deg)`,
  };

  if (shapeType === "circle" || shapeType === "ellipse") {
    return (
      <div className="w-full h-full flex items-center justify-center overflow-visible">
        <div
          style={{
            ...outerStyle,
            background: fill,
            border: `${borderWidth}px solid ${borderColor}`,
            borderRadius: "50%",
            boxSizing: "border-box",
          }}
        />
      </div>
    );
  }

  if (shapeType === "line") {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div
          style={{
            width: "100%",
            height: Math.max(1, borderWidth),
            background: fill,
            transform: `rotate(${rotation}deg)`,
            transformOrigin: "center",
          }}
        />
      </div>
    );
  }

  if (shapeType === "cross") {
    const strokeW = Math.max(4, borderWidth * 4);
    return (
      <div className="w-full h-full" style={{ transform: `rotate(${rotation}deg)` }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
          <line x1="8" y1="8" x2="92" y2="92" stroke={fill} strokeWidth={strokeW} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <line x1="92" y1="8" x2="8" y2="92" stroke={fill} strokeWidth={strokeW} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    );
  }

  if (shapeType === "triangle") {
    return (
      <div className="w-full h-full" style={{ transform: `rotate(${rotation}deg)` }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
          <polygon
            points="50,0 100,100 0,100"
            fill={fill}
            stroke={borderColor}
            strokeWidth={borderWidth}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    );
  }

  const polygonPoints = POLYGON_POINTS[shapeType];
  if (polygonPoints) {
    return (
      <div className="w-full h-full" style={{ transform: `rotate(${rotation}deg)` }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
          <polygon
            points={polygonPoints}
            fill={fill}
            stroke={borderColor}
            strokeWidth={borderWidth}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    );
  }

  // rectangle (default)
  return (
    <div
      className="w-full h-full"
      style={{
        ...outerStyle,
        background: fill,
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius: `${radius}px`,
        boxSizing: "border-box",
      }}
    />
  );
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

export function ShapePreview({ widget }) {
  return (
    <div className="w-full h-full overflow-visible">
      <ShapeSurface p={widget.props || {}} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function ShapePropertyPanel({ p, set }) {
  const isLineLike = p.shapeType === "line" || p.shapeType === "cross";

  return (
  <>
    <PropSection title="Shape">
      <PropInput
        label="Type"
        options={SHAPE_TYPES}
        value={p.shapeType || "rectangle"}
        onChange={v => set("shapeType", v)}
      />

      {(p.shapeType === "rectangle" || !p.shapeType) && (
        <PropInput
          label="Corner Radius"
          type="number"
          min={0}
          max={100}
          value={p.radius ?? 8}
          onChange={v => set("radius", Number(v))}
        />
      )}

      <PropInput
        label="Rotation"
        type="number"
        min={-360}
        max={360}
        value={p.rotation ?? 0}
        onChange={v => set("rotation", Number(v))}
      />
    </PropSection>

    <PropSection title="Appearance">
      <PropInput
        label={isLineLike ? "Color" : "Fill"}
        type="color"
        value={p.fill || "var(--panel-mid)"}
        onChange={v => set("fill", v)}
      />
      {!isLineLike && (
        <>
          <PropInput
            label="Border"
            type="color"
            value={p.borderColor || "var(--accent-cyan)"}
            onChange={v => set("borderColor", v)}
          />
          <PropInput
            label="Border Width"
            type="number"
            min={0}
            max={20}
            value={p.borderWidth ?? 1}
            onChange={v => set("borderWidth", Number(v))}
          />
        </>
      )}
      {p.shapeType === "line" && (
        <PropInput
          label="Thickness"
          type="number"
          min={1}
          max={40}
          value={p.borderWidth ?? 1}
          onChange={v => set("borderWidth", Number(v))}
        />
      )}
      {p.shapeType === "cross" && (
        <PropInput
          label="Thickness"
          type="number"
          min={1}
          max={20}
          value={p.borderWidth ?? 1}
          onChange={v => set("borderWidth", Number(v))}
        />
      )}
    </PropSection>
  </>
  );
}

// ────────────────────────────────────────────────────────────────
//  DYNAMIC CP PAGE — RUNTIME
// ────────────────────────────────────────────────────────────────

export function RuntimeShape({ widget }) {
  const p = widget.props || {};
  return (
    <div
      className="absolute"
      style={{ left: widget.x, top: widget.y, width: p.width, height: p.height }}
    >
      <ShapeSurface p={p} />
    </div>
  );
}
