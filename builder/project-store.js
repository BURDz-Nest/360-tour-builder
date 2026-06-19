// project-store.js — remembers recently opened tour folders.
//
// The File System Access API lets us persist a directory *handle* in IndexedDB
// and reopen it later (with a permission prompt). That powers the Welcome
// screen's "Recent projects" list so users never hunt for folders again.

const DB_NAME = "tour-builder";
const STORE = "recent-projects";
const MAX_RECENT = 8;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "name" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function asPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Record (or refresh) a project in the recents list. Best-effort. */
export async function rememberProject(name, dirHandle) {
  try {
    const db = await openDb();
    await asPromise(tx(db, "readwrite").put({ name, dirHandle, openedAt: Date.now() }));
    await trim(db);
  } catch (e) {
    console.warn("[project-store] remember failed", e);
  }
}

/** Most-recently-opened projects first. Returns [] if unavailable. */
export async function listRecent() {
  try {
    const db = await openDb();
    const all = await asPromise(tx(db, "readonly").getAll());
    return all.sort((a, b) => b.openedAt - a.openedAt);
  } catch (e) {
    console.warn("[project-store] list failed", e);
    return [];
  }
}

/** Remove one project from the recents list. */
export async function forgetProject(name) {
  try {
    const db = await openDb();
    await asPromise(tx(db, "readwrite").delete(name));
  } catch (e) {
    console.warn("[project-store] forget failed", e);
  }
}

/** Keep only the newest MAX_RECENT entries. */
async function trim(db) {
  const all = await asPromise(tx(db, "readonly").getAll());
  if (all.length <= MAX_RECENT) return;
  const stale = all.sort((a, b) => b.openedAt - a.openedAt).slice(MAX_RECENT);
  for (const p of stale) await asPromise(tx(db, "readwrite").delete(p.name));
}
