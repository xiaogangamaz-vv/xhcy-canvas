import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  NodeResizer,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  useViewport,
  type Connection,
  type ConnectionLineComponentProps,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnConnectStart,
  type OnMoveEnd,
  type Viewport,
} from "@xyflow/react"
import {
  ImagePlus,
  Keyboard,
  Map as MapIcon,
  Maximize2,
  Plus,
  Redo2,
  Undo2,
  Upload,
  Video as VideoIcon,
  X,
} from "lucide-react"
import type { CanvasDocument, HostPort } from "@/adapters/host"
import type { CanvasImageModelCatalog, CanvasVideoModelCatalog } from "@/adapters/model-catalog"
import {
  clampDraftToModel,
  resolveImageModelOptions,
  resolveVideoModelOptions,
} from "@/adapters/model-catalog"
import { MOCK_OWNER_ID } from "@/adapters/mock"
import { CANVAS_EDGE_TYPES } from "@/canvas/canvas-edge"
import {
  CANVAS_BACKGROUND,
  CANVAS_CONNECTION_IDLE,
  CANVAS_CONNECTION_INVALID,
  CANVAS_CONNECTION_VALID,
  CANVAS_DOT,
  CANVAS_TOOLBAR_BORDER,
  CANVAS_TOOLBAR_PANEL,
  canvasSurfaceStyle,
} from "@/canvas/canvas-palette"
import { canvasMotionDuration } from "@/canvas/canvas-motion"
import {
  CANVAS_UPLOAD_ACCEPT,
  nodeTypeFromAsset,
  paramsFromAsset,
  splitCanvasUploadFiles,
  uploadCanvasMedia,
} from "@/canvas/canvas-upload"
import {
  buildCanvasClipboard,
  canPasteCanvasClipboard,
  canvasClipboardEdgePayloads,
  canvasClipboardNodeBody,
  canvasClipboardOffset,
  type CanvasClipboardPayload,
} from "@/canvas/clipboard"
import { canvasGroupMemberIds } from "@/canvas/group-membership"
import { CANVAS_CHARACTER_RENDERER_COMPONENTS } from "@/canvas/character-node-renderer"
import { CANVAS_GROUP_RENDERER_COMPONENTS } from "@/canvas/group-node-renderer"
import { CANVAS_MEDIA_RENDERER_COMPONENTS } from "@/canvas/media-node-renderers"
import { CanvasPlusHandle } from "@/canvas/node-handle"
import {
  CANVAS_NODE_REGISTRY,
  CANVAS_QUICK_ADD_NODE_TYPES,
  canConnectCanvasRegistryNodeInstances,
  createDefaultCanvasNodeParams,
} from "@/canvas/node-registry"
import {
  calculateCanvasNodeSnap,
  canvasNodeSnapThresholdForZoom,
  type CanvasSnapGuides,
  type CanvasSnapNode,
} from "@/canvas/node-snap"
import { applyCanvasNodeVisualData } from "@/canvas/node-visual-data"
import { CANVAS_SCENE_RENDERER_COMPONENTS } from "@/canvas/scene-node-renderer"
import { CANVAS_SHORTCUTS_LEFT, CANVAS_SHORTCUTS_RIGHT } from "@/canvas/shortcuts"
import { CanvasNodeComposer, type CanvasNodeComposerConfig } from "@/canvas/node-composer"
import { CanvasPrevisInspector } from "@/canvas/previs-inspector"
import { CANVAS_PREVIS_RENDERER_COMPONENTS } from "@/canvas/previs-node-renderer"
import { CANVAS_GENERATION_RENDERER_COMPONENTS } from "@/canvas/generation-node-renderer"
import {
  displayPixelSize,
  frameBoxForNode,
  frameBoxFromAspectRatio,
  frameCornerBadge,
} from "@/canvas/generation-frame"
import { CANVAS_STANDARD_RENDERER_COMPONENTS } from "@/canvas/standard-node-renderer"
import {
  addCanvasStoryboardScene,
  canvasStoryboardLayout,
  canvasStoryboardLayoutLabels,
  canvasStoryboardLayouts,
  moveCanvasStoryboardScene,
  parseCanvasStoryboardParams,
  pruneCanvasStoryboardSceneIds,
  removeCanvasStoryboardScene,
  resolveCanvasStoryboardSceneIdsForPaste,
  serializeCanvasStoryboardParams,
} from "@/canvas/storyboard"
import { CanvasSceneStrip } from "@/canvas/scene-strip"
import { nextCanvasScenePosition, nextCanvasSceneTitle, sortCanvasSceneEntries, type CanvasSceneSequenceEntry } from "@/canvas/scene-sequence"
import { canvasScriptDocumentKind, parseCanvasStoryOutline, summarizeCanvasStoryOutline } from "@/canvas/script-outline"
import { previsDocumentScene, safeParsePrevisDocument } from "@/previs"
import { deriveCanvasUpstreamReferences } from "@/domain/edge-references"
import { type TextEditorHandle } from "@/canvas/text-editor"
import { CANVAS_TEXT_RENDERER_COMPONENTS } from "@/canvas/text-node-renderer"
import { resolveTextColorCss } from "@/canvas/text-styles"
import { TextToolbar, type TextToolbarState } from "@/canvas/text-toolbar"
import { useCanvasEvents } from "@/canvas/use-canvas-events"
import { contentToDocument, documentToContent } from "@/domain/text-document-codec"
import { isTextDocument, type TextDocument } from "@/domain/text-document"
import { wouldCreateCanvasCycle } from "@/domain/graph"
import { connectionEndpointFromCanvasNode, type CanvasAsset, type CanvasEdge, type CanvasNode, type CanvasNodeType } from "@/domain/types"
import { clipboardImageFiles } from "@/lib/image-clipboard"
import { cn } from "@/lib/utils"
import { useCanvasStore } from "@/store/canvas-store"

const FLOW_NODE_TYPE = "canvasNode"
const NODE_MIN_WIDTH = 180
const NODE_MAX_WIDTH = 960
const NODE_MIN_HEIGHT = 120
const NODE_MAX_HEIGHT = 720
const SAVE_DEBOUNCE_MS = 300
const UNDO_LIMIT = 80

type FlowNodeData = {
  rawNode: CanvasNode
  onInlineSave?: (node: CanvasNode, params: Record<string, string>) => Promise<void>
  onDelete?: (nodeId: string) => void
  highlighted?: boolean
  connectable?: boolean
  useThumbnail?: boolean
  composer?: CanvasNodeComposerConfig | null
  taskStatus?: CanvasNode["status"] | null
  resultPreviewUrl?: string | null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function paramString(params: object, key: string, fallback = "") {
  const value = (params as Record<string, unknown>)[key]
  return typeof value === "string" ? value : fallback
}

function asParams(params: CanvasNode["params"]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value
  }
  return out
}

function nodePreviewText(node: CanvasNode) {
  if (node.type === "text") return paramString(node.params, "text")
  if (node.type === "script") {
    if (canvasScriptDocumentKind(paramString(node.params, "documentKind")) === "story_outline") {
      const outline = parseCanvasStoryOutline(paramString(node.params, "outline"))
      if (outline) {
        const { acts, shots } = summarizeCanvasStoryOutline(outline)
        const synopsis = outline.synopsis.trim().slice(0, 60)
        return `分镜大纲 · ${acts} 幕 ${shots} 镜头${synopsis ? `\n${synopsis}` : ""}`
      }
      return "分镜大纲（尚未添加幕或镜头）"
    }
    return paramString(node.params, "script") || "Script nodes organize shots, narration, and creative context."
  }
  if (node.type === "scene" || node.type === "character" || node.type === "group") return paramString(node.params, "text")
  if (node.type === "storyboard") {
    const ids = parseCanvasStoryboardParams(node.params).sceneNodeIds
    return ids.length ? `分镜板 · ${ids.length} 个分镜` : "分镜板（还没有分镜）"
  }
  if (node.type === "generation") return paramString(node.params, "prompt") || "Generation nodes only save parameters in this sprint."
  if (node.type === "audio") return paramString(node.params, "title") || "Audio asset placeholder node."
  if (node.type === "previs") return previsSceneSummary(paramString(node.params, "document")) || "3D 预演（还没有场景）"
  return paramString(node.params, "caption") || paramString(node.params, "url") || "Media asset placeholder node."
}

function previsSceneSummary(documentJson: string): string {
  if (!documentJson.trim()) return ""
  try {
    const document = safeParsePrevisDocument(JSON.parse(documentJson))
    if (!document) return ""
    const scene = previsDocumentScene(document)
    const characters = scene.entities.filter(entity => entity.role === "character").map(entity => entity.name)
    return characters.length
      ? `3D 预演 · ${characters.join(" / ")}`
      : `3D 预演 · ${scene.entities.length} 实体`
  } catch {
    return ""
  }
}

function nodeGenerationMediaType(node: CanvasNode): string {
  if (node.type !== "generation") return "image"
  return paramString(node.params, "mediaType", "image")
}

function generationResolvedParams(
  node: CanvasNode,
  draft?: Record<string, string> | null,
): { mediaType: string; aspectRatio: string; resolution: string; imageSize: string; durationSeconds: string } {
  const mediaType = draft?.mediaType || nodeGenerationMediaType(node)
  const isVideo = mediaType === "video"
  return {
    mediaType,
    aspectRatio: draft?.aspectRatio || paramString(node.params, "aspectRatio", isVideo ? "16:9" : "auto"),
    resolution: draft?.resolution || paramString(node.params, "resolution", "720p"),
    imageSize: draft?.imageSize || paramString(node.params, "imageSize", "2K"),
    durationSeconds: draft?.durationSeconds || paramString(node.params, "durationSeconds", "4"),
  }
}

function generationDisplayTitle(mediaType: string, nodeTitle: string): string {
  if (mediaType === "video") return "Video Generator"
  if (mediaType === "image") return "Image Generator"
  if (nodeTitle && nodeTitle !== "生成节点") return nodeTitle
  return "Image Generator"
}

