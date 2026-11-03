// src/widgets/stateStyle.jsx
//
// "State Styles": conditional appearance for a widget, driven by Internal Variables.
//
// A widget carries an ordered list of rules in `props.stateStyles`:
//
//   { variable: "BT_State", operator: "equals", value: "FAIL",
//     text: "FAIL", textColor: "#FF453A", backgroundColor: "#3A2222", borderColor: "#6B2B2B" }
//
// The FIRST rule whose condition currently holds wins; its style fields override the widget's
// normal props. `text` / `label` may embed other variables as {VarName}, e.g. "Starting in {BT_Countdown}s".
// A widget without rules behaves exactly as before.
import { useInternalVariables } from "../hooks/useInternalVariables";
import { PropInput, PropSection } from "./shared";

export const STATE_OPERATORS = [
  { value: "equals", label: "=" },
  { value: "not_equals", label: "≠" },
  { value: "greater", label: ">" },
  { value: "greater_equal", label: "≥" },
  { value: "less", label: "<" },
  { value: "less_equal", label: "≤" },
];

const asNumber = (x) =>
  x === "" || x === null || x === undefined || typeof x === "boolean" ? NaN : Number(x);

const asText = (x) => String(x ?? "").trim().toLowerCase();

export function stateRuleMatches(current, operator, target) {
  const a = asNumber(current);
  const b = asNumber(target);
  const numeric = Number.isFinite(a) && Number.isFinite(b);
  const equal = numeric ? a === b : asText(current) === asText(target);

  switch (operator) {
    case "not_equals": return !equal;
    case "greater": return numeric && a > b;
    case "greater_equal": return numeric && a >= b;
    case "less": return numeric && a < b;
    case "less_equal": return numeric && a <= b;
    default: return equal;
  }
}

const fillTemplate = (text, getValue) =>
  String(text).replace(/\{([A-Za-z0-9_]+)\}/g, (_, name) => {
    const v = getValue(name);
    return v === undefined || v === null ? "" : String(v);
  });

// Pure evaluation (usable inside components that already read Internal Variables).
export function evalStateStyle(rules, getValue) {
  if (!Array.isArray(rules) || !rules.length) return null;

  for (const rule of rules) {
    if (!rule || !String(rule.variable || "").trim()) continue;
    if (!stateRuleMatches(getValue(rule.variable), rule.operator || "equals", rule.value)) continue;

    const out = { ...rule };
    ["text", "label"].forEach((k) => {
      if (typeof out[k] === "string") out[k] = fillTemplate(out[k], getValue);
    });
    return out;
  }
  return null;
}

export function useStateStyle(rules) {
  const { getValue } = useInternalVariables();
  return evalStateStyle(rules, getValue);
}

export const hasStateStyles = (props) =>
  Array.isArray(props?.stateStyles) && props.stateStyles.length > 0;

