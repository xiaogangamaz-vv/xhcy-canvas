import {
  createPrevisProjector,
  type PrevisCamera,
  type PrevisRenderFrame,
  type PrevisScene,
} from "@/previs"

/**
 * Painting a previs frame onto a 2D context.
 *
 * Shared by the node's live viewport and the shot export that renders a blockout
 * PNG for the generation node, so the reference image a model receives is the same
 * picture the user is looking at — one painter, no drift.
 */

export const PREVIS_PAINT = {
  sky: "#141210",
  groundBase: 236,
  entityBase: 232,
  shadowBase: 176,
  grid: "rgba(245,245,244,0.13)",
} as const

function shadeColor(base: number, shade: number): string {
  const value = Math.max(8, Math.min(255, Math.round(base * (0.35 + 0.65 * shade))))
  return `rgb(${value},${value},${Math.max(6, value - 3)})`
}

export function paintPrevisFrame(
  context: CanvasRenderingContext2D,
  input: {
    scene: PrevisScene
    frame: PrevisRenderFrame
    camera: PrevisCamera
    width: number
    height: number
    timeSeconds: number
    /** Ground grid: useful while authoring, noise for a reference image. */
    showGrid?: boolean
    /** Rule-of-thirds reticle: viewport affordance only. */
    showReticle?: boolean
  },
): void {
  const { scene, frame, camera, width, height, timeSeconds } = input

  context.fillStyle = PREVIS_PAINT.sky
  context.fillRect(0, 0, width, height)

  if (input.showGrid && scene.world.grid) {
    const projector = createPrevisProjector({ scene, camera, width, height, timeSeconds })
    context.strokeStyle = PREVIS_PAINT.grid
    context.lineWidth = 1
    const extent = Math.min(scene.world.groundHalfExtent, 20)
    for (let line = -extent; line <= extent; line += 2) {
      for (const points of [
        [[line, 0, -extent], [line, 0, extent]],
        [[-extent, 0, line], [extent, 0, line]],
      ] as Array<Array<[number, number, number]>>) {
        const from = projector.project(points[0])
        const to = projector.project(points[1])
        if (!from || !to) continue
        context.beginPath()
        context.moveTo(from[0], from[1])
        context.lineTo(to[0], to[1])
        context.stroke()
      }
    }
  }

  for (const polygon of frame.polygons) {
    const base = polygon.kind === "ground"
      ? PREVIS_PAINT.groundBase
      : polygon.kind === "shadow"
        ? PREVIS_PAINT.shadowBase
        : PREVIS_PAINT.entityBase
    context.beginPath()
    context.moveTo(polygon.points[0][0], polygon.points[0][1])
    for (let index = 1; index < polygon.points.length; index += 1) {
      context.lineTo(polygon.points[index][0], polygon.points[index][1])
    }
    context.closePath()
    context.fillStyle = polygon.kind === "shadow"
      ? `rgba(0,0,0,${Math.round((1 - polygon.shade) * 42)})`
      : shadeColor(base, polygon.shade)
    context.fill()
    context.strokeStyle = "rgba(0,0,0,0.18)"
    context.lineWidth = 0.5
    context.stroke()
  }

  if (input.showReticle) {
    context.strokeStyle = "rgba(245,245,244,0.10)"
    context.lineWidth = 1
    for (const ratio of [1 / 3, 2 / 3]) {
      context.beginPath()
      context.moveTo(width * ratio, 0)
      context.lineTo(width * ratio, height)
      context.stroke()
      context.beginPath()
      context.moveTo(0, height * ratio)
      context.lineTo(width, height * ratio)
      context.stroke()
    }
  }
}
