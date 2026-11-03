// src/widgets/pageBackground.jsx
//
// Page background setting, stored on a page as `background: { mode: "theme" | "custom", color }`.
//   theme  -> follows the software theme (dark / light) through the --bg-canvas token   (default)
//   custom -> a fixed colour picked in the Page Builder
// Used by the Page Builder canvas and by the runtime (Dynamic page + popup windows).
import { PropInput } from "./shared";

export const THEME_BACKGROUND = "var(--bg-canvas)";

export function isCustomBackground(background) {
  return background?.mode === "custom" && !!background?.color;
}

export function pageBackgroundCss(background) {
  return isCustomBackground(background) ? background.color : THEME_BACKGROUND;
}

// Toolbar control: [Software theme | Custom] + colour picker.
export function PageBackgroundControl({ background, onChange }) {
  const custom = isCustomBackground(background) || background?.mode === "custom";
  const color = background?.color || "#1C1C1E";
  const pill = (active) =>
    `h-7 px-2.5 text-[10px] font-bold whitespace-nowrap transition-colors ${
      active ? "bg-[var(--accent-green)]/15 text-[var(--accent-green)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
    }`;
  return (
    <div className="flex items-center gap-1.5 shrink-0" title="Page background: follow the software theme, or pick your own colour">
      <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Background</span>
      <div className="flex items-center rounded border border-[var(--border)] overflow-hidden">
        <button type="button" className={pill(!custom)} onClick={() => onChange({ mode: "theme", color })}>Software theme</button>
        <button type="button" className={pill(custom)} onClick={() => onChange({ mode: "custom", color })}>Custom</button>
      </div>
      {custom && (
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#1C1C1E"}
          onChange={(e) => onChange({ mode: "custom", color: e.target.value })}
          className="w-7 h-7 p-0 rounded border border-[var(--border)] bg-transparent cursor-pointer"
          aria-label="Background colour"
        />
      )}
    </div>
  );
}
