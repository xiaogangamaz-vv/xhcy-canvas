import type { HostPort } from "@/adapters/host"
import type { CanvasAsset, CanvasNodeType } from "@/domain/types"

export type CanvasUploadRejection = { filename: string; error: string }
export type CanvasUploadResult = {
  importedCount: number
  assets: CanvasAsset[]
  rejected: CanvasUploadRejection[]
}

export const CANVAS_UPLOAD_ACCEPT = "image/*,video/*"
export const CANVAS_UPLOAD_MAX_FILES = 20

export function isCanvasUploadableFile(file: File): boolean {
  const type = String(file.type || "").toLowerCase()
  if (type.startsWith("image/") || type.startsWith("video/")) return true
  return /\.(png|jpe?g|webp|gif|avif|heic|heif|bmp|mp4|webm|mov)$/i.test(file.name || "")
}

export function nodeTypeFromAsset(asset: { type: string }): CanvasNodeType {
  if (asset.type === "image" || asset.type === "video" || asset.type === "audio") return asset.type
  return "text"
}

export function paramsFromAsset(
  type: CanvasNodeType,
  asset: { url?: string | null; storageKey?: string | null; title?: string },
): Record<string, string> {
  const url = asset.url || asset.storageKey || ""
  if (type === "image" || type === "video") return { url, caption: asset.title || "" }
  if (type === "audio") return { url, title: asset.title || "" }
  return { text: asset.title || "" }
}

export function splitCanvasUploadFiles(files: readonly File[]): { accepted: File[]; skipped: number } {
  const accepted = files.filter(isCanvasUploadableFile).slice(0, CANVAS_UPLOAD_MAX_FILES)
  return { accepted, skipped: files.length - accepted.length }
}

export async function uploadCanvasMedia(input: {
  host: HostPort
  files: readonly File[]
}): Promise<CanvasUploadResult> {
  const rejected: CanvasUploadRejection[] = []
  const assets: CanvasAsset[] = []
  if (!input.host.uploadAsset) {
    return {
      importedCount: 0,
      assets,
      rejected: input.files.map(file => ({ filename: file.name, error: "Upload is not available" })),
    }
  }
  for (const file of input.files) {
    try {
      assets.push(await input.host.uploadAsset(file))
    } catch (error) {
      rejected.push({
        filename: file.name,
        error: error instanceof Error ? error.message : "Upload failed",
      })
    }
  }
  return { importedCount: assets.length, assets, rejected }
}