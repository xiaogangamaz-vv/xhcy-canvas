import {
  Boxes,
  Clapperboard,
  FileAudio,
  FileText,
  Frame,
  ImageIcon,
  LayoutList,
  UserRound,
  Video,
  WandSparkles,
  type LucideIcon,
} from "lucide-react"
import {
  canvasNodeTypes,
  type CanvasNodeType,
} from "@/domain/types"
import {
  CANVAS_NODE_CAPABILITY_CATALOG,
  canConnectCanvasCapabilityNodeInstances,
  canConnectCanvasCapabilityNodes,
  canvasNodeRenderers,
  type CanvasNodeConnectionCapabilities,
  type CanvasNodeRenderer,
} from "@/domain/node-capabilities"
import type { CanvasConnectionAttempt } from "@/domain/types"

export { canvasNodeRenderers }
export type { CanvasNodeConnectionCapabilities, CanvasNodeRenderer }

export type CanvasNodeRegistryItem = {
  label: string
  icon: LucideIcon
  renderer: CanvasNodeRenderer
  defaultSize: { width: number; height: number }
  createDefaultParams: () => Record<string, string>
  quickAdd: boolean
  connections: CanvasNodeConnectionCapabilities
}

function uiCapability(type: CanvasNodeType): Omit<CanvasNodeRegistryItem, "icon" | "createDefaultParams"> {
  const capability = CANVAS_NODE_CAPABILITY_CATALOG[type]
  return {
    label: capability.label,
    renderer: capability.renderer,
    defaultSize: capability.defaultSize,
    quickAdd: capability.quickAdd,
    connections: capability.connections,
  }
}

export const CANVAS_NODE_REGISTRY = {
  text: {
    ...uiCapability("text"),
    icon: FileText,
    createDefaultParams: () => ({ ...CANVAS_NODE_CAPABILITY_CATALOG.text.defaultParams }),
  },
  image: {
    ...uiCapability("image"),
    icon: ImageIcon,
    createDefaultParams: () => ({ ...CANVAS_NODE_CAPABILITY_CATALOG.image.defaultParams }),
  },
  video: {
    ...uiCapability("video"),
    icon: Video,
    createDefaultParams: () => ({ ...CANVAS_NODE_CAPABILITY_CATALOG.video.defaultParams }),
  },
  audio: {
    ...uiCapability("audio"),
    icon: FileAudio,
    createDefaultParams: () => ({ ...CANVAS_NODE_CAPABILITY_CATALOG.audio.defaultParams }),
  },
  script: {
    ...uiCapability("script"),
    icon: FileText,
    createDefaultParams: () => ({ ...CANVAS_NODE_CAPABILITY_CATALOG.script.defaultParams }),
  },
  scene: {
    ...uiCapability("scene"),
    icon: Clapperboard,
    createDefaultParams: () => ({ ...CANVAS_NODE_CAPABILITY_CATALOG.scene.defaultParams }),
  },
  character: {
    ...uiCapability("character"),
    icon: UserRound,
    createDefaultParams: () => ({ ...CANVAS_NODE_CAPABILITY_CATALOG.character.defaultParams }),
  },
  group: {
    ...uiCapability("group"),
    icon: Frame,
    createDefaultParams: () => ({ ...CANVAS_NODE_CAPABILITY_CATALOG.group.defaultParams }),
  },
  storyboard: {
    ...uiCapability("storyboard"),
    icon: LayoutList,
    createDefaultParams: () => ({ ...CANVAS_NODE_CAPABILITY_CATALOG.storyboard.defaultParams }),
  },
  generation: {
    ...uiCapability("generation"),
    icon: WandSparkles,
    createDefaultParams: () => ({ ...CANVAS_NODE_CAPABILITY_CATALOG.generation.defaultParams }),
  },
  previs: {
    ...uiCapability("previs"),
    icon: Boxes,
    createDefaultParams: () => ({ ...CANVAS_NODE_CAPABILITY_CATALOG.previs.defaultParams }),
  },
} satisfies Record<CanvasNodeType, CanvasNodeRegistryItem>

export const CANVAS_QUICK_ADD_NODE_TYPES: CanvasNodeType[] = canvasNodeTypes.filter(type => CANVAS_NODE_REGISTRY[type].quickAdd)

export function createDefaultCanvasNodeParams(type: CanvasNodeType): Record<string, string> {
  return CANVAS_NODE_REGISTRY[type].createDefaultParams()
}

export function canConnectCanvasRegistryNodes(sourceType: CanvasNodeType, targetType: CanvasNodeType): boolean {
  return canConnectCanvasCapabilityNodes(sourceType, targetType)
}

export function canConnectCanvasRegistryNodeInstances(attempt: CanvasConnectionAttempt): boolean {
  return canConnectCanvasCapabilityNodeInstances(attempt)
}
