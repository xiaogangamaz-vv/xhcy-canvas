import type { ComponentType } from "react"
import type { CanvasNodeRenderer } from "@/canvas/node-registry"

export type CanvasMediaNodeRenderer = Extract<CanvasNodeRenderer, "image" | "video">

export type CanvasMediaNodeRendererProps = {
  url: string
  useThumbnail?: boolean
}

function CanvasImageNodeRenderer({ url, useThumbnail }: CanvasMediaNodeRendererProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      fetchPriority={useThumbnail ? "low" : "auto"}
      className="h-full w-full rounded-md object-contain"
    />
  )
}

function CanvasVideoNodeRenderer({ url, useThumbnail }: CanvasMediaNodeRendererProps) {
  return (
    <video
      src={url}
      controls
      preload={useThumbnail ? "none" : "metadata"}
      className="h-full w-full rounded-md bg-black object-contain"
    />
  )
}

export const CANVAS_MEDIA_RENDERER_COMPONENTS = {
  image: CanvasImageNodeRenderer,
  video: CanvasVideoNodeRenderer,
} satisfies Record<CanvasMediaNodeRenderer, ComponentType<CanvasMediaNodeRendererProps>>
