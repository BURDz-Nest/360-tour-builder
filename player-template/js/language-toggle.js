/**
 * language-toggle.js — dropdown pill that lets a viewer switch between tour
 * language variants. Adapted from ATLAS Coach's player-side toggle (same
 * component contract) so both apps share one interaction pattern.
 *
 * Trigger button shows the currently-active language + a caret; clicking opens
 * a small listbox of alternatives. Clicking an option (or Escape, or anywhere
 * outside) closes the menu. Purely presentational — clicking an option fires
 * `onChange(newCode)` and the caller decides what to swap; this module never
 * touches tour data.
 *
 * SRP + additive: `mountLanguageToggle()` returns null (no DOM at all) when
 * < 2 languages, so single-language tours stay pixel-identical to before
 * this feature existed.
 */

/** Native names for the language pills. English-side name is the a11y label
 *  so screen readers announce "Switch to Spanish" not "Switch to Español"
 *  (which most English screen-reader voices mangle). Add entries here as new
 *  sibling languages ship.
 *
 *  Exported so the BUILDER (language-manifest.js) can reuse this map for its
 *  Tour settings language chip popover — one source of truth for language
 *  names across authoring + runtime (DRY). */
export const LANG_LABELS = {
  en: { native: "English",   en: "English" },
  es: { native: "Español",   en: "Spanish" },
  fr: { native: "Français",  en: "French" },
  de: { native: "Deutsch",   en: "German" },
  pt: { native: "Português", en: "Portuguese" },
  zh: { native: "中文",       en: "Chinese" },
};

function labelOf(code) {
  return LANG_LABELS[code] || { native: code.toUpperCase(), en: code };
}

/**
 * Mount the dropdown. Returns { setActive, destroy } or null when there's
 * nothing to toggle.
 *
 *   languages  string[]           e.g. ["en", "es"]
 *   active     string             current language code
 *   onChange   (code) => void     fired when the viewer picks a different language
 *   mountEl    HTMLElement        where to append the toggle (default: document.body)
 */
export function mountLanguageToggle({ languages, active, onChange, mountEl }) {
  if (!Array.isArray(languages) || languages.length < 2) return null;

  let current = active;
  let open = false;

  const wrap = document.createElement("div");
  wrap.className = "lang-toggle";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "lang-toggle-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", "Change language");

  const triggerLabel = document.createElement("span");
  triggerLabel.className = "lang-toggle-trigger-label";
  const caret = document.createElement("span");
  caret.className = "lang-toggle-caret";
  caret.setAttribute("aria-hidden", "true");
  caret.textContent = "\u25BE"; // ▾
  trigger.append(triggerLabel, caret);

  const menu = document.createElement("ul");
  menu.className = "lang-toggle-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;

  const options = new Map(); // code -> <li>
  for (const code of languages) {
    const labels = labelOf(code);
    const li = document.createElement("li");
    li.className = "lang-toggle-option";
    li.setAttribute("role", "option");
    li.setAttribute("tabindex", "-1");
    li.dataset.lang = code;
    li.textContent = labels.native;
    li.title = labels.en;
    li.setAttribute("aria-label", `Switch to ${labels.en}`);
    li.addEventListener("click", () => pick(code));
    li.addEventListener("keydown", (e) => onOptionKey(e, code));
    menu.appendChild(li);
    options.set(code, li);
  }

  trigger.addEventListener("click", toggle);
  trigger.addEventListener("keydown", onTriggerKey);
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onDocKey);

  wrap.append(trigger, menu);
  (mountEl || document.body).appendChild(wrap);
  paint();

  function paint() {
    triggerLabel.textContent = labelOf(current).native;
    for (const [code, li] of options) {
      const on = code === current;
      li.classList.toggle("is-active", on);
      li.setAttribute("aria-selected", on ? "true" : "false");
    }
  }

  function setOpen(next) {
    open = next;
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
    wrap.classList.toggle("is-open", open);
    if (open) {
      // Focus the first non-active option (typical dropdown UX: current is
      // shown on the trigger; the menu shows other choices).
      const first = [...options.values()].find((li) => !li.classList.contains("is-active"))
                  || options.values().next().value;
      if (first) first.focus();
    }
  }

  function toggle() { setOpen(!open); }

  function pick(code) {
    setOpen(false);
    trigger.focus();
    if (code === current) return; // no-op re-select
    onChange(code);
  }

  function onDocClick(e) {
    if (!open) return;
    if (!wrap.contains(e.target)) setOpen(false);
  }

  function onDocKey(e) {
    if (open && e.key === "Escape") { setOpen(false); trigger.focus(); }
  }

  function onTriggerKey(e) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onOptionKey(e, code) {
    const arr = [...options.values()];
    const i = arr.indexOf(e.currentTarget);
    if (e.key === "ArrowDown") { e.preventDefault(); arr[Math.min(i + 1, arr.length - 1)].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); arr[Math.max(i - 1, 0)].focus(); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(code); }
    else if (e.key === "Escape") { setOpen(false); trigger.focus(); }
  }

  return {
    /** Update the trigger label after the caller swaps the active tour. */
    setActive(code) { current = code; paint(); },
    /** Remove the toggle from the DOM (e.g. when the player unmounts). */
    destroy() {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onDocKey);
      wrap.remove();
    },
  };
}
