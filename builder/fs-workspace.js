// fs-workspace.js — File System Access API helpers for the builder.
//
// Chrome/Edge only. Lets the builder create/open tour folders, copy the player
// runtime, import images by drag-and-drop, and save tour.json straight to disk
// — no terminal required. All functions degrade gracefully: callers check
// `fsSupported()` first and fall back to the classic download/upload flow.

const TEMPLATE_BASE = "../player-template/";
const IMG_RE = /\.(jpe?g|png|webp)$/i;

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

/** Copy dropped/selected image files into the tour's images/ folder. */
export async function addImages(dirHandle, files) {
  const imagesDir = await dirHandle.getDirectoryHandle("images", { create: true });
  const thumbsDir = await imagesDir.getDirectoryHandle("thumbs", { create: true });
  const added = [];
  for (const file of files) {
    if (!IMG_RE.test(file.name)) continue;
    await writeBlobTo(imagesDir, file.name, file);
    // Generate a center-crop "snapshot" thumbnail (nicer than the raw
    // equirectangular strip in link hover previews). Best-effort.
    try {
      const thumb = await makeSnapshotThumbnail(file);
      if (thumb) await writeBlobTo(thumbsDir, thumbName(file.name), thumb);
    } catch (e) {
      console.warn("[fs] thumbnail failed for", file.name, e);
    }
    added.push(file.name);
  }
  added.sort((a, b) => a.localeCompare(b));
  return added;
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
 * Render a thumbnail grid of images. `baseUrl` is the HTTP path the running
 * server serves the tour from (e.g. ../tours/foo/), so thumbnails load over
 * HTTP. Clicking a thumbnail calls onAssign(name).
 */
export function renderImageGrid(container, names, baseUrl, onAssign) {
  container.innerHTML = "";
  if (!names.length) {
    container.innerHTML = '<p class="muted">No images yet — drag 360 photos here.</p>';
    return;
  }
  const base = (baseUrl || "").replace(/\/?$/, "/");
  for (const name of names) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "img-thumb";
    btn.title = `Use ${name} for the selected scene`;
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "";
    img.src = `${base}images/${encodeURIComponent(name)}`;
    img.addEventListener("error", () => btn.classList.add("is-broken"));
    const span = document.createElement("span");
    span.textContent = name;
    btn.append(img, span);
    btn.addEventListener("click", () => onAssign(name));
    container.appendChild(btn);
  }
}
