import {
  Box,
  Boxes,
  ImageIcon,
  LayoutGrid,
  PenLine,
  Scissors,
  Type,
  Video,
  type LucideIcon,
} from "lucide-react"
import {
  canConnectCanvasRegistryNodeInstances,
  createDefaultCanvasNodeParams,
} from "@/canvas/node-registry"
import {
  connectionEndpointFromCanvasNode,
  canvasGenerationMediaTypeFromParams,
  type CanvasNodeType,
} from "@/domain/types"

/**
 * Drag-out menu ("引用该节点生成"): dropping a line on empty canvas offers what to
 * create where the line ended.
 *
 * The canvas only wires edges its own rules allow, so an entry resolves to the node
 * the canvas can actually place *and* connect from that source: an image/video entry
 * becomes a generation node when the line comes from a data node, and a media result
 * node when it comes from a generation node. Entries whose node family is not built
 * yet (快捷剪辑 / 3D …) stay in the list as disabled rows.
 */
export const CANVAS_REFERENCE_MENU_TITLE = "引用该节点生成"

/** Panel box, used to keep the menu inside the canvas section when it opens near an edge. */
export const CANVAS_REFERENCE_MENU_WIDTH = 184
export const CANVAS_REFERENCE_MENU_HEIGHT = 8 * 34 + 30

/** Node id used only to ask the connection rules about a node that does not exist yet. */
const PENDING_NODE_ID = "pending-reference-node"

export type CanvasReferenceSource = {
  id: string
  type: CanvasNodeType
  params?: unknown
  sourceHandle?: string | null
}

export type CanvasReferenceTarget = {
  nodeType: CanvasNodeType
  params: Record<string, string>
  /** False when the canvas rules forbid the source → new node edge. */
  connect: boolean
}

export type CanvasReferenceMenuEntry = {
  key: string
  label: string
  icon: LucideIcon
  /** Null while the node family is not implemented — the row renders disabled. */
  resolve: ((source: CanvasReferenceSource) => CanvasReferenceTarget) | null
}

function connects(source: CanvasReferenceSource, target: CanvasReferenceTarget): boolean {
  return canConnectCanvasRegistryNodeInstances({
    source: connectionEndpointFromCanvasNode({ id: source.id, type: source.type, params: source.params }),
    target: connectionEndpointFromCanvasNode({ id: PENDING_NODE_ID, type: target.nodeType, params: target.params }),
    sourceHandle: source.sourceHandle ?? null,
    targetHandle: null,
  })
}

/** True when the source hands a still image to whatever is created next. */
function sourceProvidesImage(source: CanvasReferenceSource): boolean {
  if (source.type === "image") return true
  return source.type === "generation" && canvasGenerationMediaTypeFromParams(source.params) === "image"
}

function resolveMediaEntry(source: CanvasReferenceSource, mediaType: "image" | "video"): CanvasReferenceTarget {
  // A generation node produces results, so the entry becomes the result node of that
  // medium; every other node feeds a new generator.
  if (source.type === "generation" && canvasGenerationMediaTypeFromParams(source.params) === mediaType) {
    const target: CanvasReferenceTarget = {
      nodeType: mediaType,
      params: createDefaultCanvasNodeParams(mediaType),
      connect: false,
    }
    return { ...target, connect: connects(source, target) }
  }
  const params: Record<string, string> = {
    ...createDefaultCanvasNodeParams("generation"),
    mediaType,
    moduleKey: sourceProvidesImage(source)
      ? mediaType === "image" ? "image-to-image" : "image-to-video"
      : mediaType === "image" ? "text-to-image" : "text-to-video",
  }
  const target: CanvasReferenceTarget = { nodeType: "generation", params, connect: false }
  return { ...target, connect: connects(source, target) }
}

function resolveDataEntry(source: CanvasReferenceSource, nodeType: CanvasNodeType): CanvasReferenceTarget {
  const target: CanvasReferenceTarget = {
    nodeType,
    params: createDefaultCanvasNodeParams(nodeType),
    connect: false,
  }
  return { ...target, connect: connects(source, target) }
}

export const CANVAS_REFERENCE_MENU_ENTRIES: CanvasReferenceMenuEntry[] = [
  { key: "text", label: "文本", icon: Type, resolve: source => resolveDataEntry(source, "text") },
  { key: "image", label: "图片", icon: ImageIcon, resolve: source => resolveMediaEntry(source, "image") },
  { key: "video", label: "视频", icon: Video, resolve: source => resolveMediaEntry(source, "video") },
  { key: "quick-edit", label: "快捷剪辑", icon: Scissors, resolve: null },
  { key: "world-3d", label: "3D 世界", icon: Box, resolve: null },
  { key: "model-3d", label: "3D 模型", icon: Boxes, resolve: null },
  { key: "stage-3d", label: "3D 导演台", icon: LayoutGrid, resolve: null },
  { key: "script", label: "脚本策划", icon: PenLine, resolve: source => resolveDataEntry(source, "script") },
]

export function resolveCanvasReferenceMenuTarget(
  entry: CanvasReferenceMenuEntry,
  source: CanvasReferenceSource,
): CanvasReferenceTarget | null {
  return entry.resolve ? entry.resolve(source) : null
}
