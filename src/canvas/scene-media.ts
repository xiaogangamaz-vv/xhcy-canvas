import type { CanvasAsset } from "@/domain/types"

export type CanvasSceneMediaAsset = Pick<CanvasAsset, "type" | "width" | "height" | "duration">

/**
 * The scene card's metadata line, derived from the chosen asset.
 *
 * Only measured asset fields are rendered: a missing size or duration is
 * omitted rather than guessed, and non-media assets produce no metadata.
 */
export function canvasSceneMediaMeta(asset: CanvasSceneMediaAsset): string {
  const isPreviewMedia = asset.type === "image" || asset.type === "video"
  if (!isPreviewMedia) return ""
  const dimensions = asset.width && asset.height ? `${asset.width}×${asset.height}` : ""
  const duration = asset.type === "video" && asset.duration ? `${Math.round(asset.duration)}s` : ""
  return [dimensions, duration].filter(Boolean).join(" | ")
}
