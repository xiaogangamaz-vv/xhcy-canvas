export type CanvasSceneSequenceEntry = {
  id: string
  title: string
  text: string
  mediaUrl: string
  mediaKind: string
  mediaMeta: string
  x: number
  y: number
}

/** Matches the titles this module generates, and any hand-typed "Scene 3" / "scene-3". */
const SCENE_TITLE_PATTERN = /^scene[ -]?(\d+)$/i

/** Horizontal gap between a new scene node and the rightmost existing one. */
export const CANVAS_SCENE_POSITION_GAP = 48

/** Storyboard order: left to right, then top to bottom. */
export function sortCanvasSceneEntries<T extends { x: number; y: number }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => Math.round(a.x) - Math.round(b.x) || Math.round(a.y) - Math.round(b.y))
}

/**
 * The next free "Scene NN" title.
 *
 * Numbering follows the highest title already on the canvas, so deleting a
 * middle scene frees its number instead of shifting every later scene.
 */
export function nextCanvasSceneTitle(existingTitles: readonly string[]): string {
  let highest = 0
  for (const title of existingTitles) {
    const match = SCENE_TITLE_PATTERN.exec(String(title ?? "").trim())
    if (!match) continue
    const value = Number(match[1])
    if (Number.isFinite(value) && value > highest) highest = value
  }
  return `Scene ${String(highest + 1).padStart(2, "0")}`
}

/**
 * Where a new scene node lands: one gap right of the rightmost scene, aligned
 * with the topmost one. With no scenes yet, the fallback point is centered.
 */
export function nextCanvasScenePosition(
  entries: readonly { x: number; y: number }[],
  size: { width: number; height: number },
  fallback: { x: number; y: number },
): { x: number; y: number } {
  if (entries.length === 0) {
    return { x: Math.round(fallback.x - size.width / 2), y: Math.round(fallback.y - size.height / 2) }
  }
  const rightEdge = Math.max(...entries.map(entry => entry.x + size.width))
  const topEdge = Math.min(...entries.map(entry => entry.y))
  return { x: Math.round(rightEdge + CANVAS_SCENE_POSITION_GAP), y: Math.round(topEdge) }
}
