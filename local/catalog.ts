import type { CanvasNodeType, WorkspaceNode } from "./types.ts"

const ASSET_TYPES = new Set(["image", "video", "audio"])
const GENERATION_CHAINS = [
  { source: "image", target: "image" },
  { source: "image", target: "video" },
] as const

export const NODE_DEFAULTS: Record<CanvasNodeType, {
  label: string
  size: { width: number; height: number }
  params: Record<string, string>
}> = {
  text: { label: "文本", size: { width: 300, height: 170 }, params: { text: "" } },
  image: { label: "图片", size: { width: 320, height: 230 }, params: { url: "", caption: "" } },
  video: { label: "视频", size: { width: 360, height: 230 }, params: { url: "", caption: "" } },
  audio: { label: "音频", size: { width: 320, height: 150 }, params: { url: "", title: "" } },
  script: {
    label: "脚本",
    size: { width: 360, height: 240 },
    params: { script: "", language: "zh-CN", documentKind: "free", outline: "" },
  },
  scene: {
    label: "场景",
    size: { width: 340, height: 360 },
    params: {
      schemaVersion: "story_scene@1",
      text: "",
      dialogue: "",
      durationSeconds: "",
      shotType: "",
      cameraMovement: "",
      readiness: "draft",
      order: "",
      mediaKind: "",
      mediaMeta: "",
    },
  },
  character: {
    label: "角色",
    size: { width: 300, height: 340 },
    params: { text: "", mediaUrl: "", mediaKind: "", mediaMeta: "" },
  },
  group: { label: "分组", size: { width: 560, height: 380 }, params: { text: "" } },
  storyboard: {
    label: "分镜板",
    size: { width: 320, height: 380 },
    params: { schemaVersion: "storyboard_board@1", sceneNodeIds: "[]", layout: "list", note: "" },
  },
  generation: {
    label: "生成节点",
    size: { width: 380, height: 420 },
    params: {
      moduleKey: "text-to-image",
      modelId: "",
      mediaType: "image",
      durationSeconds: "4",
      prompt: "",
      aspectRatio: "auto",
      imageSize: "2K",
      negativePrompt: "",
      resolution: "720p",
      cameraPreset: "",
      cameraworkPreset: "",
      stylePreset: "",
      generationCount: "1",
      mode: "text_to_video",
    },
  },
  previs: {
    label: "3D 预演",
    size: { width: 520, height: 420 },
    params: { schemaVersion: "previs_document@1", document: "", activeShotId: "" },
  },
}

export function generationTitle(mediaType: string): string {
  return mediaType === "video" ? "Video Generator" : "Image Generator"
}

export function defaultGenerationParams(mediaType: "image" | "video", modelId = ""): Record<string, string> {
  const defaults = { ...NODE_DEFAULTS.generation.params }
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

function generationMediaType(node: Pick<WorkspaceNode, "type" | "params">): string | null {
  if (node.type !== "generation") return null
  const mediaType = String(node.params?.mediaType || "")
  return mediaType === "image" || mediaType === "video" || mediaType === "audio" ? mediaType : null
}

function normalizeHandle(handle?: string | null): string | null {
  if (handle == null) return null
  const trimmed = handle.trim()
  return trimmed.length === 0 ? null : trimmed
}

export function canConnectNodes(input: {
  source: Pick<WorkspaceNode, "id" | "type" | "params">
  target: Pick<WorkspaceNode, "id" | "type" | "params">
  sourceHandle?: string | null
  targetHandle?: string | null
}): boolean {
  const { source, target } = input
  if (!source.id || !target.id || source.id === target.id) return false
  if (source.type === "group" || target.type === "group" || source.type === "storyboard" || target.type === "storyboard") {
    return false
  }

  const sourceHandle = normalizeHandle(input.sourceHandle)
  const targetHandle = normalizeHandle(input.targetHandle)
  if (sourceHandle && sourceHandle !== "out") return false
  if (targetHandle && targetHandle !== "ref") return false

  const sourceMedia = generationMediaType(source)
  const targetMedia = generationMediaType(target)

  if (targetHandle === "ref") {
    if (target.type !== "generation") return false
    if (source.type === "image") return true
    return source.type === "generation" && sourceMedia === "image"
  }

  if (source.type === "generation" && target.type === "generation") {
    return GENERATION_CHAINS.some(chain => chain.source === sourceMedia && chain.target === targetMedia)
  }

  if (source.type === "generation" && ASSET_TYPES.has(target.type)) {
    return sourceMedia === target.type
  }

  if (source.type === "generation") return ASSET_TYPES.has(target.type)
  return target.type === "generation"
}

export function wouldCreateCycle(
  edges: Array<{ sourceNodeId: string; targetNodeId: string }>,
  source: string,
  target: string,
): boolean {
  if (!source || !target) return false
  if (source === target) return true
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const outgoing = adjacency.get(edge.sourceNodeId)
    if (outgoing) outgoing.push(edge.targetNodeId)
    else adjacency.set(edge.sourceNodeId, [edge.targetNodeId])
  }
  const visited = new Set<string>()
  const reachesSource = (node: string): boolean => {
    if (node === source) return true
    if (visited.has(node)) return false
    visited.add(node)
    return (adjacency.get(node) || []).some(reachesSource)
  }
  return reachesSource(target)
}
