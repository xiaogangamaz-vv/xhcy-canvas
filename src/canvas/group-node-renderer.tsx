import type { ComponentType } from "react"
import { canvasFrameStyle } from "@/canvas/canvas-palette"
import type { CanvasNodeRenderer } from "@/canvas/node-registry"

export type CanvasGroupNodeRenderer = Extract<CanvasNodeRenderer, "group">

export type CanvasGroupNodeRendererProps = {
  title: string
  text: string
  selected: boolean
}

/**
 * A frame that keeps a set of nodes together.
 *
 * Only the header strip takes pointer events, so the canvas inside the frame
 * stays fully usable: the frame is dragged by its label, and clicks inside it
 * reach whatever sits behind.
 */
function CanvasGroupNodeRenderer({ title, text, selected }: CanvasGroupNodeRendererProps) {
  const trimmedTitle = title.trim()
  const trimmedText = text.trim()

  return (
    <div
      style={canvasFrameStyle({ selected })}
      className="pointer-events-none h-full w-full rounded-3xl border-2 border-dashed"
    >
      <div className="pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-lg border border-border-default bg-surface-overlay/95 px-2 py-1 shadow-lg">
        <span className="truncate text-[11px] font-semibold text-text-primary">{trimmedTitle || "未命名分组"}</span>
        <span className="shrink-0 rounded-full bg-surface-hover px-1.5 text-[10px] text-text-secondary">分组</span>
        {trimmedText ? <span className="min-w-0 truncate text-[10px] text-text-weak">{trimmedText}</span> : null}
      </div>
    </div>
  )
}

export const CANVAS_GROUP_RENDERER_COMPONENTS = {
  group: CanvasGroupNodeRenderer,
} satisfies Record<CanvasGroupNodeRenderer, ComponentType<CanvasGroupNodeRendererProps>>
