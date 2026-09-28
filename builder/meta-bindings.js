/**
 * meta-bindings.js — wires the Tour Settings panel's plain input/checkbox
 * fields (title/description/author/display toggles/guided-experience config)
 * to `state.tour.meta`.
 *
 * Pulled out of builder.js purely to keep that controller under the
 * 600-line guideline (SRP: one place owns "meta form -> state" for this
 * cohesive chunk of fields). Everything here is DOM wiring only — no
 * rendering back OUT of state (that's renderAll()'s job in builder.js).
 */
export function bindMetaFields({
  $, state, bindInput, ensureExperience, reflectExperience, renderMarkerList, applyShadowPref,
}) {
  bindInput("meta-title", (v) => (state.tour.meta.title = v));
  bindInput("meta-description", (v) => (state.tour.meta.description = v));
  bindInput("meta-author", (v) => (state.tour.meta.author = v));
  $("meta-show-thumbnails").addEventListener("change", (e) => (state.tour.meta.showThumbnails = e.target.checked));
  $("meta-show-waypoint-shadows").addEventListener("change", (e) => {
    state.tour.meta.showWaypointShadows = e.target.checked;
    applyShadowPref();
  });
  $("meta-show-info-zones").addEventListener("change", (e) => (state.tour.meta.showInfoZones = e.target.checked));
  $("meta-show-hints").addEventListener("change", (e) => (state.tour.meta.showHotspotHints = e.target.checked));

  // Guided experience (opt-in linear mode).
  $("meta-exp-enabled").addEventListener("change", (e) => {
    ensureExperience();
    state.tour.meta.experience.enabled = e.target.checked;
    reflectExperience();
    renderMarkerList(); // "required" checkboxes appear/disappear with the mode
  });
  $("meta-exp-startscreen").addEventListener("change", (e) => { ensureExperience(); state.tour.meta.experience.showStartScreen = e.target.checked; });
  bindInput("meta-exp-welcome-title", (v) => { ensureExperience(); state.tour.meta.experience.welcomeTitle = v; });
  bindInput("meta-exp-welcome-body", (v) => { ensureExperience(); state.tour.meta.experience.welcomeBody = v; });
  bindWelcomeToolbar($);
  bindInput("meta-exp-start-label", (v) => { ensureExperience(); state.tour.meta.experience.startButtonLabel = v; });
  $("meta-exp-skipping").addEventListener("change", (e) => { ensureExperience(); state.tour.meta.experience.allowSkipping = e.target.checked; });
  bindInput("meta-exp-title", (v) => { ensureExperience(); state.tour.meta.experience.completionTitle = v; });
  bindInput("meta-exp-message", (v) => { ensureExperience(); state.tour.meta.experience.completionMessage = v; });
}

/**
 * Wire the tiny Bold/Bullet toolbar above the Welcome instructions textarea.
 * Both buttons manipulate the textarea's own selection directly (classic
 * markdown-toolbar pattern) then fire a synthetic "input" event so the
 * existing bindInput("meta-exp-welcome-body", ...) listener above picks up
 * the change — no separate state-writing path to keep in sync.
 */
function bindWelcomeToolbar($) {
  $("wb-bold").addEventListener("click", () => wrapSelection($("meta-exp-welcome-body"), "**"));
  $("wb-bullet").addEventListener("click", () => toggleBulletLines($("meta-exp-welcome-body")));
}

function fireInput(textarea) {
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
}

/** Wrap the current selection in `mark` (or insert a placeholder if nothing's
 *  selected), then re-select the wrapped text so repeated clicks toggle nicely. */
function wrapSelection(textarea, mark) {
  const { selectionStart: s, selectionEnd: e, value } = textarea;
  const selected = value.slice(s, e) || "bold text";
  textarea.value = value.slice(0, s) + mark + selected + mark + value.slice(e);
  textarea.setSelectionRange(s + mark.length, s + mark.length + selected.length);
  fireInput(textarea);
}

/** Toggle a "- " bullet prefix on every line touched by the current selection
 *  (or just the current line, if nothing's selected). If every touched line
 *  is already bulleted, this REMOVES the bullets instead — standard toggle
 *  behavior so the same button adds or clears formatting. */
function toggleBulletLines(textarea) {
  const { selectionStart: s, selectionEnd: e, value } = textarea;
  const lineStart = value.lastIndexOf("\n", s - 1) + 1;
  const nextBreak = value.indexOf("\n", e);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const allBulleted = lines.every((l) => l.trim() === "" || l.startsWith("- "));
  const toggled = lines
    .map((l) => {
      if (l.trim() === "") return l;
      return allBulleted ? l.replace(/^- /, "") : l.startsWith("- ") ? l : `- ${l}`;
    })
    .join("\n");
  textarea.value = value.slice(0, lineStart) + toggled + value.slice(lineEnd);
  textarea.setSelectionRange(lineStart, lineStart + toggled.length);
  fireInput(textarea);
}
