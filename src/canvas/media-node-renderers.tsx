import type { ComponentType, DragEvent } from "react"
import { ImagePlus, Music, Upload, Video } from "lucide-react"
import type { CanvasNodeRenderer } from "@/canvas/node-registry"

export type CanvasMediaNodeRenderer = Extract<CanvasNodeRenderer, "image" | "video">

export type CanvasMediaNodeRendererProps = {
  url: string
  useThumbnail?: boolean
}

export type CanvasMediaEmptyStateProps = {
  kind: "image" | "video" | "audio"
  onPick: () => void
  onDropFiles?: (files: File[]) => void
}

export function CanvasMediaEmptyState({ kind, onPick, onDropFiles }: CanvasMediaEmptyStateProps) {
  const label = kind === "audio" ? "上传音频到此节点" : kind === "video" ? "上传视频到此节点" : "上传图片到此节点"
  const hint = kind === "audio" ? "或把音频文件拖到这里" : "或把文件拖到这个节点上"
  const Icon = kind === "audio" ? Music : kind === "video" ? Video : ImagePlus
  return (
    <div
      className="flex h-full min-h-[96px] w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-white/15 bg-black/20 px-3 text-center"
      onDragOver={event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy" }}
      onDrop={(event: DragEvent) => {
        event.preventDefault()
        event.stopPropagation()
        const files = Array.from(event.dataTransfer.files)
        if (files.length) onDropFiles?.(files)
      }}
    >
      <Icon className="h-6 w-6 text-white/35" />
      <button
        type="button"
        className="nodrag inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] text-text-primary hover:bg-white/16"
        onClick={event => { event.stopPropagation(); onPick() }}
      >
        <Upload className="h-3 w-3" />
        {label}
      </button>
      <p className="text-[10px] text-text-weak">{hint}</p>
    </div>
  )
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