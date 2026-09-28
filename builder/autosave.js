// autosave.js — quietly persists the open tour's tour.json to its folder.
//
// WHY A MODULE: builder.js is pinned at the ~600-line guideline, and autosave
// is a self-contained concern (SRP). It's a factory: give it a way to serialize
// the tour, read the current folder handle, write tour.json, and report status,
// and it runs a debounced dirty-check loop.
//
// HOW IT WORKS (no invasive mutation hooks): every INTERVAL ms it serializes
// the tour and compares the JSON string to the last-saved snapshot. Only when
// they differ (a real edit happened) does it write to disk. This is O(size)
// cheap for tours of this scale and avoids sprinkling markDirty() across every
// action. It also flushes when the tab is hidden (tab switch / close) so the
// last few seconds of edits aren't lost.
//
// SAFETY: it NEVER writes without a bound folder handle, and the baseline is
// (re)set via markClean() right after a tour loads — so opening a tour that
// happens to read empty can't autosave a blank tour.json over your real one
// until you actually change something.

const INTERVAL_MS = 4000;

/**
 * @param {object} deps
 * @param {() => object} deps.serializeTour   -> plain tour object to persist
 * @param {() => (FileSystemDirectoryHandle|null)} deps.getDirHandle
 * @param {(handle, text:string) => Promise<void>} deps.saveJson
 * @param {(text:string, kind?:"idle"|"saving"|"saved"|"error") => void} deps.setStatus
 */
export function createAutosave({ serializeTour, getDirHandle, saveJson, setStatus }) {
  let lastSaved = null; // JSON string of the last successfully-persisted tour
  let timer = null;
  let writing = false;

  function snapshot() {
    try {
      return JSON.stringify(serializeTour(), null, 2);
    } catch {
      return null; // mid-edit invalid state — skip this tick
    }
  }

  /** Treat the current tour as already-persisted (call after load/manual save). */
  function markClean() {
    lastSaved = snapshot();
  }

  async function tick() {
    if (writing) return;
    const handle = getDirHandle();
    if (!handle) return; // no folder bound -> nothing to autosave to
    const json = snapshot();
    if (json == null || json === lastSaved) return; // nothing changed
    writing = true;
    setStatus?.("Saving\u2026", "saving");
    try {
      await saveJson(handle, json);
      lastSaved = json;
      setStatus?.("All changes saved", "saved");
    } catch (e) {
      console.warn("[autosave] write failed", e);
      setStatus?.("Autosave failed", "error");
    } finally {
      writing = false;
    }
  }

  function onVisibility() {
    if (document.visibilityState === "hidden") tick();
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibility);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    document.removeEventListener("visibilitychange", onVisibility);
  }

  return { start, stop, markClean, flush: tick };
}
