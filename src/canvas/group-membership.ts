export type CanvasGroupRect = {
  id: string
  type?: string
  x: number
  y: number
  width: number
  height: number
}

export type CanvasGroupMember = {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/** A node belongs to a frame when its centre sits inside the frame. */
export function canvasGroupContains(rect: Pick<CanvasGroupRect, "x" | "y" | "width" | "height">, member: CanvasGroupMember): boolean {
  const centreX = member.x + member.width / 2
  const centreY = member.y + member.height / 2
  return centreX >= rect.x
    && centreX <= rect.x + rect.width
    && centreY >= rect.y
    && centreY <= rect.y + rect.height
}

/**
 * The nodes a frame currently holds, by geometry.
 *
 * Membership is derived instead of stored: a frame is a view over the canvas, so
 * moving or resizing it never leaves a stale parent/child relation behind. Frames
 * never nest, so other frames are excluded.
 */
export function canvasGroupMemberIds(
  group: CanvasGroupRect,
  nodes: readonly (CanvasGroupMember & { type?: string })[],
): string[] {
  return nodes
    .filter(node => node.id !== group.id && node.type !== "group" && canvasGroupContains(group, node))
    .map(node => node.id)
}
