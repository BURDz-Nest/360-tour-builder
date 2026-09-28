/**
 * i18n.js — tiny chrome-string dictionary for the ATLAS Explore player.
 *
 * SCOPE (deliberately narrow, YAGNI): a fresh player session always boots in
 * English chrome (see player.js — the tour's OWN content picks whatever
 * language it was authored in, but UI chrome starts English by convention,
 * same as ATLAS Coach). This dictionary only matters for chrome the learner
 * can see AFTER flipping the language toggle: the Info Zones reveal button,
 * the Mark-complete button, the info-popup default title/close label, and
 * the Areas menu. Everything else (scene names, captions, marker text,
 * guided-experience copy) is real tour CONTENT — it's translated by
 * authoring a tour-<code>.json, not by this file.
 *
 * Not covered yet (documented limitation, not a bug): the opt-in "guided
 * experience" runtime (guided.js) has its own hardcoded English chrome, and
 * the in-player language toggle is intentionally not offered on guided
 * tours (see player.js) to avoid resetting an in-progress guided run. A
 * guided tour can still ship translated content — the author points a
 * separate LMS launch / ?config= link at tour-es.json.
 */

const STRINGS = {
  en: {
    showZones: "Show Info Zones",
    hideZones: "Hide Info Zones",
    showZonesAria: "Show information zones",
    hideZonesAria: "Hide information zones",
    markComplete: "Mark complete",
    markCompleteAria: "Mark this tour complete",
    completed: "Completed \u2713",
    detailsTitle: "Details",
    closeDetails: "Close details",
    areas: "Areas",
    jumpToArea: "Jump to area",
    // Guided-experience welcome screen: fallback boilerplate ONLY, used when
    // an author leaves welcomeTitle/startButtonLabel blank (see guided.js).
    // Author-set content in the tour JSON always wins over these.
    welcomeTitled: "Welcome to {title}",
    welcomeBare: "Welcome!",
    startButton: "Start",
  },
  es: {
    showZones: "Mostrar zonas informativas",
    hideZones: "Ocultar zonas informativas",
    showZonesAria: "Mostrar zonas informativas",
    hideZonesAria: "Ocultar zonas informativas",
    markComplete: "Marcar como completo",
    markCompleteAria: "Marcar este recorrido como completo",
    completed: "Completado \u2713",
    detailsTitle: "Detalles",
    closeDetails: "Cerrar detalles",
    areas: "\u00c1reas",
    jumpToArea: "Ir a un \u00e1rea",
    welcomeTitled: "Bienvenido a {title}",
    welcomeBare: "\u00a1Bienvenido!",
    startButton: "Comenzar",
  },
};

let active = "en";

/** Switch the active chrome language. Falls back to "en" for unknown codes. */
export function setChromeLanguage(code) {
  active = STRINGS[code] ? code : "en";
}

/** Look up a chrome string, falling back to English then the key itself. */
export function t(key) {
  return STRINGS[active]?.[key] ?? STRINGS.en[key] ?? key;
}

/** Look up a chrome string for an EXPLICIT language code, ignoring the
 *  module-global `active` toggle above. Used by guided.js, which tracks its
 *  own per-boot active language rather than sharing the free-roam toggle's
 *  singleton state. Falls back to English, then the key itself. */
export function tFor(code, key) {
  return STRINGS[code]?.[key] ?? STRINGS.en[key] ?? key;
}
