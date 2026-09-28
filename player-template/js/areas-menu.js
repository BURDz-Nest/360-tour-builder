/**
 * areas-menu.js - player-side "Areas" dropdown + current-area breadcrumb.
 *
 * For large tours split into groups ("areas"), this lets a visitor fast-travel
 * between areas instead of clicking scene-by-scene. The button's label doubles
 * as a breadcrumb (the area you're currently in). Rendered only when the tour
 * actually has areas, so classic single-list tours are unaffected.
 *
 * Pure UI: it never navigates itself - it calls onPickArea(groupId) and lets
 * player.js resolve that area's entry scene + drive the VirtualTour plugin.
 */

/**
 * @param {object} cfg
 * @param {HTMLElement} cfg.mountEl   empty container in the player bar
 * @param {object} cfg.tour           validated tour (with .groups + scene.groupId)
 * @param {(groupId: string) => void} cfg.onPickArea
 * @param {{areas?: string, jumpToArea?: string}} [cfg.labels]  i18n overrides
 *   (default English chrome; see player-template/js/i18n.js)
 * @returns {{ update(sceneId: string): void } | null}  null if no areas exist
 */
export function mountAreasMenu({ mountEl, tour, onPickArea, labels }) {
  if (!mountEl) return null;
  const areasLabel = labels?.areas || "Areas";
  const jumpLabel = labels?.jumpToArea || "Jump to area";
  // Only areas that actually contain scenes are worth jumping to.
  const areas = (tour.groups || []).filter((g) =>
    tour.scenes.some((s) => (s.groupId || null) === g.id)
  );
  if (!areas.length) return null;

  const count = (gid) =>
    tour.scenes.filter((s) => (s.groupId || null) === gid).length;

  mountEl.hidden = false;
  mountEl.classList.add("areas-menu");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "areas-menu__btn";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML =
    "<svg viewBox='0 0 24 24' width='16' height='16' aria-hidden='true' fill='none'" +
    " stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>" +
    "<rect x='3' y='3' width='7' height='7'></rect><rect x='14' y='3' width='7' height='7'></rect>" +
    "<rect x='14' y='14' width='7' height='7'></rect><rect x='3' y='14' width='7' height='7'></rect></svg>" +
    "<span class='areas-menu__label'>" + areasLabel + "</span>" +
    "<span class='areas-menu__caret' aria-hidden='true'>\u25BE</span>";
  const labelEl = btn.querySelector(".areas-menu__label");

  const panel = document.createElement("div");
  panel.className = "areas-menu__panel";
  panel.setAttribute("role", "menu");
  panel.hidden = true;

  const heading = document.createElement("p");
  heading.className = "areas-menu__heading";
  heading.textContent = jumpLabel;
  panel.append(heading);

  const items = new Map(); // groupId -> item button
  areas.forEach((g) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "areas-menu__item";
    item.setAttribute("role", "menuitem");
    item.innerHTML =
      `<span class="areas-menu__dot" aria-hidden="true"></span>` +
      `<span class="areas-menu__name"></span>` +
      `<span class="areas-menu__count">${count(g.id)}</span>`;
    item.querySelector(".areas-menu__dot").style.background = g.color || "#0071dc";
    item.querySelector(".areas-menu__name").textContent = g.name;
    item.addEventListener("click", () => {
      close();
      onPickArea(g.id);
    });
    items.set(g.id, item);
    panel.append(item);
  });

  mountEl.append(btn, panel);

  /* ---- open / close ---- */
  function open() {
    panel.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey);
  }
  function close() {
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey);
  }
  function onDocClick(e) {
    if (!mountEl.contains(e.target)) close();
  }
  function onKey(e) {
    if (e.key === "Escape") { close(); btn.focus(); }
  }
  btn.addEventListener("click", () => (panel.hidden ? open() : close()));

  /* ---- breadcrumb: reflect the current scene's area ---- */
  function update(sceneId) {
    const scene = tour.scenes.find((s) => s.id === sceneId);
    const gid = scene?.groupId || null;
    const group = areas.find((g) => g.id === gid);
    labelEl.textContent = group ? group.name : areasLabel;
    items.forEach((el, id) => el.classList.toggle("is-current", id === gid));
  }

  return { update };
}
