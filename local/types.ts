export const canvasNodeTypes = [
  "text",
  "image",
  "video",
  "audio",
  "script",
  "scene",
  "character",
  "group",
  "storyboard",
  "generation",
  "previs",
] as const

export type CanvasNodeType = (typeof canvasNodeTypes)[number]

export type CanvasNodeStatus = "idle" | "running" | "succeeded" | "failed"

export type CanvasAssetKind = "image" | "video" | "audio" | "text" | "script" | "thumbnail" | "file"

export type WorkspaceViewport = { x: number; y: number; zoom: number }

export type WorkspaceAssetRef = {
  assetId: string
  type: CanvasAssetKind
  url?: string | null
}

export type WorkspaceNode = {
  id: string
  canvasId: string
  projectId: string
  ownerUserId: string
  title: string
  type: CanvasNodeType
  position: { x: number; y: number }
  size: { width: number; height: number }
  status: CanvasNodeStatus
  assetRefs: WorkspaceAssetRef[]
  params: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export type WorkspaceEdge = {
  id: string
  canvasId: string
  projectId: string
  ownerUserId: string
  sourceNodeId: string
  targetNodeId: string
  sourceHandle: string | null
  targetHandle: string | null
  edgeType: string
  createdAt: number
  updatedAt: number
}

export type WorkspaceAsset = {
  id: string
  ownerId: string
  projectId: string
  canvasId: string | null
  type: CanvasAssetKind
  source: string
  sourceTable: string
  title: string
  mimeType: string | null
  size: number
  width: number | null
  height: number | null
  duration: number | null
  status: string
  url: string | null
  storageKey: string | null
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export type WorkspaceDocument = {
  id: string
  projectId: string
  name: string
  viewport: WorkspaceViewport
  nodes: WorkspaceNode[]
  edges: WorkspaceEdge[]
  assets: WorkspaceAsset[]
  revision: number
}

export type WorkspaceOpName =
  | "create_node"
  | "update_node"
  | "delete_node"
  | "create_edge"
  | "delete_edge"
  | "configure_generator"
  | "run_generation"

export type WorkspaceOpRecord = {
  operationId: string
  name: WorkspaceOpName
  result: unknown
  createdAt: number
}

export type GenerationCommand = {
  id: string
  operationId: string
  type: "run_generation"
  nodeId: string
  createdAt: number
  status: "pending" | "running"
}

export type GenerationCommandResult = {
  operationId: string
  status: "succeeded" | "failed"
  assetId?: string
  message?: string
  completedAt: number
}

export type CommandLog = {
  pending: GenerationCommand[]
  results: Record<string, GenerationCommandResult>
}

export type StoreMeta = {
  revision: number
  writerId: string | null
  updatedAt: number
}

export function isNodeType(value: unknown): value is CanvasNodeType {
  return typeof value === "string" && (canvasNodeTypes as readonly string[]).includes(value)
}

export function emptyDocument(): WorkspaceDocument {
  return {
    id: "local-canvas",
    projectId: "local-project",
    name: "Canvas",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    assets: [],
    revision: 0,
  }
}

export function isWorkspaceDocument(value: unknown): value is WorkspaceDocument {
  if (!value || typeof value !== "object") return false
  const doc = value as WorkspaceDocument
  return Array.isArray(doc.nodes) && Array.isArray(doc.edges) && typeof doc.id === "string"
}
