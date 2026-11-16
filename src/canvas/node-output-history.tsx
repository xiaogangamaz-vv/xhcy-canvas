import { useState } from "react"
import { mediaLooksLikeVideo } from "@/lib/media-cache"
import type { CanvasAsset } from "@/domain/types"
import {
  resolveHistoryAsset,
  toggleOutputCompare,
  type CanvasOutputHistoryEntry,
} from "@/canvas/output-history"

export type CanvasNodeOutputHistoryProps = {
  entries: readonly CanvasOutputHistoryEntry[]
  assets: readonly CanvasAsset[]
  onCreateNode: (entry: CanvasOutputHistoryEntry, asset: CanvasAsset) => void
}

function formatTime(value: number): string {
  try {
    return new Date(value).toLocaleString("zh-CN", { hour12: false })
  } catch {
    return String(value)
  }
}

function HistoryMedia({ asset }: { asset: CanvasAsset }) {
  const url = asset.url
  if (!url) {
    return <div className="flex aspect-video items-center justify-center rounded-md bg-black/40 text-[10px] text-text-weak">预览不可用</div>
  }
  if (mediaLooksLikeVideo(url, asset.mimeType, asset.type)) {
    return <video src={url} controls preload="metadata" className="aspect-video w-full rounded-md bg-black object-contain" />
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="aspect-video w-full rounded-md object-cover" />
  )
}

export function CanvasNodeOutputHistory({ entries, assets, onCreateNode }: CanvasNodeOutputHistoryProps) {
  const [compareIds, setCompareIds] = useState<string[]>([])
  const compareRows = compareIds
    .map(id => entries.find(entry => entry.id === id))
    .filter((entry): entry is CanvasOutputHistoryEntry => Boolean(entry))

  if (entries.length === 0) {
    return (
      <div>
        <h3 className="text-[11px] font-medium text-text-primary">生成历史</h3>
        <p className="mt-1 text-[10px] leading-4 text-text-weak">还没有成功的生成结果。运行图像或视频生成后，每一版都会留在这里，可对比或作为新节点放回画布。</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium text-text-primary">生成历史</h3>
        <span className="text-[10px] tabular-nums text-text-weak">{entries.length} 条</span>
      </div>
      <ul className="space-y-1.5">
        {entries.map(entry => {
          const asset = resolveHistoryAsset(entry, assets)
          const selected = compareIds.includes(entry.id)
          return (
            <li key={entry.id} className="rounded-md border border-white/8 bg-white/[0.03] p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] tabular-nums text-text-weak">{formatTime(entry.createdAt)}</div>
                  <div className="mt-0.5 truncate text-[11px] text-text-primary">{entry.mediaType === "video" ? "视频" : "图片"} · {entry.modelName || entry.modelId || "模型"}</div>
                  <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-text-secondary">{entry.prompt || "（无提示词）"}</p>
                </div>
                <button
                  type="button"
                  className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] ${selected ? "bg-white/16 text-text-primary" : "bg-surface-hover text-text-secondary"}`}
                  onClick={() => setCompareIds(current => toggleOutputCompare(current, entry.id))}
                >
                  {selected ? "取消对比" : "对比"}
                </button>
              </div>
              {asset ? (
                <div className="mt-2 flex items-center justify-end">
                  <button
                    type="button"
                    className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] text-text-primary hover:bg-white/16"
                    onClick={() => onCreateNode(entry, asset)}
                  >
                    作为新节点
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-[10px] text-text-weak">对应素材已不在本地缓存中</p>
              )}
            </li>
          )
        })}
      </ul>
      {compareRows.length > 0 ? (
        <div>
          <h4 className="mb-1 text-[10px] font-semibold text-text-primary">输出版本比较</h4>
          <div className={`grid gap-2 ${compareRows.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
            {compareRows.map(entry => {
              const asset = resolveHistoryAsset(entry, assets)
              return (
                <div key={entry.id} className="min-w-0">
                  {asset ? <HistoryMedia asset={asset} /> : <div className="flex aspect-video items-center justify-center rounded-md bg-black/40 text-[10px] text-text-weak">缺失</div>}
                  <p className="mt-1 line-clamp-3 text-[10px] leading-4 text-text-secondary">{entry.prompt}</p>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