function defaultGenerationParams(mediaType: "image" | "video", modelId: string): Record<string, string> {
  const defaults = createDefaultCanvasNodeParams("generation")
  if (mediaType === "video") {
    return {
      ...defaults,
      mediaType: "video",
      moduleKey: "text-to-video",
      aspectRatio: "16:9",
      resolution: "720p",
      durationSeconds: "4",
      modelId,
      mode: "text_to_video",
    }
  }
  return {
    ...defaults,
    mediaType: "image",
    moduleKey: "text-to-image",
    aspectRatio: "auto",
    modelId,
  }
}

type CanvasAddMenuEntry =
  | { kind: "node"; key: string; type: CanvasNodeType }
  | { kind: "upload"; key: string; label: string }
  | { kind: "generation"; key: string; mediaType: "image" | "video"; label: string }

const CANVAS_ADD_MENU_GROUPS: Array<{ key: string; label: string; entries: CanvasAddMenuEntry[] }> = [
  {
    key: "nodes",
    label: "节点",
    entries: [
      { kind: "node", key: "text", type: "text" },
      { kind: "node", key: "image", type: "image" },
      { kind: "node", key: "video", type: "video" },
    ],
  },
  {
    key: "generate",
    label: "生成",
    entries: [
      { kind: "generation", key: "ai-image", mediaType: "image", label: "AI 生图" },
      { kind: "generation", key: "ai-video", mediaType: "video", label: "AI 生视频" },
    ],
  },
  {
    key: "structure",
    label: "结构化",
    entries: [
      { kind: "node", key: "scene", type: "scene" },
      { kind: "node", key: "character", type: "character" },
      { kind: "node", key: "group", type: "group" },
      { kind: "node", key: "storyboard", type: "storyboard" },
      { kind: "node", key: "script", type: "script" },
      { kind: "node", key: "audio", type: "audio" },
    ],
  },
  {
    key: "three-d",
    label: "3D",
    entries: [{ kind: "node", key: "previs", type: "previs" }],
  },
  {
    key: "source",
    label: "素材",
    entries: [{ kind: "upload", key: "upload", label: "上传素材" }],
  },
]

const REFERENCE_ACCEPT_KINDS_IMAGE = ["image"] as const
const REFERENCE_ACCEPT_KINDS_VIDEO = ["image", "video", "audio"] as const
const EMPTY_COMPOSER_REFS: CanvasNodeComposerConfig["referenceRefs"] = []

function toFlowNode(node: CanvasNode, actions?: Pick<FlowNodeData, "onInlineSave" | "onDelete">): Node<FlowNodeData> {
  return {
    id: node.id,
    type: FLOW_NODE_TYPE,
    position: node.position,
    width: node.size.width,
    height: node.size.height,
    ...(node.type === "group" ? { style: { pointerEvents: "none" as const } } : {}),
    data: {
      rawNode: node,
      onInlineSave: actions?.onInlineSave,
      onDelete: actions?.onDelete,
    },
  }
}

function toFlowEdge(edge: CanvasEdge): Edge {
  return {
    id: edge.id,
    type: "canvas",
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    sourceHandle: edge.sourceHandle || undefined,
    targetHandle: edge.targetHandle || undefined,
  }
}

function toSnapNode(node: Node<FlowNodeData>): CanvasSnapNode {
  return {
    id: node.id,
    position: node.position,
    size: {
      width: node.measured?.width ?? node.width ?? node.data.rawNode.size.width,
      height: node.measured?.height ?? node.height ?? node.data.rawNode.size.height,
    },
  }
}

function CanvasSnapGuideLines({ guides }: { guides: CanvasSnapGuides | null }) {
  const { zoom } = useViewport()
  if (!guides) return null
  const lineThickness = 1 / Math.max(zoom, 0.01)
  return (
    <ViewportPortal>
      {guides.x !== null ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-[1000] bg-white/40"
          style={{ left: guides.x - lineThickness / 2, top: -100_000, width: lineThickness, height: 200_000 }}
        />
      ) : null}
      {guides.y !== null ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-[1000] bg-white/40"
          style={{ left: -100_000, top: guides.y - lineThickness / 2, width: 200_000, height: lineThickness }}
        />
      ) : null}
    </ViewportPortal>
  )
}

function CanvasConnectionLine({ fromX, fromY, toX, toY, connectionStatus }: ConnectionLineComponentProps<Node<FlowNodeData>>) {
  const stroke = connectionStatus === "valid"
    ? CANVAS_CONNECTION_VALID
    : connectionStatus === "invalid"
      ? CANVAS_CONNECTION_INVALID
      : CANVAS_CONNECTION_IDLE
  const d = `M ${fromX} ${fromY} C ${fromX + 60} ${fromY} ${toX - 60} ${toY} ${toX} ${toY}`
  return (
    <g>
      <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeDasharray={connectionStatus === "valid" ? "0" : "6 4"} />
      <circle cx={toX} cy={toY} r={4} fill={stroke} />
    </g>
  )
}

function newBlockId() {
  return crypto.randomUUID()
}

function textDocumentFromNode(node: CanvasNode): TextDocument {
  const raw = paramString(node.params, "text")
  return contentToDocument(raw, newBlockId)
}

