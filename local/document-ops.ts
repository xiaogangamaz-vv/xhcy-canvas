import { LOCAL_CANVAS_ID, LOCAL_OWNER_ID, LOCAL_PROJECT_ID } from "./config.ts"
import { canConnectNodes, defaultGenerationParams, generationTitle, NODE_DEFAULTS, wouldCreateCycle } from "./catalog.ts"
import { enqueueGeneration, readCommands, readDocument, readOps, rememberOp, writeDocument } from "./store.ts"
import type { WorkspaceStore } from "./store.ts"
import { isNodeType, type CanvasNodeType, type GenerationCommand, type WorkspaceDocument, type WorkspaceNode, type WorkspaceOpName } from "./types.ts"

export type OpError = { error: string; code: string }

export type CreateNodeInput = {
  operationId: string
  type: string
  title?: string
  x?: number
  y?: number
  width?: number
  height?: number
  params?: Record<string, unknown>
}

export type UpdateNodeInput = {
  operationId: string
  nodeId: string
  title?: string
  x?: number
  y?: number
  width?: number
  height?: number
  status?: WorkspaceNode["status"]
  params?: Record<string, unknown>
}

export type ConfigureGeneratorInput = {
  operationId: string
  nodeId: string
  prompt?: string
  aspectRatio?: string
  imageSize?: string
  resolution?: string
  durationSeconds?: string
  modelId?: string
  mediaType?: "image" | "video"
  negativePrompt?: string
}

export type CreateEdgeInput = {
  operationId: string
  sourceNodeId: string
  targetNodeId: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

function replay<T>(store: WorkspaceStore, operationId: string, name: WorkspaceOpName): T | null {
  const existing = readOps(store)[operationId]
  if (!existing) return null
  if (existing.name !== name) {
    throw Object.assign(new Error("operationId 已用于其他操作"), { code: "operation_conflict" })
  }
  return existing.result as T
}

function commit<T>(store: WorkspaceStore, operationId: string, name: WorkspaceOpName, result: T, writerId: string): T {
  rememberOp(store, { operationId, name, result, createdAt: Date.now() })
  void writerId
  return result
}

function nextDocument(store: WorkspaceStore, current: WorkspaceDocument, patch: Partial<WorkspaceDocument>, writerId: string): WorkspaceDocument {
  const next: WorkspaceDocument = {
    ...current,
    ...patch,
    revision: (current.revision || 0) + 1,
  }
  return writeDocument(store, next, writerId)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function asParams(params: Record<string, unknown> | undefined): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null) continue
    next[key] = typeof value === "string" ? value : String(value)
  }
  return next
}

