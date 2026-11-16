import type { CanvasAsset } from "@/domain/types"

export const OUTPUT_HISTORY_LIMIT = 20
export const OUTPUT_COMPARE_LIMIT = 2

export type CanvasOutputHistoryEntry = {
  id: string
  assetId: string
  createdAt: number
  prompt: string
  modelId: string
  modelName?: string
  mediaType: "image" | "video"
  aspectRatio?: string
}

export function parseCanvasOutputHistory(raw: string | undefined): CanvasOutputHistoryEntry[] {
  if (!raw || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap(item => {
      if (!item || typeof item !== "object") return []
      const row = item as Partial<CanvasOutputHistoryEntry>
      if (!row.id || !row.assetId || !row.createdAt) return []
      return [{
        id: String(row.id),
        assetId: String(row.assetId),
        createdAt: Number(row.createdAt) || 0,
        prompt: String(row.prompt || ""),
        modelId: String(row.modelId || ""),
        modelName: row.modelName ? String(row.modelName) : undefined,
        mediaType: row.mediaType === "video" ? "video" : "image",
        aspectRatio: row.aspectRatio ? String(row.aspectRatio) : undefined,
      }]
    })
  } catch {
    return []
  }
}

export function serializeCanvasOutputHistory(entries: readonly CanvasOutputHistoryEntry[]): string {
  return JSON.stringify(entries.slice(0, OUTPUT_HISTORY_LIMIT))
}

export function prependCanvasOutputHistory(
  raw: string | undefined,
  entry: CanvasOutputHistoryEntry,
): string {
  const current = parseCanvasOutputHistory(raw).filter(item => item.id !== entry.id && item.assetId !== entry.assetId)
  return serializeCanvasOutputHistory([entry, ...current])
}

export function toggleOutputCompare(current: readonly string[], id: string): string[] {
  if (current.includes(id)) return current.filter(item => item !== id)
  if (current.length >= OUTPUT_COMPARE_LIMIT) return [...current.slice(1), id]
  return [...current, id]
}

export function resolveHistoryAsset(
  entry: CanvasOutputHistoryEntry,
  assets: readonly CanvasAsset[],
): CanvasAsset | null {
  return assets.find(asset => asset.id === entry.assetId) ?? null
}