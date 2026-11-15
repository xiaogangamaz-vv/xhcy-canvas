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
  Keyboard,
  Map as MapIcon,
  Maximize2,
  Plus,
  Redo2,
  Undo2,
  Upload,
  X,
} from "lucide-react"
import type { HostPort, CanvasDocument } from "@/adapters/host"
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
import { CANVAS_STANDARD_RENDERER_COMPONENTS } from "@/canvas/standard-node-renderer"
import {
  CANVAS_GENERATION_RENDERER_COMPONENTS,
  CANVAS_PREVIS_RENDERER_COMPONENTS,
  CANVAS_STORYBOARD_RENDERER_COMPONENTS,
} from "@/canvas/stub-renderers"
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
  if (node.type === "script") return paramString(node.params, "script")
  if (node.type === "scene" || node.type === "character" || node.type === "group") return paramString(node.params, "text")
  if (node.type === "storyboard") return paramString(node.params, "note") || "Storyboard"
  if (node.type === "generation") return paramString(node.params, "prompt")
  if (node.type === "audio") return paramString(node.params, "title")
  if (node.type === "previs") return "Previs"
  return paramString(node.params, "caption") || paramString(node.params, "url")
}

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
  const StoryboardRenderer = renderer === "storyboard" ? CANVAS_STORYBOARD_RENDERER_COMPONENTS[renderer] : null
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
  const showHandles = renderer !== "group" && renderer !== "storyboard"
  const preview = nodePreviewText(node)
  const mediaUrl = node.assetRefs[0]?.url || paramString(node.params, "url") || paramString(node.params, "mediaUrl")
  const surface = canvasSurfaceStyle({ selected, highlighted: data.highlighted })

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
      className={cn("relative h-full w-full overflow-visible", isGroupFrame ? "bg-transparent" : "rounded-2xl")}
      style={isGroupFrame ? undefined : { ...surface, pointerEvents: "auto" }}
    >
      <NodeResizer
        minWidth={NODE_MIN_WIDTH}
        minHeight={NODE_MIN_HEIGHT}
        maxWidth={NODE_MAX_WIDTH}
        maxHeight={NODE_MAX_HEIGHT}
        isVisible={selected && !isGroupFrame}
        color="#fafaf9"
      />
      {showHandles ? (
        <>
          <CanvasPlusHandle type="target" position={Position.Left} variant="target" reveal={data.connectable || selected} style={{ top: "50%" }} />
          <CanvasPlusHandle type="source" position={Position.Right} id="out" variant="source" reveal={data.connectable || selected} style={{ top: "50%" }} />
          {renderer === "generation" ? (
            <CanvasPlusHandle type="target" position={Position.Left} id="ref" variant="ref" reveal={data.connectable || selected} style={{ top: "28%" }} />
          ) : null}
        </>
      ) : null}

      {isGroupFrame && GroupRenderer ? (
        <GroupRenderer title={node.title} text={String(preview || "")} selected={selected} />
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
          {GenerationRenderer ? (
            <GenerationRenderer title={nodeDefinition.label} text={String(preview || "")} />
          ) : PrevisRenderer ? (
            <PrevisRenderer title={nodeDefinition.label} text={String(preview || "")} />
          ) : StoryboardRenderer ? (
            <StoryboardRenderer title={nodeDefinition.label} text={String(preview || "")} />
          ) : SceneRenderer ? (
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
    const flowNodes = nodesRef.current.filter(node => node.id !== nodeId)
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
      for (const item of clipboardRef.current.nodes) {
        const body = canvasClipboardNodeBody(item, offset)
        const timestamp = Date.now()
        const id = crypto.randomUUID()
        createdIds.push(id)
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
          params: { ...createDefaultCanvasNodeParams(body.type), ...(body.params as Record<string, string>) },
          createdAt: timestamp,
          updatedAt: timestamp,
        } as CanvasNode)
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

  const palette = useMemo(() => CANVAS_QUICK_ADD_NODE_TYPES, [])

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
          {palette.map(type => {
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

      <button
        type="button"
        className="absolute bottom-6 right-6 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-default bg-surface-overlay text-text-primary shadow-xl"
        onClick={() => {
          const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
          createNode("text", center)
        }}
        title="Add text node"
      >
        <Plus className="h-5 w-5" />
      </button>

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