import { useState } from "react"
import { BaseEdge, EdgeToolbar, useInternalNode, type EdgeProps } from "@xyflow/react"
import { X } from "lucide-react"

export type CanvasFlowEdgeData = {
  /** Injected by the workspace so the edge can remove itself. */
  onDelete?: (edgeId: string) => void
}

/** The reference canvas' curve: a cubic whose control points scale with the horizontal run. */
function connectionPath(startX: number, startY: number, endX: number, endY: number): string {
  const distance = Math.abs(endX - startX)
  const curvature = Math.max(distance * 0.5, 50)
  return `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`
}

/**
 * The canvas edge.
 *
 * The horizontal ends are drawn on the *node frames*: xyflow reports the outer edge of the
 * handle element, and a port keeps a generous hit area, so the line would start beside the
 * frame instead of on it.
 *
 * The vertical ends come from xyflow, because those are the port's real centre. A content node
 * draws its title row above the card, so its ports sit below the middle of the node box —
 * deriving the anchor from the box leaves the line 13px above the dot.
 *
 * It also draws a wide invisible path so the thin line is easy to hover, and reveals a delete
 * button at its midpoint while hovered or selected.
 */
export function CanvasFlowEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  selected,
  data,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false)
  const edgeData = (data || {}) as CanvasFlowEdgeData
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)

  // Before the nodes are measured there is no frame to read, so that first frame falls back to
  // xyflow's own handle coordinates instead of drawing from the node's left edge.
  const sourceWidth = sourceNode?.measured?.width
  const targetWidth = targetNode?.measured?.width
  const startX = sourceNode && sourceWidth ? sourceNode.internals.positionAbsolute.x + sourceWidth : sourceX
  const endX = targetNode && targetWidth ? targetNode.internals.positionAbsolute.x : targetX
  const startY = sourceY
  const endY = targetY
  const path = connectionPath(startX, startY, endX, endY)
  const labelX = (startX + endX) / 2
  const labelY = (startY + endY) / 2
  const active = hovered || selected

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        style={{ cursor: "pointer" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {edgeData.onDelete ? (
        // EdgeToolbar counter-transforms against the current zoom, so the button keeps its size
        // at every zoom level. EdgeLabelRenderer content is rendered inside the viewport and
        // scales with it — a 20px button collapses to 1.6px at the canvas's 0.08 minimum zoom.
        <EdgeToolbar
          edgeId={id}
          x={labelX}
          y={labelY}
          isVisible={active}
          className="nodrag nopan"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <button
            type="button"
            title="删除连线"
            aria-label="删除连线"
            onClick={() => edgeData.onDelete?.(id)}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-border-strong bg-surface-overlay text-text-secondary transition hover:border-white/60 hover:text-text-primary"
          >
            <X className="h-3 w-3" strokeWidth={2.4} />
          </button>
        </EdgeToolbar>
      ) : null}
    </>
  )
}

export const CANVAS_EDGE_TYPES = { canvas: CanvasFlowEdge }
