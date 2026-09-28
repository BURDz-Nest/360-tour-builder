/**
 * language-manifest.js — builder-side multi-language plumbing.
 *
 * Bridges two surfaces so `tour.languages` stays a pure derivative of what's
 * on disk (authors NEVER edit the field manually):
 *   1. Filesystem  - listLanguageSiblings() reads `tour-<code>.json` files
 *   2. Tour model  - reconciles `tour.languages` array to match reality
 *   3. Meta panel  - re-renders the read-only chip + click-open popover
 *
 * (The runtime player's live-preview language staging lives in
 * builder-io.js's previewInPlayer() — this module only owns the FILE SYSTEM
 * scan + the Tour settings chip, matching where those concerns already live
 * in this codebase.)
 *
 * Pulled out of builder.js to keep that controller under the 600-line
 * ceiling and to isolate a feature that can be iterated on without touching
 * the conductor (see ARCHITECTURE.md "Multi-language").
 */

import { listLanguageSiblings } from "./fs-workspace.js?v=6";
import { LANG_LABELS } from "../player-template/js/language-toggle.js?v=1";

/**
 * Re-scan the tour folder for sibling `tour-<code>.json` files and reconcile
 * `state.tour.languages` against what's on disk. Returns true if the
 * reconciled `languages` field differs from what was there before (the
 * caller should markDirty()/let autosave pick it up — record()/autosave
 * already run frequently enough elsewhere that no extra hook is needed here).
 *
 * Never throws. A missing folder / broken sibling logs a warning and behaves
 * as if no siblings were found — the primary tour always keeps working.
 */
export async function refreshLanguageSiblings(state, $) {
  if (!state.dirHandle || !state.tour) return false;
  let siblings = {};
  try { siblings = await listLanguageSiblings(state.dirHandle); } catch (e) { console.warn(e); }
  state.languageSiblings = siblings;
  const declared = Array.isArray(state.tour.languages) ? state.tour.languages : ["en"];
  const detected = ["en", ...Object.keys(siblings).sort()];
  const changed = declared.length !== detected.length
               || declared.some((c, i) => c !== detected[i]);
  if (changed) state.tour.languages = detected;
  renderLanguageChip($, siblings);
  return changed;
}

/**
 * Bind ONE-TIME event listeners to the chip (click to toggle popover, outside
 * click / Escape to close). Idempotent — safe to call multiple times but only
 * wires up handlers on the first call. Called during builder init so the
 * chip is interactive before the first tour is even loaded.
 */
let chipBound = false;
export function initLanguageChip($) {
  if (chipBound) return;
  const chip = $("meta-lang-chip");
  const pop = $("meta-lang-pop");
  if (!chip || !pop) return;
  chipBound = true;

  chip.addEventListener("click", (e) => {
    e.stopPropagation(); // don't trigger the doc-click that closes it
    const open = chip.getAttribute("aria-expanded") === "true";
    setOpen(chip, pop, !open);
  });
  document.addEventListener("click", (e) => {
    // Close if the click landed outside both the chip AND the popover.
    if (chip.getAttribute("aria-expanded") !== "true") return;
    if (chip.contains(e.target) || pop.contains(e.target)) return;
    setOpen(chip, pop, false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && chip.getAttribute("aria-expanded") === "true") {
      setOpen(chip, pop, false);
      chip.focus();
    }
  });
}

function setOpen(chip, pop, open) {
  chip.setAttribute("aria-expanded", open ? "true" : "false");
  pop.hidden = !open;
}

/**
 * Re-draw the chip LABEL and popover CONTENT from the current siblings map.
 * Idempotent — safe to call on every open/focus. Does NOT re-attach
 * listeners (initLanguageChip does that once).
 */
export function renderLanguageChip($, siblings) {
  const chip = $("meta-lang-chip");
  const pop = $("meta-lang-pop");
  if (!chip || !pop) return;
  const codes = Object.keys(siblings).sort();
  const total = 1 + codes.length; // primary + siblings

  chip.dataset.state = codes.length ? "multi" : "solo";
  chip.textContent = codes.length === 0 ? "English only" : `${total} Languages`;

  const rows = [
    row("en", "tour.json"),
    ...codes.map((c) => row(c, `tour-${c}.json`)),
  ];
  pop.replaceChildren();
  const kids = [
    mk("h3", "lang-pop-title", codes.length === 0 ? "This tour is English only" : `${total} languages detected`),
    listOf(rows),
  ];
  if (codes.length === 0) {
    kids.push(mk("p", "lang-pop-hint",
      "Drop a tour-es.json (or tour-fr.json, etc.) file next to tour.json in this folder to add a language.",
    ));
  }
  pop.append(...kids);
}

/** Compose one <li> row for the popover language list. English (tour.json)
 *  sits at the top of the list by convention — no "primary" tag needed. */
function row(code, filename) {
  const labels = LANG_LABELS[code] || { native: code.toUpperCase(), en: code };
  const li = mk("li", "lang-pop-row");
  const name = mk("span", "lang-pop-name", labels.native);
  const meta = mk("span", "lang-pop-meta", filename);
  li.append(name, meta);
  return li;
}

function listOf(rows) {
  const ul = mk("ul", "lang-pop-list");
  rows.forEach((r) => ul.appendChild(r));
  return ul;
}

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
