import type { ComponentType, ReactNode } from "react"
import { ImageIcon, Loader2, Play } from "lucide-react"
import { GENERATION_COMPOSER_WIDTH, type FrameBox } from "@/canvas/generation-frame"
import type { CanvasNodeRenderer } from "@/canvas/node-registry"
import {
  canvasSurfaceStyle,
} from "@/canvas/canvas-palette"
import { mediaLooksLikeVideo } from "@/lib/media-cache"
import { cn } from "@/lib/utils"

export type CanvasGenerationNodeRenderer = Extract<CanvasNodeRenderer, "generation">

export type CanvasGenerationNodeRendererProps = {
  frame: FrameBox
  displayTitle: string
  sizeLabel: string
  cornerBadge: string
  isVideo: boolean
  isBusy: boolean
  selected: boolean
  highlighted?: boolean
  connectable?: boolean
  resultPreviewUrl?: string | null
  resultPreviewKind?: "image" | "video" | null
  taskStatus?: string | null
  onJumpToTasks?: () => void
  /** 该节点最新一次任务失败的原因（来自画布任务列表）。 */
  taskFailure?: { taskId: string; message: string; code: string | null; status: string } | null
  onRetryFailedTask?: (taskId: string) => void
  /** Upstream wiring counts. Kept on the contract for the inspector; not printed on the frame. */
  upstreamSummary?: { media: number; text: number; generation: number }
  composer: ReactNode
}

function CanvasGenerationNodeRenderer({
  frame,
  displayTitle,
  sizeLabel,
  cornerBadge,
  isVideo,
  isBusy,
  selected,
  highlighted,
  connectable,
  resultPreviewUrl,
  resultPreviewKind,
  taskStatus,
  onJumpToTasks,
  taskFailure,
  onRetryFailedTask,
  composer,
}: CanvasGenerationNodeRendererProps) {
  return (
    // The node box *is* the frame: the ports sit on the frame's edges and its vertical
    // middle, so nothing floats in the empty space beside the frame. The title row and the
    // composer overflow the box instead of stretching it.
    <div className="relative" style={{ width: frame.width, height: frame.height }}>
      <div
        className="absolute bottom-full left-0 mb-1.5 flex w-full flex-col gap-1"
      >
        <div
          className="flex min-w-0 items-baseline justify-between gap-2 px-0.5"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {isVideo ? (
              <Play className="h-3.5 w-3.5 shrink-0 fill-current text-text-secondary" strokeWidth={0} />
            ) : (
              <ImageIcon className="h-3.5 w-3.5 shrink-0 text-text-secondary" strokeWidth={1.8} />
            )}
            <span className="min-w-0 truncate text-[14px] font-normal text-text-primary">{displayTitle}</span>
          </div>
          <span className="shrink-0 text-[12px] tabular-nums text-text-weak">{sizeLabel}</span>
        </div>

        {/*
          The upstream chips used to print here ("上游 文本 1" …). The wiring is already read
          from the edges themselves, so the frame keeps only its title row.
        */}
      </div>

        <div
          className="relative overflow-hidden rounded-3xl border-2 transition-colors duration-150"
          // The global `* { border-color }` rule outranks border utilities, so the fill and
          // every state colour are set inline from the canvas palette.
          style={{
            ...canvasSurfaceStyle({ selected, highlighted, connectable }),
            width: frame.width,
            height: frame.height,
          }}
        >
          {resultPreviewUrl ? (
            mediaLooksLikeVideo(resultPreviewUrl, null, resultPreviewKind) ? (
              <video
                src={resultPreviewUrl}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full bg-black object-cover"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resultPreviewUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
                draggable={false}
              />
            )
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              {isBusy ? (
                <Loader2 className="h-8 w-8 animate-spin text-white/40" />
              ) : isVideo ? (
                <Play className="h-14 w-14 fill-white/40 text-white/40" strokeWidth={0} />
              ) : (
                <ImageIcon className="h-12 w-12 text-white/35" strokeWidth={1.2} />
              )}
            </div>
          )}
          {taskStatus === "failed" && onJumpToTasks ? (
            <button
              type="button"
              title="查看任务"
              className="absolute right-1.5 top-1.5 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-status-error hover:opacity-90"
              onClick={onJumpToTasks}
            >
              失败
            </button>
          ) : null}
          {/* 失败原因直接显示在节点上，是否重新生成由用户决定（批量失败同样走这里）。 */}
          {taskFailure ? (
            <div
              role="status"
              aria-label="任务失败原因"
              className="absolute inset-x-2 bottom-8 rounded-lg border border-status-error/40 bg-black/70 px-2 py-1.5 text-left"
            >
              <p className="line-clamp-2 text-[10px] leading-4 text-status-error">
                {taskFailure.code === "VIOLATION" ? "违规：" : ""}{taskFailure.message}
              </p>
              {onRetryFailedTask ? (
                <button
                  type="button"
                  className="pointer-events-auto mt-1 rounded border border-status-error/40 px-2 py-0.5 text-[10px] text-status-error hover:bg-status-error/10"
                  onClick={() => onRetryFailedTask(taskFailure.taskId)}
                >
                  重新生成
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="pointer-events-none absolute bottom-2 right-2.5 text-[11px] text-white/70">
            {cornerBadge}
          </div>
        </div>

      {composer ? (
        // Centred under the frame and overflowing the node box, so the frame keeps the
        // node's width and the ports stay on its edges.
        <div
          className="absolute left-1/2 top-full mt-3 -translate-x-1/2"
          style={{ width: GENERATION_COMPOSER_WIDTH }}
        >
          {composer}
        </div>
      ) : null}
    </div>
  )
}

export const CANVAS_GENERATION_RENDERER_COMPONENTS = {
  generation: CanvasGenerationNodeRenderer,
} satisfies Record<CanvasGenerationNodeRenderer, ComponentType<CanvasGenerationNodeRendererProps>>
