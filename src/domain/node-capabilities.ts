import {
  canConnectCanvasNodeInstances,
  canConnectCanvasNodes,
  canvasNodeTypes,
  CANVAS_PREVIS_DOCUMENT_SCHEMA_VERSION,
  CANVAS_STORYBOARD_SCHEMA_VERSION,
  CANVAS_STORY_SCENE_SCHEMA_VERSION,
  type CanvasConnectionAttempt,
  type CanvasNodeType,
} from "@/domain/types"

export {
  canConnectCanvasNodeInstances,
  connectionEndpointFromCanvasNode,
  canvasGenerationMediaTypeFromParams,
} from "@/domain/types"
export type { CanvasConnectionAttempt, CanvasConnectionEndpoint } from "@/domain/types"

export const canvasNodeRenderers = ["text", "image", "video", "standard", "generation", "scene", "character", "group", "storyboard", "previs"] as const
export type CanvasNodeRenderer = typeof canvasNodeRenderers[number]

export type CanvasNodeConnectionCapabilities = {
  acceptedInputNodeTypes: readonly CanvasNodeType[]
  allowedOutputNodeTypes: readonly CanvasNodeType[]
}

export type CanvasNodeCapability = {
  type: CanvasNodeType
  label: string
  renderer: CanvasNodeRenderer
  defaultSize: Readonly<{ width: number; height: number }>
  defaultParams: Readonly<Record<string, string>>
  quickAdd: boolean
  connections: CanvasNodeConnectionCapabilities
}

export type CanvasNodeCapabilityProjection = Omit<CanvasNodeCapability, "defaultParams" | "connections"> & {
  parameterKeys: readonly string[]
  acceptedInputNodeTypes: readonly CanvasNodeType[]
  allowedOutputNodeTypes: readonly CanvasNodeType[]
}

/** Shared type-level connection predicate for static catalogs. */
export function canConnectCanvasCapabilityNodes(sourceType: CanvasNodeType, targetType: CanvasNodeType): boolean {
  return canConnectCanvasNodes(sourceType, targetType)
}

/** Shared instance-level connection predicate for UI and persistence. */
export function canConnectCanvasCapabilityNodeInstances(attempt: CanvasConnectionAttempt): boolean {
  return canConnectCanvasNodeInstances(attempt)
}

function deriveConnectionCapabilities(type: CanvasNodeType): CanvasNodeConnectionCapabilities {
  return {
    acceptedInputNodeTypes: canvasNodeTypes.filter(sourceType => canConnectCanvasCapabilityNodes(sourceType, type)),
    allowedOutputNodeTypes: canvasNodeTypes.filter(targetType => canConnectCanvasCapabilityNodes(type, targetType)),
  }
}

export const CANVAS_NODE_CAPABILITY_CATALOG = {
  text: {
    type: "text",
    label: "文本",
    renderer: "text",
    defaultSize: { width: 300, height: 170 },
    defaultParams: { text: "" },
    quickAdd: true,
    connections: deriveConnectionCapabilities("text"),
  },
  image: {
    type: "image",
    label: "图片",
    renderer: "image",
    defaultSize: { width: 320, height: 230 },
    defaultParams: { url: "", caption: "" },
    quickAdd: true,
    connections: deriveConnectionCapabilities("image"),
  },
  video: {
    type: "video",
    label: "视频",
    renderer: "video",
    defaultSize: { width: 360, height: 230 },
    defaultParams: { url: "", caption: "" },
    quickAdd: true,
    connections: deriveConnectionCapabilities("video"),
  },
  audio: {
    type: "audio",
    label: "音频",
    renderer: "standard",
    defaultSize: { width: 320, height: 150 },
    defaultParams: { url: "", title: "" },
    quickAdd: false,
    connections: deriveConnectionCapabilities("audio"),
  },
  script: {
    type: "script",
    label: "脚本",
    renderer: "standard",
    defaultSize: { width: 360, height: 240 },
    defaultParams: { script: "", language: "zh-CN", documentKind: "free", outline: "" },
    quickAdd: false,
    connections: deriveConnectionCapabilities("script"),
  },
  scene: {
    type: "scene",
    label: "场景",
    renderer: "scene",
    defaultSize: { width: 340, height: 360 },
    // story_scene@1: the shot description plus the shot parameters. The reference
    // media is an assetRef, not a URL in params.
    defaultParams: {
      schemaVersion: CANVAS_STORY_SCENE_SCHEMA_VERSION,
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
    quickAdd: true,
    connections: deriveConnectionCapabilities("scene"),
  },
  character: {
    type: "character",
    label: "角色",
    renderer: "character",
    defaultSize: { width: 300, height: 340 },
    // The card header is the character's name; the sheet text and the chosen
    // reference image live in params.
    defaultParams: {
      text: "",
      mediaUrl: "",
      mediaKind: "",
      mediaMeta: "",
    },
    quickAdd: true,
    connections: deriveConnectionCapabilities("character"),
  },
  group: {
    type: "group",
    label: "分组",
    renderer: "group",
    defaultSize: { width: 560, height: 380 },
    // The frame label is the node title; params only carry the optional note.
    defaultParams: { text: "" },
    quickAdd: true,
    connections: deriveConnectionCapabilities("group"),
  },
  storyboard: {
    type: "storyboard",
    // IC4-2：分镜板只按顺序引用同画布的 scene id（`sceneNodeIds` 是 JSON 字符串），
    // 不复制 scene 的 JSON，也不参与生成数据流，所以不暴露连线端口。
    label: "分镜板",
    renderer: "storyboard",
    defaultSize: { width: 320, height: 380 },
    defaultParams: {
      schemaVersion: CANVAS_STORYBOARD_SCHEMA_VERSION,
      sceneNodeIds: "[]",
      layout: "list",
      note: "",
    },
    quickAdd: true,
    connections: deriveConnectionCapabilities("storyboard"),
  },
  generation: {
    type: "generation",
    label: "生成节点",
    renderer: "generation",
    defaultSize: { width: 380, height: 420 },
    defaultParams: {
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
    quickAdd: false,
    connections: deriveConnectionCapabilities("generation"),
  },
  previs: {
    type: "previs",
    label: "3D 预演",
    renderer: "previs",
    // The card is a viewport: it needs real estate for a 16:9 blockout plus the
    // shot strip and the scrub row underneath.
    defaultSize: { width: 520, height: 420 },
    // `document` is the previs_document@1 JSON (baseScene + edits + cursor).
    defaultParams: {
      schemaVersion: CANVAS_PREVIS_DOCUMENT_SCHEMA_VERSION,
      document: "",
      activeShotId: "",
    },
    quickAdd: true,
    connections: deriveConnectionCapabilities("previs"),
  },
} satisfies Record<CanvasNodeType, CanvasNodeCapability>

