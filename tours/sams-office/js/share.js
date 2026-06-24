/**
 * share.js - "Share this view" panel for the player.
 *
 * Two responsibilities:
 *   - keep the URL's ?scene= param in sync with the current node (deep-linking)
 *   - render a small modal with the current URL, a copy button, and a QR code
 *
 * QR generation uses the vendored window.qrcode (qrcode-generator 1.4.4),
 * loaded by player.html as a classic <script> so it attaches as a global.
 */

const SHARE_BTN_ID = "share-btn";
const SHARE_OVERLAY_ID = "share-overlay";

/** Read the ?scene= param from the current URL, or null if absent. */
export function readSceneFromUrl() {
  return new URLSearchParams(location.search).get("scene");
}

/**
 * Replace (not push) the URL's ?scene= so the browser back-button doesn't
 * fill up with every scene change. Preserves existing params (e.g. ?config=).
 */
export function writeSceneToUrl(sceneId) {
  const url = new URL(location.href);
  if (sceneId) url.searchParams.set("scene", sceneId);
  else url.searchParams.delete("scene");
  history.replaceState(history.state, "", url.href);
}

/**
 * Wire the share button + modal. The HTML for both lives in player.html.
 * @param {() => string|null} getCurrentSceneId  used to refresh the URL on open
 */
export function mountShareUI({ getCurrentSceneId }) {
  const btn = document.getElementById(SHARE_BTN_ID);
  const overlay = document.getElementById(SHARE_OVERLAY_ID);
  if (!btn || !overlay) return;

  const urlField = overlay.querySelector("#share-url");
  const copyBtn = overlay.querySelector("#share-copy");
  const qrHost = overlay.querySelector("#share-qr");
  const closeBtn = overlay.querySelector("#share-close");

  btn.addEventListener("click", () => openShare(getCurrentSceneId()));
  closeBtn.addEventListener("click", closeShare);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeShare();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeShare();
  });
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(urlField.value);
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy link"), 1500);
    } catch {
      // Clipboard API can fail on insecure origins; fall back to selection.
      urlField.select();
    }
  });

  function openShare(sceneId) {
    // Always make sure the URL reflects the current scene before sharing.
    if (sceneId) writeSceneToUrl(sceneId);
    const here = location.href;
    urlField.value = here;
    renderQrInto(qrHost, here);
    overlay.hidden = false;
    closeBtn.focus();
  }

  function closeShare() {
    overlay.hidden = true;
    btn.focus();
  }
}

/**
 * Render a QR code (SVG, scalable) into `host` for `text`. Uses the vendored
 * qrcode-generator global. Error correction level "M" + auto-sized type number
 * keeps mid-length URLs (~150 chars) comfortably scannable.
 */
function renderQrInto(host, text) {
  host.innerHTML = "";
  if (typeof window.qrcode !== "function") {
    host.textContent = "(QR library not loaded)";
    return;
  }
  // Type 0 = auto-pick the smallest type that fits; "M" = ~15% error correction.
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  // createSvgTag(cellSize, margin) returns a fully-formed SVG string.
  host.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  const svg = host.querySelector("svg");
  if (svg) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR code linking to this tour view");
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.width = "100%";
    svg.style.height = "auto";
  }
}
