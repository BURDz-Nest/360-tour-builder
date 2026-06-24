/**
 * marker-icons.js — the library of animated icons users can pick for markers.
 *
 * SHARED by builder (picker + preview) and player (runtime rendering). PURE:
 * no DOM, no PSV, no fetch. Just an SVG/string registry. SOLID:
 *   - Single source of truth for what icons exist and what they look like.
 *   - Separate sets per marker type (nav vs info) so the picker shows only
 *     icons that semantically fit (a "stairs" icon for an info popup is silly).
 *   - Defaults declared here so every code path (preview, player, validation)
 *     resolves the same way: getIcon(type, marker.icon) -> the chosen icon, or
 *     the type's default if the id is unknown / blank (back-compat).
 *
 * Each icon entry: { id, label, body, anim }
 *   id    - stable string written to tour.json (don't rename without migration)
 *   label - human-readable name shown in the builder picker
 *   body  - inner SVG (no <svg> wrapper; we wrap at render time so the
 *           viewBox and size live in one place)
 *   anim  - one of ANIMATIONS keys; the CSS class applied to the wrapping
 *           <span> so animations are themable in app.css
 */

/** Animation tokens. Renderer maps to "tour-anim--<token>" CSS classes. */
export const ANIMATIONS = Object.freeze({
  PULSE: "pulse",     // gentle scale + opacity pulse on the icon itself
  RING: "ring",       // expanding ring behind the icon (the Panoee look)
  BOB: "bob",         // vertical bob, good for floor-anchored waypoints
  SPIN: "spin",       // slow continuous rotation (compass-style)
  TWINKLE: "twinkle", // opacity twinkle, sparkles/stars
});

