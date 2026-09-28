/**
 * language-config.js — fetch/read sibling `tour-<code>.json` language
 * variants for the ATLAS Explore player.
 *
 * Scoped to just the "find the alternates" concern — the primary config load
 * (fetch vs. builder preview vs. same-origin checks) stays in player.js's
 * loadRawConfig(), which calls into here once it knows the primary tour +
 * where it came from. Mirrors ATLAS Coach's config-loader.js multi-language
 * handling, minus the inline-SCORM-script path: ATLAS Explore's SCORM export
 * ships tour-<code>.json as ordinary loose files (see scorm-export.js), so a
 * plain relative fetch works inside an LMS package too — no extra machinery.
 */

const PREVIEW_ALT_PREFIX = "tour-preview-config-";

/** Non-primary language codes declared on the tour. */
function altCodes(tour) {
  const langs = Array.isArray(tour?.languages) ? tour.languages : [];
  return langs.filter((c) => c && c !== "en");
}

/** Directory portion of a url (keeps the trailing slash), or "". */
function dirOf(url) {
  const i = url.lastIndexOf("/");
  return i >= 0 ? url.slice(0, i + 1) : "";
}

/**
 * Fetch sibling tour-<code>.json files next to `configUrl`. Parallel. Any
 * fetch failure logs a warning and is skipped — a broken sibling should never
 * break the primary tour.
 */
export async function fetchAlternates(tour, configUrl) {
  const codes = altCodes(tour);
  if (!codes.length) return {};
  const dir = dirOf(configUrl);
  const alt = {};
  await Promise.all(codes.map(async (code) => {
    const url = `${dir}tour-${code}.json`;
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      alt[code] = await res.json();
    } catch (e) {
      console.warn(`[ATLAS] Skipping language '${code}': ${e.message} (${url})`);
    }
  }));
  return alt;
}

/**
 * Preview-mode counterpart to fetchAlternates(): reads sibling tours stashed
 * in localStorage by builder/builder-io.js's previewInPlayer(). Silent skip
 * on missing/bad entries, matching the fetch path's fail-open behavior.
 */
export function readPreviewAlternates(tour) {
  const codes = altCodes(tour);
  const alt = {};
  for (const code of codes) {
    try {
      const raw = localStorage.getItem(PREVIEW_ALT_PREFIX + code);
      if (raw) alt[code] = JSON.parse(raw);
    } catch { /* skip bad stash */ }
  }
  return alt;
}

export { PREVIEW_ALT_PREFIX };