// ────────────────────────────────────────────────────────────────
//  PAGE BUILDER — rule editor
//  fields: [{ key, label, type: "text" | "color" | "checkbox" }]
// ────────────────────────────────────────────────────────────────
export function StateStylesEditor({ rules, onChange, fields }) {
  const list = Array.isArray(rules) ? rules : [];
  const { variables = [] } = useInternalVariables();

  const update = (index, patch) => onChange(list.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const remove = (index) => onChange(list.filter((_, i) => i !== index));
  const move = (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <PropSection title="State Styles">
      <div className="text-[8px] text-[var(--text-dim)]">
        The first rule that matches wins; its fields replace the normal appearance. Text may use {"{VariableName}"}.
      </div>

      {list.map((rule, index) => (
        <div key={index} className="flex flex-col gap-1.5 p-2 rounded border border-[var(--border)] bg-[var(--bg-canvas)]/40">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Rule {index + 1}</span>
            <span className="flex gap-1">
              <button type="button" onClick={() => move(index, -1)} className="text-[10px] px-1 text-[var(--text-dim)] hover:text-[var(--text-primary)]">↑</button>
              <button type="button" onClick={() => move(index, 1)} className="text-[10px] px-1 text-[var(--text-dim)] hover:text-[var(--text-primary)]">↓</button>
              <button type="button" onClick={() => remove(index)} className="text-[10px] px-1 text-red-400 hover:text-red-300">✕</button>
            </span>
          </div>

          <div>
            <label className="block text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">When variable</label>
            <select
              value={rule.variable || ""}
              onChange={(e) => update(index, { variable: e.target.value })}
              className="w-full h-7 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none"
            >
              <option value="">Select variable...</option>
              {variables.map((v) => (
                <option key={v.id} value={v.name}>{v.name} ({v.data_type})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <PropInput
              label="Operator"
              options={STATE_OPERATORS}
              value={rule.operator || "equals"}
              onChange={(v) => update(index, { operator: v })}
            />
            <PropInput label="Value" value={rule.value ?? ""} onChange={(v) => update(index, { value: v })} />
          </div>

          {fields.map((f) => (
            <PropInput
              key={f.key}
              label={f.label}
              type={f.type || "text"}
              value={f.type === "checkbox" ? rule[f.key] === true : (rule[f.key] ?? "")}
              onChange={(v) => update(index, { [f.key]: v })}
            />
          ))}
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...list, { variable: "", operator: "equals", value: "" }])}
        className="h-7 rounded border border-dashed border-[var(--border)] text-[10px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-green)]/60"
      >
        + Add rule
      </button>
    </PropSection>
  );
}

// ────────────────────────────────────────────────────────────────
//  VISIBLE WHEN — any widget can be shown only while ALL of its conditions hold
//  props.visibleWhen = [{ variable, operator, value }, ...]
// ────────────────────────────────────────────────────────────────
export function widgetIsVisible(props, getValue) {
  const conditions = props?.visibleWhen;
  if (!Array.isArray(conditions) || !conditions.length) return true;
  return conditions.every(
    (c) => !c?.variable || stateRuleMatches(getValue(c.variable), c.operator || "equals", c.value)
  );
}

// ── Page Builder preview filter ──
// The editor shows every widget, so a page built from several "Visible When" screens piles up.
// The filter lets the designer pick a value per variable; widgets whose conditions fail for the picked
// values are hidden in the editor only. A variable left on "any" never hides anything.
export function previewVariables(widgets) {
  const found = {};
  (widgets || []).forEach((w) => {
    (w?.props?.visibleWhen || []).forEach((c) => {
      if (!c?.variable) return;
      const key = String(c.variable);
      found[key] = found[key] || new Set();
      if (String(c.value ?? "") !== "") found[key].add(String(c.value));
    });
  });
  return Object.entries(found)
    .map(([name, values]) => ({ name, values: [...values] }))
    .filter((v) => v.values.length > 0);
}

export function widgetVisibleInPreview(widget, assumed) {
  const conditions = widget?.props?.visibleWhen;
  if (!Array.isArray(conditions) || !conditions.length) return true;
  return conditions.every((c) => {
    const picked = assumed?.[c?.variable];
    return !c?.variable || picked === undefined || picked === "" || stateRuleMatches(picked, c.operator || "equals", c.value);
  });
}

export function PreviewFilter({ widgets, assumed, onChange }) {
  const vars = previewVariables(widgets);
  if (!vars.length) return null;
  return (
    <div className="flex items-center gap-1.5" title="Editor only: hide widgets that are not visible for the chosen values">
      <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Preview</span>
      {vars.map((v) => (
        <select
          key={v.name}
          value={assumed?.[v.name] || ""}
          onChange={(e) => onChange({ ...assumed, [v.name]: e.target.value })}
          className="h-7 px-1.5 rounded border border-[var(--border)] bg-[var(--bg-canvas)] text-[var(--text-primary)] text-[9px] font-mono outline-none"
        >
          <option value="">{v.name}: any</option>
          {v.values.map((val) => <option key={val} value={val}>{v.name} = {val}</option>)}
        </select>
      ))}
    </div>
  );
}

export function VisibleWhenEditor({ p, set }) {
  const list = Array.isArray(p.visibleWhen) ? p.visibleWhen : [];
  const { variables = [] } = useInternalVariables();
  const update = (index, patch) => set("visibleWhen", list.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  return (
    <PropSection title="Visible When">
      <div className="text-[8px] text-[var(--text-dim)]">
        Show this widget only while ALL conditions are true. No conditions = always visible.
      </div>
      {list.map((c, index) => (
        <div key={index} className="flex flex-col gap-1.5 p-2 rounded border border-[var(--border)] bg-[var(--bg-canvas)]/40">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Condition {index + 1}</span>
            <button type="button" onClick={() => set("visibleWhen", list.filter((_, i) => i !== index))} className="text-[10px] px-1 text-red-400 hover:text-red-300">✕</button>
          </div>
          <select
            value={c.variable || ""}
            onChange={(e) => update(index, { variable: e.target.value })}
            className="w-full h-7 px-2 rounded border border-[var(--border)] bg-[var(--panel-canvas)] text-[var(--text-primary)] text-[10px] font-mono outline-none"
          >
            <option value="">Select variable...</option>
            {variables.map((v) => (
              <option key={v.id} value={v.name}>{v.name} ({v.data_type})</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <PropInput label="Operator" options={STATE_OPERATORS} value={c.operator || "equals"} onChange={(v) => update(index, { operator: v })} />
            <PropInput label="Value" value={c.value ?? ""} onChange={(v) => update(index, { value: v })} />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => set("visibleWhen", [...list, { variable: "", operator: "equals", value: "" }])}
        className="h-7 rounded border border-dashed border-[var(--border)] text-[10px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-green)]/60"
      >
        + Add condition
      </button>
    </PropSection>
  );
}
