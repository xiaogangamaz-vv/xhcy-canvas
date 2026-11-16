import { z } from "zod"

export const canvasNodeTypes = ["text", "image", "video", "audio", "script", "scene", "character", "group", "storyboard", "generation", "previs"] as const
export type CanvasNodeType = typeof canvasNodeTypes[number]

export const NODE_CONNECTION_RULES = {
  dataNodeTypes: ["text", "script", "scene", "character", "image", "video", "audio"] as const,
  generationNodeType: "generation",
  assetNodeTypes: ["image", "video", "audio"] as const,
  groupNodeType: "group",
  storyboardNodeType: "storyboard",
} as const

export function canConnectCanvasNodes(sourceType: CanvasNodeType, targetType: CanvasNodeType): boolean {
  if (
    sourceType === NODE_CONNECTION_RULES.groupNodeType || targetType === NODE_CONNECTION_RULES.groupNodeType
    || sourceType === NODE_CONNECTION_RULES.storyboardNodeType || targetType === NODE_CONNECTION_RULES.storyboardNodeType
  ) {
    return false
  }
  if (sourceType === NODE_CONNECTION_RULES.generationNodeType) {
    return (NODE_CONNECTION_RULES.assetNodeTypes as readonly string[]).includes(targetType)
  }
  return targetType === NODE_CONNECTION_RULES.generationNodeType
}

export const canvasNodeStatus = ["idle", "running", "succeeded", "failed"] as const
export type CanvasNodeStatus = typeof canvasNodeStatus[number]

export const canvasAssetKinds = ["image", "video", "audio", "text", "script", "thumbnail", "file"] as const
export type CanvasAssetKind = typeof canvasAssetKinds[number]

export const canvasAssetSources = ["upload", "generation", "external", "template", "mock"] as const
export type CanvasAssetSource = typeof canvasAssetSources[number]

export const canvasAssetStatus = ["active", "archived", "deleted"] as const
export type CanvasAssetStatus = typeof canvasAssetStatus[number]

export const canvasGenerationTaskTypes = ["image", "video", "audio", "script"] as const
export type CanvasGenerationTaskType = typeof canvasGenerationTaskTypes[number]

export const CANVAS_NODE_SOURCE_HANDLE_ID = "out"
export const CANVAS_NODE_REF_HANDLE_ID = "ref"

export const CANVAS_COMPATIBLE_GENERATION_CHAINS = [
  { sourceMediaType: "image", targetMediaType: "image" },
  { sourceMediaType: "image", targetMediaType: "video" },
] as const

export type CanvasConnectionEndpoint = {
  id: string
  type: CanvasNodeType
  mediaType?: string | null
}

export type CanvasConnectionAttempt = {
  source: CanvasConnectionEndpoint
  target: CanvasConnectionEndpoint
  sourceHandle?: string | null
  targetHandle?: string | null
}

export function canvasGenerationMediaTypeFromParams(params: unknown): CanvasGenerationTaskType | null {
  if (!params || typeof params !== "object") return null
  const mediaType = (params as { mediaType?: unknown }).mediaType
  return canvasGenerationTaskTypes.includes(mediaType as CanvasGenerationTaskType)
    ? mediaType as CanvasGenerationTaskType
    : null
}

export function connectionEndpointFromCanvasNode(node: {
  id: string
  type: CanvasNodeType
  params?: unknown
}): CanvasConnectionEndpoint {
  return {
    id: node.id,
    type: node.type,
    mediaType: node.type === NODE_CONNECTION_RULES.generationNodeType
      ? canvasGenerationMediaTypeFromParams(node.params)
      : null,
  }
}

function normalizeCanvasHandle(handle?: string | null): string | null {
  if (handle == null) return null
  const trimmed = handle.trim()
  return trimmed.length === 0 ? null : trimmed
}

function asGenerationMediaType(value: string | null | undefined): CanvasGenerationTaskType | null {
  return canvasGenerationTaskTypes.includes(value as CanvasGenerationTaskType)
    ? value as CanvasGenerationTaskType
    : null
}

export function isCompatibleCanvasGenerationChain(
  sourceMediaType: string | null | undefined,
  targetMediaType: string | null | undefined,
): boolean {
  const source = asGenerationMediaType(sourceMediaType ?? null)
  const target = asGenerationMediaType(targetMediaType ?? null)
  if (!source || !target) return false
  return CANVAS_COMPATIBLE_GENERATION_CHAINS.some(
    chain => chain.sourceMediaType === source && chain.targetMediaType === target,
  )
}