const CanvasNodeCard = memo(function CanvasNodeCard({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const node = data.rawNode
  const nodeDefinition = CANVAS_NODE_REGISTRY[node.type]
  const renderer = nodeDefinition.renderer
  const MediaRenderer = renderer === "image" || renderer === "video" ? CANVAS_MEDIA_RENDERER_COMPONENTS[renderer] : null
  const StandardRenderer = renderer === "standard" ? CANVAS_STANDARD_RENDERER_COMPONENTS[renderer] : null
  const TextRenderer = renderer === "text" ? CANVAS_TEXT_RENDERER_COMPONENTS[renderer] : null
  const GenerationRenderer = renderer === "generation" ? CANVAS_GENERATION_RENDERER_COMPONENTS[renderer] : null
  const SceneRenderer = renderer === "scene" ? CANVAS_SCENE_RENDERER_COMPONENTS[renderer] : null
  const CharacterRenderer = renderer === "character" ? CANVAS_CHARACTER_RENDERER_COMPONENTS[renderer] : null
  const GroupRenderer = renderer === "group" ? CANVAS_GROUP_RENDERER_COMPONENTS[renderer] : null
  const PrevisRenderer = renderer === "previs" ? CANVAS_PREVIS_RENDERER_COMPONENTS[renderer] : null
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [textDoc, setTextDoc] = useState<TextDocument>(() => textDocumentFromNode(node))
  const [error, setError] = useState<string | null>(null)
  const [toolbarState, setToolbarState] = useState<TextToolbarState>({
    blockType: "paragraph",
    marks: { bold: false, italic: false, underline: false, strike: false },
    linkActive: false,
    colorToken: null,
  })
  const editorRef = useRef<TextEditorHandle | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isGroupFrame = renderer === "group"
  const isGenerationFrame = renderer === "generation"
  const boardParams = renderer === "storyboard" ? parseCanvasStoryboardParams(node.params) : null
  const showHandles = renderer !== "group" && renderer !== "storyboard" && renderer !== "generation"
  const preview = nodePreviewText(node)
  const mediaUrl = node.assetRefs[0]?.url || paramString(node.params, "url") || paramString(node.params, "mediaUrl")
  const surface = canvasSurfaceStyle({ selected, highlighted: data.highlighted })
  const resolvedGeneration = isGenerationFrame ? generationResolvedParams(node, selected ? data.composer?.draft : null) : null
  const generationFrame = resolvedGeneration
    ? frameBoxForNode(resolvedGeneration.aspectRatio, node.size)
    : null
  const resizeBounds = generationFrame
    ? (() => {
        const maxScale = Math.min(NODE_MAX_WIDTH / generationFrame.width, NODE_MAX_HEIGHT / generationFrame.height)
        const minScale = Math.max(NODE_MIN_WIDTH / generationFrame.width, NODE_MIN_HEIGHT / generationFrame.height)
        return {
          minWidth: Math.round(generationFrame.width * minScale),
          minHeight: Math.round(generationFrame.height * minScale),
          maxWidth: Math.round(generationFrame.width * maxScale),
          maxHeight: Math.round(generationFrame.height * maxScale),
        }
      })()
    : { minWidth: NODE_MIN_WIDTH, minHeight: NODE_MIN_HEIGHT, maxWidth: NODE_MAX_WIDTH, maxHeight: NODE_MAX_HEIGHT }

  useEffect(() => {
    if (!editing) setTextDoc(textDocumentFromNode(node))
  }, [editing, node])

  const commitStandard = async () => {
    if (!data.onInlineSave) {
      setEditing(false)
      return
    }
    try {
      const key = node.type === "script" ? "script" : node.type === "audio" ? "title" : "text"
      await data.onInlineSave(node, { ...asParams(node.params), [key]: draft })
      setEditing(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
    }
  }

  const commitText = async (document: TextDocument) => {
    if (!data.onInlineSave) {
      setEditing(false)
      return
    }
    try {
      await data.onInlineSave(node, { ...asParams(node.params), text: documentToContent(document) })
      setEditing(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
    }
  }

  return (
    <div
      className={cn(
        "relative h-full w-full overflow-visible",
        isGroupFrame || isGenerationFrame || renderer === "text" ? "bg-transparent" : "rounded-2xl",
      )}
      style={isGroupFrame || isGenerationFrame ? undefined : { ...surface, pointerEvents: "auto" }}
    >
      <NodeResizer
        minWidth={resizeBounds.minWidth}
        minHeight={resizeBounds.minHeight}
        maxWidth={resizeBounds.maxWidth}
        maxHeight={resizeBounds.maxHeight}
        keepAspectRatio={isGenerationFrame}
        isVisible={selected && !isGroupFrame}
        color="#fafaf9"
      />
      {showHandles ? (
        <>
          <CanvasPlusHandle type="target" position={Position.Left} variant="target" reveal={data.connectable || selected} style={{ top: "50%" }} />
          <CanvasPlusHandle type="source" position={Position.Right} id="out" variant="source" reveal={data.connectable || selected} style={{ top: "50%" }} />
        </>
      ) : null}
      {isGenerationFrame ? (
        <>
          <CanvasPlusHandle type="target" position={Position.Left} variant="target" reveal={data.connectable || selected} style={{ top: "50%" }} />
          <CanvasPlusHandle type="source" position={Position.Right} id="out" variant="source" reveal={data.connectable || selected} style={{ top: "50%" }} />
        </>
      ) : null}

      {isGroupFrame && GroupRenderer ? (
        <GroupRenderer title={node.title} text={String(preview || "")} selected={selected} />
      ) : isGenerationFrame && GenerationRenderer && generationFrame && resolvedGeneration ? (
        <GenerationRenderer
          frame={generationFrame}
          displayTitle={generationDisplayTitle(resolvedGeneration.mediaType, node.title)}
          sizeLabel={displayPixelSize(resolvedGeneration.mediaType, resolvedGeneration.aspectRatio, resolvedGeneration.resolution, resolvedGeneration.imageSize)}
          cornerBadge={frameCornerBadge(resolvedGeneration.mediaType, resolvedGeneration.aspectRatio, resolvedGeneration.durationSeconds, resolvedGeneration.imageSize)}
          isVideo={resolvedGeneration.mediaType === "video"}
          isBusy={node.status === "running" || data.taskStatus === "running"}
          selected={selected}
          highlighted={data.highlighted}
          connectable={data.connectable}
          resultPreviewUrl={data.resultPreviewUrl || node.assetRefs[0]?.url || null}
          taskStatus={data.taskStatus || node.status}
          composer={selected && data.composer ? <CanvasNodeComposer nodeId={node.id} {...data.composer} /> : null}
        />
      ) : renderer === "previs" && PrevisRenderer ? (
        <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl p-3" style={{ ...surface, pointerEvents: "auto" }}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-semibold text-text-primary">{node.title || nodeDefinition.label}</span>
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-secondary">{nodeDefinition.label}</span>
          </div>
          <div className="min-h-0 flex-1">
            <PrevisRenderer documentJson={paramString(node.params, "document")} selected={selected} />
          </div>
        </div>
      ) : renderer === "storyboard" && boardParams ? (
        <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl p-3" style={{ ...surface, pointerEvents: "auto" }}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-semibold text-text-primary">{node.title || nodeDefinition.label}</span>
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-secondary">{nodeDefinition.label}</span>
          </div>
          <div className="flex h-full flex-col gap-2">
            <p className="text-[11px] text-text-secondary">
              {boardParams.sceneNodeIds.length
                ? `${boardParams.sceneNodeIds.length} 个分镜 · ${canvasStoryboardLayoutLabels[boardParams.layout]}`
                : "还没有分镜"}
            </p>
            {boardParams.sceneNodeIds.length ? (
              <ol
                aria-label="分镜顺序"
                data-storyboard-layout={boardParams.layout}
                className={boardParams.layout === "grid" ? "flex flex-wrap gap-1" : "flex flex-col gap-1"}
              >
                {boardParams.sceneNodeIds.map((sceneId, index) => (
                  <li
                    key={sceneId}
                    title={sceneId}
                    className={`${boardParams.layout === "grid" ? "inline-flex min-w-6 justify-center" : "flex w-full justify-center"} h-6 items-center rounded-md border border-white/15 bg-black/20 px-1.5 text-[10px] tabular-nums text-text-secondary`}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[10px] leading-4 text-text-weak">在右侧检查器里从画布的场景节点中添加。</p>
            )}
          </div>
        </div>
      ) : renderer === "text" ? (
        <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl p-3" style={{ pointerEvents: "auto" }}>
          <NodeToolbar isVisible={editing} position={Position.Top} className="nodrag nopan">
            <TextToolbar
              editorRef={editorRef}
              state={toolbarState}
              disabled={!editing}
              textColor={resolveTextColorCss(toolbarState.colorToken)}
              onTextColorChange={token => {
                setToolbarState(state => ({ ...state, colorToken: token }))
                editorRef.current?.execCommand("foreColor", token ? resolveTextColorCss(token) : "inherit")
              }}
              onBlockTypeChange={(type, level) => {
                setToolbarState(state => ({ ...state, blockType: type, blockLevel: level }))
                if (type === "heading" && level) editorRef.current?.execCommand("formatBlock", `h${level}`)
                else if (type === "paragraph") editorRef.current?.execCommand("formatBlock", "p")
                else if (type === "blockquote") editorRef.current?.execCommand("formatBlock", "blockquote")
                else if (type === "bulletList") editorRef.current?.execCommand("insertUnorderedList")
                else if (type === "orderedList") editorRef.current?.execCommand("insertOrderedList")
              }}
              onOpenLink={() => {
                const href = window.prompt("Link URL")
                if (href) editorRef.current?.execCommand("createLink", href)
              }}
              onClose={() => void commitText(textDoc)}
            />
          </NodeToolbar>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-semibold text-text-primary">
              {node.title === CANVAS_NODE_REGISTRY.text.label || !node.title ? "Text Note" : node.title}
            </span>
            <button
              type="button"
              className="nodrag rounded-md px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-surface-hover"
              onClick={() => {
                if (editing) void commitText(textDoc)
                else setEditing(true)
              }}
            >
              {editing ? "Done" : "Edit"}
            </button>
          </div>
          {TextRenderer ? (
            <TextRenderer
              editing={editing}
              editorRef={editorRef}
              document={textDoc}
              previewDocument={isTextDocument(textDoc) ? textDoc : textDocumentFromNode(node)}
              textColorCss={resolveTextColorCss(toolbarState.colorToken)}
              error={error}
              onDocumentChange={setTextDoc}
              onSelectionChange={() => {}}
            />
          ) : null}
        </div>
      ) : (
        <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl p-3" style={{ pointerEvents: "auto" }}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-semibold text-text-primary">{node.title || nodeDefinition.label}</span>
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-secondary">{nodeDefinition.label}</span>
          </div>
          {SceneRenderer ? (
            <SceneRenderer
              text={paramString(node.params, "text")}
              dialogue={paramString(node.params, "dialogue")}
              shotType={paramString(node.params, "shotType")}
              cameraMovement={paramString(node.params, "cameraMovement")}
              durationSeconds={paramString(node.params, "durationSeconds")}
              readiness={paramString(node.params, "readiness")}
              mediaUrl={mediaUrl}
              mediaKind={paramString(node.params, "mediaKind")}
              mediaMeta={paramString(node.params, "mediaMeta")}
            />
          ) : CharacterRenderer ? (
            <CharacterRenderer
              text={paramString(node.params, "text")}
              mediaUrl={mediaUrl}
              mediaKind={paramString(node.params, "mediaKind")}
              mediaMeta={paramString(node.params, "mediaMeta")}
            />
          ) : StandardRenderer ? (
            <StandardRenderer
              editing={editing}
              draft={draft}
              preview={String(preview || "")}
              title={node.title}
              error={error}
              textareaRef={textareaRef}
              onDraftChange={setDraft}
              onCommit={() => void commitStandard()}
              onCancel={() => { setEditing(false); setError(null) }}
            />
          ) : MediaRenderer && mediaUrl ? (
            <MediaRenderer url={mediaUrl} useThumbnail={data.useThumbnail} />
          ) : MediaRenderer ? (
            <p className="text-xs text-text-weak">Drop an image or video onto the canvas</p>
          ) : (
            <p className={cn("whitespace-pre-wrap leading-5", preview && preview.length > 160 ? "line-clamp-7" : "")}>{String(preview || "")}</p>
          )}
          {StandardRenderer && !editing && data.onInlineSave ? (
            <button
              type="button"
              className="nodrag mt-2 self-start rounded-md px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-surface-hover"
              onClick={() => {
                setDraft(node.type === "script" ? paramString(node.params, "script") : node.type === "audio" ? paramString(node.params, "title") : paramString(node.params, "text"))
                setEditing(true)
              }}
            >
              Edit
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
})

const nodeTypes = { [FLOW_NODE_TYPE]: CanvasNodeCard }
function documentFromGraph(
  current: CanvasDocument,
  flowNodes: Node<FlowNodeData>[],
  flowEdges: Edge[],
  viewport: Viewport,
): CanvasDocument {
  const existing = new Map(current.nodes.map(node => [node.id, node]))
  const nodes: CanvasNode[] = flowNodes.map(flowNode => {
    const raw = flowNode.data.rawNode
    const width = clamp(flowNode.measured?.width ?? flowNode.width ?? raw.size.width, NODE_MIN_WIDTH, NODE_MAX_WIDTH)
    const height = clamp(flowNode.measured?.height ?? flowNode.height ?? raw.size.height, NODE_MIN_HEIGHT, NODE_MAX_HEIGHT)
    return {
      ...raw,
      position: { x: flowNode.position.x, y: flowNode.position.y },
      size: { width, height },
      updatedAt: Date.now(),
    }
  })
  const edges: CanvasEdge[] = flowEdges.map(edge => {
    const previous = current.edges.find(item => item.id === edge.id)
    return previous
      ? {
        ...previous,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
        updatedAt: Date.now(),
      }
      : {
        id: edge.id,
        canvasId: current.id,
        projectId: current.projectId,
        ownerUserId: MOCK_OWNER_ID,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
        edgeType: edge.type || "canvas",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
  })
  void existing
  return {
    ...current,
    nodes,
    edges,
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
  }
}

export function CanvasWorkspace({ host }: { host: HostPort }) {
  return (
    <ReactFlowProvider>
      <CanvasWorkspaceInner host={host} />
    </ReactFlowProvider>
  )
}

function CanvasWorkspaceInner({ host }: { host: HostPort }) {
  const { fitView, zoomIn, zoomOut, getViewport, setViewport, screenToFlowPosition } = useReactFlow()
  const [document, setDocument] = useState<CanvasDocument | null>(null)
  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [guides, setGuides] = useState<CanvasSnapGuides | null>(null)
  const [showMinimap, setShowMinimap] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [sceneStripOpen, setSceneStripOpen] = useState(true)
  const [sceneStripPending, setSceneStripPending] = useState(false)
  const [inspectorDraft, setInspectorDraft] = useState<Record<string, string>>({})
  const [imageCatalog, setImageCatalog] = useState<CanvasImageModelCatalog | null>(null)
  const [videoCatalog, setVideoCatalog] = useState<CanvasVideoModelCatalog | null>(null)
  const [generatingNodeId, setGeneratingNodeId] = useState<string | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const clipboardRef = useRef<CanvasClipboardPayload | null>(null)
  const pasteCountRef = useRef(0)
  const undoRef = useRef<CanvasDocument[]>([])
  const redoRef = useRef<CanvasDocument[]>([])
  const documentRef = useRef<CanvasDocument | null>(null)
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const saveTimerRef = useRef<number | null>(null)
  const ignoreSaveRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const connectStartRef = useRef<{ nodeId: string; handleId: string | null } | null>(null)
  const selectedNodeId = useCanvasStore(state => state.selectedNodeId)
  const setSelectedNodeId = useCanvasStore(state => state.setSelectedNodeId)
  useCanvasEvents(document?.id ?? null, true)

  useEffect(() => { documentRef.current = document }, [document])
  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { edgesRef.current = edges }, [edges])

  const actionsRef = useRef<{ onInlineSave: FlowNodeData["onInlineSave"]; onDelete: FlowNodeData["onDelete"] }>({ onInlineSave: undefined, onDelete: undefined })

  const applyDocument = useCallback((next: CanvasDocument, recordHistory = false) => {
    if (recordHistory && documentRef.current) {
      undoRef.current = [...undoRef.current, documentRef.current].slice(-UNDO_LIMIT)
      redoRef.current = []
    }
    documentRef.current = next
    setDocument(next)
    const actions = actionsRef.current
    setNodes(next.nodes.map(node => toFlowNode(node, actions)))
    setEdges(next.edges.map(toFlowEdge))
    if (next.viewport) {
      ignoreSaveRef.current = true
      void setViewport(next.viewport, { duration: 0 })
      queueMicrotask(() => { ignoreSaveRef.current = false })
    }
  }, [setViewport])

  const scheduleSave = useCallback((next: CanvasDocument) => {
    documentRef.current = next
    setDocument(next)
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      setSaveState("saving")
      void host.saveDocument(next)
        .then(saved => {
          documentRef.current = saved
          setDocument(saved)
          setSaveState("saved")
        })
        .catch(() => setSaveState("error"))
    }, SAVE_DEBOUNCE_MS)
  }, [host])

  const commitGraph = useCallback((flowNodes: Node<FlowNodeData>[], flowEdges: Edge[], recordHistory = true) => {
    const current = documentRef.current
    if (!current) return
    const next = documentFromGraph(current, flowNodes, flowEdges, getViewport())
    if (recordHistory) {
      undoRef.current = [...undoRef.current, current].slice(-UNDO_LIMIT)
      redoRef.current = []
    }
    scheduleSave(next)
  }, [getViewport, scheduleSave])

  const saveInline = useCallback(async (node: CanvasNode, params: Record<string, string>) => {
    const current = documentRef.current
    if (!current) return
    const nextNodes = current.nodes.map(item => item.id === node.id ? { ...item, params: { ...item.params, ...params }, updatedAt: Date.now() } as CanvasNode : item)
    const next = { ...current, nodes: nextNodes }
    undoRef.current = [...undoRef.current, current].slice(-UNDO_LIMIT)
    redoRef.current = []
    const actions = actionsRef.current
    setNodes(next.nodes.map(item => toFlowNode(item, actions)))
    scheduleSave(next)
  }, [scheduleSave])

  const deleteNode = useCallback((nodeId: string) => {
    const flowNodes = nodesRef.current.filter(node => node.id !== nodeId).map(node => {
      if (node.data.rawNode.type !== "storyboard") return node
      const params = parseCanvasStoryboardParams(node.data.rawNode.params)
      const pruned = pruneCanvasStoryboardSceneIds(params.sceneNodeIds, new Set(nodesRef.current.filter(item => item.id !== nodeId && item.data.rawNode.type === "scene").map(item => item.id)))
      if (pruned.removed.length === 0) return node
      const rawNode = { ...node.data.rawNode, params: serializeCanvasStoryboardParams({ ...params, sceneNodeIds: pruned.ids }) } as CanvasNode
      return { ...node, data: { ...node.data, rawNode } }
    })
    const flowEdges = edgesRef.current.filter(edge => edge.source !== nodeId && edge.target !== nodeId)
    setNodes(flowNodes)
    setEdges(flowEdges)
    commitGraph(flowNodes, flowEdges)
  }, [commitGraph])

  actionsRef.current = { onInlineSave: saveInline, onDelete: deleteNode }

  useEffect(() => {
    let cancelled = false
    void host.loadDocument().then(loaded => {
      if (cancelled) return
      applyDocument(loaded, false)
      setLoadError(null)
    }).catch(error => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : "Failed to load canvas")
    })
    return () => { cancelled = true }
  }, [host, applyDocument])

  useEffect(() => {
    let cancelled = false
    void Promise.all([host.listImageModels(), host.listVideoModels()]).then(([image, video]) => {
      if (cancelled) return
      setImageCatalog(image)
      setVideoCatalog(video)
    }).catch(() => {
      if (!cancelled) {
        setImageCatalog(null)
        setVideoCatalog(null)
      }
    })
    return () => { cancelled = true }
  }, [host])

  useEffect(() => {
    setNodes(current => applyCanvasNodeVisualData(current, {
      edges: edges.map(edge => ({ source: edge.source, target: edge.target })),
      assetRows: (document?.assets ?? []).map(asset => ({
        id: asset.id,
        type: asset.type,
        width: asset.width,
        height: asset.height,
        duration: asset.duration,
      })),
      highlightedNodeIds: new Set(),
      connectableNodeIds: new Set(),
      perfMode: "full",
    }))
  }, [edges, document?.assets])

  const createNode = useCallback((type: CanvasNodeType, position: { x: number; y: number }, params?: Record<string, string>, assetRefs: CanvasAsset["id"][] | CanvasAsset[] = []) => {
    const current = documentRef.current
    if (!current) return
    const definition = CANVAS_NODE_REGISTRY[type]
    const timestamp = Date.now()
    const refs = (Array.isArray(assetRefs) && assetRefs.length && typeof assetRefs[0] === "object"
      ? (assetRefs as CanvasAsset[]).map(asset => ({ assetId: asset.id, type: asset.type, url: asset.url }))
      : []) as CanvasNode["assetRefs"]
    const node = {
      id: crypto.randomUUID(),
      canvasId: current.id,
      projectId: current.projectId,
      ownerUserId: MOCK_OWNER_ID,
      title: definition.label,
      type,
      position,
      size: { ...definition.defaultSize },
      status: "idle" as const,
      assetRefs: refs,
      params: { ...createDefaultCanvasNodeParams(type), ...(params || {}) },
      createdAt: timestamp,
      updatedAt: timestamp,
    } as CanvasNode
    const next = { ...current, nodes: [...current.nodes, node] }
    undoRef.current = [...undoRef.current, current].slice(-UNDO_LIMIT)
    redoRef.current = []
    const actions = actionsRef.current
    setNodes(next.nodes.map(item => toFlowNode(item, actions)))
    scheduleSave(next)
    setSelectedNodeId(node.id)
    return node
  }, [scheduleSave, setSelectedNodeId])

  const createGenerationFromTool = useCallback((mediaType: "image" | "video") => {
    const current = documentRef.current
    if (!current) return
    const modelId = mediaType === "video"
      ? (videoCatalog?.primaryModelId || videoCatalog?.models[0]?.id || "")
      : (imageCatalog?.primaryModelId || imageCatalog?.models[0]?.id || "")
    const params = defaultGenerationParams(mediaType, modelId)
    const frame = frameBoxFromAspectRatio(params.aspectRatio)
    const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    const definition = CANVAS_NODE_REGISTRY.generation
    const timestamp = Date.now()
    const node = {
      id: crypto.randomUUID(),
      canvasId: current.id,
      projectId: current.projectId,
      ownerUserId: MOCK_OWNER_ID,
      title: generationDisplayTitle(mediaType, ""),
      type: "generation" as const,
      position: { x: center.x - frame.width / 2, y: center.y - frame.height / 2 },
      size: { width: frame.width, height: frame.height },
      status: "idle" as const,
      assetRefs: [],
      params,
      createdAt: timestamp,
      updatedAt: timestamp,
    } as CanvasNode
    const next = { ...current, nodes: [...current.nodes, node] }
    undoRef.current = [...undoRef.current, current].slice(-UNDO_LIMIT)
    redoRef.current = []
    setNodes(next.nodes.map(item => toFlowNode(item, actionsRef.current)))
    scheduleSave(next)
    setSelectedNodeId(node.id)
    void definition
    return node
  }, [imageCatalog, scheduleSave, screenToFlowPosition, setSelectedNodeId, videoCatalog])

  const patchNodeParams = useCallback((nodeId: string, patch: Record<string, string>, recordHistory = true) => {
    const current = documentRef.current
    if (!current) return
    const nextNodes = current.nodes.map(item => item.id === nodeId
      ? { ...item, params: { ...asParams(item.params), ...patch }, updatedAt: Date.now() } as CanvasNode
      : item)
    const next = { ...current, nodes: nextNodes }
    if (recordHistory) {
      undoRef.current = [...undoRef.current, current].slice(-UNDO_LIMIT)
      redoRef.current = []
    }
    const actions = actionsRef.current
    setNodes(next.nodes.map(item => toFlowNode(item, actions)))
    scheduleSave(next)
  }, [scheduleSave])

  const selectedRawNode = document?.nodes.find(node => node.id === selectedNodeId) ?? null

  useEffect(() => {
    if (!selectedRawNode) {
      setInspectorDraft({})
      setGenerationError(null)
      return
    }
    setInspectorDraft(asParams(selectedRawNode.params))
    setGenerationError(null)
  }, [selectedRawNode?.id, selectedRawNode?.updatedAt])

  const imageModels = imageCatalog?.models ?? []
  const videoModels = videoCatalog?.models ?? []

  const composerDraft = useMemo(() => {
    if (!selectedRawNode || selectedRawNode.type !== "generation") return inspectorDraft
    return clampDraftToModel(inspectorDraft, imageModels, videoModels)
  }, [imageModels, inspectorDraft, selectedRawNode, videoModels])

  const patchComposer = useCallback((patch: Record<string, string>) => {
    if (!selectedRawNode || selectedRawNode.type !== "generation") return
    const next = clampDraftToModel({ ...inspectorDraft, ...patch }, imageModels, videoModels)
    setInspectorDraft(next)
    const mediaType = next.mediaType === "video" ? "video" : "image"
    if (patch.aspectRatio && patch.aspectRatio !== paramString(selectedRawNode.params, "aspectRatio")) {
      const frame = frameBoxFromAspectRatio(next.aspectRatio || (mediaType === "video" ? "16:9" : "auto"))
      const current = documentRef.current
      if (current) {
        const nextNodes = current.nodes.map(item => item.id === selectedRawNode.id
          ? { ...item, params: { ...asParams(item.params), ...next }, size: frame, updatedAt: Date.now() } as CanvasNode
          : item)
        const nextDoc = { ...current, nodes: nextNodes }
        undoRef.current = [...undoRef.current, current].slice(-UNDO_LIMIT)
        redoRef.current = []
        setNodes(nextDoc.nodes.map(item => toFlowNode(item, actionsRef.current)))
        scheduleSave(nextDoc)
        return
      }
    }
    patchNodeParams(selectedRawNode.id, next, false)
  }, [imageModels, inspectorDraft, patchNodeParams, scheduleSave, selectedRawNode, videoModels])

  const toggleGenerationReference = useCallback((asset: CanvasAsset) => {
    const current = documentRef.current
    if (!current || !selectedRawNode || selectedRawNode.type !== "generation") return
    const already = selectedRawNode.assetRefs.some(ref => ref.assetId === asset.id)
    const nextRefs = already
      ? selectedRawNode.assetRefs.filter(ref => ref.assetId !== asset.id)
      : [...selectedRawNode.assetRefs, { assetId: asset.id, type: asset.type, url: asset.url }]
    const nextNodes = current.nodes.map(item => item.id === selectedRawNode.id
      ? { ...item, assetRefs: nextRefs, updatedAt: Date.now() } as CanvasNode
      : item)
    const next = { ...current, nodes: nextNodes }
    undoRef.current = [...undoRef.current, current].slice(-UNDO_LIMIT)
    redoRef.current = []
    setNodes(next.nodes.map(item => toFlowNode(item, actionsRef.current)))
    scheduleSave(next)
  }, [scheduleSave, selectedRawNode])

  const runSelectedGeneration = useCallback(async () => {
    if (!selectedRawNode || selectedRawNode.type !== "generation") return
    const mediaType = composerDraft.mediaType === "video" ? "video" : "image"
    const prompt = (composerDraft.prompt || "").trim()
    const modelId = composerDraft.modelId
    if (!prompt || !modelId) return
    const current = documentRef.current
    if (!current) return
    setGeneratingNodeId(selectedRawNode.id)
    setGenerationError(null)
    const running = current.nodes.map(item => item.id === selectedRawNode.id ? { ...item, status: "running" as const, updatedAt: Date.now() } as CanvasNode : item)
    const runningDoc = { ...current, nodes: running }
    setNodes(runningDoc.nodes.map(item => toFlowNode(item, actionsRef.current)))
    documentRef.current = runningDoc
    setDocument(runningDoc)
    try {
      const modelName = (mediaType === "video" ? videoModels : imageModels).find(model => model.id === modelId)?.name
      const result = await host.runGeneration({
        nodeId: selectedRawNode.id,
        mediaType,
        prompt,
        modelId,
        modelName,
        aspectRatio: composerDraft.aspectRatio,
        imageSize: composerDraft.imageSize,
        resolution: composerDraft.resolution,
        durationSeconds: composerDraft.durationSeconds,
        generationCount: Number(composerDraft.generationCount || "1") || 1,
        referenceUrls: selectedRawNode.assetRefs.map(ref => ref.url).filter((url): url is string => Boolean(url)),
      })
      const latest = documentRef.current
      if (!latest) return
      if (result.status === "succeeded" && result.asset) {
        const asset = result.asset
        const nextNodes = latest.nodes.map(item => item.id === selectedRawNode.id
          ? {
              ...item,
              status: "succeeded" as const,
              assetRefs: [{ assetId: asset.id, type: asset.type, url: result.previewUrl || asset.url }],
              updatedAt: Date.now(),
            } as CanvasNode
          : item)
        const next = { ...latest, nodes: nextNodes, assets: [...latest.assets.filter(item => item.id !== asset.id), asset] }
        setNodes(next.nodes.map(item => toFlowNode(item, actionsRef.current)))
        scheduleSave(next)
        setGenerationError(null)
      } else {
        const nextNodes = latest.nodes.map(item => item.id === selectedRawNode.id ? { ...item, status: "failed" as const, updatedAt: Date.now() } as CanvasNode : item)
        const next = { ...latest, nodes: nextNodes }
        setNodes(next.nodes.map(item => toFlowNode(item, actionsRef.current)))
        scheduleSave(next)
        setGenerationError(result.message || "生成失败")
      }
    } catch (error) {
      const latest = documentRef.current
      if (latest) {
        const nextNodes = latest.nodes.map(item => item.id === selectedRawNode.id ? { ...item, status: "failed" as const, updatedAt: Date.now() } as CanvasNode : item)
        const next = { ...latest, nodes: nextNodes }
        setNodes(next.nodes.map(item => toFlowNode(item, actionsRef.current)))
        scheduleSave(next)
      }
      setGenerationError(error instanceof Error ? error.message : "生成失败")
    } finally {
      setGeneratingNodeId(null)
    }
  }, [composerDraft, host, imageModels, scheduleSave, selectedRawNode, videoModels])

  const composerConfig = useMemo<CanvasNodeComposerConfig | null>(() => {
    if (!selectedRawNode || selectedRawNode.type !== "generation") return null
    const mediaType = composerDraft.mediaType === "video" ? "video" : "image"
    const models = mediaType === "video" ? videoModels : imageModels
    const imageOptions = resolveImageModelOptions(imageModels, composerDraft.modelId)
    const videoOptions = resolveVideoModelOptions(videoModels, composerDraft.modelId)
    const acceptKinds = mediaType === "video" ? REFERENCE_ACCEPT_KINDS_VIDEO : REFERENCE_ACCEPT_KINDS_IMAGE
    const derived = deriveCanvasUpstreamReferences({
      targetNodeId: selectedRawNode.id,
      nodes: (document?.nodes ?? []).map(node => ({
        id: node.id,
        type: node.type,
        title: node.title,
        params: asParams(node.params),
        assetRefs: node.assetRefs,
      })),
      edges: (document?.edges ?? []).map(edge => ({ source: edge.sourceNodeId, target: edge.targetNodeId })),
      acceptKinds,
      excludeAssetIds: selectedRawNode.assetRefs.map(ref => ref.assetId),
    })
    const model = models.find(item => item.id === composerDraft.modelId)
    const requiresPrompt = mediaType === "image" ? (model && "requiresPrompt" in model ? model.requiresPrompt : true) : true
    const requiresImage = mediaType === "image" && model && "requiresImage" in model ? model.requiresImage : false
    let runDisabledReason: string | null = null
    if (requiresPrompt && !(composerDraft.prompt || "").trim()) runDisabledReason = "请先填写提示词"
    else if (!composerDraft.modelId) runDisabledReason = "请选择一个模型"
    else if (requiresImage && selectedRawNode.assetRefs.length + derived.references.length === 0) runDisabledReason = "该模型需要至少一张参考图"
    const referenceAssets = (document?.assets ?? []).filter(asset => (acceptKinds as readonly string[]).includes(asset.type))
    return {
      draft: composerDraft,
      onPatch: patchComposer,
      modelOptions: models.map(item => ({ id: item.id, name: item.name })),
      aspectRatioOptions: mediaType === "video" ? videoOptions.aspectRatios : imageOptions.aspectRatios,
      imageSizeOptions: imageOptions.imageSizes,
      mediaType,
      resolutionOptions: videoOptions.resolutions,
      durationOptions: videoOptions.durations,
      referenceRefs: selectedRawNode.assetRefs,
      edgeReferenceRefs: derived.references,
      unusableUpstreamCount: derived.unusableUpstreams.length,
      canvasImageAssets: referenceAssets,
      canvasReferenceAssets: referenceAssets,
      onToggleReference: toggleGenerationReference,
      canRun: !runDisabledReason,
      runDisabledReason,
      isGenerating: generatingNodeId === selectedRawNode.id,
      generationError,
      onGenerate: () => { void runSelectedGeneration() },
      onCancel: undefined,
    }
  }, [composerDraft, document, generationError, generatingNodeId, imageModels, patchComposer, runSelectedGeneration, selectedRawNode, toggleGenerationReference, videoModels])

  useEffect(() => {
    setNodes(current => current.map(node => {
      const isSelectedGeneration = node.id === selectedNodeId && node.data.rawNode.type === "generation"
      if ((node.data.composer ?? null) === (isSelectedGeneration ? composerConfig : null)) return node
      return {
        ...node,
        data: {
          ...node.data,
          composer: isSelectedGeneration ? composerConfig : null,
          taskStatus: node.data.rawNode.status,
          resultPreviewUrl: node.data.rawNode.assetRefs[0]?.url || null,
        },
      }
    }))
  }, [composerConfig, selectedNodeId])

  const sceneEntries: CanvasSceneSequenceEntry[] = useMemo(() => {
    const size = CANVAS_NODE_REGISTRY.scene.defaultSize
    void size
    return sortCanvasSceneEntries((document?.nodes ?? []).filter(node => node.type === "scene").map(node => ({
      id: node.id,
      title: node.title || "Scene",
      text: paramString(node.params, "text"),
      mediaUrl: node.assetRefs[0]?.url || paramString(node.params, "mediaUrl"),
      mediaKind: paramString(node.params, "mediaKind"),
      mediaMeta: paramString(node.params, "mediaMeta"),
      x: node.position.x,
      y: node.position.y,
    })))
  }, [document?.nodes])

  const createSceneFromStrip = useCallback(() => {
    if (sceneStripPending) return
    const size = CANVAS_NODE_REGISTRY.scene.defaultSize
    const viewportCenter = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    const titles = (documentRef.current?.nodes ?? []).filter(node => node.type === "scene").map(node => node.title)
    setSceneStripPending(true)
    try {
      const node = createNode("scene", nextCanvasScenePosition(sceneEntries, size, viewportCenter), undefined, [])
      if (node) {
        const title = nextCanvasSceneTitle(titles)
        patchNodeParams(node.id, {}, false)
        const current = documentRef.current
        if (current) {
          const nextNodes = current.nodes.map(item => item.id === node.id ? { ...item, title } as CanvasNode : item)
          const next = { ...current, nodes: nextNodes }
          setNodes(next.nodes.map(item => toFlowNode(item, actionsRef.current)))
          scheduleSave(next)
        }
      }
    } finally {
      setSceneStripPending(false)
    }
  }, [createNode, patchNodeParams, scheduleSave, sceneEntries, sceneStripPending, screenToFlowPosition])

  const focusSceneNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
    setNodes(current => current.map(node => ({ ...node, selected: node.id === nodeId })))
    void fitView({ nodes: [{ id: nodeId }], padding: 0.4, duration: canvasMotionDuration(300) })
  }, [fitView, setSelectedNodeId])


  const onNodesChange = useCallback((changes: NodeChange<Node<FlowNodeData>>[]) => {
    setNodes(current => {
      const next = applyNodeChanges(changes, current)
      const structural = changes.some(change => change.type === "remove" || change.type === "dimensions" || change.type === "position" && change.dragging === false)
      if (structural) queueMicrotask(() => commitGraph(next, edgesRef.current, changes.some(change => change.type !== "dimensions" || change.resizing === false)))
      return next
    })
  }, [commitGraph])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges(current => {
      const next = applyEdgeChanges(changes, current)
      if (changes.some(change => change.type === "remove" || change.type === "add")) {
        queueMicrotask(() => commitGraph(nodesRef.current, next))
      }
      return next
    })
  }, [commitGraph])

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    const current = documentRef.current
    if (!current || !connection.source || !connection.target) return false
    const source = current.nodes.find(node => node.id === connection.source)
    const target = current.nodes.find(node => node.id === connection.target)
    if (!source || !target) return false
    if (wouldCreateCanvasCycle(current.edges.map(edge => ({ source: edge.sourceNodeId, target: edge.targetNodeId })), connection.source, connection.target)) {
      return false
    }
    return canConnectCanvasRegistryNodeInstances({
      source: connectionEndpointFromCanvasNode(source),
      target: connectionEndpointFromCanvasNode(target),
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
    })
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    const current = documentRef.current
    if (!current || !connection.source || !connection.target) return
    if (!isValidConnection(connection)) return
    const timestamp = Date.now()
    const edge: CanvasEdge = {
      id: crypto.randomUUID(),
      canvasId: current.id,
      projectId: current.projectId,
      ownerUserId: MOCK_OWNER_ID,
      sourceNodeId: connection.source,
      targetNodeId: connection.target,
      sourceHandle: connection.sourceHandle ?? "out",
      targetHandle: connection.targetHandle ?? null,
      edgeType: "canvas",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const next = { ...current, edges: [...current.edges, edge] }
    undoRef.current = [...undoRef.current, current].slice(-UNDO_LIMIT)
    redoRef.current = []
    setEdges(next.edges.map(toFlowEdge))
    scheduleSave(next)
  }, [isValidConnection, scheduleSave])

  const onConnectStart: OnConnectStart = useCallback((_event, params) => {
    connectStartRef.current = { nodeId: params.nodeId ?? "", handleId: params.handleId ?? null }
  }, [])

  const onNodeDrag = useCallback((_event: MouseEvent | TouchEvent, node: Node<FlowNodeData>) => {
    const snap = calculateCanvasNodeSnap(toSnapNode(node), nodesRef.current.map(toSnapNode), canvasNodeSnapThresholdForZoom(getViewport().zoom))
    setGuides(snap.guides)
  }, [getViewport])

  const onNodeDragStop = useCallback((event: MouseEvent | TouchEvent, node: Node<FlowNodeData>, dragged: Node<FlowNodeData>[]) => {
    const current = documentRef.current
    if (!current) return
    const snap = calculateCanvasNodeSnap(toSnapNode(node), nodesRef.current.map(toSnapNode), canvasNodeSnapThresholdForZoom(getViewport().zoom))
    setGuides(null)
    let flowNodes = nodesRef.current.map(item => item.id === node.id ? { ...item, position: snap.position } : item)

    if (node.data.rawNode.type === "group") {
      const members = new Set(canvasGroupMemberIds({
        id: node.id,
        type: "group",
        x: node.position.x,
        y: node.position.y,
        width: node.width ?? node.data.rawNode.size.width,
        height: node.height ?? node.data.rawNode.size.height,
      }, current.nodes.map(item => ({
        id: item.id,
        type: item.type,
        x: item.position.x,
        y: item.position.y,
        width: item.size.width,
        height: item.size.height,
      }))))
      const dx = snap.position.x - node.position.x
      const dy = snap.position.y - node.position.y
      flowNodes = flowNodes.map(item => members.has(item.id) ? { ...item, position: { x: item.position.x + dx, y: item.position.y + dy } } : item)
    }

    if ("altKey" in event && event.altKey) {
      const original = node.data.rawNode
      const copy = {
        ...original,
        id: crypto.randomUUID(),
        position: { x: snap.position.x + 32, y: snap.position.y + 32 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        title: original.title,
      } as CanvasNode
      flowNodes = [...flowNodes, toFlowNode(copy, actionsRef.current)]
    }

    void dragged
    setNodes(flowNodes)
    commitGraph(flowNodes, edgesRef.current)
  }, [commitGraph, getViewport])

  const onMoveEnd: OnMoveEnd = useCallback((_event, viewport) => {
    const current = documentRef.current
    if (!current || ignoreSaveRef.current) return
    scheduleSave({ ...current, viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom } })
  }, [scheduleSave])

  const placeFiles = useCallback(async (files: File[], origin?: { x: number; y: number }) => {
    const current = documentRef.current
    if (!current) return
    const { accepted } = splitCanvasUploadFiles(files)
    if (!accepted.length) return
    const result = await uploadCanvasMedia({ host, files: accepted })
    const position = origin ?? screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    let assets = [...current.assets]
    const created: CanvasNode[] = []
    result.assets.forEach((asset, index) => {
      assets = [...assets, asset]
      const type = nodeTypeFromAsset(asset)
      const definition = CANVAS_NODE_REGISTRY[type]
      const timestamp = Date.now()
      created.push({
        id: crypto.randomUUID(),
        canvasId: current.id,
        projectId: current.projectId,
        ownerUserId: MOCK_OWNER_ID,
        title: asset.title || definition.label,
        type,
        position: { x: position.x + index * 36, y: position.y + index * 36 },
        size: { ...definition.defaultSize },
        status: "idle",
        assetRefs: [{ assetId: asset.id, type: asset.type, url: asset.url }],
        params: paramsFromAsset(type, asset),
        createdAt: timestamp,
        updatedAt: timestamp,
      } as CanvasNode)
    })
    const next = { ...current, assets, nodes: [...current.nodes, ...created] }
    undoRef.current = [...undoRef.current, current].slice(-UNDO_LIMIT)
    redoRef.current = []
    setNodes(next.nodes.map(item => toFlowNode(item, actionsRef.current)))
    scheduleSave(next)
  }, [host, scheduleSave, screenToFlowPosition])

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files)
    if (!files.length) return
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    void placeFiles(files, position)
  }, [placeFiles, screenToFlowPosition])

  const restoreDocument = useCallback((next: CanvasDocument) => {
    applyDocument(next, false)
    scheduleSave(next)
  }, [applyDocument, scheduleSave])

  const undo = useCallback(() => {
    const previous = undoRef.current.pop()
    if (!previous || !documentRef.current) return
    redoRef.current = [...redoRef.current, documentRef.current]
    restoreDocument(previous)
  }, [restoreDocument])

  const redo = useCallback(() => {
    const next = redoRef.current.pop()
    if (!next || !documentRef.current) return
    undoRef.current = [...undoRef.current, documentRef.current]
    restoreDocument(next)
  }, [restoreDocument])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      if (event.key === "?" && !event.ctrlKey && !event.metaKey && !typing) {
        event.preventDefault()
        setShowHelp(open => !open)
        return
      }
      if (typing) return
      const meta = event.ctrlKey || event.metaKey
      if (meta && event.key.toLowerCase() === "z" && event.shiftKey) { event.preventDefault(); redo(); return }
      if (meta && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); return }
      if (meta && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return }
      if (meta && event.key.toLowerCase() === "a") {
        event.preventDefault()
        setNodes(current => current.map(node => ({ ...node, selected: true })))
        return
      }
      if (meta && event.key.toLowerCase() === "c") {
        const current = documentRef.current
        if (!current) return
        const selected = nodesRef.current.filter(node => node.selected)
        clipboardRef.current = buildCanvasClipboard({
          canvasId: current.id,
          nodes: selected.map(node => ({
            id: node.id,
            type: node.data.rawNode.type,
            title: node.data.rawNode.title,
            x: node.position.x,
            y: node.position.y,
            width: node.data.rawNode.size.width,
            height: node.data.rawNode.size.height,
            params: { ...node.data.rawNode.params },
            assetRefs: node.data.rawNode.assetRefs,
          })),
          edges: edgesRef.current.map(edge => ({
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
          })),
        })
        pasteCountRef.current = 0
        return
      }
      if (meta && (event.key === "=" || event.key === "+")) { event.preventDefault(); void zoomIn({ duration: canvasMotionDuration(200) }); return }
      if (meta && event.key === "-") { event.preventDefault(); void zoomOut({ duration: canvasMotionDuration(200) }); return }
      if (event.shiftKey && event.code === "Digit1") { event.preventDefault(); void fitView({ duration: canvasMotionDuration(240), padding: 0.16 }); return }
      if (event.shiftKey && event.code === "Digit2") {
        event.preventDefault()
        void fitView({ duration: canvasMotionDuration(240), padding: 0.2, nodes: nodesRef.current.filter(node => node.selected) })
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [fitView, redo, undo, zoomIn, zoomOut])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
      const current = documentRef.current
      if (!current) return
      const files = event.clipboardData
        ? clipboardImageFiles(event.clipboardData.items, 20).files
        : []
      if (files.length) {
        event.preventDefault()
        void placeFiles(files)
        return
      }
      if (!canPasteCanvasClipboard(clipboardRef.current, current.id) || !clipboardRef.current) return
      event.preventDefault()
      pasteCountRef.current += 1
      const offset = canvasClipboardOffset(pasteCountRef.current)
      const created: CanvasNode[] = []
      const createdIds: string[] = []
      const idMap = new Map<string, string>()
      for (const item of clipboardRef.current.nodes) {
        const body = canvasClipboardNodeBody(item, offset)
        const timestamp = Date.now()
        const id = crypto.randomUUID()
        createdIds.push(id)
        idMap.set(item.sourceId, id)
        let params = { ...createDefaultCanvasNodeParams(body.type), ...(body.params as Record<string, string>) }
        created.push({
          id,
          canvasId: current.id,
          projectId: current.projectId,
          ownerUserId: MOCK_OWNER_ID,
          title: body.title,
          type: body.type,
          position: { x: body.x, y: body.y },
          size: { width: body.width, height: body.height },
          status: "idle",
          assetRefs: (body.assetRefs || []) as CanvasNode["assetRefs"],
          params,
          createdAt: timestamp,
          updatedAt: timestamp,
        } as CanvasNode)
      }
      const liveSceneIds = new Set([
        ...current.nodes.filter(node => node.type === "scene").map(node => node.id),
        ...created.filter(node => node.type === "scene").map(node => node.id),
      ])
      for (const node of created) {
        if (node.type !== "storyboard") continue
        const params = parseCanvasStoryboardParams(node.params)
        const resolved = resolveCanvasStoryboardSceneIdsForPaste(params.sceneNodeIds, idMap, liveSceneIds)
        node.params = serializeCanvasStoryboardParams({ ...params, sceneNodeIds: resolved.ids })
      }
      const newEdges: CanvasEdge[] = canvasClipboardEdgePayloads(clipboardRef.current, createdIds).map(payload => ({
        id: crypto.randomUUID(),
        canvasId: current.id,
        projectId: current.projectId,
        ownerUserId: MOCK_OWNER_ID,
        sourceNodeId: payload.sourceNodeId,
        targetNodeId: payload.targetNodeId,
        sourceHandle: payload.sourceHandle,
        targetHandle: payload.targetHandle,
        edgeType: payload.edgeType || "canvas",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }))
      const next = { ...current, nodes: [...current.nodes, ...created], edges: [...current.edges, ...newEdges] }
      undoRef.current = [...undoRef.current, current].slice(-UNDO_LIMIT)
      redoRef.current = []
      setNodes(next.nodes.map(item => toFlowNode(item, actionsRef.current)))
      setEdges(next.edges.map(toFlowEdge))
      scheduleSave(next)
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [placeFiles, scheduleSave])

  useEffect(() => {
    const onUnload = () => {
      const current = documentRef.current
      if (!current) return
      void host.saveDocument(documentFromGraph(current, nodesRef.current, edgesRef.current, getViewport()))
    }
    window.addEventListener("beforeunload", onUnload)
    return () => window.removeEventListener("beforeunload", onUnload)
  }, [getViewport, host])

  const palette = useMemo(() => CANVAS_QUICK_ADD_NODE_TYPES.filter(type => type !== "previs"), [])

  if (loadError) {
    return <div className="flex h-full items-center justify-center text-sm text-status-error">{loadError}</div>
  }
  if (!document) {
    return <div className="flex h-full items-center justify-center text-sm text-text-weak">Loading canvas…</div>
  }

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: CANVAS_BACKGROUND }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={CANVAS_EDGE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        isValidConnection={isValidConnection}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onMoveEnd={onMoveEnd}
        onDrop={onDrop}
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "copy" }}
        onSelectionChange={({ nodes: selected }) => setSelectedNodeId(selected[0]?.id ?? null)}
        connectionLineComponent={CanvasConnectionLine}
        deleteKeyCode={["Delete", "Backspace"]}
        selectionKeyCode="Control"
        multiSelectionKeyCode={["Shift", "Control"]}
        panActivationKeyCode="Space"
        minZoom={0.08}
        maxZoom={4}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color={CANVAS_DOT} />
        <Controls showInteractive={false} />
        {showMinimap ? <MiniMap pannable zoomable maskColor="rgba(0,0,0,0.45)" /> : null}
        <CanvasSnapGuideLines guides={guides} />
      </ReactFlow>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center p-3">
        <div
          className="pointer-events-auto flex max-w-[min(96vw,1100px)] flex-wrap items-center gap-1 rounded-2xl border px-2 py-1.5 shadow-xl"
          style={{ background: CANVAS_TOOLBAR_PANEL, borderColor: CANVAS_TOOLBAR_BORDER }}
        >
          {palette.filter(type => type === "text" || type === "image" || type === "video").map(type => {
            const item = CANVAS_NODE_REGISTRY[type]
            const Icon = item.icon
            return (
              <button
                key={type}
                type="button"
                className="inline-flex items-center gap-1 rounded-xl px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                onClick={() => {
                  const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
                  createNode(type, { x: center.x - item.defaultSize.width / 2, y: center.y - item.defaultSize.height / 2 })
                }}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            )
          })}
          <span className="mx-1 h-4 w-px bg-white/10" />
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-xl px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            aria-label="创建 AI 生图节点"
            onClick={() => createGenerationFromTool("image")}
          >
            <ImagePlus className="h-3.5 w-3.5" />
            AI 生图
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-xl px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            aria-label="创建 AI 生视频节点"
            onClick={() => createGenerationFromTool("video")}
          >
            <VideoIcon className="h-3.5 w-3.5" />
            AI 生视频
          </button>
          <span className="mx-1 h-4 w-px bg-white/10" />
          {palette.filter(type => type === "scene" || type === "character" || type === "group" || type === "storyboard").map(type => {
            const item = CANVAS_NODE_REGISTRY[type]
            const Icon = item.icon
            return (
              <button
                key={type}
                type="button"
                className="inline-flex items-center gap-1 rounded-xl px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                onClick={() => {
                  const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
                  createNode(type, { x: center.x - item.defaultSize.width / 2, y: center.y - item.defaultSize.height / 2 })
                }}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            )
          })}
          <span className="mx-1 h-4 w-px bg-white/10" />
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-xl px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            onClick={() => {
              const item = CANVAS_NODE_REGISTRY.previs
              const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
              createNode("previs", { x: center.x - item.defaultSize.width / 2, y: center.y - item.defaultSize.height / 2 })
            }}
          >
            {(() => { const Icon = CANVAS_NODE_REGISTRY.previs.icon; return <Icon className="h-3.5 w-3.5" /> })()}
            3D 预演
          </button>
          <span className="mx-1 h-4 w-px bg-white/10" />
          <button type="button" className="rounded-xl p-1.5 text-text-secondary hover:bg-surface-hover" onClick={() => fileInputRef.current?.click()} title="Upload">
            <Upload className="h-4 w-4" />
          </button>
          <button type="button" className="rounded-xl p-1.5 text-text-secondary hover:bg-surface-hover" onClick={undo} title="Undo">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" className="rounded-xl p-1.5 text-text-secondary hover:bg-surface-hover" onClick={redo} title="Redo">
            <Redo2 className="h-4 w-4" />
          </button>
          <button type="button" className="rounded-xl p-1.5 text-text-secondary hover:bg-surface-hover" onClick={() => void fitView({ duration: canvasMotionDuration(240), padding: 0.16 })} title="Fit">
            <Maximize2 className="h-4 w-4" />
          </button>
          <button type="button" className="rounded-xl p-1.5 text-text-secondary hover:bg-surface-hover" onClick={() => setShowMinimap(value => !value)} title="Minimap">
            <MapIcon className="h-4 w-4" />
          </button>
          <button type="button" className="rounded-xl p-1.5 text-text-secondary hover:bg-surface-hover" onClick={() => setShowHelp(true)} title="Shortcuts">
            <Keyboard className="h-4 w-4" />
          </button>
          <span className="ml-2 text-[10px] text-text-weak">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : ""}
          </span>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={CANVAS_UPLOAD_ACCEPT}
        multiple
        className="hidden"
        onChange={event => {
          const files = Array.from(event.target.files || [])
          event.target.value = ""
          if (files.length) void placeFiles(files)
        }}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-stretch gap-2 p-3">
        <div className="pointer-events-auto mx-auto w-full max-w-[min(96vw,1100px)]">
          <CanvasSceneStrip
            entries={sceneEntries}
            selectedSceneId={selectedRawNode?.type === "scene" ? selectedRawNode.id : null}
            open={sceneStripOpen}
            pending={sceneStripPending}
            onToggle={() => setSceneStripOpen(value => !value)}
            onSelect={focusSceneNode}
            onCreate={createSceneFromStrip}
          />
        </div>
      </div>

      <button
        type="button"
        className="absolute bottom-24 right-6 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-default bg-surface-overlay text-text-primary shadow-xl"
        onClick={() => setAddMenuOpen(value => !value)}
        title="添加节点"
        aria-expanded={addMenuOpen}
      >
        <Plus className="h-5 w-5" />
      </button>

      {addMenuOpen ? (
        <div
          role="menu"
          aria-label="添加节点"
          className="absolute bottom-40 right-6 z-40 flex w-64 flex-col gap-0.5 rounded-xl border border-border-default bg-surface-overlay p-1.5 shadow-2xl"
        >
          {CANVAS_ADD_MENU_GROUPS.map(group => (
            <div key={group.key} className="flex flex-col gap-0.5">
              <span className="px-3 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-text-weak">{group.label}</span>
              {group.entries.map(entry => {
                if (entry.kind === "upload") {
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      role="menuitem"
                      onClick={() => { setAddMenuOpen(false); fileInputRef.current?.click() }}
                      className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs text-text-primary hover:bg-surface-hover"
                    >
                      <Upload className="h-4 w-4 text-text-secondary" />
                      <span>{entry.label}</span>
                    </button>
                  )
                }
                if (entry.kind === "generation") {
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      role="menuitem"
                      onClick={() => { setAddMenuOpen(false); createGenerationFromTool(entry.mediaType) }}
                      className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs text-text-primary hover:bg-surface-hover"
                    >
                      {entry.mediaType === "video" ? <VideoIcon className="h-4 w-4 text-text-secondary" /> : <ImagePlus className="h-4 w-4 text-text-secondary" />}
                      <span>{entry.label}</span>
                    </button>
                  )
                }
                const NodeIcon = CANVAS_NODE_REGISTRY[entry.type].icon
                return (
                  <button
                    key={entry.key}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAddMenuOpen(false)
                      const item = CANVAS_NODE_REGISTRY[entry.type]
                      const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
                      createNode(entry.type, { x: center.x - item.defaultSize.width / 2, y: center.y - item.defaultSize.height / 2 })
                    }}
                    className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs text-text-primary hover:bg-surface-hover"
                  >
                    <NodeIcon className="h-4 w-4 text-text-secondary" />
                    <span>{CANVAS_NODE_REGISTRY[entry.type].label}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ) : null}

      {selectedRawNode && (selectedRawNode.type === "storyboard" || selectedRawNode.type === "previs" || selectedRawNode.type === "script") ? (
        <aside className="absolute bottom-24 right-20 top-20 z-20 flex w-80 flex-col overflow-auto rounded-2xl border border-border-default bg-surface-overlay/95 p-3 shadow-2xl">
          {selectedRawNode.type === "storyboard" ? (
            <StoryboardInspector
              draft={inspectorDraft}
              setDraft={draft => {
                setInspectorDraft(draft)
                patchNodeParams(selectedRawNode.id, draft, false)
              }}
              sceneEntries={sceneEntries}
            />
          ) : selectedRawNode.type === "previs" ? (
            <CanvasPrevisInspector
              node={selectedRawNode}
              draft={inspectorDraft}
              setDraft={draft => {
                setInspectorDraft(draft)
                patchNodeParams(selectedRawNode.id, draft, false)
              }}
            />
          ) : (
            <ScriptInspector
              draft={inspectorDraft}
              setDraft={draft => {
                setInspectorDraft(draft)
                patchNodeParams(selectedRawNode.id, draft, false)
              }}
            />
          )}
        </aside>
      ) : null}

      {showHelp ? createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowHelp(false)}>
          <div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-2xl border border-border-default bg-surface-overlay p-5" onClick={event => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">Shortcuts</h2>
              <button type="button" onClick={() => setShowHelp(false)} className="rounded-md p-1 text-text-secondary hover:bg-surface-hover">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <ShortcutList items={CANVAS_SHORTCUTS_LEFT} />
              <ShortcutList items={CANVAS_SHORTCUTS_RIGHT} />
            </div>
          </div>
        </div>,
        globalThis.document.body,
      ) : null}
    </div>
  )
}

