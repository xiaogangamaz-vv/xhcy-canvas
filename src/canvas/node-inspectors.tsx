import { mediaLooksLikeAudio, mediaLooksLikeVideo } from "@/lib/media-cache"
import type { CanvasAsset } from "@/domain/types"

type DraftInspectorProps = {
  draft: Record<string, string>
  setDraft: (draft: Record<string, string>) => void
  assets: readonly CanvasAsset[]
  onUpload: () => void
}

function MediaPicker({
  assets,
  accept,
  value,
  emptyHint,
  label,
  clearLabel,
  onChange,
  onUpload,
}: {
  assets: readonly CanvasAsset[]
  accept: readonly string[]
  value: string
  emptyHint: string
  label: string
  clearLabel: string
  onChange: (asset: CanvasAsset | null) => void
  onUpload: () => void
}) {
  const choices = assets.filter(asset => asset.status === "active" && accept.includes(asset.type))
  const current = choices.find(asset => asset.url === value || asset.id === value)
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-text-primary">{label}</div>
      {current?.url ? (
        mediaLooksLikeVideo(current.url, current.mimeType, current.type) ? (
          <video src={current.url} controls preload="metadata" className="mb-2 aspect-video w-full rounded-md bg-black object-contain" />
        ) : mediaLooksLikeAudio(current.url, current.mimeType, current.type) ? (
          <audio src={current.url} controls className="mb-2 w-full" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.url} alt="" className="mb-2 aspect-video w-full rounded-md object-cover" />
        )
      ) : null}
      {choices.length === 0 ? (
        <p className="rounded-md border border-white/10 bg-white/[0.03] p-2 text-[11px] leading-5 text-text-secondary">{emptyHint}</p>
      ) : (
        <div className="grid grid-cols-3 gap-1">
          {choices.map(asset => {
            const active = current?.id === asset.id
            return (
              <button
                key={asset.id}
                type="button"
                className={`overflow-hidden rounded-md border ${active ? "border-white/50" : "border-white/10"} bg-black/30`}
                title={asset.title}
                onClick={() => onChange(asset)}
              >
                {asset.url && !mediaLooksLikeAudio(asset.url, asset.mimeType, asset.type) ? (
                  mediaLooksLikeVideo(asset.url, asset.mimeType, asset.type) ? (
                    <video src={asset.url} preload="metadata" muted className="aspect-video w-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={asset.url} alt="" className="aspect-video w-full object-cover" />
                  )
                ) : (
                  <div className="flex aspect-video items-center justify-center text-[10px] text-text-weak">音频</div>
                )}
              </button>
            )
          })}
        </div>
      )}
      <div className="mt-2 flex gap-1.5">
        <button type="button" className="rounded-md bg-white/10 px-2 py-1 text-[10px] text-text-primary hover:bg-white/16" onClick={onUpload}>
          上传素材
        </button>
        {value ? (
          <button type="button" className="rounded-md bg-surface-hover px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary" onClick={() => onChange(null)}>
            {clearLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function CanvasSceneInspector({ draft, setDraft, assets, onUpload }: DraftInspectorProps) {
  const patch = (partial: Record<string, string>) => setDraft({ ...draft, ...partial })
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[11px] font-medium text-text-primary">场景</h3>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-text-primary">场景描述</span>
        <textarea
          value={draft.text || ""}
          onChange={event => patch({ text: event.target.value })}
          rows={4}
          placeholder="调度、镜头、对白要点"
          className="canvas-input resize-none rounded-md border border-border-default bg-surface-inset px-2 py-1.5 text-[11px] text-text-primary outline-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-text-primary">对白</span>
        <textarea
          value={draft.dialogue || ""}
          onChange={event => patch({ dialogue: event.target.value })}
          rows={2}
          placeholder="角色的台词，一行一句"
          className="canvas-input resize-none rounded-md border border-border-default bg-surface-inset px-2 py-1.5 text-[11px] text-text-primary outline-none"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-text-secondary">镜头类型</span>
          <input value={draft.shotType || ""} onChange={event => patch({ shotType: event.target.value })} className="canvas-input rounded-md border border-border-default bg-surface-inset px-2 py-1 text-[11px] outline-none" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-text-secondary">运镜</span>
          <input value={draft.cameraMovement || ""} onChange={event => patch({ cameraMovement: event.target.value })} className="canvas-input rounded-md border border-border-default bg-surface-inset px-2 py-1 text-[11px] outline-none" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-text-secondary">时长（秒）</span>
          <input value={draft.durationSeconds || ""} onChange={event => patch({ durationSeconds: event.target.value })} className="canvas-input rounded-md border border-border-default bg-surface-inset px-2 py-1 text-[11px] outline-none" />
        </label>
      </div>
      <MediaPicker
        assets={assets}
        accept={["image", "video"]}
        value={draft.mediaUrl || ""}
        label="参考素材"
        clearLabel="清除参考素材"
        emptyHint="素材库里还没有图片或视频。先用生成节点产出结果，或从素材库插入媒体节点，再回来挑选本场景的参考素材。"
        onUpload={onUpload}
        onChange={asset => patch({
          mediaUrl: asset?.url || "",
          mediaKind: asset?.type || "",
          mediaMeta: asset ? JSON.stringify({ assetId: asset.id, title: asset.title }) : "",
        })}
      />
    </div>
  )
}

export function CanvasCharacterInspector({ draft, setDraft, assets, onUpload }: DraftInspectorProps) {
  const patch = (partial: Record<string, string>) => setDraft({ ...draft, ...partial })
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[11px] font-medium text-text-primary">角色</h3>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-text-primary">角色设定</span>
        <textarea
          value={draft.text || ""}
          onChange={event => patch({ text: event.target.value })}
          rows={5}
          placeholder="身份、外形、服装、语气"
          className="canvas-input resize-none rounded-md border border-border-default bg-surface-inset px-2 py-1.5 text-[11px] text-text-primary outline-none"
        />
      </label>
      <MediaPicker
        assets={assets}
        accept={["image", "video"]}
        value={draft.mediaUrl || ""}
        label="参考形象"
        clearLabel="清除参考图"
        emptyHint="素材库里还没有图片或视频。先用生成节点产出角色形象，或从素材库插入图片节点，再回来挑选本角色的参考形象。"
        onUpload={onUpload}
        onChange={asset => patch({
          mediaUrl: asset?.url || "",
          mediaKind: asset?.type || "",
          mediaMeta: asset ? JSON.stringify({ assetId: asset.id, title: asset.title }) : "",
        })}
      />
    </div>
  )
}

export function CanvasAudioInspector({ draft, setDraft, assets, onUpload }: DraftInspectorProps) {
  const patch = (partial: Record<string, string>) => setDraft({ ...draft, ...partial })
  const url = draft.url || ""
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[11px] font-medium text-text-primary">音频</h3>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-text-primary">标题</span>
        <input
          value={draft.title || ""}
          onChange={event => patch({ title: event.target.value })}
          className="canvas-input rounded-md border border-border-default bg-surface-inset px-2 py-1.5 text-[11px] outline-none"
        />
      </label>
      {url ? <audio src={url} controls className="w-full" /> : <p className="text-[10px] text-text-weak">还没有音频文件。上传后可在节点上直接播放。</p>}
      <MediaPicker
        assets={assets}
        accept={["audio"]}
        value={url}
        label="音频文件"
        clearLabel="移除音频"
        emptyHint="还没有音频素材。点击上传，或把音频文件拖到这个节点上。"
        onUpload={onUpload}
        onChange={asset => patch({ url: asset?.url || "", title: draft.title || asset?.title || "" })}
      />
    </div>
  )
}

export function CanvasMediaNodeInspector({
  kind,
  draft,
  setDraft,
  assets,
  onUpload,
}: DraftInspectorProps & { kind: "image" | "video" }) {
  const patch = (partial: Record<string, string>) => setDraft({ ...draft, ...partial })
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[11px] font-medium text-text-primary">{kind === "video" ? "视频素材" : "图片素材"}</h3>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-text-primary">说明</span>
        <input
          value={draft.caption || ""}
          onChange={event => patch({ caption: event.target.value })}
          className="canvas-input rounded-md border border-border-default bg-surface-inset px-2 py-1.5 text-[11px] outline-none"
        />
      </label>
      <MediaPicker
        assets={assets}
        accept={kind === "video" ? ["image", "video"] : ["image"]}
        value={draft.url || ""}
        label={kind === "video" ? "视频文件" : "图片文件"}
        clearLabel="移除素材"
        emptyHint={kind === "video" ? "把视频拖到节点上，或点击上传。刷新后仍会从本地缓存恢复预览。" : "把图片拖到节点上，或点击上传。刷新后仍会从本地缓存恢复预览。"}
        onUpload={onUpload}
        onChange={asset => patch({ url: asset?.url || "" })}
      />
    </div>
  )
}