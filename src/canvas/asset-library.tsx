import { X } from "lucide-react"
import { mediaLooksLikeAudio, mediaLooksLikeVideo } from "@/lib/media-cache"
import type { CanvasAsset } from "@/domain/types"

export type CanvasAssetLibraryProps = {
  assets: readonly CanvasAsset[]
  onClose: () => void
  onInsert: (asset: CanvasAsset) => void
}

function AssetThumb({ asset }: { asset: CanvasAsset }) {
  const url = asset.url
  if (url && mediaLooksLikeVideo(url, asset.mimeType, asset.type)) {
    return <video src={url} preload="metadata" muted className="h-16 w-24 rounded-md bg-black object-cover" />
  }
  if (url && mediaLooksLikeAudio(url, asset.mimeType, asset.type)) {
    return <div className="flex h-16 w-24 items-center justify-center rounded-md bg-black/40 text-[10px] text-text-secondary">音频</div>
  }
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" className="h-16 w-24 rounded-md object-cover" />
    )
  }
  return <div className="flex h-16 w-24 items-center justify-center rounded-md bg-black/40 text-[10px] text-text-weak">无预览</div>
}

export function CanvasAssetLibrary({ assets, onClose, onInsert }: CanvasAssetLibraryProps) {
  const visible = assets.filter(asset => asset.status === "active")
  return (
    <div className="pointer-events-auto flex h-full w-80 flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-overlay/95 shadow-2xl">
      <div className="flex h-10 items-center justify-between border-b border-border-subtle px-3">
        <span className="text-xs font-semibold text-text-primary">素材库</span>
        <button type="button" aria-label="关闭素材库" onClick={onClose} className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {visible.length === 0 ? (
          <p className="px-1 py-3 text-[11px] leading-5 text-text-weak">
            素材库里还没有图片或视频。先上传素材，或用生成节点产出结果，再回来插入到画布。
          </p>
        ) : (
          <ul className="space-y-1.5">
            {visible.map(asset => (
              <li key={asset.id} className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-surface-hover">
                <AssetThumb asset={asset} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] text-text-primary">{asset.title || asset.id.slice(0, 8)}</div>
                  <div className="text-[10px] text-text-weak">{asset.type === "video" ? "视频" : asset.type === "audio" ? "音频" : "图片"}</div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-md bg-white/10 px-2 py-1 text-[10px] text-text-primary hover:bg-white/16"
                  onClick={() => onInsert(asset)}
                >
                  插入
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}