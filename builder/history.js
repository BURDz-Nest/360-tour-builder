// history.js — undo/redo for the tour, via debounced JSON snapshots.
//
// WHY SNAPSHOTS (not command objects): the tour is a plain JSON-safe object and
// mutations happen in many places (scenes, groups, markers, meta fields, drags).
// Instrumenting every one with an inverse command would be invasive and brittle.
// Instead we deep-clone the whole tour (structuredClone-cheap at this scale) into
// a stack. A single debounced record() collapses a burst of edits (typing, a
// drag) into ONE undo step, which matches user expectation.
//
// It's a factory (SRP / DI): the caller provides how to read the current state
// (`snapshot`), how to put a state back (`restore`), and a status callback to
// reflect the toolbar buttons.

export function createHistory({ snapshot, restore, onChange, limit = 60, debounceMs = 500 }) {
  let past = [];
  let future = [];
  let present = null; // JSON string of the last COMMITTED state
  let timer = null;
  let applying = false; // guard: don't record our own restore()

  const status = () => ({ canUndo: past.length > 0, canRedo: future.length > 0 });

  function commit(json) {
    if (json == null || json === present) return; // nothing actually changed
    if (present != null) {
      past.push(present);
      if (past.length > limit) past.shift(); // cap memory
    }
    present = json;
    future = []; // a fresh edit invalidates the redo branch
    onChange?.(status());
  }

  /** Debounced: call after any mutation. Collapses bursts into one step. */
  function record() {
    if (applying) return;
    clearTimeout(timer);
    timer = setTimeout(() => commit(snapshot()), debounceMs);
  }

  /** Fold any pending (un-debounced) edit into `present` right now. */
  function flushPending() {
    clearTimeout(timer);
    const cur = snapshot();
    if (cur != null && cur !== present) commit(cur);
  }

  /** Establish a clean baseline (e.g. after loading a tour). No undo across it. */
  function reset() {
    clearTimeout(timer);
    past = [];
    future = [];
    present = snapshot();
    onChange?.(status());
  }

  function apply(json) {
    applying = true;
    try {
      restore(json);
    } finally {
      applying = false;
    }
  }

  function undo() {
    flushPending(); // make sure the latest un-committed edit is captured first
    if (!past.length) return;
    future.push(present);
    present = past.pop();
    apply(present);
    onChange?.(status());
  }

  function redo() {
    if (!future.length) return;
    past.push(present);
    present = future.pop();
    apply(present);
    onChange?.(status());
  }

  return { record, reset, undo, redo, status };
}
