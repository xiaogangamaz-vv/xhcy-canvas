import type { ComponentType } from "react"
import { CanvasNodeMediaPreview } from "@/canvas/node-media-preview"
import type { CanvasNodeRenderer } from "@/canvas/node-registry"

export type CanvasCharacterNodeRenderer = Extract<CanvasNodeRenderer, "character">

export type CanvasCharacterNodeRendererProps = {
  text: string
  mediaUrl: string
  mediaKind: string
  mediaMeta: string
}

/**
 * A character card: the character sheet text plus the reference image chosen
 * for it. Same shape as a scene card, with its own wording — the node title in
 * the card header is the character's name.
 */
function CanvasCharacterNodeRenderer({
  text,
  mediaUrl,
  mediaKind,
  mediaMeta,
}: CanvasCharacterNodeRendererProps) {
  const trimmedMedia = mediaUrl.trim()
  const trimmedMeta = mediaMeta.trim()

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden">
      <CanvasNodeMediaPreview mediaUrl={mediaUrl} mediaKind={mediaKind} />

      {trimmedMedia && trimmedMeta ? (
        <div className="shrink-0 truncate text-[10px] tabular-nums text-white/45">{trimmedMeta}</div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-4 text-white/70">
        {text.trim() || <span className="text-white/30">无角色设定</span>}
      </div>
    </div>
  )
}

export const CANVAS_CHARACTER_RENDERER_COMPONENTS = {
  character: CanvasCharacterNodeRenderer,
} satisfies Record<CanvasCharacterNodeRenderer, ComponentType<CanvasCharacterNodeRendererProps>>
