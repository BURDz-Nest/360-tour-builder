/**
 * tour-model.js — the single source of truth for the tour.json schema.
 *
 * SHARED by the builder (index.html) and the player (player.html).
 * Pure data + logic only — NO DOM, NO Photo-Sphere-Viewer imports here.
 * That separation keeps this testable and keeps us honest (SOLID: SRP).
 *
 * tour.json shape (version 1):
 * {
 *   "version": 1,
 *   "meta": { title, description, author, startSceneId, createdAt },
 *   "scenes": [
 *     {
 *       id, name, panorama (URL), thumbnail (URL|""), caption,
 *       initialView: { yaw, pitch, zoom },   // yaw/pitch in DEGREES, zoom 0-100
 *       markers: [
 *         // ICON pin (default): glyph at a single yaw/pitch.
 *         { id, type:"link"|"info", yaw, pitch, label, icon,
 *           targetSceneId (link only), html (info only) },
 *         // INFO ZONE: transparent polygon hotspot (Storyline-style).
 *         { id, type:"info", shape:"zone", label, html,
 *           points:[{yaw,pitch},...],   // 3+ corners, DEGREES
 *           idleStroke:false,           // faint always-on outline?
 *           hoverColor:"#0071dc" }      // tint shown on hover
 *       ]
 *     }
 *   ]
 * }
 *
 * `shape` defaults to "icon" and is only stored for zones, so existing
 * tour.json files load unchanged (back-compat).
 *
 * Angles are stored as human-friendly DEGREES (numbers). The PSV adapter
 * converts them to the "<n>deg" strings Photo-Sphere-Viewer expects.
 */

export const SCHEMA_VERSION = 1;

export const MARKER_TYPES = Object.freeze({
  LINK: "link",
  INFO: "info",
});

/**
 * INFO markers come in two shapes:
 *   - "icon": a glyph pin (the classic info hotspot)
 *   - "zone": a transparent polygon region (Storyline-style hotspot) that
 *     reveals on hover and opens the same info popup on click.
 * Shape only applies to INFO markers; LINK markers are always icons.
 */
export const MARKER_SHAPES = Object.freeze({
  ICON: "icon",
  ZONE: "zone",
});

/** Default hover tint for zones (Walmart Blue, matches nav waypoints). */
export const DEFAULT_ZONE_HOVER = "#0071dc";

/** Crypto-ish short id good enough for in-tour uniqueness. */
export function makeId(prefix = "id") {
  const rand = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36).slice(-4);
  return `${prefix}_${time}${rand}`;
}

