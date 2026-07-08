// fs-workspace.js — File System Access API helpers for the builder.
//
// Chrome/Edge only. Lets the builder create/open tour folders, copy the player
// runtime, import images by drag-and-drop, and save tour.json straight to disk
// — no terminal required. All functions degrade gracefully: callers check
// `fsSupported()` first and fall back to the classic download/upload flow.

const TEMPLATE_BASE = "../player-template/";
const IMG_RE = /\.(jpe?g|png|webp)$/i;

/**
 * Image quality presets for panorama import. These are the only knobs we
 * expose to authors — each tunes max width + JPEG quality together so people
 * don't have to think in megapixels and 0.0–1.0 floats.
 *
 * Why these numbers:
 *   - 4096 is the "safe everywhere" width (locked-down VDI / older laptops
 *     start failing above this for textures). 6144 / 8192 are fine on real
 *     hardware but big files; warn in the UI.
 *   - 0.82 was the v1 default — fast and small but visibly soft on detail.
 *   - 0.90 is the sweet spot: ~25-40% bigger than 0.82, dramatically sharper.
 *   - 0.95 is for hero scenes (text/logo readability) and costs ~2-3x size.
 */
export const QUALITY_PRESETS = Object.freeze({
  web:      { label: "Web optimized (smallest)",  maxWidth: 4096, quality: 0.82 },
  balanced: { label: "Balanced (recommended)",    maxWidth: 4096, quality: 0.90 },
  high:     { label: "High quality (sharper)",    maxWidth: 6144, quality: 0.92 },
  max:      { label: "Maximum (largest files)",   maxWidth: 8192, quality: 0.95 },
});
const DEFAULT_PRESET_KEY = "balanced";

// Mutable module state so the builder can tweak the preset at runtime without
// threading options through every fs call. Single source of truth.
let currentPresetKey = DEFAULT_PRESET_KEY;

export function getQualityPreset() {
  return { key: currentPresetKey, ...QUALITY_PRESETS[currentPresetKey] };
}

export function setQualityPreset(key) {
  if (!QUALITY_PRESETS[key]) return false;
  currentPresetKey = key;
  return true;
}

export function fsSupported() {
  return typeof window.showDirectoryPicker === "function";
}

export function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---- low-level file helpers -------------------------------------------------

async function getFileHandleDeep(dirHandle, relPath, create = false) {
  const parts = relPath.split("/").filter(Boolean);
  const fileName = parts.pop();
  let dir = dirHandle;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return dir.getFileHandle(fileName, { create });
}

/**
 * Read a file (by relative path like "images/foo.jpg") from a directory handle
 * and return the File/Blob. Used by the asset resolver to make blob: URLs so
 * the builder can preview images no matter WHERE the tour folder lives (not
 * just under the repo's served /tours/).
 */
export async function readFileDeep(dirHandle, relPath) {
  const fh = await getFileHandleDeep(dirHandle, relPath, false);
  return fh.getFile();
}

