// ui-dom.js — small pure DOM-factory helpers shared by the builder UI.
// No app state, no side effects beyond creating elements.

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
