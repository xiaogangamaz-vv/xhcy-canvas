import type { ComponentType, Ref } from "react"
import type { CanvasNodeRenderer } from "@/canvas/node-registry"

export type CanvasStandardNodeRenderer = Extract<CanvasNodeRenderer, "standard">

export type CanvasStandardNodeRendererProps = {
  editing: boolean
  draft: string
  preview: string
  title: string
  error: string | null
  textareaRef: Ref<HTMLTextAreaElement>
  onDraftChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
}

function CanvasStandardNodeRenderer({
  editing,
  draft,
  preview,
  title,
  error,
  textareaRef,
  onDraftChange,
  onCommit,
  onCancel,
}: CanvasStandardNodeRendererProps) {
  return (
    <>
      {editing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={event => onDraftChange(event.target.value)}
          onBlur={onCommit}
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.preventDefault()
              onCancel()
            } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault()
              onCommit()
            }
          }}
          className="canvas-input nodrag h-full w-full resize-none rounded-md border border-border-default bg-surface-inset px-2 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-weak"
          aria-label={`编辑 ${title}`}
        />
      ) : (
        <p className={`whitespace-pre-wrap leading-5${preview.length > 160 ? " line-clamp-7" : ""}`}>{preview}</p>
      )}
      {error ? <div role="alert" className="mt-1 text-[10px] text-status-error">{error}</div> : null}
    </>
  )
}

export const CANVAS_STANDARD_RENDERER_COMPONENTS = {
  standard: CanvasStandardNodeRenderer,
} satisfies Record<CanvasStandardNodeRenderer, ComponentType<CanvasStandardNodeRendererProps>>