/** Turn a free-text name into a stable, URL/JSON-safe slug. */
export function slugify(text, fallback = "scene") {
  const slug = String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

export function createEmptyTour() {
  return {
    version: SCHEMA_VERSION,
    meta: {
      title: "Untitled Tour",
      description: "",
      author: "",
      startSceneId: "",
      showThumbnails: true,
      showWaypointShadows: true,
      createdAt: new Date().toISOString(),
    },
    scenes: [],
  };
}

export function createScene({ name = "New Scene", panorama = "" } = {}) {
  return {
    id: makeId("scene"),
    name,
    panorama,
    thumbnail: "",
    caption: "",
    initialView: { yaw: 0, pitch: 0, zoom: 50 },
    markers: [],
  };
}

export function createMarker({
  type = MARKER_TYPES.LINK,
  shape = MARKER_SHAPES.ICON,
  yaw = 0,
  pitch = 0,
  label = "",
  targetSceneId = "",
  html = "",
  icon = "",
  points = null,
  idleStroke = false,
  hoverColor = DEFAULT_ZONE_HOVER,
} = {}) {
  // INFO ZONE: a polygon hotspot. No single position - the corners live in
  // `points` (DEGREES). Falls back to a default quad if given too few points.
  if (type === MARKER_TYPES.INFO && shape === MARKER_SHAPES.ZONE) {
    return {
      id: makeId("mk"),
      type: MARKER_TYPES.INFO,
      shape: MARKER_SHAPES.ZONE,
      label,
      html,
      points:
        Array.isArray(points) && points.length >= 3
          ? points.map((p) => ({ yaw: num(p.yaw, 0), pitch: num(p.pitch, 0) }))
          : defaultZonePoints(yaw, pitch),
      // false -> fully transparent until hover; true -> faint always-on stroke.
      idleStroke: !!idleStroke,
      hoverColor: hoverColor || DEFAULT_ZONE_HOVER,
    };
  }
  // ICON marker (link or info): single position + an icon from marker-icons.js.
  return {
    id: makeId("mk"),
    type,
    yaw,
    pitch,
    label,
    // "" means "use the type's default icon" (resolved by marker-icons.js).
    // Storing blank instead of the default id keeps old tour.json files small
    // and lets us change the default later without touching saved data.
    icon,
    ...(type === MARKER_TYPES.LINK ? { targetSceneId } : { html }),
  };
}

/**
 * Build a default 4-corner quad centered on a yaw/pitch (DEGREES), wound
 * clockwise from the top-left. Authors then drag the corners to fit.
 */
export function defaultZonePoints(centerYaw = 0, centerPitch = 0, halfW = 12, halfH = 9) {
  return [
    { yaw: centerYaw - halfW, pitch: centerPitch + halfH },
    { yaw: centerYaw + halfW, pitch: centerPitch + halfH },
    { yaw: centerYaw + halfW, pitch: centerPitch - halfH },
    { yaw: centerYaw - halfW, pitch: centerPitch - halfH },
  ];
}

/** True if a marker is an info zone (polygon) rather than a glyph pin. */
export function isZone(marker) {
  return marker?.type === MARKER_TYPES.INFO && marker?.shape === MARKER_SHAPES.ZONE;
}

/** Look up a scene by id (or undefined). */
export function getScene(tour, sceneId) {
  return tour?.scenes?.find((s) => s.id === sceneId);
}

/** The scene the player should open first (explicit start, else first scene). */
export function resolveStartScene(tour) {
  if (!tour?.scenes?.length) return undefined;
  return getScene(tour, tour.meta?.startSceneId) || tour.scenes[0];
}

/**
 * Validate + normalize a parsed tour object.
 * Returns { ok, tour, errors:[], warnings:[] }.
 * We REPAIR what we safely can (defaults) and ERROR on the unrecoverable.
 */
export function validateTour(raw) {
  const errors = [];
  const warnings = [];

  if (!raw || typeof raw !== "object") {
    return { ok: false, tour: null, errors: ["Config is not a JSON object."], warnings };
  }

  const tour = createEmptyTour();

  if (raw.version && raw.version !== SCHEMA_VERSION) {
    warnings.push(
      `Config version ${raw.version} != supported ${SCHEMA_VERSION}; attempting to load anyway.`
    );
  }

  // ---- meta ----
  const meta = raw.meta && typeof raw.meta === "object" ? raw.meta : {};
  tour.meta.title = String(meta.title || "Untitled Tour");
  tour.meta.description = String(meta.description || "");
  tour.meta.author = String(meta.author || "");
  tour.meta.showThumbnails = meta.showThumbnails !== false; // default on
  // Floating ground shadow under nav waypoints — default on (the new look).
  tour.meta.showWaypointShadows = meta.showWaypointShadows !== false;
  tour.meta.createdAt = String(meta.createdAt || tour.meta.createdAt);

  // ---- scenes ----
  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) {
    errors.push("Config has no scenes.");
    return { ok: false, tour: null, errors, warnings };
  }

  const seenIds = new Set();
  raw.scenes.forEach((rawScene, idx) => {
    if (!rawScene || typeof rawScene !== "object") {
      warnings.push(`Scene #${idx} is not an object; skipped.`);
      return;
    }
    const scene = createScene();
    scene.id = rawScene.id ? String(rawScene.id) : scene.id;
    if (seenIds.has(scene.id)) {
      const fixed = `${scene.id}_${idx}`;
      warnings.push(`Duplicate scene id "${scene.id}" renamed to "${fixed}".`);
      scene.id = fixed;
    }
    seenIds.add(scene.id);

    scene.name = String(rawScene.name || `Scene ${idx + 1}`);
    scene.panorama = String(rawScene.panorama || "");
    scene.thumbnail = String(rawScene.thumbnail || "");
    scene.caption = String(rawScene.caption || "");

    if (!scene.panorama) {
      warnings.push(`Scene "${scene.name}" has no panorama URL.`);
    }

    const iv = rawScene.initialView || {};
    scene.initialView = {
      yaw: num(iv.yaw, 0),
      pitch: num(iv.pitch, 0),
      zoom: clamp(num(iv.zoom, 50), 0, 100),
    };

    scene.markers = Array.isArray(rawScene.markers)
      ? rawScene.markers.map((m) => normalizeMarker(m)).filter(Boolean)
      : [];

    tour.scenes.push(scene);
  });

  if (tour.scenes.length === 0) {
    errors.push("No valid scenes after parsing.");
    return { ok: false, tour: null, errors, warnings };
  }

  // ---- start scene ----
  const desiredStart = String(meta.startSceneId || "");
  tour.meta.startSceneId = seenIds.has(desiredStart)
    ? desiredStart
    : tour.scenes[0].id;
  if (desiredStart && !seenIds.has(desiredStart)) {
    warnings.push(`startSceneId "${desiredStart}" not found; using first scene.`);
  }

  // ---- referential integrity for link markers ----
  for (const scene of tour.scenes) {
    for (const m of scene.markers) {
      if (m.type === MARKER_TYPES.LINK && !seenIds.has(m.targetSceneId)) {
        warnings.push(
          `Scene "${scene.name}" has a link marker to missing scene "${m.targetSceneId}".`
        );
      }
    }
  }

  return { ok: true, tour, errors, warnings };
}

function normalizeMarker(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = raw.type === MARKER_TYPES.INFO ? MARKER_TYPES.INFO : MARKER_TYPES.LINK;
  const zone = type === MARKER_TYPES.INFO && raw.shape === MARKER_SHAPES.ZONE;
  const marker = createMarker({
    type,
    shape: zone ? MARKER_SHAPES.ZONE : MARKER_SHAPES.ICON,
    yaw: num(raw.yaw, 0),
    pitch: num(raw.pitch, 0),
    label: String(raw.label || ""),
    targetSceneId: String(raw.targetSceneId || ""),
    html: String(raw.html || ""),
    icon: String(raw.icon || ""),
    points: Array.isArray(raw.points) ? raw.points : null,
    idleStroke: !!raw.idleStroke,
    hoverColor: raw.hoverColor ? String(raw.hoverColor) : undefined,
  });
  if (raw.id) marker.id = String(raw.id);
  return marker;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