async function writeFile(dirHandle, relPath, data) {
  const fh = await getFileHandleDeep(dirHandle, relPath, true);
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

async function copyRuntime(destHandle, onProgress) {
  const manifest = await fetch(TEMPLATE_BASE + "manifest.json").then((r) => r.json());
  let done = 0;
  for (const path of manifest) {
    const blob = await fetch(TEMPLATE_BASE + path).then((r) => r.blob());
    await writeFile(destHandle, path, blob);
    onProgress?.(++done, manifest.length);
  }
}

// ---- high-level tour operations --------------------------------------------

/** Create tours/<slug>/ (user picks the parent), copy runtime, make images/. */
export async function newTour(name, onProgress) {
  const slug = slugify(name);
  if (!slug) throw new Error("Please enter a tour name first.");
  const parent = await window.showDirectoryPicker({ mode: "readwrite" });

  let exists = true;
  try {
    await parent.getDirectoryHandle(slug);
  } catch (e) {
    if (e.name === "NotFoundError") exists = false;
    else throw e;
  }
  if (exists) {
    throw new Error(`A folder "${slug}" already exists here — open it instead, or pick another name.`);
  }

  const dirHandle = await parent.getDirectoryHandle(slug, { create: true });
  await dirHandle.getDirectoryHandle("images", { create: true });
  await copyRuntime(dirHandle, onProgress);
  return { dirHandle, slug, name };
}

/** Open an existing tour folder; ensures an images/ subfolder exists. */
export async function openTour() {
  const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
  await dirHandle.getDirectoryHandle("images", { create: true });
  return { dirHandle, name: dirHandle.name };
}

/** Read + parse a folder's tour.json. Returns the parsed object, or null if
 *  there isn't one yet (a brand-new folder). Throws only on malformed JSON. */
export async function readTourJson(dirHandle) {
  let fh;
  try {
    fh = await dirHandle.getFileHandle("tour.json");
  } catch {
    return null; // no tour.json yet — that's fine for a new folder
  }
  const text = await (await fh.getFile()).text();
  return JSON.parse(text);
}

/** Ensure we still hold readwrite permission on a stored handle (recents).
 *  Returns true if granted. Prompts the user if needed. */
export async function verifyPermission(handle) {
  if (!handle?.queryPermission) return true;
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

/** Copy + web-optimize dropped/selected images into the tour's images/ folder.
 *  Each image is downscaled to <= MAX_PANO_WIDTH and re-encoded as JPEG (we
 *  only ever store the web version). Returns the STORED filenames. */
export async function addImages(dirHandle, files) {
  const imagesDir = await dirHandle.getDirectoryHandle("images", { create: true });
  const thumbsDir = await imagesDir.getDirectoryHandle("thumbs", { create: true });
  const added = [];
  for (const file of files) {
    if (!IMG_RE.test(file.name)) continue;
    const web = await optimizeToWeb(file).catch((e) => {
      console.warn("[fs] optimize failed, storing original", file.name, e);
      return null;
    });
    const storedName = web ? webName(file.name) : file.name;
    const blob = web || file;
    await writeBlobTo(imagesDir, storedName, blob);
    try {
      const thumb = await makeSnapshotThumbnail(blob);
      if (thumb) await writeBlobTo(thumbsDir, thumbName(storedName), thumb);
    } catch (e) {
      console.warn("[fs] thumbnail failed for", storedName, e);
    }
    added.push(storedName);
  }
  added.sort((a, b) => a.localeCompare(b));
  return added;
}

/** Web filename for an image: same basename, always .jpg. */
export function webName(imageName) {
  return imageName.replace(/\.[^.]+$/, "") + ".jpg";
}

/** Downscale to <= the active preset's max width and re-encode as JPEG.
 *  Returns a Blob (or null if unsupported). Pass explicit overrides only
 *  for the rare case you don't want the current preset. */
async function optimizeToWeb(file, maxWidth, quality) {
  if (typeof createImageBitmap !== "function") return null;
  const preset = QUALITY_PRESETS[currentPresetKey];
  const w_max = Number.isFinite(maxWidth) ? maxWidth : preset.maxWidth;
  const q = Number.isFinite(quality) ? quality : preset.quality;
  const bmp = await createImageBitmap(file);
  const scale = bmp.width > w_max ? w_max / bmp.width : 1;
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", q)
  );
}

/**
 * Re-process every image in images/ at the CURRENT quality preset:
 * downscale + re-encode to a web .jpg, regenerate its thumbnail, and remove
 * the stale original if the name changed. Returns { optimized, renames } so
 * the caller can fix up scene panorama/thumbnail paths.
 *
 * Note: we used to skip files already <= maxWidth and ending in .jpg as a
 * speed win. With mutable quality presets that's actively wrong — it would
 * mean changing the preset has no effect on existing images. So we always
 * re-encode. Re-encoding the same JPG twice adds a touch of compression
 * noise, but the user pressed the button intentionally to apply a setting.
 */
export async function optimizeFolder(dirHandle, maxWidth) {
  const w_max = Number.isFinite(maxWidth) ? maxWidth : QUALITY_PRESETS[currentPresetKey].maxWidth;
  let imagesDir;
  try {
    imagesDir = await dirHandle.getDirectoryHandle("images");
  } catch {
    return { optimized: 0, renames: {} };
  }
  const thumbsDir = await imagesDir.getDirectoryHandle("thumbs", { create: true });
  const names = [];
  for await (const [name, h] of imagesDir.entries()) {
    if (h.kind === "file" && IMG_RE.test(name)) names.push(name);
  }
  let optimized = 0;
  const renames = {};
  for (const name of names) {
    const file = await (await imagesDir.getFileHandle(name)).getFile();
    const out = webName(name);
    const web = await optimizeToWeb(file, w_max);
    if (!web) continue;
    await writeBlobTo(imagesDir, out, web);
    try {
      const thumb = await makeSnapshotThumbnail(web);
      if (thumb) await writeBlobTo(thumbsDir, thumbName(out), thumb);
    } catch (e) {
      console.warn("[fs] thumb regen failed", out, e);
    }
    if (out !== name) {
      await imagesDir.removeEntry(name).catch(() => {});
      renames[name] = out;
    }
    optimized++;
  }
  return { optimized, renames };
}

async function writeBlobTo(dir, name, blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

/** Thumbnail filename for an image (always .jpg). */
export function thumbName(imageName) {
  return imageName.replace(/\.[^.]+$/, "") + ".jpg";
}

/**
 * Make a square center-crop of an equirectangular image — roughly the
 * forward-facing view, which reads like a normal photo instead of the
 * stretched 2:1 panorama. Returns a JPEG Blob (or null if unsupported).
 */
async function makeSnapshotThumbnail(file, size = 240) {
  if (typeof createImageBitmap !== "function") return null;
  const bmp = await createImageBitmap(file);
  // Centered square crop ~ the middle of the panorama (forward view).
  const side = Math.round(Math.min(bmp.height * 0.85, bmp.width));
  const sx = Math.round((bmp.width - side) / 2);
  const sy = Math.round((bmp.height - side) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
  bmp.close?.();
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8)
  );
}

/**
 * Generate snapshot thumbnails for any images that don't have one yet (e.g.
 * copied into images/ via Finder rather than dragged into the builder).
 * Returns the count generated.
 */
export async function ensureThumbnails(dirHandle) {
  let imagesDir;
  try {
    imagesDir = await dirHandle.getDirectoryHandle("images");
  } catch {
    return 0;
  }
  const thumbsDir = await imagesDir.getDirectoryHandle("thumbs", { create: true });
  const haveThumb = new Set();
  for await (const [n, h] of thumbsDir.entries()) {
    if (h.kind === "file") haveThumb.add(n);
  }
  let made = 0;
  for await (const [name, h] of imagesDir.entries()) {
    if (h.kind !== "file" || !IMG_RE.test(name)) continue;
    const tn = thumbName(name);
    if (haveThumb.has(tn)) continue;
    try {
      const file = await h.getFile();
      const thumb = await makeSnapshotThumbnail(file);
      if (thumb) {
        await writeBlobTo(thumbsDir, tn, thumb);
        made++;
      }
    } catch (e) {
      console.warn("[fs] thumbnail gen failed for", name, e);
    }
  }
  return made;
}

/** List image filenames already in the tour's images/ folder. */
export async function listImageNames(dirHandle) {
  let imagesDir;
  try {
    imagesDir = await dirHandle.getDirectoryHandle("images");
  } catch {
    return [];
  }
  const names = [];
  for await (const [name, h] of imagesDir.entries()) {
    if (h.kind === "file" && IMG_RE.test(name)) names.push(name);
  }
  names.sort((a, b) => a.localeCompare(b));
  return names;
}

/** Write tour.json directly into the tour folder (no save dialog). */
export async function saveTourJson(dirHandle, text) {
  await writeFile(dirHandle, "tour.json", text);
}

// ---- small UI helpers -------------------------------------------------------

/** Wire an element as a drag-and-drop zone for image files. */
export function setupDropZone(el, onFiles) {
  const stop = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  ["dragenter", "dragover"].forEach((ev) =>
    el.addEventListener(ev, (e) => {
      stop(e);
      el.classList.add("is-dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    el.addEventListener(ev, (e) => {
      stop(e);
      el.classList.remove("is-dragover");
    })
  );
  el.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => IMG_RE.test(f.name));
    if (files.length) onFiles(files);
  });
}

/**
 * Render a thumbnail grid of images. `resolve(relPath)` returns a Promise of a
 * displayable URL (blob: from the folder handle, or an HTTP path) so images
 * load regardless of where the tour folder lives. Clicking calls onAssign(name).
 */
export function renderImageGrid(container, names, resolve, onAssign) {
  container.innerHTML = "";
  if (!names.length) {
    container.innerHTML = '<p class="muted">No images yet — drag 360 photos here.</p>';
    return;
  }
  for (const name of names) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "img-thumb";
    btn.title = `Use ${name} for the selected scene`;
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "";
    img.addEventListener("error", () => btn.classList.add("is-broken"));
    Promise.resolve(resolve(`images/${name}`))
      .then((url) => { if (url) img.src = url; else btn.classList.add("is-broken"); })
      .catch(() => btn.classList.add("is-broken"));
    const span = document.createElement("span");
    span.textContent = name;
    btn.append(img, span);
    btn.addEventListener("click", () => onAssign(name));
    container.appendChild(btn);
  }
}
