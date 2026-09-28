/**
 * scorm-api.js — a tiny, no-op-safe SCORM 1.2 runtime wrapper.
 *
 * The SAME player.html runs three ways: as a plain web tour, as the builder's
 * "Preview in player", AND as a SCORM SCO inside Moodle. This wrapper is what
 * lets that be true: if it can't find an LMS API on the window chain, every
 * method becomes a silent no-op, so the normal tour is completely unaffected.
 *
 * SCORM 1.2 completion model (the only bit we need):
 *   LMSInitialize("")                                  -> "I started"
 *   LMSSetValue("cmi.core.lesson_status","completed")  -> "I'm done"
 *   LMSCommit("")                                      -> flush to the LMS
 *   LMSFinish("")                                      -> clean close (on unload)
 *
 * The LMS injects an object called `API` (SCORM 1.2) onto a parent or opener
 * window. We walk both chains to find it (the canonical ADL discovery dance).
 *
 * No imports, no DOM. Pure integration glue (SRP): player.js decides WHEN to
 * report completion; this module only knows HOW to talk to the LMS.
 */

const MAX_PARENT_HOPS = 12; // guard against pathological window chains

/**
 * Break out of an LMS's centered, max-width content column.
 *
 * Moodle (and other LMSs) render the SCO inside an <iframe>/<object> that sits
 * in a theme container capped at ~1140px and centered — which leaves our 360
 * viewer squeezed into the middle with big side gutters. Because the SCORM
 * package is unzipped onto the LMS's OWN domain, we're same-origin with the
 * parent page and may legally widen those ancestors ourselves.
 *
 * Fully defensive: does nothing when we're the top window (plain web tour), and
 * silently bails if any access throws (e.g. an unexpected cross-origin frame).
 * We only RELAX constraints (remove max-width, stretch to 100%) — never remove
 * the LMS's own header/nav, so the surrounding chrome keeps working.
 */
export function fitToLmsFrame() {
  try {
    if (window.self === window.top) return; // not embedded -> nothing to do
    const frame = window.frameElement; // throws if truly cross-origin
    if (!frame) return;
    frame.style.width = "100%";
    frame.style.maxWidth = "none";
    // Walk a bounded number of ancestors, lifting width caps as we go.
    let el = frame.parentElement;
    let hops = 0;
    while (el && el !== el.ownerDocument.body && hops < 8) {
      el.style.maxWidth = "none";
      el.style.width = "100%";
      el.style.marginLeft = "0";
      el.style.marginRight = "0";
      el.style.paddingLeft = "0";
      el.style.paddingRight = "0";
      el = el.parentElement;
      hops++;
    }
  } catch {
    /* cross-origin or unexpected DOM — leave the LMS layout untouched */
  }
}

/** Walk a window's parent chain looking for the SCORM 1.2 `API` object. */
function findAPIInChain(startWin) {
  let win = startWin;
  let hops = 0;
  while (win && hops < MAX_PARENT_HOPS) {
    try {
      if (win.API) return win.API;
    } catch {
      // Cross-origin frame access can throw — just stop climbing that way.
      return null;
    }
    if (win.parent === win) break; // reached the top
    win = win.parent;
    hops++;
  }
  return null;
}

/** Look in our own parent chain, then the opener's chain (popup launches). */
function locateAPI() {
  try {
    let api = findAPIInChain(window);
    if (!api && window.opener) api = findAPIInChain(window.opener);
    return api;
  } catch {
    return null;
  }
}

/**
 * Create the SCORM controller. Call once on player load.
 * @returns {{
 *   present: boolean,
 *   init(): boolean,
 *   complete(): void,
 *   setScore(raw:number, min?:number, max?:number): void,
 *   finish(): void,
 *   isCompleted(): boolean
 * }}
 */
export function createScorm() {
  const api = locateAPI();
  const present = !!api;
  let initialized = false;
  let completed = false;

  function init() {
    if (!present || initialized) return initialized;
    try {
      initialized = api.LMSInitialize("") === "true";
      if (initialized) {
        // Flip a fresh/unknown attempt to "incomplete" so the LMS shows the
        // learner as in-progress the moment they open the tour.
        const status = api.LMSGetValue("cmi.core.lesson_status");
        if (!status || status === "not attempted" || status === "unknown") {
          api.LMSSetValue("cmi.core.lesson_status", "incomplete");
          api.LMSCommit("");
        }
        // Always leave the session cleanly, or Moodle may mark it abandoned.
        window.addEventListener("pagehide", finish);
        window.addEventListener("beforeunload", finish);
      }
    } catch (e) {
      console.warn("[scorm] LMSInitialize failed", e);
    }
    return initialized;
  }

  function complete() {
    if (!present || completed) return;
    if (!initialized && !init()) return;
    try {
      api.LMSSetValue("cmi.core.lesson_status", "completed");
      api.LMSCommit("");
      completed = true;
      console.log("[scorm] marked completed");
    } catch (e) {
      console.warn("[scorm] complete failed", e);
    }
  }

  // Optional: report a raw score (0-100 by default). Not used for pass/fail
  // here — completion is the signal — but handy for future quiz-style tours.
  function setScore(raw, min = 0, max = 100) {
    if (!present) return;
    if (!initialized && !init()) return;
    try {
      api.LMSSetValue("cmi.core.score.min", String(min));
      api.LMSSetValue("cmi.core.score.max", String(max));
      api.LMSSetValue("cmi.core.score.raw", String(raw));
      api.LMSCommit("");
    } catch (e) {
      console.warn("[scorm] setScore failed", e);
    }
  }

  function finish() {
    if (!present || !initialized) return;
    try {
      api.LMSCommit("");
      api.LMSFinish("");
    } catch (e) {
      console.warn("[scorm] finish failed", e);
    }
    initialized = false;
  }

  return {
    present,
    init,
    complete,
    setScore,
    finish,
    isCompleted: () => completed,
  };
}
