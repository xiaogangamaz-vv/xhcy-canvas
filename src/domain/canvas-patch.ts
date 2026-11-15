/**
 * Atomic canvas patch contract (pure functions, no I/O).
 * Apply creates, updates, and deletes of nodes and edges as one validation
 * against the resulting graph so a half-applied graph never becomes the source of truth.
 * Connectivity comes from node capabilities; cycle detection comes from the graph module.
 */

import { z } from "zod"
import { canConnectCanvasCapabilityNodeInstances } from "@/domain/node-capabilities"
import { wouldCreateCanvasCycle, type CanvasGraphEdge } from "@/domain/graph"
import {
  connectionEndpointFromCanvasNode,
  createEdgeSchema,
  createNodeSchema,
  type CanvasNodeType,
} from "@/domain/types"

/** 单次补丁的操作数上限。挡误操作，不是产品上限。 */
export const CANVAS_PATCH_MAX_NODE_OPS = 200
export const CANVAS_PATCH_MAX_EDGE_OPS = 400

const nodeIdSchema = z.string().trim().min(1).max(160)

/**
 * 补丁里的节点创建：在 `createNodeSchema` 之上**只增加**可选 `id`。
 *
 * Optional ids let a later edge in the same patch point at a node created in that patch.
 */
export const canvasPatchNodeCreateSchema = createNodeSchema.extend({
  id: z.string().trim().min(1).max(160).optional(),
})

/**
 * 补丁里的节点更新：几何与标题。
 *
 * 边界与 `batchUpdateNodesSchema` 保持一致（同一批字段没有第二套范围）。
 * This update schema covers geometry and title only.
 */
export const canvasPatchNodeUpdateSchema = z.object({
  nodeId: nodeIdSchema,
  title: z.string().trim().min(1).max(120).optional(),
  x: z.number().finite().min(-100000).max(100000).optional(),
  y: z.number().finite().min(-100000).max(100000).optional(),
  width: z.number().int().min(180).max(960).optional(),
  height: z.number().int().min(120).max(720).optional(),
})

/** 补丁里的连线创建：直接用 `createEdgeSchema`（含 id 可选、handle、edgeType 默认值）。 */
export const canvasPatchEdgeCreateSchema = createEdgeSchema

export const canvasPatchSchema = z.object({
  /**
   * 提交者看到的画布版本。The document revision the client last loaded. A host may reject a stale write.
   */
  baseRevision: z.number().int().nonnegative(),
  nodes: z.object({
    create: z.array(canvasPatchNodeCreateSchema).max(CANVAS_PATCH_MAX_NODE_OPS).default([]),
    update: z.array(canvasPatchNodeUpdateSchema).max(CANVAS_PATCH_MAX_NODE_OPS).default([]),
    delete: z.array(nodeIdSchema).max(CANVAS_PATCH_MAX_NODE_OPS).default([]),
  }).default({ create: [], update: [], delete: [] }),
  edges: z.object({
    create: z.array(canvasPatchEdgeCreateSchema).max(CANVAS_PATCH_MAX_EDGE_OPS).default([]),
    delete: z.array(nodeIdSchema).max(CANVAS_PATCH_MAX_EDGE_OPS).default([]),
  }).default({ create: [], delete: [] }),
})

export type CanvasPatch = z.infer<typeof canvasPatchSchema>
export type CanvasPatchNodeCreate = z.infer<typeof canvasPatchNodeCreateSchema>
export type CanvasPatchNodeUpdate = z.infer<typeof canvasPatchNodeUpdateSchema>
export type CanvasPatchEdgeCreate = z.infer<typeof canvasPatchEdgeCreateSchema>

/** Minimal graph state used for validation: structure only. */
export type CanvasPatchNodeState = {
  id: string
  type: CanvasNodeType
  title: string
  x: number
  y: number
  width: number
  height: number
  params: Record<string, unknown>
}

export type CanvasPatchEdgeState = {
  id: string
  source: string
  target: string
  sourceHandle: string | null
  targetHandle: string | null
  edgeType: string
}

export type CanvasPatchState = {
  nodes: CanvasPatchNodeState[]
  edges: CanvasPatchEdgeState[]
}

export type CanvasPatchViolationCode =
  | "DUPLICATE_NODE_ID"
  | "NODE_NOT_FOUND"
  | "EDGE_NOT_FOUND"
  | "EDGE_ENDPOINT_MISSING"
  | "SELF_LOOP"
  | "CYCLE"
  | "INCOMPATIBLE_CONNECTION"
  | "INPUT_COUNT_CONSTRAINT"

export type CanvasPatchViolation = {
  scope: "nodes.create" | "nodes.update" | "nodes.delete" | "edges.create" | "edges.delete"
  index: number
  id: string | null
  code: CanvasPatchViolationCode
  message: string
}

export type CanvasPatchValidation =
  | { ok: true; next: CanvasPatchState }
  | { ok: false; violations: CanvasPatchViolation[] }

/**
 * 在**最终图**上做环检测。
 *
 * `wouldCreateCanvasCycle(accepted, source, target)` 判断"加这一条边会不会闭环"，
 * 逐条加入并复用同一个谓词，就能在不复制图算法的前提下覆盖整批新增边
 * （含批内多条边互相成环）。
 */
export function hasCanvasCycle(edges: readonly CanvasGraphEdge[]): boolean {
  const accepted: CanvasGraphEdge[] = []
  for (const edge of edges) {
    if (wouldCreateCanvasCycle(accepted, edge.source, edge.target)) return true
    accepted.push(edge)
  }
  return false
}

