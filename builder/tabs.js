/**
 * tabs.js - a tiny, accessible tab controller (WCAG 2.2 AA).
 *
 * PURE-ish: no app state, no PSV. You hand it pairs of {tab button, panel}
 * and it wires:
 *   - click to switch
 *   - roving tabindex + Arrow/Home/End keyboard nav (WAI-ARIA tabs pattern)
 *   - aria-selected / hidden bookkeeping
 *   - optional localStorage persistence so the chosen tab survives reloads
 *
 * SOLID: this knows nothing about scenes or settings - it just toggles
 * visibility. Callers decide what lives in each panel.
 */

/**
 * @param {object} cfg
 * @param {Array<{tab: HTMLElement, panel: HTMLElement}>} cfg.pairs
 * @param {string} [cfg.storageKey]  persist the active tab id under this key
 */
export function mountTabs({ pairs, storageKey }) {
  if (!pairs?.length) return;

  const activate = (idx, focus = false) => {
    pairs.forEach(({ tab, panel }, i) => {
      const on = i === idx;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1; // roving tabindex
      panel.hidden = !on;
    });
    if (focus) pairs[idx].tab.focus();
    if (storageKey) {
      try { localStorage.setItem(storageKey, pairs[idx].tab.id); } catch { /* private mode */ }
    }
  };

  pairs.forEach(({ tab }, idx) => {
    tab.addEventListener("click", () => activate(idx));
    tab.addEventListener("keydown", (e) => {
      const last = pairs.length - 1;
      let next = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = idx === last ? 0 : idx + 1;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = idx === 0 ? last : idx - 1;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = last;
      if (next !== null) {
        e.preventDefault();
        activate(next, true);
      }
    });
  });

  // Restore persisted choice, else default to the first tab.
  let start = 0;
  if (storageKey) {
    try {
      const savedId = localStorage.getItem(storageKey);
      const found = pairs.findIndex(({ tab }) => tab.id === savedId);
      if (found >= 0) start = found;
    } catch { /* ignore */ }
  }
  activate(start);

  // Let callers jump programmatically (e.g. focus Settings from a button).
  return { show: (tabId) => {
    const i = pairs.findIndex(({ tab }) => tab.id === tabId);
    if (i >= 0) activate(i);
  }};
}
