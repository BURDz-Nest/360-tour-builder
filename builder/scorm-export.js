/**
 * scorm-export.js — build a SCORM 1.2 package (.zip) from the current tour.
 *
 * Wires the Export SCORM dialog and does the packaging:
 *   1. gather the player runtime (via player-template/manifest.json)
 *   2. serialize tour.json (rewriting image paths in "remote" mode)
 *   3. optionally bundle referenced images read from the tour folder handle
 *   4. generate imsmanifest.xml (SCORM 1.2)
 *   5. zip it all (zip-writer.js) and trigger a download
 *
 * SRP: this module ONLY knows SCORM packaging. It reuses fs.readFileDeep to
 * read images and fetches runtime files the same way fs-workspace.copyRuntime
 * does, so there's one obvious way to source the runtime (DRY).
 */

import { makeZip } from "./zip-writer.js?v=1";

const TEMPLATE_BASE = "../player-template/";
const PASSTHROUGH = /^(https?:|data:|blob:|\/)/i; // already-absolute image refs

/**
 * @param {object} deps
 * @param {(id:string)=>HTMLElement} deps.$
 * @param {object} deps.state          builder state (needs dirHandle)
 * @param {object} deps.fs             fs-workspace module (readFileDeep, slugify)
 * @param {()=>object} deps.serializeTour  returns a clean tour object
 * @param {(msg:string, isError?:boolean)=>void} deps.toast
 */
export function createScormExport({ $, state, fs, serializeTour, toast }) {
  const modal = $("scorm-modal");
  const azureRow = $("scorm-azure-row");
  const est = $("scorm-est");

    function currentMode() {
    return document.querySelector('input[name="scorm-mode"]:checked')?.value || "bundle";
  }

  // Own our dialog's internal controls (SRP: the module wires its own DOM).
  $("scorm-modal-close").addEventListener("click", close);
  $("scorm-export-go").addEventListener("click", run);
  document.querySelectorAll('input[name="scorm-mode"]').forEach((r) =>
    r.addEventListener("change", syncMode)
  );

  function open() {
    if (!state.tour.scenes?.length) return toast("Add at least one scene first.", true);
    $("scorm-title").value = state.tour.meta?.title || "";
    est.hidden = true;
    syncMode();
    modal.hidden = false;
  }
  function close() { modal.hidden = true; }

  function syncMode() {
    azureRow.hidden = currentMode() !== "remote";
  }

  async function run() {
    const mode = currentMode();
    const title = ($("scorm-title").value || "").trim() || state.tour.meta?.title || "360 Tour";
    let base = "";
    if (mode === "remote") {
      base = ($("scorm-azure-base").value || "").trim();
      if (!base) return toast("Enter an image base URL for remote mode.", true);
      if (!/^https:\/\//i.test(base)) return toast("Image base URL must start with https://", true);
      if (!base.endsWith("/")) base += "/";
    }
    if (mode === "bundle" && !state.dirHandle) {
      return toast("Bundling needs the tour folder open (so images can be read).", true);
    }

    const goBtn = $("scorm-export-go");
    goBtn.disabled = true;
    const prev = goBtn.textContent;
    goBtn.textContent = "Building…";
    try {
      const blob = await buildPackage({ mode, title, base });
      downloadBlob(blob, `${fs.slugify(title) || "tour"}-scorm.zip`);
      const mb = (blob.size / (1024 * 1024)).toFixed(1);
      est.hidden = false;
      est.textContent = `Built ${mb} MB SCORM package. Upload it to Moodle as a SCORM activity.`;
      toast(`SCORM package ready (${mb} MB).`);
    } catch (e) {
      console.error("[scorm-export]", e);
      toast(`Export failed: ${e.message}`, true);
    } finally {
      goBtn.disabled = false;
      goBtn.textContent = prev;
    }
  }

  async function buildPackage({ mode, title, base }) {
    const entries = [];

    // 1. Runtime files (player.html, js/, css/, vendor/) from the template.
    const manifest = await fetch(TEMPLATE_BASE + "manifest.json").then((r) => r.json());
    for (const path of manifest) {
      const buf = await fetch(TEMPLATE_BASE + path).then((r) => r.arrayBuffer());
      entries.push({ name: path, data: new Uint8Array(buf) });
    }

    // 2. tour.json (+ any tour-<code>.json language siblings) — clone so we
    // never mutate the live tour, then rewrite paths. Siblings are re-scanned
    // fresh here (not just state.tour.languages) so an export is correct even
    // if the builder's language chip hasn't been refreshed since a translated
    // file was dropped in.
    const localImages = new Set(); // relative paths to bundle (bundle mode)
    const primaryTour = JSON.parse(JSON.stringify(serializeTour()));
    let siblings = {};
    if (state.dirHandle) {
      try { siblings = await fs.listLanguageSiblings(state.dirHandle); }
      catch (e) { console.warn("[scorm-export] language scan failed", e); }
    }
    const langCodes = Object.keys(siblings).sort();
    primaryTour.languages = ["en", ...langCodes];
    rewriteTourImages(primaryTour, mode, base, localImages);
    entries.push({ name: "tour.json", data: JSON.stringify(primaryTour, null, 2) });
    for (const code of langCodes) {
      const altTour = JSON.parse(JSON.stringify(siblings[code]));
      rewriteTourImages(altTour, mode, base, localImages);
      entries.push({ name: `tour-${code}.json`, data: JSON.stringify(altTour, null, 2) });
    }

    // 3. Bundle referenced images (read from the tour folder handle).
    if (mode === "bundle") {
      for (const path of localImages) {
        try {
          const file = await fs.readFileDeep(state.dirHandle, path);
          entries.push({ name: path, data: new Uint8Array(await file.arrayBuffer()) });
        } catch {
          throw new Error(`Couldn't read image "${path}" from the tour folder.`);
        }
      }
    }

    // 4. SCORM 1.2 manifest.
    entries.push({ name: "imsmanifest.xml", data: buildManifest(title, entries) });

    // 5. Zip.
    return makeZip(entries);
  }

  // Return the path to store in tour.json. In remote mode, relative local paths
  // become absolute (base + path); already-absolute URLs pass through untouched.
  // In bundle mode, local paths stay relative and are queued for bundling.
  function rewriteImage(path, mode, base, localImages) {
    if (!path) return path;
    if (PASSTHROUGH.test(path)) return path; // already absolute — leave it
    const clean = path.replace(/^\.?\//, "");
    if (mode === "remote") return base + clean;
    localImages.add(clean);
    return path;
  }

  /** Apply rewriteImage() to every scene's panorama + thumbnail, in place. */
  function rewriteTourImages(tour, mode, base, localImages) {
    for (const s of tour.scenes || []) {
      s.panorama = rewriteImage(s.panorama, mode, base, localImages);
      s.thumbnail = rewriteImage(s.thumbnail, mode, base, localImages);
    }
  }

  return { open };
}

/* ---------------- SCORM 1.2 manifest ---------------- */

function buildManifest(title, entries) {
  const id = "ATLAS_" + Date.now().toString(36).toUpperCase();
  const t = xmlEscape(title);
  const files = entries
    .map((e) => `      <file href="${xmlEscape(e.name)}" />`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                      http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG">
    <organization identifier="ORG">
      <title>${t}</title>
      <item identifier="ITEM" identifierref="RES">
        <title>${t}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES" type="webcontent" adlcp:scormtype="sco" href="player.html">
${files}
    </resource>
  </resources>
</manifest>
`;
}

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
