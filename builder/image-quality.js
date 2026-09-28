// image-quality.js — the "Image quality" dropdown in Tour settings.
//
// Self-contained authoring preference (persisted to localStorage), pulled out of
// builder.js. Reads/writes the preset registry that lives in fs-workspace.

const QUALITY_STORAGE_KEY = "tour-builder.imageQualityPreset";

/**
 * Build the quality dropdown from fs.QUALITY_PRESETS, restore the user's saved
 * choice (or the registry default), and persist on change.
 * @param {object} deps
 * @param {(id:string)=>HTMLElement} deps.$
 * @param {object} deps.fs   fs-workspace module (QUALITY_PRESETS, get/setQualityPreset)
 * @param {(msg:string)=>void} deps.toast
 */
export function mountQualityPicker({ $, fs, toast }) {
  const sel = $("image-quality");
  if (!sel) return; // defensive: no-op if the settings panel isn't present
  sel.innerHTML = "";
  for (const [key, preset] of Object.entries(fs.QUALITY_PRESETS)) {
    sel.append(new Option(preset.label, key));
  }
  const saved = localStorage.getItem(QUALITY_STORAGE_KEY);
  if (saved && fs.setQualityPreset(saved)) {
    sel.value = saved;
  } else {
    sel.value = fs.getQualityPreset().key;
  }
  sel.addEventListener("change", () => {
    if (fs.setQualityPreset(sel.value)) {
      localStorage.setItem(QUALITY_STORAGE_KEY, sel.value);
      const p = fs.getQualityPreset();
      toast(`Image quality set to "${p.label}" (${p.maxWidth}px, q=${p.quality}).`);
    }
  });
}
