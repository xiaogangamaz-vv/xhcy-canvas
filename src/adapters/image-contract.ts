/**
 * Official image request-parameter contract, keyed by public model id.
 *
 * This is not a model catalog. Live image ids still come from
 * GET /api/public-models and GET /api/model_provider_meta. These option
 * lists are taken from the site /api-docs contract (protocols.js and
 * modelDocumentation.js). Ids that are not documented here get no guessed
 * size or ratio list.
 */

export type ImageParamContract = {
  /** How the official route shapes the output. */
  sizeMode: "aspect_image_size" | "pixel_box" | "size_alias"
  supportedAspectRatios: string[]
  supportedImageSizes: string[]
  /** Official field to send for a selected size option. */
  sizeField: "image_size" | "size"
  acceptsAspectRatio: boolean
  /** auto is omitted from the request, per official docs. */
  omitAspectWhenAuto: boolean
  acceptsReferenceImage: boolean
  minN: number
  maxN: number
}

const ASPECT_NO_AUTO = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"] as const
const ASPECT_WITH_AUTO = ["auto", ...ASPECT_NO_AUTO] as const
const IMAGE_TIERS = ["1K", "2K", "4K"] as const
const GEMINI_BOXES = [
  "1024x1024", "848x1264", "1264x848", "896x1200", "1200x896",
  "928x1152", "1152x928", "768x1344", "1344x768", "1536x672",
] as const
const GPT_IMAGE_25_BOXES = [
  "1024x1024", "720x1280", "1280x720", "848x1264", "1264x848", "896x1200", "1200x896",
] as const
const GPT_IMAGE_26_EXAMPLES = [
  "auto", "1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "3840x2160", "2160x3840",
] as const
const SEEDREAM_ALIASES = ["1k", "1.5k", "2k"] as const

function aspectAndTier(aspects: readonly string[], acceptsReferenceImage = false): ImageParamContract {
  return {
    sizeMode: "aspect_image_size",
    supportedAspectRatios: [...aspects],
    supportedImageSizes: [...IMAGE_TIERS],
    sizeField: "image_size",
    acceptsAspectRatio: true,
    omitAspectWhenAuto: true,
    acceptsReferenceImage,
    minN: 1,
    maxN: 1,
  }
}

function pixelBoxes(boxes: readonly string[], maxN = 1): ImageParamContract {
  return {
    sizeMode: "pixel_box",
    supportedAspectRatios: [],
    supportedImageSizes: [...boxes],
    sizeField: "size",
    acceptsAspectRatio: false,
    omitAspectWhenAuto: true,
    acceptsReferenceImage: false,
    minN: 1,
    maxN,
  }
}

function sizeAliases(aliases: readonly string[], maxN: number): ImageParamContract {
  return {
    sizeMode: "size_alias",
    supportedAspectRatios: [],
    supportedImageSizes: [...aliases],
    sizeField: "size",
    acceptsAspectRatio: false,
    omitAspectWhenAuto: true,
    acceptsReferenceImage: false,
    minN: 1,
    maxN,
  }
}

/**
 * Contracts for ids documented on the official image route.
 * gpt-image-2.5-flare / sunburst have no separate recommended-box list;
 * the documented gpt-image-2.5 known boxes sit inside that official edge range.
 */
const IMAGE_PARAM_CONTRACTS: Record<string, ImageParamContract> = {
  "nano-banana-2": aspectAndTier(ASPECT_NO_AUTO),
  "nano-banana-pro": aspectAndTier(ASPECT_WITH_AUTO, true),
  "gemini-nano-banana-2.1": aspectAndTier(ASPECT_NO_AUTO),
  "gemini-2.5-flash-image": pixelBoxes(GEMINI_BOXES),
  "gpt-image-2": pixelBoxes(GEMINI_BOXES),
  "gpt-image-2-vip": pixelBoxes(GEMINI_BOXES),
  "gpt-image-2.5": pixelBoxes(GPT_IMAGE_25_BOXES),
  "gpt-image-2.5-flare": pixelBoxes(GPT_IMAGE_25_BOXES),
  "gpt-image-2.5-sunburst": pixelBoxes(GPT_IMAGE_25_BOXES),
  "gpt-image-2.6-flare": pixelBoxes(GPT_IMAGE_26_EXAMPLES),
  "gpt-image-2.6-sunburst": pixelBoxes(GPT_IMAGE_26_EXAMPLES),
  "seedream-v5-pro": sizeAliases(SEEDREAM_ALIASES, 10),
  "seedream-v5-flash": sizeAliases(SEEDREAM_ALIASES, 10),
  "seedream-v5-pro/layer-decomposition": sizeAliases(SEEDREAM_ALIASES, 1),
  "seedream-v5-flash/layer-decomposition": sizeAliases(SEEDREAM_ALIASES, 1),
}

export function getImageParamContract(modelId: string): ImageParamContract | null {
  return IMAGE_PARAM_CONTRACTS[modelId] ?? null
}
