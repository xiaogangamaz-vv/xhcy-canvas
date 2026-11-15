import type { ComponentType } from "react"
import type { CanvasNodeRenderer } from "@/canvas/node-registry"

type StubProps = {
  title?: string
  text?: string
}

function Placeholder({ title, text }: StubProps) {
  return (
    <div className="flex h-full w-full flex-col justify-center gap-1 overflow-hidden">
      {title ? <div className="text-[11px] font-medium text-text-secondary">{title}</div> : null}
      <p className="whitespace-pre-wrap text-xs leading-5 text-text-weak">{text || ""}</p>
    </div>
  )
}

export const CANVAS_GENERATION_RENDERER_COMPONENTS = {
  generation: Placeholder,
} satisfies Record<Extract<CanvasNodeRenderer, "generation">, ComponentType<StubProps>>

export const CANVAS_STORYBOARD_RENDERER_COMPONENTS = {
  storyboard: Placeholder,
} satisfies Record<Extract<CanvasNodeRenderer, "storyboard">, ComponentType<StubProps>>

export const CANVAS_PREVIS_RENDERER_COMPONENTS = {
  previs: Placeholder,
} satisfies Record<Extract<CanvasNodeRenderer, "previs">, ComponentType<StubProps>>