/**
 * 校验并计算补丁的最终图。
 *
 * Apply order: create/update nodes, then deletes, then edges.
 * 任何一条违规都会让整批不生效（服务端据此回滚事务）。
 */
export function validateCanvasPatch(
  state: CanvasPatchState,
  patch: CanvasPatch,
): CanvasPatchValidation {
  const violations: CanvasPatchViolation[] = []

  const nodes = new Map(state.nodes.map(node => [node.id, node]))
  const edges = new Map(state.edges.map(edge => [edge.id, edge]))

  // 1) 节点创建：id 不得与现有节点重复。
  patch.nodes.create.forEach((item, index) => {
    const id = item.id ?? null
    if (id && nodes.has(id)) {
      violations.push({
        scope: "nodes.create", index, id, code: "DUPLICATE_NODE_ID",
        message: `节点 id 已存在：${id}`,
      })
      return
    }
    const effectiveId = id ?? `__pending_node_${index}`
    nodes.set(effectiveId, {
      id: effectiveId,
      type: item.type,
      title: item.title ?? "",
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      params: item.params,
    })
  })

  // 2) 节点更新：目标必须存在。
  patch.nodes.update.forEach((item, index) => {
    const current = nodes.get(item.nodeId)
    if (!current) {
      violations.push({
        scope: "nodes.update", index, id: item.nodeId, code: "NODE_NOT_FOUND",
        message: `待更新节点不存在：${item.nodeId}`,
      })
      return
    }
    nodes.set(item.nodeId, {
      ...current,
      ...(item.title === undefined ? {} : { title: item.title }),
      ...(item.x === undefined ? {} : { x: item.x }),
      ...(item.y === undefined ? {} : { y: item.y }),
      ...(item.width === undefined ? {} : { width: item.width }),
      ...(item.height === undefined ? {} : { height: item.height }),
    })
  })

  // 3) 节点删除：软删节点并**级联**删掉它的全部连线（与 deleteCanvasNode 同语义）。
  patch.nodes.delete.forEach((nodeId, index) => {
    if (!nodes.has(nodeId)) {
      violations.push({
        scope: "nodes.delete", index, id: nodeId, code: "NODE_NOT_FOUND",
        message: `待删除节点不存在：${nodeId}`,
      })
      return
    }
    nodes.delete(nodeId)
    for (const [edgeId, edge] of edges) {
      if (edge.source === nodeId || edge.target === nodeId) edges.delete(edgeId)
    }
  })

  // 4) 连线删除。
  patch.edges.delete.forEach((edgeId, index) => {
    if (!edges.has(edgeId)) {
      violations.push({
        scope: "edges.delete", index, id: edgeId, code: "EDGE_NOT_FOUND",
        message: `待删除连线不存在：${edgeId}`,
      })
      return
    }
    edges.delete(edgeId)
  })

  // 5) 连线创建：端点存在、非自环、可连接；ref 端口一对一。
  //    一对一在**最终图**上判定，所以同一批里的旧 ref 边与新 ref 边不会互相漏检。
  patch.edges.create.forEach((item, index) => {
    const edgeId = item.id ?? `__pending_edge_${index}`
    const source = nodes.get(item.sourceNodeId)
    const target = nodes.get(item.targetNodeId)
    if (!source || !target) {
      violations.push({
        scope: "edges.create", index, id: item.id ?? null, code: "EDGE_ENDPOINT_MISSING",
        message: `连线端点不在最终图内：${item.sourceNodeId} → ${item.targetNodeId}`,
      })
      return
    }
    if (item.sourceNodeId === item.targetNodeId) {
      violations.push({
        scope: "edges.create", index, id: item.id ?? null, code: "SELF_LOOP",
        message: "不允许自环连接",
      })
      return
    }
    if (!canConnectCanvasCapabilityNodeInstances({
      source: connectionEndpointFromCanvasNode(source),
      target: connectionEndpointFromCanvasNode(target),
      sourceHandle: item.sourceHandle ?? null,
      targetHandle: item.targetHandle ?? null,
    })) {
      violations.push({
        scope: "edges.create", index, id: item.id ?? null, code: "INCOMPATIBLE_CONNECTION",
        message: `该连接不合法：${source.type} → ${target.type}`,
      })
      return
    }
    if (item.targetHandle === "ref") {
      const conflict = [...edges.values()].find(edge =>
        edge.target === item.targetNodeId && edge.targetHandle === "ref")
      // ref 端口一对一：后写的替换先写的（与 createCanvasEdge 的既有语义一致）。
      if (conflict) edges.delete(conflict.id)
    }
    edges.set(edgeId, {
      id: edgeId,
      source: item.sourceNodeId,
      target: item.targetNodeId,
      sourceHandle: item.sourceHandle ?? null,
      targetHandle: item.targetHandle ?? null,
      edgeType: item.edgeType,
    })
  })

  if (violations.length > 0) return { ok: false, violations }

  // 6) 最终图必须无环，且所有已知 generation module 的输入数量要满足 min/max。
  const finalEdges = [...edges.values()]
  if (hasCanvasCycle(finalEdges.map(edge => ({ source: edge.source, target: edge.target })))) {
    return {
      ok: false,
      violations: [{
        scope: "edges.create", index: 0, id: null, code: "CYCLE",
        message: "该补丁会让画布出现循环依赖，已拒绝",
      }],
    }
  }
  

  return { ok: true, next: { nodes: [...nodes.values()], edges: finalEdges } }
}
