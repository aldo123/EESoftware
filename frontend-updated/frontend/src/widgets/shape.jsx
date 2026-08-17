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
//  PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

export function ShapePreview({ widget }) {
  const p = widget.props || {};

  const shapeType = p.shapeType || "rectangle";
  const fill = p.fill || "transparent";
  const borderColor = p.borderColor || "var(--accent-cyan)";
  const borderWidth = Math.max(0, Number(p.borderWidth ?? 1));
  const radius = Math.max(0, Number(p.radius ?? 8));
  const rotation = Number(p.rotation ?? 0);

  const baseStyle = {
    width: "100%",
    height: "100%",
    background: fill,
    border: `${borderWidth}px solid ${borderColor}`,
    transform: `rotate(${rotation}deg)`,
    transition: "all 0.2s ease"
  };

  if (shapeType === "circle") {
    return (
      <div className="w-full h-full flex items-center justify-center overflow-visible">
        <div
          style={{
            ...baseStyle,
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            boxSizing: "border-box"
          }}
        />
      </div>
    );
  }

  if (shapeType === "ellipse") {
    return (
      <div className="w-full h-full flex items-center justify-center overflow-visible">
        <div
          style={{
            ...baseStyle,
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            boxSizing: "border-box"
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
            background: borderColor,
            transform: `rotate(${rotation}deg)`,
            transformOrigin: "center"
          }}
        />
      </div>
    );
  }

  if (shapeType === "triangle") {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div
          style={{
            width: "100%",
            height: "100%",
            background: fill,
            clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)",
            transform: `rotate(${rotation}deg)`,
            boxSizing: "border-box"
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="w-full h-full"
      style={{
        ...baseStyle,
        borderRadius: `${radius}px`,
        boxSizing: "border-box"
      }}
    />
  );
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function ShapePropertyPanel({ p, set }) {
  return (
  <>
    <PropSection title="Shape">
      <PropInput
        label="Type"
        options={[
          { value: "rectangle", label: "Rectangle" },
          { value: "circle", label: "Circle" },
          { value: "ellipse", label: "Ellipse" },
          { value: "triangle", label: "Triangle" },
          { value: "line", label: "Line" }
        ]}
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
        label="Fill"
        type="color"
        value={p.fill || "var(--panel-mid)"}
        onChange={v => set("fill", v)}
      />
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
    </PropSection>
  </>
  );
}

// ────────────────────────────────────────────────────────────────
//  DYNAMIC CP PAGE — RUNTIME
// ────────────────────────────────────────────────────────────────

export function RuntimeShape({ widget }) {
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
