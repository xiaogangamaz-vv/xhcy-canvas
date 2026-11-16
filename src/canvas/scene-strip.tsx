import { ChevronDown, ChevronUp, Clapperboard, Plus } from "lucide-react"
import { CANVAS_FILL, CANVAS_FRAME_FILL, canvasBorderColor } from "@/canvas/canvas-palette"
import { cn } from "@/lib/utils"
import type { CanvasSceneSequenceEntry } from "@/canvas/scene-sequence"

export type CanvasSceneStripProps = {
  entries: CanvasSceneSequenceEntry[]
  selectedSceneId: string | null
  open: boolean
  pending: boolean
  onToggle: () => void
  onSelect: (nodeId: string) => void
  onCreate: () => void
}

/**
 * The storyboard strip: every scene node on the canvas, in canvas order.
 *
 * It is a projection, not a second source of truth — selecting an entry selects
 * the node, and the sequence order follows the node positions, so dragging a
 * scene on the canvas reorders the strip.
 */
export function CanvasSceneStrip({
  entries,
  selectedSceneId,
  open,
  pending,
  onToggle,
  onSelect,
  onCreate,
}: CanvasSceneStripProps) {
  const bodyId = "canvas-scene-strip-body"

  return (
    <div
      className="pointer-events-auto w-full rounded-xl border border-border-default shadow-2xl backdrop-blur"
      style={{ background: CANVAS_FILL }}
      role="region"
      aria-label="分镜条"
    >
      <div className="flex h-9 items-center gap-1.5 px-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          title={open ? "收起分镜条" : "展开分镜条"}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary"
        >
          <Clapperboard className="h-3.5 w-3.5 text-text-secondary" />
          <span>分镜</span>
          <span className="rounded-full bg-surface-hover px-1.5 text-[10px] tabular-nums text-text-secondary">{entries.length}</span>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>

        {entries.length === 0 ? (
          <span className="min-w-0 flex-1 truncate text-[11px] text-text-weak">
            还没有场景节点 — 点右侧「新增场景」，或双击画布空白处添加
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[11px] text-text-weak">按画布从左到右的顺序排列，拖动节点即可调整分镜顺序</span>
        )}

        <button
          type="button"
          onClick={onCreate}
          disabled={pending}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border-default px-2 text-[11px] font-medium text-text-primary hover:bg-surface-hover disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>{pending ? "创建中…" : "新增场景"}</span>
        </button>
      </div>

      {open && entries.length > 0 ? (
        <div id={bodyId} className="ui-scrollbar flex gap-2 overflow-x-auto px-1.5 pb-1.5">
          {entries.map((entry, index) => {
            const selected = entry.id === selectedSceneId
            const mediaUrl = entry.mediaUrl.trim()
            const isVideo = entry.mediaKind.trim() === "video"
            return (
              <button
                key={entry.id}
                type="button"
                data-scene-strip-id={entry.id}
                aria-current={selected ? "true" : undefined}
                title={entry.title}
                onClick={() => onSelect(entry.id)}
                // Canvas palette: the selected chip is white-bordered and carries a
                // white badge — no accent colour on the canvas surface. The border is
                // inline because the global `* { border-color }` rule outranks utilities.
                // Canvas palette: the strip shares the node fill, and the selected chip steps up
                // to the frame fill; the border colour is inline (see the palette note).
                style={{
                  borderColor: canvasBorderColor({ selected }),
                  background: selected ? CANVAS_FRAME_FILL : CANVAS_FILL,
                }}
                className="flex w-44 shrink-0 flex-col gap-1 rounded-2xl border p-1.5 text-left transition"
              >
                <span className="flex items-center gap-1.5">
                  <span className="rounded bg-surface-hover px-1 text-[10px] font-semibold tabular-nums text-text-secondary">{String(index + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-text-primary">{entry.title}</span>
                </span>
                <span className="flex h-[54px] w-full items-center justify-center overflow-hidden rounded-md bg-black/40">
                  {mediaUrl && !isVideo ? (
                    <img src={mediaUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[10px] text-text-weak">{isVideo ? "VID" : "无预览"}</span>
                  )}
                </span>
                <span className="line-clamp-2 h-8 text-[10px] leading-4 text-text-secondary">{entry.text.trim() || "无场景描述"}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
