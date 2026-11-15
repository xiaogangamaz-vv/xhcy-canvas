/**
 * Canvas graph rules.
 *
 * Pure functions shared by the canvas (live validation while dragging a connection) so a cycle cannot be introduced when an edge is added. walk forward from the
 * proposed target and ask whether it can already reach the proposed source.
 */

export type CanvasGraphEdge = { source: string; target: string }

export function wouldCreateCanvasCycle(
  edges: readonly CanvasGraphEdge[],
  source: string,
  target: string,
): boolean {
  if (!source || !target) return false
  if (source === target) return true
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const outgoing = adjacency.get(edge.source)
    if (outgoing) outgoing.push(edge.target)
    else adjacency.set(edge.source, [edge.target])
  }
  const visited = new Set<string>()
  const reachesSource = (node: string): boolean => {
    if (node === source) return true
    if (visited.has(node)) return false
    visited.add(node)
    return (adjacency.get(node) || []).some(reachesSource)
  }
  return reachesSource(target)
}

/**
 * The closest aspect ratio the model supports for a measured asset.
 *
 * Returns null when nothing is measurable or the model declares no ratios, so the caller
 * keeps the user's own choice instead of guessing.
 */
export function closestCanvasAspectRatio(
  width: number | null | undefined,
  height: number | null | undefined,
  supported: readonly string[],
): string | null {
  if (!width || !height || width <= 0 || height <= 0 || supported.length === 0) return null
  const target = width / height
  let best: string | null = null
  let bestDelta = Number.POSITIVE_INFINITY
  for (const ratio of supported) {
    const parts = String(ratio).split(":").map(Number)
    if (parts.length !== 2 || !parts.every(value => Number.isFinite(value) && value > 0)) continue
    const delta = Math.abs(parts[0] / parts[1] - target)
    if (delta < bestDelta) {
      bestDelta = delta
      best = ratio
    }
  }
  return best
}

/** The two module pairs a connection may switch between; a specialized module is left alone. */
export const CANVAS_IMAGE_MODULE_PAIR = ["text-to-image", "image-to-image"] as const
export const CANVAS_VIDEO_MODULE_PAIR = ["text-to-video", "image-to-video"] as const

/**
 * The module a generation node should run once its inputs change.
 *
 * Connecting an image turns a text-to-image node into an image edit, and a text-to-video node
 * into image-to-video; disconnecting the last image turns it back. Modules outside those pairs
 * (a try-on or pattern workflow, for instance) keep their own mode.
 */
export function canvasConnectionDrivenModule(input: {
  currentModuleKey: string
  mediaType: string
  imageUpstreamCount: number
}): string | null {
  const pair = input.mediaType === "image"
    ? CANVAS_IMAGE_MODULE_PAIR
    : input.mediaType === "video"
      ? CANVAS_VIDEO_MODULE_PAIR
      : null
  if (!pair) return null
  if (!(pair as readonly string[]).includes(input.currentModuleKey)) return null
  const next = input.imageUpstreamCount > 0 ? pair[1] : pair[0]
  return next === input.currentModuleKey ? null : next
}
