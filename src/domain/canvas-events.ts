/**
 * Canvas change-event contract (pure functions, no I/O).
 * Helpers for planning how a local cache should merge a document revision.
 */

import type { CanvasNodeStatus, CanvasNodeType } from "@/domain/types"

/** Event names used when a host emits document changes. */
export const CANVAS_EVENT_NAMES = {
  /** 连接建立，携带当前 revision，客户端据此对齐本地状态。 */
  ready: "ready",
  /** 一次画布内容变更（可能含多个节点/连线）。 */
  canvas: "canvas",
  /** 心跳（也用于穿透中间层代理的空闲超时）。 */
  heartbeat: "heartbeat",
  /** The emitter asks the client to reconnect. */
  reconnect: "reconnect",
} as const

export type CanvasEventName =
  typeof CANVAS_EVENT_NAMES[keyof typeof CANVAS_EVENT_NAMES]

/** 事件里的节点表示：只带客户端合并所需字段，不带 params 全量（体积可控）。 */
export type CanvasEventNode = {
  id: string
  type: string
  title: string
  x: number
  y: number
  width: number
  height: number
  status: string
  /** 生成进度（来自节点 params 的投影，见 canvas-generation-progress）。 */
  progressPercent: number | null
}

export type CanvasEventEdge = {
  id: string
  source: string
  target: string
  sourceHandle: string | null
  targetHandle: string | null
  edgeType: string
}

export type CanvasEventPayload = {
  canvasId: string
  revision: number
  /** 新增或更新的节点（不含已删除的）。 */
  nodes: CanvasEventNode[]
  edges: CanvasEventEdge[]
  /** 需从本地移除的节点（含被级联删掉的连线在下方单独给出）。 */
  deletedNodeIds: string[]
  deletedEdgeIds: string[]
}

export type CanvasEventCursor = {
  revision: number
  watermark: number
}

/** 流的最长存活时长；到点发 reconnect 让客户端带新游标重连（避免无上限的长连接）。 */
export const CANVAS_EVENT_MAX_STREAM_MS = 15 * 60 * 1000
/** Suggested polling interval when a host uses polling instead of a stream. */
export const CANVAS_EVENT_POLL_INTERVAL_MS = 1000
/** 心跳间隔。 */
export const CANVAS_EVENT_HEARTBEAT_MS = 15 * 1000

/**
 * 规范化客户端传入的 `since`/`Last-Event-ID` 游标。
 *
 * 接受非负整数（revision）。缺失、非数字、负数一律回退到 `null`，
 * A missing cursor means the client should wait for a ready event and may reload the full document.
 */
export function normalizeCanvasEventCursor(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value)
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed)
  }
  return null
}

/** 请求的每批行数上限；防止一次变更过大把单帧撑爆。 */
export const CANVAS_EVENT_MAX_ROWS_PER_FRAME = 200

type NodeRowLike = {
  id: string
  type: string
  title: string
  x: number
  y: number
  width: number
  height: number
  status: string
  params_json: string | null
  deleted_at: number | null
}

type EdgeRowLike = {
  id: string
  source_node_id: string
  target_node_id: string
  source_handle: string | null
  target_handle: string | null
  edge_type: string
  deleted_at: number | null
}