export function summarizeDocument(document: WorkspaceDocument) {
  return {
    id: document.id,
    name: document.name,
    revision: document.revision,
    nodeCount: document.nodes.length,
    edgeCount: document.edges.length,
    assetCount: document.assets.length,
    nodes: document.nodes.map(node => ({
      id: node.id,
      type: node.type,
      title: node.title,
      status: node.status,
      x: node.position.x,
      y: node.position.y,
      prompt: typeof node.params?.prompt === "string" ? node.params.prompt : undefined,
      mediaType: typeof node.params?.mediaType === "string" ? node.params.mediaType : undefined,
      modelId: typeof node.params?.modelId === "string" ? node.params.modelId : undefined,
      assetIds: node.assetRefs.map(ref => ref.assetId),
    })),
    edges: document.edges.map(edge => ({
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
    assets: document.assets.map(asset => ({
      id: asset.id,
      type: asset.type,
      title: asset.title,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      size: asset.size,
    })),
  }
}

export function createNode(store: WorkspaceStore, input: CreateNodeInput, writerId: string) {
  const replayed = replay<unknown>(store, input.operationId, "create_node")
  if (replayed) return { replayed: true, result: replayed }
  if (!isNodeType(input.type)) {
    return { error: "不支持的节点类型", code: "invalid_type" } satisfies OpError
  }
  const type = input.type as CanvasNodeType
  const defaults = NODE_DEFAULTS[type]
  const timestamp = Date.now()
  const current = readDocument(store)
  const mediaType = input.params && input.params.mediaType === "video" ? "video" : "image"
  const params = type === "generation"
    ? { ...defaultGenerationParams(mediaType, String(input.params?.modelId || "")), ...asParams(input.params) }
    : { ...defaults.params, ...asParams(input.params) }
  const node: WorkspaceNode = {
    id: crypto.randomUUID(),
    canvasId: current.id || LOCAL_CANVAS_ID,
    projectId: current.projectId || LOCAL_PROJECT_ID,
    ownerUserId: LOCAL_OWNER_ID,
    title: (input.title || (type === "generation" ? generationTitle(mediaType) : defaults.label)).slice(0, 120),
    type,
    position: {
      x: Number.isFinite(input.x) ? Number(input.x) : 0,
      y: Number.isFinite(input.y) ? Number(input.y) : 0,
    },
    size: {
      width: clamp(Math.round(input.width || defaults.size.width), 180, 960),
      height: clamp(Math.round(input.height || defaults.size.height), 120, 720),
    },
    status: "idle",
    assetRefs: [],
    params,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const document = nextDocument(store, current, { nodes: [...current.nodes, node] }, writerId)
  return commit(store, input.operationId, "create_node", { documentRevision: document.revision, node }, writerId)
}

export function updateNode(store: WorkspaceStore, input: UpdateNodeInput, writerId: string) {
  const replayed = replay<unknown>(store, input.operationId, "update_node")
  if (replayed) return { replayed: true, result: replayed }
  const current = readDocument(store)
  const existing = current.nodes.find(node => node.id === input.nodeId)
  if (!existing) return { error: "节点不存在", code: "not_found" } satisfies OpError
  const node: WorkspaceNode = {
    ...existing,
    title: input.title ? input.title.slice(0, 120) : existing.title,
    position: {
      x: input.x == null ? existing.position.x : Number(input.x),
      y: input.y == null ? existing.position.y : Number(input.y),
    },
    size: {
      width: input.width == null ? existing.size.width : clamp(Math.round(input.width), 180, 960),
      height: input.height == null ? existing.size.height : clamp(Math.round(input.height), 120, 720),
    },
    status: input.status || existing.status,
    params: input.params ? { ...existing.params, ...asParams(input.params) } : existing.params,
    updatedAt: Date.now(),
  }
  const document = nextDocument(store, current, {
    nodes: current.nodes.map(item => item.id === node.id ? node : item),
  }, writerId)
  return commit(store, input.operationId, "update_node", { documentRevision: document.revision, node }, writerId)
}

export function deleteNode(store: WorkspaceStore, input: { operationId: string; nodeId: string }, writerId: string) {
  const replayed = replay<unknown>(store, input.operationId, "delete_node")
  if (replayed) return { replayed: true, result: replayed }
  const current = readDocument(store)
  if (!current.nodes.some(node => node.id === input.nodeId)) {
    return { error: "节点不存在", code: "not_found" } satisfies OpError
  }
  const document = nextDocument(store, current, {
    nodes: current.nodes.filter(node => node.id !== input.nodeId),
    edges: current.edges.filter(edge => edge.sourceNodeId !== input.nodeId && edge.targetNodeId !== input.nodeId),
  }, writerId)
  return commit(store, input.operationId, "delete_node", { documentRevision: document.revision, deletedNodeId: input.nodeId }, writerId)
}

export function createEdge(store: WorkspaceStore, input: CreateEdgeInput, writerId: string) {
  const replayed = replay<unknown>(store, input.operationId, "create_edge")
  if (replayed) return { replayed: true, result: replayed }
  const current = readDocument(store)
  const source = current.nodes.find(node => node.id === input.sourceNodeId)
  const target = current.nodes.find(node => node.id === input.targetNodeId)
  if (!source || !target) return { error: "连线的端点节点不存在", code: "not_found" } satisfies OpError
  if (!canConnectNodes({
    source,
    target,
    sourceHandle: input.sourceHandle,
    targetHandle: input.targetHandle,
  })) {
    return { error: "这两个节点不能这样连接", code: "invalid_connection" } satisfies OpError
  }
  if (wouldCreateCycle(current.edges, source.id, target.id)) {
    return { error: "该连线会形成环", code: "cycle" } satisfies OpError
  }
  const duplicate = current.edges.find(edge =>
    edge.sourceNodeId === source.id
    && edge.targetNodeId === target.id
    && (edge.sourceHandle || null) === (input.sourceHandle || null)
    && (edge.targetHandle || null) === (input.targetHandle || null)
  )
  if (duplicate) {
    return commit(store, input.operationId, "create_edge", { documentRevision: current.revision, edge: duplicate, alreadyExists: true }, writerId)
  }
  const timestamp = Date.now()
  const edge = {
    id: crypto.randomUUID(),
    canvasId: current.id || LOCAL_CANVAS_ID,
    projectId: current.projectId || LOCAL_PROJECT_ID,
    ownerUserId: LOCAL_OWNER_ID,
    sourceNodeId: source.id,
    targetNodeId: target.id,
    sourceHandle: input.sourceHandle || "out",
    targetHandle: input.targetHandle || "ref",
    edgeType: "default",
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const document = nextDocument(store, current, { edges: [...current.edges, edge] }, writerId)
  return commit(store, input.operationId, "create_edge", { documentRevision: document.revision, edge }, writerId)
}

export function deleteEdge(store: WorkspaceStore, input: { operationId: string; edgeId: string }, writerId: string) {
  const replayed = replay<unknown>(store, input.operationId, "delete_edge")
  if (replayed) return { replayed: true, result: replayed }
  const current = readDocument(store)
  if (!current.edges.some(edge => edge.id === input.edgeId)) {
    return { error: "连线不存在", code: "not_found" } satisfies OpError
  }
  const document = nextDocument(store, current, {
    edges: current.edges.filter(edge => edge.id !== input.edgeId),
  }, writerId)
  return commit(store, input.operationId, "delete_edge", { documentRevision: document.revision, deletedEdgeId: input.edgeId }, writerId)
}

export function configureGenerator(store: WorkspaceStore, input: ConfigureGeneratorInput, writerId: string) {
  const replayed = replay<unknown>(store, input.operationId, "configure_generator")
  if (replayed) return { replayed: true, result: replayed }
  const current = readDocument(store)
  const existing = current.nodes.find(node => node.id === input.nodeId)
  if (!existing) return { error: "节点不存在", code: "not_found" } satisfies OpError
  if (existing.type !== "generation") return { error: "只能配置生成节点", code: "invalid_type" } satisfies OpError
  const mediaType = input.mediaType || (existing.params.mediaType === "video" ? "video" : "image")
  const patch: Record<string, string> = {}
  if (input.prompt != null) patch.prompt = input.prompt
  if (input.aspectRatio != null) patch.aspectRatio = input.aspectRatio
  if (input.imageSize != null) patch.imageSize = input.imageSize
  if (input.resolution != null) patch.resolution = input.resolution
  if (input.durationSeconds != null) patch.durationSeconds = input.durationSeconds
  if (input.modelId != null) patch.modelId = input.modelId
  if (input.negativePrompt != null) patch.negativePrompt = input.negativePrompt
  if (input.mediaType) {
    patch.mediaType = mediaType
    patch.moduleKey = mediaType === "video" ? "text-to-video" : "text-to-image"
    patch.mode = mediaType === "video" ? "text_to_video" : "text_to_image"
  }
  const node: WorkspaceNode = {
    ...existing,
    title: input.mediaType ? generationTitle(mediaType) : existing.title,
    params: { ...existing.params, ...patch },
    updatedAt: Date.now(),
  }
  const document = nextDocument(store, current, {
    nodes: current.nodes.map(item => item.id === node.id ? node : item),
  }, writerId)
  return commit(store, input.operationId, "configure_generator", { documentRevision: document.revision, node }, writerId)
}

export function queueGeneration(store: WorkspaceStore, input: { operationId: string; nodeId: string }, writerId: string) {
  const replayed = replay<unknown>(store, input.operationId, "run_generation")
  if (replayed) return { replayed: true, result: replayed }
  const completed = readCommands(store).results[input.operationId]
  if (completed) return { replayed: true, result: completed }
  const current = readDocument(store)
  const node = current.nodes.find(item => item.id === input.nodeId)
  if (!node) return { error: "节点不存在", code: "not_found" } satisfies OpError
  if (node.type !== "generation") return { error: "只能对生成节点触发生成", code: "invalid_type" } satisfies OpError
  const prompt = String(node.params.prompt || "").trim()
  if (!prompt) return { error: "请先填写提示词", code: "missing_prompt" } satisfies OpError
  if (!String(node.params.modelId || "").trim()) return { error: "请先选择模型", code: "missing_model" } satisfies OpError
  const command: GenerationCommand = {
    id: input.operationId,
    operationId: input.operationId,
    type: "run_generation",
    nodeId: input.nodeId,
    createdAt: Date.now(),
    status: "pending",
  }
  enqueueGeneration(store, command)
  void writerId
  return { queued: true, command }
}

export function rememberGenerationResult(store: WorkspaceStore, operationId: string, result: unknown) {
  rememberOp(store, { operationId, name: "run_generation", result, createdAt: Date.now() })
}