function StoryboardInspector({
  draft,
  setDraft,
  sceneEntries,
}: {
  draft: Record<string, string>
  setDraft: (draft: Record<string, string>) => void
  sceneEntries: CanvasSceneSequenceEntry[]
}) {
  const params = parseCanvasStoryboardParams(draft)
  const write = (next: { sceneNodeIds: string[]; layout: typeof params.layout; note: string }) => {
    setDraft({ ...draft, ...serializeCanvasStoryboardParams(next) })
  }
  const unusedScenes = sceneEntries.filter(entry => !params.sceneNodeIds.includes(entry.id))
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-[11px] font-medium text-text-primary">分镜板</h3>
        <p className="mt-1 text-[10px] text-text-weak">按顺序引用画布上的场景节点，最多 24 个。</p>
      </div>
      <div className="flex flex-wrap gap-1">
        {canvasStoryboardLayouts.map(layout => (
          <button
            key={layout}
            type="button"
            aria-pressed={canvasStoryboardLayout(params.layout) === layout}
            className={canvasStoryboardLayout(params.layout) === layout
              ? "rounded-md bg-white/15 px-2 py-1 text-[10px] text-text-primary"
              : "rounded-md bg-surface-hover px-2 py-1 text-[10px] text-text-secondary"}
            onClick={() => write({ ...params, layout })}
          >
            {canvasStoryboardLayoutLabels[layout]}
          </button>
        ))}
      </div>
      <ul className="space-y-1">
        {params.sceneNodeIds.map((sceneId, index) => {
          const entry = sceneEntries.find(item => item.id === sceneId)
          return (
            <li key={sceneId} className="flex items-center gap-1 rounded-md bg-white/[0.03] px-1.5 py-1 text-[10px]">
              <span className="w-5 tabular-nums text-text-weak">{String(index + 1).padStart(2, "0")}</span>
              <span className="min-w-0 flex-1 truncate text-text-primary">{entry?.title || "缺失的场景"}</span>
              <button type="button" className="rounded px-1 text-text-secondary hover:text-text-primary" onClick={() => write({ ...params, sceneNodeIds: moveCanvasStoryboardScene(params.sceneNodeIds, index, index - 1) })}>上</button>
              <button type="button" className="rounded px-1 text-text-secondary hover:text-text-primary" onClick={() => write({ ...params, sceneNodeIds: moveCanvasStoryboardScene(params.sceneNodeIds, index, index + 1) })}>下</button>
              <button type="button" className="rounded px-1 text-text-secondary hover:text-status-error" onClick={() => write({ ...params, sceneNodeIds: removeCanvasStoryboardScene(params.sceneNodeIds, sceneId) })}>移除</button>
            </li>
          )
        })}
      </ul>
      {unusedScenes.length ? (
        <label className="flex flex-col gap-1 text-[10px] text-text-secondary">
          添加场景
          <select
            className="rounded-md border border-border-default bg-surface-inset px-2 py-1 text-[11px] text-text-primary"
            defaultValue=""
            onChange={event => {
              const id = event.target.value
              if (id) write({ ...params, sceneNodeIds: addCanvasStoryboardScene(params.sceneNodeIds, id) })
              event.target.value = ""
            }}
          >
            <option value="">选择场景…</option>
            {unusedScenes.map(entry => (
              <option key={entry.id} value={entry.id}>{entry.title}</option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-[10px] text-text-weak">画布上没有可添加的场景节点。</p>
      )}
      <label className="flex flex-col gap-1 text-[10px] text-text-secondary">
        备注
        <textarea
          value={params.note}
          onChange={event => write({ ...params, note: event.target.value })}
          rows={3}
          className="canvas-input resize-none rounded-md border border-border-default bg-surface-inset px-2 py-1.5 text-[11px] text-text-primary outline-none"
        />
      </label>
    </div>
  )
}

function ScriptInspector({
  draft,
  setDraft,
}: {
  draft: Record<string, string>
  setDraft: (draft: Record<string, string>) => void
}) {
  const kind = canvasScriptDocumentKind(draft.documentKind)
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-[11px] font-medium text-text-primary">脚本</h3>
        <p className="mt-1 text-[10px] text-text-weak">自由文本，或写成结构化分镜大纲。</p>
      </div>
      <div className="flex gap-1">
        {(["free", "story_outline"] as const).map(item => (
          <button
            key={item}
            type="button"
            className={kind === item ? "rounded-md bg-white/15 px-2 py-1 text-[10px] text-text-primary" : "rounded-md bg-surface-hover px-2 py-1 text-[10px] text-text-secondary"}
            onClick={() => setDraft({ ...draft, documentKind: item })}
          >
            {item === "free" ? "自由文本" : "分镜大纲"}
          </button>
        ))}
      </div>
      {kind === "story_outline" ? (
        <p className="whitespace-pre-wrap text-[11px] leading-5 text-text-secondary">
          {(() => {
            const outline = parseCanvasStoryOutline(draft.outline)
            if (!outline) return "尚未添加幕或镜头。可在节点上直接编辑大纲 JSON，或先用自由文本撰写脚本。"
            const summary = summarizeCanvasStoryOutline(outline)
            return `分镜大纲 · ${summary.acts} 幕 ${summary.shots} 镜头${outline.synopsis ? `\n${outline.synopsis}` : ""}`
          })()}
        </p>
      ) : (
        <textarea
          value={draft.script || ""}
          onChange={event => setDraft({ ...draft, script: event.target.value })}
          rows={12}
          placeholder="写下镜头、旁白和创作说明"
          className="canvas-input min-h-[200px] resize-none rounded-md border border-border-default bg-surface-inset px-2 py-1.5 text-[11px] text-text-primary outline-none"
        />
      )}
    </div>
  )
}

function ShortcutList({ items }: { items: typeof CANVAS_SHORTCUTS_LEFT }) {

  return (
    <ul className="space-y-2 text-xs text-text-secondary">
      {items.map(item => (
        <li key={item.action} className="flex items-center justify-between gap-3">
          <span>{item.action}</span>
          <span className="flex items-center gap-1 text-text-weak">
            {item.scrollWheel ? "Scroll wheel" : item.keys.map(key => <Kbd key={key}>{key}</Kbd>)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border-default bg-surface-inset px-1.5 py-0.5 text-[10px] text-text-secondary">{children}</kbd>
}