export function canConnectCanvasNodeInstances(attempt: CanvasConnectionAttempt): boolean {
  if (!attempt.source.id || !attempt.target.id || attempt.source.id === attempt.target.id) return false

  const sourceHandle = normalizeCanvasHandle(attempt.sourceHandle)
  const targetHandle = normalizeCanvasHandle(attempt.targetHandle)
  if (sourceHandle && sourceHandle !== CANVAS_NODE_SOURCE_HANDLE_ID) return false
  if (targetHandle && targetHandle !== CANVAS_NODE_REF_HANDLE_ID) return false

  const sourceMediaType = asGenerationMediaType(attempt.source.mediaType ?? null)
  const targetMediaType = asGenerationMediaType(attempt.target.mediaType ?? null)

  if (targetHandle === CANVAS_NODE_REF_HANDLE_ID) {
    if (attempt.target.type !== NODE_CONNECTION_RULES.generationNodeType) return false
    if (attempt.source.type === "image") return true
    return attempt.source.type === NODE_CONNECTION_RULES.generationNodeType && sourceMediaType === "image"
  }

  if (
    attempt.source.type === NODE_CONNECTION_RULES.generationNodeType
    && attempt.target.type === NODE_CONNECTION_RULES.generationNodeType
  ) {
    return isCompatibleCanvasGenerationChain(sourceMediaType, targetMediaType)
  }

  if (
    attempt.source.type === NODE_CONNECTION_RULES.generationNodeType
    && (NODE_CONNECTION_RULES.assetNodeTypes as readonly string[]).includes(attempt.target.type)
  ) {
    return sourceMediaType === attempt.target.type
  }

  return canConnectCanvasNodes(attempt.source.type, attempt.target.type)
}

export type CanvasViewport = {
  x: number
  y: number
  zoom: number
}

export type CanvasAssetRef = {
  assetId: string
  type: CanvasAssetKind
  url?: string | null
}