/** Inner-SVG building blocks. White stroke/fill so they pop on any panorama. */
const STROKE = `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
const FILL = `fill="currentColor"`;

/* ============================================================ */
/* NAV waypoints (used by "link" markers — go to another scene) */
/* ============================================================ */

export const NAV_ICONS = Object.freeze({
  waypoint: {
    id: "waypoint",
    label: "Waypoint pin",
    anim: ANIMATIONS.PULSE,
    body: `<path d="M16 2C10.5 2 6 6.5 6 12c0 7.5 10 18 10 18s10-10.5 10-18C26 6.5 21.5 2 16 2z" ${FILL}/>
           <circle cx="16" cy="12" r="3.6" fill="#fff"/>`,
  },
  arrow: {
    id: "arrow",
    label: "Floor arrow",
    anim: ANIMATIONS.BOB,
    body: `<path d="M16 4 L26 18 L20 18 L20 28 L12 28 L12 18 L6 18 Z" ${FILL}/>`,
  },
  chevrons: {
    id: "chevrons",
    label: "Chevrons forward",
    anim: ANIMATIONS.BOB,
    body: `<path d="M8 8 L16 16 L8 24" ${STROKE}/>
           <path d="M16 8 L24 16 L16 24" ${STROKE}/>`,
  },
  circle_arrow: {
    id: "circle_arrow",
    label: "Arrow in ring",
    anim: ANIMATIONS.RING,
    body: `<circle cx="16" cy="16" r="13" stroke="currentColor" stroke-width="2" fill="none"/>
           <path d="M16 9 L22 16 L18 16 L18 22 L14 22 L14 16 L10 16 Z" ${FILL}/>`,
  },
  footsteps: {
    id: "footsteps",
    label: "Footsteps",
    anim: ANIMATIONS.BOB,
    body: `<ellipse cx="10" cy="20" rx="3.5" ry="5" ${FILL}/>
           <circle cx="7.5" cy="13.5" r="1.4" ${FILL}/>
           <circle cx="9.5" cy="11.5" r="1.2" ${FILL}/>
           <circle cx="11.8" cy="11" r="1.2" ${FILL}/>
           <ellipse cx="22" cy="14" rx="3.5" ry="5" ${FILL}/>
           <circle cx="19.5" cy="7.5" r="1.4" ${FILL}/>
           <circle cx="21.5" cy="5.5" r="1.2" ${FILL}/>
           <circle cx="23.8" cy="5" r="1.2" ${FILL}/>`,
  },
  door: {
    id: "door",
    label: "Door",
    anim: ANIMATIONS.PULSE,
    body: `<rect x="8" y="4" width="16" height="24" rx="1.5" ${STROKE}/>
           <circle cx="20" cy="17" r="1.4" ${FILL}/>`,
  },
  stairs_up: {
    id: "stairs_up",
    label: "Stairs up",
    anim: ANIMATIONS.BOB,
    body: `<path d="M4 26 L11 26 L11 21 L17 21 L17 16 L23 16 L23 11 L28 11" ${STROKE}/>
           <path d="M22 6 L28 6 L28 12" ${STROKE}/>`,
  },
  stairs_down: {
    id: "stairs_down",
    label: "Stairs down",
    anim: ANIMATIONS.BOB,
    body: `<path d="M4 6 L11 6 L11 11 L17 11 L17 16 L23 16 L23 21 L28 21" ${STROKE}/>
           <path d="M22 26 L28 26 L28 20" ${STROKE}/>`,
  },
  elevator: {
    id: "elevator",
    label: "Elevator",
    anim: ANIMATIONS.PULSE,
    body: `<rect x="6" y="4" width="20" height="24" rx="1.5" ${STROKE}/>
           <path d="M16 4 L16 28" ${STROKE}/>
           <path d="M11 12 L11 8 L13 10 Z" ${FILL}/>
           <path d="M21 20 L21 24 L19 22 Z" ${FILL}/>`,
  },
  exit: {
    id: "exit",
    label: "Exit",
    anim: ANIMATIONS.PULSE,
    body: `<path d="M18 4 L26 4 L26 28 L18 28" ${STROKE}/>
           <path d="M4 16 L20 16" ${STROKE}/>
           <path d="M14 10 L20 16 L14 22" ${STROKE}/>`,
  },
  compass: {
    id: "compass",
    label: "Compass",
    anim: ANIMATIONS.SPIN,
    body: `<circle cx="16" cy="16" r="13" stroke="currentColor" stroke-width="2" fill="none"/>
           <path d="M16 7 L19 16 L16 25 L13 16 Z" ${FILL}/>`,
  },
  parking: {
    id: "parking",
    label: "Parking / area",
    anim: ANIMATIONS.PULSE,
    body: `<rect x="5" y="5" width="22" height="22" rx="3" stroke="currentColor" stroke-width="2" fill="none"/>
           <path d="M13 23 L13 9 L18 9 a4 4 0 1 1 0 8 L13 17" ${STROKE}/>`,
  },
});

/* ============================================================ */
/* INFO pins (used by "info" markers — open a popup) */
/* ============================================================ */

export const INFO_ICONS = Object.freeze({
  info: {
    id: "info",
    label: "Info (i)",
    anim: ANIMATIONS.RING,
    body: `<circle cx="16" cy="16" r="13" ${FILL}/>
           <text x="16" y="22" text-anchor="middle" font-size="16" font-weight="700" font-family="serif" fill="#fff">i</text>`,
  },
  question: {
    id: "question",
    label: "Question",
    anim: ANIMATIONS.RING,
    body: `<circle cx="16" cy="16" r="13" ${FILL}/>
           <text x="16" y="22" text-anchor="middle" font-size="16" font-weight="700" font-family="sans-serif" fill="#fff">?</text>`,
  },
  star: {
    id: "star",
    label: "Star",
    anim: ANIMATIONS.TWINKLE,
    body: `<path d="M16 3 L19.6 12 L29 12.8 L21.8 19 L24 28 L16 23 L8 28 L10.2 19 L3 12.8 L12.4 12 Z" ${FILL}/>`,
  },
  sparkles: {
    id: "sparkles",
    label: "Sparkles",
    anim: ANIMATIONS.TWINKLE,
    body: `<path d="M12 4 L13.5 9 L18 10.5 L13.5 12 L12 17 L10.5 12 L6 10.5 L10.5 9 Z" ${FILL}/>
           <path d="M22 14 L23 18 L27 19 L23 20 L22 24 L21 20 L17 19 L21 18 Z" ${FILL}/>`,
  },
  eye: {
    id: "eye",
    label: "Look at this",
    anim: ANIMATIONS.PULSE,
    body: `<path d="M2 16 C 7 8, 25 8, 30 16 C 25 24, 7 24, 2 16 Z" ${STROKE}/>
           <circle cx="16" cy="16" r="4" ${FILL}/>`,
  },
  phone: {
    id: "phone",
    label: "Phone",
    anim: ANIMATIONS.PULSE,
    body: `<path d="M7 5 a3 3 0 0 1 3 -3 h3 l3 7 l-3 2 a14 14 0 0 0 8 8 l2 -3 l7 3 v3 a3 3 0 0 1 -3 3 C 16 25 7 16 7 5 Z" ${FILL}/>`,
  },
  email: {
    id: "email",
    label: "Email",
    anim: ANIMATIONS.PULSE,
    body: `<rect x="3" y="7" width="26" height="18" rx="2" ${STROKE}/>
           <path d="M3 9 L16 18 L29 9" ${STROKE}/>`,
  },
  camera: {
    id: "camera",
    label: "Photo",
    anim: ANIMATIONS.PULSE,
    body: `<path d="M5 9 L11 9 L13 6 L19 6 L21 9 L27 9 a2 2 0 0 1 2 2 v13 a2 2 0 0 1 -2 2 H5 a2 2 0 0 1 -2 -2 V11 a2 2 0 0 1 2 -2 Z" ${STROKE}/>
           <circle cx="16" cy="17" r="5" ${STROKE}/>`,
  },
  video: {
    id: "video",
    label: "Video",
    anim: ANIMATIONS.PULSE,
    body: `<rect x="3" y="8" width="20" height="16" rx="2" ${STROKE}/>
           <path d="M23 14 L29 10 L29 22 L23 18 Z" ${STROKE}/>
           <path d="M11 12 L11 20 L17 16 Z" ${FILL}/>`,
  },
  audio: {
    id: "audio",
    label: "Audio",
    anim: ANIMATIONS.PULSE,
    body: `<path d="M5 12 L11 12 L17 7 L17 25 L11 20 L5 20 Z" ${FILL}/>
           <path d="M21 11 a7 7 0 0 1 0 10" ${STROKE}/>
           <path d="M24 8 a11 11 0 0 1 0 16" ${STROKE}/>`,
  },
  clock: {
    id: "clock",
    label: "Hours / time",
    anim: ANIMATIONS.PULSE,
    body: `<circle cx="16" cy="16" r="13" ${STROKE}/>
           <path d="M16 8 L16 16 L22 19" ${STROKE}/>`,
  },
  warning: {
    id: "warning",
    label: "Warning",
    anim: ANIMATIONS.RING,
    body: `<path d="M16 3 L30 27 L2 27 Z" ${FILL}/>
           <path d="M16 12 L16 20" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
           <circle cx="16" cy="24" r="1.4" fill="#fff"/>`,
  },
  cart: {
    id: "cart",
    label: "Shopping",
    anim: ANIMATIONS.PULSE,
    body: `<path d="M3 5 L7 5 L10 22 L26 22 L29 10 L9 10" ${STROKE}/>
           <circle cx="12" cy="27" r="2" ${FILL}/>
           <circle cx="24" cy="27" r="2" ${FILL}/>`,
  },
  location: {
    id: "location",
    label: "Location",
    anim: ANIMATIONS.PULSE,
    body: `<path d="M16 2 C 10 2, 6 7, 6 12 c 0 7 10 18 10 18 s 10 -11 10 -18 c 0 -5 -4 -10 -10 -10 Z" ${STROKE}/>
           <circle cx="16" cy="12" r="3.5" ${FILL}/>`,
  },
});

/** Defaults per marker type. These are the icons used when marker.icon is "". */
export const DEFAULT_ICON_ID = Object.freeze({
  link: "waypoint",
  info: "info",
});

/** Lookup. Returns the matching icon, or the type's default if id is unknown. */
export function getIcon(type, id) {
  const set = type === "link" ? NAV_ICONS : INFO_ICONS;
  if (id && Object.prototype.hasOwnProperty.call(set, id)) return set[id];
  return set[DEFAULT_ICON_ID[type] || DEFAULT_ICON_ID.info];
}

/** Return all icons for a marker type as an array (for builders / pickers). */
export function listIcons(type) {
  const set = type === "link" ? NAV_ICONS : INFO_ICONS;
  return Object.values(set);
}

/**
 * Render an icon to a complete <svg> element string.
 *  - `size` is the rendered px size (also viewBox is 32x32 internally).
 *  - `extraClass` lets callers add e.g. "tour-info-pin" / "tour-waypoint".
 */
export function renderIconSvg(icon, size = 36, extraClass = "") {
  const cls = ["tour-marker-icon__svg", extraClass].filter(Boolean).join(" ");
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" class="${cls}" aria-hidden="true" focusable="false">${icon.body}</svg>`;
}

/**
 * Render the full marker HTML: a positioned wrapper with the chosen animation
 * class + the SVG inside. The wrapper is what PSV places at yaw/pitch.
 *
 *   variant: "nav" or "info" — drives the colour theme via CSS.
 */
export function renderMarkerHtml({ type, iconId, size = 40, variant }) {
  const icon = getIcon(type, iconId);
  const animClass = `tour-anim--${icon.anim}`;
  const variantClass = `tour-marker--${variant || (type === "link" ? "nav" : "info")}`;
  return `<span class="tour-marker ${variantClass} ${animClass}" data-icon="${icon.id}">
    <span class="tour-marker__ring" aria-hidden="true"></span>
    ${renderIconSvg(icon, size)}
  </span>`;
}
