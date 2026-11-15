export const CANVAS_NODE_SNAP_THRESHOLD_PX = 10

export type CanvasSnapNode = {
  id: string
  position: { x: number; y: number }
  size: { width: number; height: number }
}

export type CanvasSnapGuides = {
  x: number | null
  y: number | null
}

export type CanvasNodeSnapResult = {
  position: { x: number; y: number }
  guides: CanvasSnapGuides
}

export function canvasNodeSnapThresholdForZoom(zoom: number) {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return CANVAS_NODE_SNAP_THRESHOLD_PX / safeZoom
}

type AxisSnap = {
  delta: number
  distance: number
  guide: number
}

function axisAnchors(start: number, length: number) {
  return [start, start + length / 2, start + length] as const
}

function nearestAxisSnap(
  draggedAnchors: readonly number[],
  candidates: Array<{ id: string; anchors: readonly number[] }>,
  threshold: number,
): AxisSnap | null {
  let nearest: (AxisSnap & { candidateId: string }) | null = null

  for (const candidate of candidates) {
    for (const draggedAnchor of draggedAnchors) {
      for (const targetAnchor of candidate.anchors) {
        const delta = targetAnchor - draggedAnchor
        const distance = Math.abs(delta)
        if (distance > threshold) continue

        if (
          !nearest
          || distance < nearest.distance
          || (distance === nearest.distance && candidate.id.localeCompare(nearest.candidateId) < 0)
          || (
            distance === nearest.distance
            && candidate.id === nearest.candidateId
            && targetAnchor < nearest.guide
          )
        ) {
          nearest = {
            candidateId: candidate.id,
            delta,
            distance,
            guide: targetAnchor,
          }
        }
      }
    }
  }

  return nearest
}

/**
 * Finds the closest left/center/right and top/center/bottom alignment for one
 * dragged node. The threshold is expressed in flow coordinates; callers that
 * want a screen-pixel threshold must divide it by the current viewport zoom.
 */
export function calculateCanvasNodeSnap(
  dragged: CanvasSnapNode,
  nodes: readonly CanvasSnapNode[],
  threshold: number,
): CanvasNodeSnapResult {
  const safeThreshold = Number.isFinite(threshold) ? Math.max(0, threshold) : 0
  const candidates = nodes.filter(node => node.id !== dragged.id)
  const xSnap = nearestAxisSnap(
    axisAnchors(dragged.position.x, dragged.size.width),
    candidates.map(node => ({
      id: node.id,
      anchors: axisAnchors(node.position.x, node.size.width),
    })),
    safeThreshold,
  )
  const ySnap = nearestAxisSnap(
    axisAnchors(dragged.position.y, dragged.size.height),
    candidates.map(node => ({
      id: node.id,
      anchors: axisAnchors(node.position.y, node.size.height),
    })),
    safeThreshold,
  )

  return {
    position: {
      x: dragged.position.x + (xSnap?.delta ?? 0),
      y: dragged.position.y + (ySnap?.delta ?? 0),
    },
    guides: {
      x: xSnap?.guide ?? null,
      y: ySnap?.guide ?? null,
    },
  }
}
