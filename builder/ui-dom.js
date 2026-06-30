// ui-dom.js — small pure DOM-factory helpers shared by the builder UI.
// No app state, no side effects beyond creating elements.

/**
 * Wire the standard dismiss behaviours for a <div class="modal" hidden> dialog:
 * a close button, backdrop click, and the Escape key. Returns {open, close}
 * so callers can trigger it from a toolbar button.
 *
 * @param {HTMLElement} modalEl    the modal container (the backdrop)
 * @param {HTMLElement} closeBtnEl the close button inside it
 */
export function bindDismissibleModal(modalEl, closeBtnEl) {
  const close = () => (modalEl.hidden = true);
  const open = () => (modalEl.hidden = false);
  closeBtnEl.addEventListener("click", close);
  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalEl.hidden) close();
  });
  return { open, close };
}

export function miniBtn(text, title, onClick, disabled = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "mini-btn";
  b.textContent = text;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

export function labeledInput(label, value, onInput) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const span = document.createElement("span");
  span.className = "field__label";
  span.textContent = label;
  const input = document.createElement("input");
  input.className = "field__input";
  input.type = "text";
  input.value = value || "";
  input.addEventListener("input", () => onInput(input.value));
  wrap.append(span, input);
  return wrap;
}

export function labeledTextarea(label, value, onInput) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const span = document.createElement("span");
  span.className = "field__label";
  span.textContent = label;
  const ta = document.createElement("textarea");
  ta.className = "field__input";
  ta.rows = 3;
  ta.value = value || "";
  ta.addEventListener("input", () => onInput(ta.value));
  wrap.append(span, ta);
  return wrap;
}

/** A label + native color swatch. Returns the wrapper <label>. */
export function labeledColor(label, value, onInput) {
  const wrap = document.createElement("label");
  wrap.className = "field field--inline";
  const span = document.createElement("span");
  span.className = "field__label";
  span.textContent = label;
  const input = document.createElement("input");
  input.type = "color";
  input.className = "field__color";
  input.value = value || "#0071dc";
  input.addEventListener("input", () => onInput(input.value));
  wrap.append(span, input);
  return wrap;
}

/** A checkbox + trailing text label. Returns the wrapper <label>. */
export function labeledCheckbox(label, checked, onChange) {
  const wrap = document.createElement("label");
  wrap.className = "field field--check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!checked;
  input.addEventListener("change", () => onChange(input.checked));
  const span = document.createElement("span");
  span.textContent = label;
  wrap.append(input, span);
  return wrap;
}
