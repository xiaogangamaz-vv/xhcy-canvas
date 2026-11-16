/**
 * Public generation-model catalog shape, plus a local mock catalog.
 *
 * Field names match the public payload the original image/video catalog services
 * returned (id, name, type, creditCost, and for image models the aspect/size
 * capability lists). This module is static data only: no database, no provider
 * keys, and creditCost is informational, not a charge.
 */

export const IMAGE_MODULE_KEY = "text-to-image"
export const VIDEO_MODULE_KEY = "text-to-video"

export const DEFAULT_IMAGE_ASPECT_RATIOS = [
  "auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21", "2:1", "1:2",
] as const

export const DEFAULT_IMAGE_SIZES = ["1K", "2K", "4K"] as const
export const DEFAULT_VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const
export const DEFAULT_VIDEO_RESOLUTIONS = ["720p", "1080p"] as const
export const DEFAULT_VIDEO_DURATIONS = ["4", "6", "8", "10"] as const

export type CanvasPublicImageModel = {
  id: string
  name: string
  type: "image"
  creditCost: number
  requiresPrompt: boolean
  requiresImage: boolean
  supportsAspectRatio: boolean
  supportedAspectRatios: string[]
  supportedImageSizes: string[]
}

export type CanvasImageModelCatalog = {
  moduleKey: typeof IMAGE_MODULE_KEY
  primaryModelId: string | null
  models: CanvasPublicImageModel[]
  channelReady: boolean
  unavailableCode: "IMAGE_CHANNEL_NOT_CONFIGURED" | null
  unavailableMessage: string | null
}

export type CanvasPublicVideoModel = {
  id: string
  name: string
  type: "video"
  creditCost: number
  supportedAspectRatios?: string[]
  supportedResolutions?: string[]
  supportedDurations?: string[]
}

export type CanvasVideoModelCatalog = {
  moduleKey: typeof VIDEO_MODULE_KEY
  primaryModelId: string | null
  models: CanvasPublicVideoModel[]
  channelReady: boolean
  unavailableCode: "VIDEO_CHANNEL_NOT_CONFIGURED" | null
  unavailableMessage: string | null
}

const IMAGE_MODELS: CanvasPublicImageModel[] = [
  {
    id: "canvas-image-2k",
    name: "Canvas Image 2K",
    type: "image",
    creditCost: 5,
    requiresPrompt: true,
    requiresImage: false,
    supportsAspectRatio: true,
    supportedAspectRatios: [...DEFAULT_IMAGE_ASPECT_RATIOS],
    supportedImageSizes: ["1K", "2K"],
  },
  {
    id: "canvas-image-4k",
    name: "Canvas Image 4K",
    type: "image",
    creditCost: 8,
    requiresPrompt: true,
    requiresImage: false,
    supportsAspectRatio: true,
    supportedAspectRatios: [...DEFAULT_IMAGE_ASPECT_RATIOS],
    supportedImageSizes: ["2K", "4K"],
  },
  {
    id: "canvas-image-portrait",
    name: "Canvas Image Portrait",
    type: "image",
    creditCost: 5,
    requiresPrompt: true,
    requiresImage: false,
    supportsAspectRatio: true,
    supportedAspectRatios: ["auto", "3:4", "2:3", "4:5", "9:16"],
    supportedImageSizes: ["1K", "2K", "4K"],
  },
  {
    id: "canvas-image-reference",
    name: "Canvas Image Reference",
    type: "image",
    creditCost: 6,
    requiresPrompt: true,
    requiresImage: true,
    supportsAspectRatio: true,
    supportedAspectRatios: [...DEFAULT_IMAGE_ASPECT_RATIOS],
    supportedImageSizes: ["1K", "2K", "4K"],
  },
]

