// asset-resolver.js — turns tour-relative image paths (e.g. "images/IMG_01.jpg")
// into URLs the builder can actually display.
//
// WHY THIS EXISTS: the builder is served from /builder/ but a tour folder can
// live ANYWHERE the user picked with the File System Access API (Desktop, a USB
// stick, wherever) — not just under the repo's served /tours/. HTTP-relative
// paths only resolve for in-repo tours, so previews + thumbnails were blank for
// external folders. Reading each file straight from the directory handle and
// wrapping it in a blob: URL works regardless of location.
//
// Falls back to the old HTTP base (state.previewBase) when there's no folder
// handle (e.g. an imported tour.json with absolute/remote image URLs).

const PASSTHROUGH = /^(https?:|data:|blob:|\/)/i;

export function createAssetResolver({ state, fs }) {
  // path -> blob: URL (so repeated lookups are cheap and revocable).
  const cache = new Map();

  /** Already-resolved blob URL for a path, or null. Synchronous. */
  function peek(path) {
    return cache.get(normalize(path)) || null;
  }

  /**
   * Resolve a tour-relative path to a displayable URL. Async because reading a
   * file from the directory handle is async. Absolute/remote paths pass through.
   */
  async function resolve(path) {
    if (!path) return "";
    if (PASSTHROUGH.test(path)) return path;
    const key = normalize(path);

    // Prefer the folder handle (works anywhere). Cache the blob URL.
    if (state.dirHandle) {
      if (cache.has(key)) return cache.get(key);
      try {
        const file = await fs.readFileDeep(state.dirHandle, key);
        // DIAGNOSTIC: a 0-byte read is the tell-tale sign of a cloud-only
        // (OneDrive "Files On-Demand") placeholder that never downloaded, or a
        // corrupt/failed save. It reads as a File but has no pixels, so WebGL
        // later logs "texSubImage2D: bad image data" and the panorama is blank.
        // Surface it loudly here so the cause is obvious instead of silent.
        if (!file || file.size === 0) {
          console.warn(
            `[asset] "${key}" read as ${file ? file.size : "null"} bytes \u2014 ` +
              "the file is empty/unavailable. If this folder is in OneDrive, the " +
              "image is likely a cloud-only placeholder: right-click the folder " +
              "in File Explorer \u2192 'Always keep on this device', then reopen."
          );
          return ""; // caller shows a broken-image / blank state
        }
        console.info(`[asset] "${key}" \u2192 ${file.size} bytes (${file.type || "unknown type"})`);
        const url = URL.createObjectURL(file);
        cache.set(key, url);
        return url;
      } catch (e) {
        console.warn(`[asset] failed to read "${key}" from folder handle:`, e);
        return ""; // missing file -> caller shows a broken-image state
      }
    }

    // No folder bound: fall back to the HTTP base (in-repo tours only).
    const base = (state.previewBase || "").trim();
    return base ? base.replace(/\/?$/, "/") + key : path;
  }

  /**
   * Drop cached URLs so the next resolve() re-reads from disk. Call after files
   * change on disk (optimize / re-encode) so stale blob URLs aren't reused.
   * `only` (optional) limits the purge to a single path.
   */
  function invalidate(only) {
    if (only) {
      const key = normalize(only);
      revoke(cache.get(key));
      cache.delete(key);
      return;
    }
    for (const url of cache.values()) revoke(url);
    cache.clear();
  }

  return { resolve, peek, invalidate };
}

function normalize(path) {
  return String(path).replace(/^\.?\//, "");
}

function revoke(url) {
  if (url && url.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* already revoked */
    }
  }
}
