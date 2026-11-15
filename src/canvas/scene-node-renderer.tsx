import type { ComponentType } from "react"
import { canvasSceneReadinessLabels } from "@/domain/types"
import { CanvasNodeMediaPreview } from "@/canvas/node-media-preview"
import type { CanvasNodeRenderer } from "@/canvas/node-registry"

export type CanvasSceneNodeRenderer = Extract<CanvasNodeRenderer, "scene">

export type CanvasSceneNodeRendererProps = {
  text: string
  dialogue: string
  shotType: string
  cameraMovement: string
  durationSeconds: string
  readiness: string
  mediaUrl: string
  mediaKind: string
  mediaMeta: string
}

/**
 * A scene card: the story_scene@1 shot — reference frame, shot parameters, the
 * scene description and its dialogue.
 *
 * The node title stays in the card header, so this body never repeats it, and the
 * reference media arrives as a plain URL resolved from the node's assetRef.
 */
function CanvasSceneNodeRenderer({
  text,
  dialogue,
  shotType,
  cameraMovement,
  durationSeconds,
  readiness,
  mediaUrl,
  mediaKind,
  mediaMeta,
}: CanvasSceneNodeRendererProps) {
  const trimmedMedia = mediaUrl.trim()
  const trimmedMeta = mediaMeta.trim()
  const trimmedDialogue = dialogue.trim()
  const duration = durationSeconds.trim()
  const shot = [shotType.trim(), cameraMovement.trim()].filter(Boolean).join(" · ")
  const readinessLabel = canvasSceneReadinessLabels[readiness.trim()] || ""

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden">
      <CanvasNodeMediaPreview mediaUrl={mediaUrl} mediaKind={mediaKind} />

      {trimmedMedia && trimmedMeta ? (
        <div className="shrink-0 truncate text-[10px] tabular-nums text-white/45">{trimmedMeta}</div>
      ) : null}

      {shot || duration || readinessLabel ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1 text-[10px] text-text-secondary">
          {shot ? <span className="rounded bg-surface-hover px-1.5 py-0.5">{shot}</span> : null}
          {duration ? <span className="rounded bg-surface-hover px-1.5 py-0.5 tabular-nums">{duration}s</span> : null}
          {readinessLabel ? <span className="rounded bg-surface-hover px-1.5 py-0.5">{readinessLabel}</span> : null}
        </div>
      ) : null}

      {/* Each block caps its own height and scrolls: a long description must never
          push the dialogue out of the card. */}
      <div className="max-h-20 shrink-0 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-4 text-white/70">
        {text.trim() || <span className="text-white/30">无场景描述</span>}
      </div>

      {trimmedDialogue ? (
        <div className="max-h-16 shrink-0 overflow-auto border-l border-white/20 pl-2 text-[11px] leading-4 text-white/55">
          <span className="mr-1 text-white/35">对白</span>
          <span className="whitespace-pre-wrap break-words">{trimmedDialogue}</span>
        </div>
      ) : null}
    </div>
  )
}

export const CANVAS_SCENE_RENDERER_COMPONENTS = {
  scene: CanvasSceneNodeRenderer,
} satisfies Record<CanvasSceneNodeRenderer, ComponentType<CanvasSceneNodeRendererProps>>
