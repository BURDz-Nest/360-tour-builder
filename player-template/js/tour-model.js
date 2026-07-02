/**
 * tour-model.js — the single source of truth for the tour.json schema.
 *
 * SHARED by the builder (index.html) and the player (player.html).
 * Pure data + logic only — NO DOM, NO Photo-Sphere-Viewer imports here.
 * That separation keeps this testable and keeps us honest (SOLID: SRP).
 *
 * tour.json shape (version 2):
 * {
 *   "version": 2,
 *   "meta": { title, description, author, startSceneId, createdAt },
 *   "groups": [                          // NEW in v2 - ordered "areas"
 *     { id, name, color, entrySceneId }  // entrySceneId = where you land when
 *   ],                                   //   you jump to this area ("" = first)
 *   "scenes": [
 *     {
 *       id, name, panorama (URL), thumbnail (URL|""), caption,
 *       groupId,                          // NEW in v2 - group id or null (ungrouped)
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
 * BACK-COMPAT: v1 files (no `groups`, no `scene.groupId`) load unchanged -
 * every scene is treated as Ungrouped. `shape` still defaults to "icon" and is
 * only stored for zones, so old marker data loads as-is too.
 *
 * Angles are stored as human-friendly DEGREES (numbers). The PSV adapter
 * converts them to the "<n>deg" strings Photo-Sphere-Viewer expects.
 */

export const SCHEMA_VERSION = 2;

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

/** Default accent color for a new area/group (Walmart Blue). */
export const DEFAULT_GROUP_COLOR = "#0071dc";

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
    groups: [],
    scenes: [],
  };
}

/**
 * A group ("area") is an ordered, named bucket of scenes for large tours.
 * `entrySceneId` is where the player lands when a visitor jumps to this area;
 * "" means "use the first scene of this group" (resolved at read time).
 */
export function createGroup({ name = "New Area", color = DEFAULT_GROUP_COLOR } = {}) {
  return {
    id: makeId("grp"),
    name,
    color: color || DEFAULT_GROUP_COLOR,
    entrySceneId: "",
  };
}

export function createScene({ name = "New Scene", panorama = "", groupId = null } = {}) {
  return {
    id: makeId("scene"),
    name,
    panorama,
    thumbnail: "",
    caption: "",
    groupId: groupId || null,
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

/** Look up a group by id (or undefined). */
export function getGroup(tour, groupId) {
  return tour?.groups?.find((g) => g.id === groupId);
}

/** All scenes belonging to a group, in tour scene order. */
export function scenesInGroup(tour, groupId) {
  return (tour?.scenes || []).filter((s) => (s.groupId || null) === (groupId || null));
}

/**
 * The scene a visitor lands on when they jump to a group:
 *   1. the group's explicit entrySceneId (if it's still in that group), else
 *   2. the first scene of that group (top of the list), else
 *   3. undefined (empty group).
 */
export function resolveGroupEntryScene(tour, groupId) {
  const members = scenesInGroup(tour, groupId);
  if (!members.length) return undefined;
  const group = getGroup(tour, groupId);
  const explicit = group?.entrySceneId
    ? members.find((s) => s.id === group.entrySceneId)
    : undefined;
  return explicit || members[0];
}

/**
 * Render order for grouped UIs (builder list + player Areas menu): each group
 * in its stored order with its member scenes, then an "Ungrouped" bucket last
 * if any scenes have no group. Groups with zero scenes are still included so
 * the author can see/fill them in the builder.
 * @returns {Array<{group: object|null, scenes: object[]}>}
 */
export function listAreas(tour) {
  const out = (tour?.groups || []).map((group) => ({
    group,
    scenes: scenesInGroup(tour, group.id),
  }));
  const ungrouped = scenesInGroup(tour, null);
  if (ungrouped.length) out.push({ group: null, scenes: ungrouped });
  return out;
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

  if (raw.version && raw.version > SCHEMA_VERSION) {
    warnings.push(
      `Config version ${raw.version} is newer than supported ${SCHEMA_VERSION}; attempting to load anyway.`
    );
  }

  // ---- groups ("areas") - optional; absent in v1 files ----
  const groupIds = new Set();
  if (Array.isArray(raw.groups)) {
    raw.groups.forEach((rawGroup, idx) => {
      if (!rawGroup || typeof rawGroup !== "object") {
        warnings.push(`Group #${idx} is not an object; skipped.`);
        return;
      }
      const group = createGroup();
      group.id = rawGroup.id ? String(rawGroup.id) : group.id;
      if (groupIds.has(group.id)) {
        const fixed = `${group.id}_${idx}`;
        warnings.push(`Duplicate group id "${group.id}" renamed to "${fixed}".`);
        group.id = fixed;
      }
      groupIds.add(group.id);
      group.name = String(rawGroup.name || `Area ${idx + 1}`);
      group.color = rawGroup.color ? String(rawGroup.color) : DEFAULT_GROUP_COLOR;
      group.entrySceneId = String(rawGroup.entrySceneId || ""); // validated after scenes load
      tour.groups.push(group);
    });
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

    // Group membership: keep only references to groups that actually exist,
    // otherwise fall back to Ungrouped (null). v1 scenes have no groupId.
    const rawGroupId = rawScene.groupId ? String(rawScene.groupId) : null;
    if (rawGroupId && !groupIds.has(rawGroupId)) {
      warnings.push(`Scene "${scene.name}" references missing group "${rawGroupId}"; ungrouped.`);
      scene.groupId = null;
    } else {
      scene.groupId = rawGroupId;
    }

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

  // ---- group entry scenes: must be a member of that group, else auto ("") ----
  for (const group of tour.groups) {
    if (!group.entrySceneId) continue;
    const inGroup = tour.scenes.some(
      (s) => s.id === group.entrySceneId && s.groupId === group.id
    );
    if (!inGroup) {
      warnings.push(
        `Area "${group.name}" entry scene is not in that area; using its first scene.`
      );
      group.entrySceneId = "";
    }
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
