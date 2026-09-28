/**
 * group-actions.js - group ("area") + scene-group operations for the builder.
 *
 * Extracted from builder.js (kept lean under the 600-line guideline). Factory:
 * hand it the shared state + a few callbacks and it returns the handlers the
 * grouped scene list wires to. SRP: all "what happens to a group / a scene's
 * membership" logic lives here; builder.js just wires buttons.
 */

import { createGroup, createScene } from "../player-template/js/tour-model.js?v=4";

/**
 * @param {object} ctx
 * @param {object} ctx.state                  shared builder state ({tour, currentSceneId})
 * @param {() => void} ctx.refresh            re-render the scene list
 * @param {(id:string) => void} ctx.selectScene  select a scene (renders editor + preview)
 * @param {(msg:string, isErr?:boolean) => void} ctx.toast
 */
export function createGroupActions({ state, refresh, selectScene, toast }) {
  const scenes = () => state.tour.scenes;
  const groups = () => (state.tour.groups ||= []); // defensive: older sessions
  const norm = (g) => g || null; // treat "" and undefined as Ungrouped

  /** Create a new empty area and re-render (author fills it via + Add / drag). */
  function addGroup() {
    const group = createGroup({ name: `Area ${groups().length + 1}` });
    groups().push(group);
    refresh();
    // New areas render at the bottom (below Uncategorized) - bring it into view
    // and confirm, so it doesn't feel like "nothing happened" on big tours.
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-group-id="${group.id}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    toast?.(`Created \u201c${group.name}\u201d \u2014 rename it or add scenes.`);
    return group;
  }

  function renameGroup(id, name) {
    const g = groups().find((x) => x.id === id);
    if (!g) return;
    const next = (name ?? "").trim();
    if (next) g.name = next;
    refresh();
  }

  /** Delete an area; its scenes are kept but fall back to Ungrouped. */
  function deleteGroup(id) {
    const g = groups().find((x) => x.id === id);
    if (!g) return;
    const members = scenes().filter((s) => norm(s.groupId) === id);
    if (
      members.length &&
      !confirm(
        `Delete area "${g.name}"? Its ${members.length} scene(s) will move to ` +
          `Uncategorized (the scenes themselves are NOT deleted).`
      )
    ) {
      return;
    }
    members.forEach((s) => (s.groupId = null));
    state.tour.groups = groups().filter((x) => x.id !== id);
    refresh();
  }

  /** Add a brand-new scene directly into a group (null = Uncategorized). */
  function addSceneToGroup(groupId) {
    const scene = createScene({
      name: `Scene ${scenes().length + 1}`,
      groupId: norm(groupId),
    });
    scenes().push(scene);
    if (!state.tour.meta.startSceneId) state.tour.meta.startSceneId = scene.id;
    selectScene(scene.id); // also refreshes list + editor + preview
  }

  /**
   * Move a scene into targetGroup, optionally before a sibling (drag-and-drop).
   * One flat scenes[] array is the source of truth; display order within a
   * group is just its members' relative order here. Inserting "before X" or
   * appending to a group both reduce to a splice.
   */
  function moveSceneToGroup(sceneId, targetGroupId, beforeSceneId = null) {
    const arr = scenes();
    const scene = arr.find((s) => s.id === sceneId);
    if (!scene) return;
    const target = norm(targetGroupId);
    if (sceneId === beforeSceneId) return; // dropped on itself

    scene.groupId = target;
    arr.splice(arr.indexOf(scene), 1); // pull it out first

    let insertAt;
    if (beforeSceneId) {
      insertAt = arr.findIndex((s) => s.id === beforeSceneId);
      if (insertAt < 0) insertAt = arr.length;
    } else {
      // Append after the group's current last member (keeps areas readable).
      insertAt = arr.length;
      for (let i = arr.length - 1; i >= 0; i--) {
        if (norm(arr[i].groupId) === target) { insertAt = i + 1; break; }
      }
    }
    arr.splice(insertAt, 0, scene);
    refresh();
  }

  /** Choose which scene a visitor lands on when jumping to this area. */
  function setGroupEntry(groupId, sceneId) {
    const g = groups().find((x) => x.id === groupId);
    if (!g) return;
    g.entrySceneId = sceneId || "";
    refresh();
    toast?.("Set as this area's entry scene.");
  }

  /**
   * Recolor an area (data only - NO refresh). The caller updates the dot +
   * row accents live, so the native color picker isn't destroyed mid-drag by a
   * full re-render (that made the picker snap shut on the first click).
   */
  function setGroupColor(groupId, color) {
    const g = groups().find((x) => x.id === groupId);
    if (g) g.color = color;
  }

  return {
    addGroup,
    renameGroup,
    deleteGroup,
    addSceneToGroup,
    moveSceneToGroup,
    setGroupEntry,
    setGroupColor,
  };
}
