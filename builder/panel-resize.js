/**
 * panel-resize.js - drag-to-resize the left (scenes) and right (editor) columns.
 *
 * The builder layout is a CSS grid: [left] [splitter] [center 1fr] [splitter]
 * [right]. This sets --left-w / --right-w custom properties on the grid so the
 * left and right columns take fixed widths while the center preview flexes to
 * fill whatever's left. Widths persist in localStorage per browser.
 *
 * SOLID/DRY: knows nothing about scenes or the viewer - it only nudges two CSS
 * variables and fires a window "resize" so the 360 viewer can relayout.
 */

const KEY = "builder-panel-widths";
const MIN = 200; // don't let a panel collapse to nothing
const MAX = 640; // ...or eat the whole preview

/**
 * Self-locates the .builder-main grid and its two #resizer-left / #resizer-right
 * splitters, then wires drag-to-resize. No-ops cleanly if any are missing.
 */
export function mountPanelResizers() {
  const container = document.querySelector(".builder-main");
  if (!container) return;
  const leftResizer = document.getElementById("resizer-left");
  const rightResizer = document.getElementById("resizer-right");

  const saved = load();
  if (saved.left) container.style.setProperty("--left-w", saved.left + "px");
  if (saved.right) container.style.setProperty("--right-w", saved.right + "px");

  wire(leftResizer, "left", "#left-col");
  wire(rightResizer, "right", ".col--editor");

  function wire(handle, side, colSelector) {
    if (!handle) return;
    const varName = side === "left" ? "--left-w" : "--right-w";

    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const col = container.querySelector(colSelector);
      if (!col) return;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("is-dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const startX = e.clientX;
      const startW = col.getBoundingClientRect().width;

      const onMove = (ev) => {
        // Left panel grows when you drag right; right panel grows dragging left.
        const dx = ev.clientX - startX;
        const w = clamp(side === "left" ? startW + dx : startW - dx);
        container.style.setProperty(varName, w + "px");
      };
      const onUp = () => {
        handle.releasePointerCapture(e.pointerId);
        handle.classList.remove("is-dragging");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        save(container);
        window.dispatchEvent(new Event("resize")); // let the 360 viewer relayout
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }
}

function clamp(w) {
  return Math.max(MIN, Math.min(MAX, Math.round(w)));
}

function save(container) {
  const left = container.style.getPropertyValue("--left-w");
  const right = container.style.getPropertyValue("--right-w");
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        left: left ? parseInt(left, 10) : undefined,
        right: right ? parseInt(right, 10) : undefined,
      })
    );
  } catch {
    /* private mode - just don't persist */
  }
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {
    return {};
  }
}