export type CanvasProject = {
  id: string
  ownerUserId: string
  title: string
  status: "active" | "archived" | "deleted"
  coverAssetId: string | null
  lastOpenedCanvasId: string | null
  previewImageUrl: string | null
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export type CanvasRecord = {
  id: string
  projectId: string
  ownerUserId: string
  name: string
  status: "active" | "archived" | "deleted"
  viewport: CanvasViewport
  snapshotVersion: number
  sortOrder: number
  previewImageUrl: string | null
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export type CanvasNodeBase = {
  id: string
  canvasId: string
  projectId: string
  ownerUserId: string
  title: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  status: CanvasNodeStatus
  assetRefs: CanvasAssetRef[]
  createdAt: number
  updatedAt: number
}

export type CanvasTextNode = CanvasNodeBase & {
  type: "text"
  params: { text?: string }
}

export type CanvasImageNode = CanvasNodeBase & {
  type: "image"
  params: { url?: string; caption?: string }
}

export type CanvasVideoNode = CanvasNodeBase & {
  type: "video"
  params: { url?: string; posterUrl?: string; caption?: string }
}

export type CanvasAudioNode = CanvasNodeBase & {
  type: "audio"
  params: { url?: string; title?: string }
}

export type CanvasScriptNode = CanvasNodeBase & {
  type: "script"
  params: { script?: string; language?: string; documentKind?: string; outline?: string }
}

export type CanvasStoryboardNode = CanvasNodeBase & {
  type: "storyboard"
  params: { schemaVersion?: string; sceneNodeIds?: string; layout?: string; note?: string }
}

export const CANVAS_STORYBOARD_SCHEMA_VERSION = "storyboard_board@1"
export const CANVAS_STORY_SCENE_SCHEMA_VERSION = "story_scene@1"
export const canvasSceneShotTypes = ["特写", "近景", "中景", "全景", "远景"] as const
export const canvasSceneCameraMovements = ["固定", "推", "拉", "摇", "移", "跟"] as const
export const canvasSceneReadiness = ["draft", "ready", "locked"] as const
export const canvasSceneReadinessLabels: Record<string, string> = {
  draft: "草稿",
  ready: "就绪",
  locked: "已锁定",
}

export type CanvasSceneNode = CanvasNodeBase & {
  type: "scene"
  params: {
    schemaVersion?: string
    text?: string
    dialogue?: string
    durationSeconds?: string
    shotType?: string
    cameraMovement?: string
    readiness?: string
    order?: string
    mediaKind?: string
    mediaMeta?: string
    mediaUrl?: string
  }
}

export const CANVAS_PREVIS_DOCUMENT_SCHEMA_VERSION = "previs_document@1"

export type CanvasPrevisNode = CanvasNodeBase & {
  type: "previs"
  params: { schemaVersion?: string; document?: string; activeShotId?: string }
}

export type CanvasCharacterNode = CanvasNodeBase & {
  type: "character"
  params: { text?: string; mediaUrl?: string; mediaKind?: string; mediaMeta?: string }
}

export type CanvasGroupNode = CanvasNodeBase & {
  type: "group"
  params: { text?: string }
}

export type CanvasGenerationNode = CanvasNodeBase & {
  type: "generation"
  params: {
    moduleKey?: string
    modelId?: string
    mediaType?: CanvasGenerationTaskType
    durationSeconds?: string
    prompt?: string
    aspectRatio?: string
    imageSize?: string
    negativePrompt?: string
    resolution?: string
    cameraPreset?: string
    cameraworkPreset?: string
    stylePreset?: string
    generationCount?: string
    mode?: string
    resultAssetId?: string
    outputHistory?: string
  }
}

export type CanvasNode =
  | CanvasTextNode
  | CanvasImageNode
  | CanvasVideoNode
  | CanvasAudioNode
  | CanvasScriptNode
  | CanvasSceneNode
  | CanvasCharacterNode
  | CanvasGroupNode
  | CanvasStoryboardNode
  | CanvasGenerationNode
  | CanvasPrevisNode

export type CanvasEdge = {
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

export type CanvasAsset = {
  id: string
  ownerId: string
  projectId: string
  canvasId: string | null
  type: CanvasAssetKind
  source: CanvasAssetSource
  sourceTable: "image_assets" | "video_assets" | "external"
  title: string
  mimeType: string | null
  size: number
  width: number | null
  height: number | null
  duration: number | null
  status: CanvasAssetStatus
  url: string | null
  storageKey: string | null
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export const viewportSchema = z.object({
  x: z.number().finite().default(0),
  y: z.number().finite().default(0),
  zoom: z.number().finite().min(0.05).max(4).default(1),
})

const assetRefSchema = z.object({
  assetId: z.string().min(1).max(160),
  type: z.enum(canvasAssetKinds),
  url: z.string().min(1).max(1000).optional().nullable(),
})

export const createNodeSchema = z.object({
  type: z.enum(canvasNodeTypes),
  title: z.string().trim().min(1).max(120).optional(),
  x: z.number().finite().min(-100000).max(100000).default(0),
  y: z.number().finite().min(-100000).max(100000).default(0),
  width: z.number().int().min(180).max(960).default(280),
  height: z.number().int().min(120).max(720).default(180),
  params: z.record(z.string(), z.unknown()).default({}),
  assetRefs: z.array(assetRefSchema).max(20).default([]),
})

export const updateNodeSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  x: z.number().finite().min(-100000).max(100000).optional(),
  y: z.number().finite().min(-100000).max(100000).optional(),
  width: z.number().int().min(180).max(960).optional(),
  height: z.number().int().min(120).max(720).optional(),
  status: z.enum(canvasNodeStatus).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  assetRefs: z.array(assetRefSchema).max(20).optional(),
})

export const batchUpdateNodesSchema = z.object({
  updates: z.array(z.object({
    nodeId: z.string().trim().min(1).max(160),
    x: z.number().finite().min(-100000).max(100000).optional(),
    y: z.number().finite().min(-100000).max(100000).optional(),
    width: z.number().int().min(180).max(960).optional(),
    height: z.number().int().min(120).max(720).optional(),
  })).min(1).max(100),
})

export const createEdgeSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  sourceNodeId: z.string().trim().min(1).max(160),
  targetNodeId: z.string().trim().min(1).max(160),
  sourceHandle: z.string().trim().max(80).optional().nullable(),
  targetHandle: z.string().trim().max(80).optional().nullable(),
  edgeType: z.string().trim().min(1).max(80).default("default"),
})