function readProgressPercent(paramsJson: string | null): number | null {
  if (!paramsJson) return null
  try {
    const parsed = JSON.parse(paramsJson)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const value = (parsed as Record<string, unknown>).lastProgressPercent
    return typeof value === "number" && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

/**
 * 把"自水位以来变化的行"整形成一个事件负载。
 *
 * 软删的行不会出现在 `nodes`/`edges` 里，而是进 `deletedNodeIds`/`deletedEdgeIds` ——
 * 客户端据此移除本地对象，语义与画布一致。
 */
export function buildCanvasEventPayload(input: {
  canvasId: string
  revision: number
  nodeRows: readonly NodeRowLike[]
  edgeRows: readonly EdgeRowLike[]
}): CanvasEventPayload {
  const nodes: CanvasEventNode[] = []
  const deletedNodeIds: string[] = []
  for (const row of input.nodeRows) {
    if (row.deleted_at !== null && row.deleted_at !== undefined) {
      deletedNodeIds.push(row.id)
      continue
    }
    nodes.push({
      id: row.id,
      type: row.type,
      title: row.title,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      status: row.status,
      progressPercent: readProgressPercent(row.params_json),
    })
  }

  const edges: CanvasEventEdge[] = []
  const deletedEdgeIds: string[] = []
  for (const row of input.edgeRows) {
    if (row.deleted_at !== null && row.deleted_at !== undefined) {
      deletedEdgeIds.push(row.id)
      continue
    }
    edges.push({
      id: row.id,
      source: row.source_node_id,
      target: row.target_node_id,
      sourceHandle: row.source_handle,
      targetHandle: row.target_handle,
      edgeType: row.edge_type,
    })
  }

  return { canvasId: input.canvasId, revision: input.revision, nodes, edges, deletedNodeIds, deletedEdgeIds }
}

/** 负载是否真的带了变化（避免空帧）。 */
export function hasCanvasEventChanges(payload: CanvasEventPayload): boolean {
  return payload.nodes.length > 0 || payload.edges.length > 0
    || payload.deletedNodeIds.length > 0 || payload.deletedEdgeIds.length > 0
}

// ---------------------------------------------------------------------------
// 消费侧：把事件负载合并进画布缓存
// ---------------------------------------------------------------------------

/**
 * 事件里的节点是**精简投影**（扁平 x/y/width/height，不带 params/assetRefs），
 * 而缓存里的节点是 `CanvasNode`（`position` / `size` / `params` / `assetRefs`）。
 * 这里做一次显式映射，避免把精简对象直接铺进缓存而丢字段。
 */
export type CanvasNodeUpdate = {
  id: string
  type: CanvasNodeType
  title: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  status: CanvasNodeStatus
  /** 无进度时为 null，调用方应保留缓存里的旧值而不是写入 null。 */
  progressPercent: number | null
}

export type CanvasCachePlan =
  | {
    kind: "patch"
    revision: number
    nodeUpdates: CanvasNodeUpdate[]
    deletedNodeIds: string[]
    deletedEdgeIds: string[]
  }
  | {
    kind: "refetch"
    revision: number
    reason: "unknown-node" | "unknown-edge"
  }

const KNOWN_NODE_TYPES = new Set<string>([
  "text", "image", "video", "audio", "script", "scene", "character", "group", "storyboard", "generation",
])

const KNOWN_NODE_STATUSES = new Set<string>(["idle", "running", "succeeded", "failed"])

function normalizeNodeType(value: string): CanvasNodeType {
  return (KNOWN_NODE_TYPES.has(value) ? value : "text") as CanvasNodeType
}

function normalizeNodeStatus(value: string): CanvasNodeStatus {
  return (KNOWN_NODE_STATUSES.has(value) ? value : "idle") as CanvasNodeStatus
}

/**
 * 决定"就地修补缓存"还是"整图重拉"。
 *
 * 规则：
 * - 出现**缓存里没有的节点/连线** → 重拉（事件只带精简投影，凭空造一个缺 params/assetRefs 的节点
 *   会让画布渲染出半成品）。结构性变化（新建、模板套用）走这条。
 * - 其余（已知节点/连线的状态、坐标、标题、进度变化）→ 就地修补，省掉一次整图请求。
 *   这正是一次生成过程中高频发生的那类事件。
 * - **删除一律就地应用**：id 是权威的，移除本地对象不需要额外字段。
 */
export function planCanvasCacheUpdate(input: {
  payload: CanvasEventPayload
  knownNodeIds: readonly string[]
  knownEdgeIds: readonly string[]
}): CanvasCachePlan {
  const knownNodes = new Set(input.knownNodeIds)
  const knownEdges = new Set(input.knownEdgeIds)

  for (const node of input.payload.nodes) {
    if (!knownNodes.has(node.id)) {
      return { kind: "refetch", revision: input.payload.revision, reason: "unknown-node" }
    }
  }
  for (const edge of input.payload.edges) {
    if (!knownEdges.has(edge.id)) {
      return { kind: "refetch", revision: input.payload.revision, reason: "unknown-edge" }
    }
  }

  return {
    kind: "patch",
    revision: input.payload.revision,
    nodeUpdates: input.payload.nodes.map(node => ({
      id: node.id,
      type: normalizeNodeType(node.type),
      title: node.title,
      position: { x: node.x, y: node.y },
      size: { width: node.width, height: node.height },
      status: normalizeNodeStatus(node.status),
      progressPercent: node.progressPercent,
    })),
    deletedNodeIds: input.payload.deletedNodeIds,
    deletedEdgeIds: input.payload.deletedEdgeIds,
  }
}
