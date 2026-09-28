/**
 * marker-row.js - renders one marker's editor card as a COLLAPSIBLE accordion:
 * a compact summary line (type badge + label + disclosure chevron, sized like
 * a scene-list row) that expands to reveal the full edit options when selected.
 *
 * Expansion is driven by selection (state.selectedMarkerId) - a single source
 * of truth that also highlights the pin / shows zone handles in the preview.
 * builder.js toggles the .is-selected class (CSS shows/hides .marker-row__details).
 *
 * Pure factory: callers pass the scene + marker + a small `actions` bag, and
 * get back a fully-wired <div>. No module-level state - every render is a
 * fresh DOM tree.
 */

import { MARKER_TYPES, isZone } from "../player-template/js/tour-model.js?v=5";
import {
  miniBtn,
  labeledInput,
  labeledTextarea,
  labeledColor,
  labeledCheckbox,
} from "./ui-dom.js";
import { createIconPicker } from "./icon-picker.js?v=1";

/**
 * @param {object} cfg
 * @param {object} cfg.scene     the scene that owns this marker
 * @param {object} cfg.marker    the marker being edited
 * @param {string|null} cfg.selectedMarkerId  expanded === selected
 * @param {object[]} cfg.scenes  all scenes (for the link target dropdown)
 * @param {boolean} cfg.guided   guided mode -> show the "required to find" toggle
 * @param {object} cfg.actions   { onReplace, onDelete, onUpdate(patch), onSelect, onToggle }
 * @returns {HTMLElement}
 */
export function renderMarkerRow({ scene, marker: m, selectedMarkerId, scenes, guided = false, actions }) {
  const selected = m.id === selectedMarkerId;
  return isZone(m)
    ? renderZoneRow({ m, selected, guided, actions })
    : renderIconRow({ scene, m, selected, scenes, guided, actions });
}

/**
 * Build the shared accordion shell: a clickable summary (badge + title +
 * chevron) plus an empty .marker-row__details container to fill. Clicking the
 * summary toggles expand/collapse (select/deselect); focusing a field inside
 * the details keeps it selected. Returns the row, the details node to append
 * editors into, and a setTitle() so the summary label can track live edits.
 */
function makeShell({ id, selected, badgeClass, badgeText, title, getFallback, actions }) {
  const fallback = getFallback || (() => "(no label)");
  const row = document.createElement("div");
  row.className = "marker-row" + (selected ? " is-selected" : "");
  row.dataset.markerId = id;

  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "marker-row__summary";
  summary.setAttribute("aria-expanded", selected ? "true" : "false");

  const badge = document.createElement("span");
  badge.className = `marker-badge ${badgeClass}`;
  badge.textContent = badgeText;

  const titleEl = document.createElement("span");
  titleEl.className = "marker-row__title";
  // Empty label falls back to something meaningful (e.g. a nav hotspot shows
  // the scene it links to) instead of a bare "(no label)".
  const setTitle = (t) => { titleEl.textContent = t?.trim() ? t : fallback(); };
  setTitle(title);

  const chevron = document.createElement("span");
  chevron.className = "marker-row__chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "\u203A"; // ›  (rotates 90deg when expanded)

  summary.append(badge, titleEl, chevron);
  summary.addEventListener("click", () => actions.onToggle?.(id));

  const details = document.createElement("div");
  details.className = "marker-row__details";
  // Tabbing/clicking into any field selects (and thus keeps expanded).
  details.addEventListener("focusin", () => actions.onSelect?.(id));

  row.append(summary, details);
  return { row, details, setTitle };
}

