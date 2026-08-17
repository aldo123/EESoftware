// src/widgets/textbox.jsx
//
// Everything about the "textbox" widget lives in this one file:
//   - TextBoxDef            palette entry (label/icon/desc/defaultProps) for the Page Builder sidebar
//   - TextBoxPreview        how it looks on the Page Builder canvas (design-time)
//   - TextBoxPropertyPanel  the property panel shown when this widget is selected
//   - RuntimeTextBox        how it looks/behaves on the live Dynamic CP Page
//
import { PropInput, PropSection, TEXTBOX_ICONS, getVisual, DEFAULT_VISUAL } from "./shared";

// ────────────────────────────────────────────────────────────────
//  PALETTE DEFINITION
// ────────────────────────────────────────────────────────────────

export const textboxDef = {
    type: "textbox",
    label: "Text Box",
    icon: "T",
    desc: "Static text display",
    defaultProps: {
      text: "TEXT",
      variable: "",
      icon: "",
      iconPosition: "left",
      iconSize: 20,
      iconGap: 8,
      fontSize: 18,
      fontWeight: "600",
      textColor: "#FFFFFF",
      iconColor: "#FFFFFF",
      textAlign: "center",
      verticalAlign: "center",
      backgroundColor: "transparent",
      borderColor: "transparent",
      borderWidth: 0,
      radius: 6,
      padding: 8,
      width: 220,
      height: 60,
      rotation: 0,
      visual: { ...DEFAULT_VISUAL }
    }
  };

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — CANVAS PREVIEW
// ────────────────────────────────────────────────────────────────

export function TextBoxPreview({ widget }) {
  const p = widget.props || {};

  const textValue = p.text ?? "TEXT";
  const icon = p.icon || "";
  const iconPosition = p.iconPosition || "left";
  const iconSize = Number(p.iconSize ?? 20);
  const fontSize = Number(p.fontSize ?? 18);
  const fontWeight = p.fontWeight || "600";
  const textColor = p.textColor || "#FFFFFF";
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
      className="relative w-full h-full"
      style={{
        background: backgroundColor,
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius: `${radius}px`,
        padding: `${padding}px`,
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
          {textValue}
        </span>
      </div>

      {icon && iconPosition === "left" && (
        <div
          className="absolute inset-y-0 left-0 flex items-center pointer-events-none"
          style={{ paddingLeft: `${padding}px` }}
        >
          <span style={{
            color: iconColor,
            fontSize: `${iconSize}px`,
            lineHeight: 1
          }}>
            {icon}
          </span>
        </div>
      )}

      {icon && iconPosition === "right" && (
        <div
          className="absolute inset-y-0 right-0 flex items-center pointer-events-none"
          style={{ paddingRight: `${padding}px` }}
        >
          <span style={{
            color: iconColor,
            fontSize: `${iconSize}px`,
            lineHeight: 1
          }}>
            {icon}
          </span>
        </div>
      )}

      {icon && iconPosition === "center" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span style={{
            color: iconColor,
            fontSize: `${iconSize}px`,
            lineHeight: 1
          }}>
            {icon}
          </span>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — PROPERTY PANEL
// ────────────────────────────────────────────────────────────────

export function TextBoxPropertyPanel({ p, set }) {
  return (
  <>
    <PropSection title="Data Binding">
      <PropInput
        label="Variable"
        value={p.variable || ""}
        onChange={v => set("variable", v)}
      />
      <div className="text-[8px] text-[var(--text-dim)] mt-0.5">
        When a variable is assigned, runtime displays its current value.
      </div>
      <PropInput
        label="Default Text"
        value={p.text || "TEXT"}
        onChange={v => set("text", v)}
      />
    </PropSection>

    <PropSection title="Icon">
      <PropInput
        label="Icon"
        options={TEXTBOX_ICONS.map(item => ({
          value: item.value,
          label: item.icon ? `${item.icon}  ${item.label}` : item.label
        }))}
        value={p.icon || ""}
        onChange={v => set("icon", v)}
      />
      <PropInput
        label="Position"
        options={[
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
          { value: "right", label: "Right" }
        ]}
        value={p.iconPosition || "left"}
        onChange={v => set("iconPosition", v)}
      />
      <div className="grid grid-cols-2 gap-2">
        <PropInput
          label="Icon Size"
          type="number"
          min={8}
          max={64}
          value={p.iconSize ?? 20}
          onChange={v => set("iconSize", Number(v))}
        />
        <PropInput
          label="Icon Gap"
          type="number"
          min={0}
          max={40}
          value={p.iconGap ?? 8}
          onChange={v => set("iconGap", Number(v))}
        />
      </div>
    </PropSection>

    <PropSection title="Text">
      <div className="grid grid-cols-2 gap-2">
        <PropInput
          label="Font Size"
          type="number"
          min={8}
          max={72}
          value={p.fontSize ?? 18}
          onChange={v => set("fontSize", Number(v))}
        />
        <PropInput
          label="Weight"
          options={[
            { value: "400", label: "Normal" },
            { value: "500", label: "Medium" },
            { value: "600", label: "Semi Bold" },
            { value: "700", label: "Bold" }
          ]}
          value={p.fontWeight || "600"}
          onChange={v => set("fontWeight", v)}
        />
      </div>

      <PropInput
        label="Alignment"
        options={[
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
          { value: "right", label: "Right" }
        ]}
        value={p.textAlign || "center"}
        onChange={v => set("textAlign", v)}
      />
    </PropSection>

    <PropSection title="Appearance">
      <PropInput
        label="Text Color"
        type="color"
        value={p.textColor || "#FFFFFF"}
        onChange={v => set("textColor", v)}
      />
      <PropInput
        label="Icon Color"
        type="color"
        value={p.iconColor || "#FFFFFF"}
        onChange={v => set("iconColor", v)}
      />
      <PropInput
        label="Background"
        type="color"
        value={p.backgroundColor || "var(--panel-canvas)"}
        onChange={v => set("backgroundColor", v)}
      />
      <PropInput
        label="Border"
        type="color"
        value={p.borderColor || "var(--panel-mid)"}
        onChange={v => set("borderColor", v)}
      />
      <div className="grid grid-cols-2 gap-2">
        <PropInput
          label="Border Width"
          type="number"
          min={0}
          max={20}
          value={p.borderWidth ?? 0}
          onChange={v => set("borderWidth", Number(v))}
        />
        <PropInput
          label="Radius"
          type="number"
          min={0}
          max={50}
          value={p.radius ?? 6}
          onChange={v => set("radius", Number(v))}
        />
      </div>
      <PropInput
        label="Padding"
        type="number"
        min={0}
        max={40}
        value={p.padding ?? 8}
        onChange={v => set("padding", Number(v))}
      />
    </PropSection>
  </>
  );
}

// ────────────────────────────────────────────────────────────────
//  DYNAMIC CP PAGE — RUNTIME
// ────────────────────────────────────────────────────────────────

export function RuntimeTextBox({ widget, value }) {
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
