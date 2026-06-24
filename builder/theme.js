/**
 * theme.js - Light/dark theme toggle for the builder UI.
 *
 * Single source of truth for the active theme. The CSS handles everything via
 * [data-theme="dark"] overrides on <html>; this module just flips the
 * attribute and persists the user's choice.
 *
 * Initial theme resolution:
 *   1. localStorage value (user's explicit pick wins)
 *   2. prefers-color-scheme: dark (system preference)
 *   3. default to light
 */

const STORAGE_KEY = "tour-builder.theme";
const VALID = new Set(["light", "dark"]);

// Inline SVG glyphs for the toggle button. currentColor inherits theme ink.
const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const ICON_SUN  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';

export function resolveInitialTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && VALID.has(saved)) return saved;
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

export function applyTheme(theme) {
  const t = VALID.has(theme) ? theme : "light";
  document.documentElement.setAttribute("data-theme", t);
}

/** Wire the topbar toggle button. Pass the <button> and an icon-host span. */
export function bindThemeToggle(btn, iconHost) {
  const paint = () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    // Show the icon for the theme you'd switch TO (clearer affordance).
    iconHost.innerHTML = current === "dark" ? ICON_SUN : ICON_MOON;
    btn.setAttribute(
      "aria-label",
      current === "dark" ? "Switch to light mode" : "Switch to dark mode"
    );
    btn.title = btn.getAttribute("aria-label");
  };
  btn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
    paint();
  });
  paint();
}