/** Editor for an ICON marker (link/info): label + icon + target/info + position. */
function renderIconRow({ scene, m, selected, scenes, guided, actions }) {
  const isLink = m.type === MARKER_TYPES.LINK;
  // Nav hotspots with no label show their target scene's name instead.
  const targetName = () => {
    const t = scenes.find((s) => s.id === m.targetSceneId);
    return t ? (t.name?.trim() || "(unnamed scene)") : "(no label)";
  };
  const { row, details, setTitle } = makeShell({
    id: m.id,
    selected,
    badgeClass: `marker-badge--${m.type}`,
    badgeText: isLink ? "Navigation" : "Info",
    title: m.label,
    getFallback: isLink ? targetName : undefined,
    actions,
  });

  details.append(rowActions(m, actions));
  details.append(
    labeledInput("Label", m.label, (v) => {
      actions.onUpdate(m.id, { label: v });
      setTitle(v);
    })
  );
  details.append(
    createIconPicker({
      type: m.type,
      iconId: m.icon,
      onChange: (id) => actions.onUpdate(m.id, { icon: id }),
    })
  );
  details.append(
    isLink
      ? linkTargetSelect(scene, m, scenes, actions, () => setTitle(m.label))
      : labeledTextarea("Info content (HTML allowed)", m.html, (v) =>
          actions.onUpdate(m.id, { html: v })
        )
  );
if (guided && !isLink) details.append(requiredToggle(m, actions));

  return row;
}

/** Editor for an INFO ZONE (polygon): label + info + idle-outline + hover color. */
function renderZoneRow({ m, selected, guided, actions }) {
  const { row, details, setTitle } = makeShell({
    id: m.id,
    selected,
    badgeClass: "marker-badge--zone",
    badgeText: "Info zone",
    title: m.label,
    actions,
  });
  row.classList.add("marker-row--zone");

  details.append(rowActions(m, actions, /*moveable*/ false));
  details.append(
    labeledColor("Hover color", m.hoverColor, (v) =>
      actions.onUpdate(m.id, { hoverColor: v })
    )
  );
  details.append(
    labeledInput("Label", m.label, (v) => {
      actions.onUpdate(m.id, { label: v });
      setTitle(v);
    })
  );
  details.append(
    labeledTextarea("Info content (HTML allowed)", m.html, (v) =>
      actions.onUpdate(m.id, { html: v })
    )
  );
  details.append(
    labeledCheckbox(
      "Faint outline when idle (otherwise invisible until hover)",
      m.idleStroke,
      (on) => actions.onUpdate(m.id, { idleStroke: on })
    )
  );
if (guided) details.append(requiredToggle(m, actions));

  return row;
}

/** Move (icons only) + Delete buttons for the top of a details panel. */
function rowActions(m, actions, moveable = true) {
  const bar = document.createElement("div");
  bar.className = "marker-row__actions";
  if (moveable) {
    bar.append(miniBtn("Move", "Re-place on sphere", () => actions.onReplace(m.id)));
  }
  const del = miniBtn("Delete", "Delete hotspot", () => actions.onDelete(m.id));
  del.classList.add("mini-btn--danger"); // destructive action reads red
  bar.append(del);
  return bar;
}

function linkTargetSelect(scene, m, scenes, actions, onChanged) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  wrap.innerHTML = "<span class='field__label'>Go to scene</span>";
  const select = document.createElement("select");
  select.className = "field__input";
  select.append(new Option("-- choose target --", ""));
  scenes
    .filter((s) => s.id !== scene.id)
    .forEach((s) => select.append(new Option(s.name || s.id, s.id)));
  select.value = m.targetSceneId || "";
  select.addEventListener("change", () => {
    actions.onUpdate(m.id, { targetSceneId: select.value });
    onChanged?.(); // refresh the summary title if it's falling back to the target
  });
  wrap.append(select);
  return wrap;
}

/** Guided-mode toggle: mark this info hotspot as required-to-find to progress. */
function requiredToggle(m, actions) {
  const el = labeledCheckbox(
    "Required to find (learner must open this to continue)",
    !!m.required,
    (on) => actions.onUpdate(m.id, { required: on })
  );
  el.classList.add("marker-row__required");
  return el;
}
