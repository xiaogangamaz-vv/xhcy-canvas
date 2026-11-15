import { Handle, Position, type HandleType } from "@xyflow/react"
import { Plus } from "lucide-react"
import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"
import {
  CANVAS_MUTED,
  CANVAS_PANEL,
} from "@/canvas/canvas-palette"

export type CanvasPlusHandleVariant = "source" | "target" | "ref"

const VARIANT_LABELS: Record<CanvasPlusHandleVariant, string> = {
  source: "输出",
  target: "输入",
  ref: "参考",
}

/**
 * A canvas port: a 12px circle with a plus inside, centred on the node's edge.
 *
 * The port stays hidden until it is needed — the pointer is on the node (`group-hover/node`),
 * the node is selected (which is also how a touch user reveals it, since there is no hover),
 * or the node is a candidate target for the connection being dragged (`reveal`). The reference
 * canvas prints nothing on the canvas at rest, and a visible port on every node is what made
 * the canvas read as cluttered.
 *
 * The hit area stays 24px on purpose: `connectionRadius` supplies the forgiveness when a
 * connection is dragged, so a bigger DOM target would only swallow pointer events meant for
 * the node card underneath it.
 */
export function CanvasPlusHandle({
  type,
  id,
  position,
  variant,
  label,
  style,
  reveal,
}: {
  type: HandleType
  id?: string
  position: Position
  variant: CanvasPlusHandleVariant
  label?: string
  style?: CSSProperties
  /** Shown even without hover: the node is selected, or it can accept the connection being dragged. */
  reveal?: boolean
}) {
  const resolvedLabel = label || VARIANT_LABELS[variant]
  return (
    <Handle
      type={type}
      id={id}
      position={position}
      aria-label={resolvedLabel}
      title={resolvedLabel}
      style={style}
      className={cn(
        "group/handle !z-30 !flex !h-6 !min-h-6 !w-6 !min-w-6 !cursor-crosshair !items-center !justify-center !rounded-full !border-0 !bg-transparent",
        "opacity-0 transition-opacity duration-150 group-hover/node:opacity-100",
        reveal && "!opacity-100",
        "focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-white/50",
      )}
    >
      <span
        className="pointer-events-none flex h-3.5 w-3.5 items-center justify-center rounded-full border-2"
        style={{ background: CANVAS_PANEL, borderColor: CANVAS_MUTED }}
      >
        <Plus className="h-2.5 w-2.5" strokeWidth={3} style={{ color: CANVAS_MUTED }} aria-hidden="true" />
      </span>
    </Handle>
  )
}