const VIDEO_MODELS: CanvasPublicVideoModel[] = [
  {
    id: "canvas-video-720",
    name: "Canvas Video 720p",
    type: "video",
    creditCost: 12,
    supportedAspectRatios: [...DEFAULT_VIDEO_ASPECT_RATIOS],
    supportedResolutions: ["720p"],
    supportedDurations: [...DEFAULT_VIDEO_DURATIONS],
  },
  {
    id: "canvas-video-1080",
    name: "Canvas Video 1080p",
    type: "video",
    creditCost: 16,
    supportedAspectRatios: [...DEFAULT_VIDEO_ASPECT_RATIOS],
    supportedResolutions: ["720p", "1080p"],
    supportedDurations: [...DEFAULT_VIDEO_DURATIONS],
  },
  {
    id: "canvas-video-cinematic",
    name: "Canvas Video Cinematic",
    type: "video",
    creditCost: 24,
    supportedAspectRatios: ["16:9", "21:9", "9:16"],
    supportedResolutions: ["1080p"],
    supportedDurations: ["6", "8", "10"],
  },
]

export function listMockImageModels(): CanvasImageModelCatalog {
  return {
    moduleKey: IMAGE_MODULE_KEY,
    primaryModelId: IMAGE_MODELS[0]?.id ?? null,
    models: IMAGE_MODELS,
    channelReady: IMAGE_MODELS.length > 0,
    unavailableCode: IMAGE_MODELS.length > 0 ? null : "IMAGE_CHANNEL_NOT_CONFIGURED",
    unavailableMessage: IMAGE_MODELS.length > 0 ? null : "图片通道未配置 / 暂不可用",
  }
}

export function listMockVideoModels(): CanvasVideoModelCatalog {
  return {
    moduleKey: VIDEO_MODULE_KEY,
    primaryModelId: VIDEO_MODELS[0]?.id ?? null,
    models: VIDEO_MODELS,
    channelReady: VIDEO_MODELS.length > 0,
    unavailableCode: VIDEO_MODELS.length > 0 ? null : "VIDEO_CHANNEL_NOT_CONFIGURED",
    unavailableMessage: VIDEO_MODELS.length > 0 ? null : "视频通道未配置 / 暂不可用",
  }
}

export function resolveImageModelOptions(
  models: readonly CanvasPublicImageModel[],
  modelId: string | undefined,
): { aspectRatios: string[]; imageSizes: string[] } {
  const model = models.find(item => item.id === modelId)
  return {
    aspectRatios: model?.supportedAspectRatios?.length ? model.supportedAspectRatios : [...DEFAULT_IMAGE_ASPECT_RATIOS],
    imageSizes: model?.supportedImageSizes?.length ? model.supportedImageSizes : [...DEFAULT_IMAGE_SIZES],
  }
}

export function resolveVideoModelOptions(
  models: readonly CanvasPublicVideoModel[],
  modelId: string | undefined,
): { aspectRatios: string[]; resolutions: string[]; durations: string[] } {
  const model = models.find(item => item.id === modelId)
  return {
    aspectRatios: model?.supportedAspectRatios?.length ? model.supportedAspectRatios : [...DEFAULT_VIDEO_ASPECT_RATIOS],
    resolutions: model?.supportedResolutions?.length ? model.supportedResolutions : [...DEFAULT_VIDEO_RESOLUTIONS],
    durations: model?.supportedDurations?.length ? model.supportedDurations : [...DEFAULT_VIDEO_DURATIONS],
  }
}

export function clampDraftToModel(
  draft: Record<string, string>,
  imageModels: readonly CanvasPublicImageModel[],
  videoModels: readonly CanvasPublicVideoModel[],
): Record<string, string> {
  const next = { ...draft }
  if ((next.mediaType || "image") === "video") {
    const options = resolveVideoModelOptions(videoModels, next.modelId)
    if (!options.aspectRatios.includes(next.aspectRatio || "")) next.aspectRatio = options.aspectRatios[0] || "16:9"
    if (!options.resolutions.includes(next.resolution || "")) next.resolution = options.resolutions[0] || "720p"
    if (!options.durations.includes(next.durationSeconds || "")) next.durationSeconds = options.durations[0] || "4"
  } else {
    const options = resolveImageModelOptions(imageModels, next.modelId)
    if (!options.aspectRatios.includes(next.aspectRatio || "")) next.aspectRatio = options.aspectRatios[0] || "auto"
    if (!options.imageSizes.includes(next.imageSize || "")) next.imageSize = options.imageSizes[0] || "2K"
  }
  return next
}
