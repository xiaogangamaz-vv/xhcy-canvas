import type { ComponentType, RefObject } from "react"
import {
  TextRichEditor as CanvasTextEditor,
  documentToHtml as canvasDocumentToHtml,
  type TextEditorHandle,
} from "@/canvas/text-editor"
import type { CanvasNodeRenderer } from "@/canvas/node-registry"
import type { TextDocument } from "@/domain/text-document"

export type CanvasTextNodeRenderer = Extract<CanvasNodeRenderer, "text">

export type CanvasTextSelectionRange = {
  blockIndex: number
  from: number
  to: number
}

export type CanvasTextNodeRendererProps = {
  editing: boolean
  editorRef: RefObject<TextEditorHandle | null>
  document: TextDocument
  previewDocument: TextDocument
  textColorCss: string | null
  error: string | null
  onDocumentChange: (document: TextDocument) => void
  onSelectionChange: (range: CanvasTextSelectionRange | null) => void
}

function CanvasTextNodeRenderer({
  editing,
  editorRef,
  document,
  previewDocument,
  textColorCss,
  error,
  onDocumentChange,
  onSelectionChange,
}: CanvasTextNodeRendererProps) {
  const previewHtml = editing ? "" : canvasDocumentToHtml(previewDocument)

  return (
    <>
      {editing ? (
        <div className="h-full w-full">
          <CanvasTextEditor
            ref={editorRef}
            textDocument={document}
            placeholder="Add a note..."
            textColor={textColorCss}
            fontSize={12}
            lineHeight={1.6}
            textAlign="left"
            editable
            onChangeDocument={onDocumentChange}
            onSelectionChange={onSelectionChange}
          />
        </div>
      ) : (
        <div className="canvas-text-preview h-full w-full overflow-auto break-words text-white/85">
          {previewHtml
            ? <div className="leading-5" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            : <span className="text-white/35">Add a note...</span>}
        </div>
      )}
      {error ? <div role="alert" className="mt-1 text-[10px] text-status-error">{error}</div> : null}
    </>
  )
}

export const CANVAS_TEXT_RENDERER_COMPONENTS = {
  text: CanvasTextNodeRenderer,
} satisfies Record<CanvasTextNodeRenderer, ComponentType<CanvasTextNodeRendererProps>>
