import { useCallback, useMemo, useRef, useState } from "react"
import { Mic, Plus, Send } from "lucide-react"

const ACT_PRESETS = [
  { key: "scene", label: "搭场景", template: "搭建一个酋长在丛林里对峙巨大蜥蜴的场景，蜥蜴上方被球砸到" },
  { key: "camera", label: "改运镜", template: "拉远到大全景" },
  { key: "animation", label: "改动画", template: "镜头往下看的同时让蜥蜴模型缩小，球掉在地上" },
  { key: "swap", label: "换资产", template: "把蜥蜴换成山猫" },
  { key: "revert", label: "回退上一句", template: "算了还是蜥蜴" },
] as const

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const candidate = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return candidate.SpeechRecognition || candidate.webkitSpeechRecognition || null
}

export type CanvasPromptBarProps = {
  targetNodeId: string | null
  targetLabel: string | null
  pending?: boolean
  reply?: string | null
  error?: string | null
  onSubmit: (prompt: string) => void
  onUpload: () => void
}

export function CanvasPromptBar({
  targetNodeId,
  targetLabel,
  pending = false,
  reply,
  error,
  onSubmit,
  onUpload,
}: CanvasPromptBarProps) {
  const [text, setText] = useState("")
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const speechCtor = useMemo(() => speechRecognitionCtor(), [])

  const submit = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || pending) return
    onSubmit(trimmed)
    setText("")
  }, [onSubmit, pending, text])

  const toggleSpeech = useCallback(() => {
    if (!speechCtor) return
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }
    const recognition = new speechCtor()
    recognition.lang = "zh-CN"
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = event => {
      const transcript = event.results[0]?.[0]?.transcript?.trim()
      if (transcript) setText(current => (current ? `${current} ${transcript}` : transcript))
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)
    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }, [listening, speechCtor])

  return (
    <div className="pointer-events-auto w-full rounded-2xl border border-border-default bg-surface-overlay/95 p-3 shadow-xl">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold text-text-primary">画布提示词</div>
          <p className="text-[10px] text-text-weak">
            {targetNodeId ? `作用于 ${targetLabel || "当前 3D 预演"}` : "还没有预演节点时，发送后会自动创建一个"}
            {" · 回车发送 · Shift+回车换行"}
          </p>
        </div>
        <div className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-secondary">
          预演模型
        </div>
      </div>
      <p className="mb-2 text-[10px] leading-4 text-text-weak">
        3D 预演由确定性规则编译：不调用模型。接上规划器后这里会变成真正的模型选择。
      </p>
      <div className="mb-2 flex flex-wrap gap-1">
        {ACT_PRESETS.map(preset => (
          <button
            key={preset.key}
            type="button"
            className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[10px] text-text-secondary hover:text-text-primary"
            onClick={() => setText(preset.template)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="flex items-end gap-1.5">
        <button
          type="button"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/8 text-text-secondary hover:bg-white/14 hover:text-text-primary"
          title="添加素材"
          aria-label="上传图片或视频作为参考素材"
          onClick={onUpload}
        >
          <Plus className="h-4 w-4" />
        </button>
        <textarea
          value={text}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          rows={3}
          placeholder="想拍什么？一句话描述场景，例如「搭建一个酋长在丛林里对峙巨大蜥蜴的场景，蜥蜴上方被球砸到」"
          className="min-h-16 flex-1 resize-none bg-transparent text-sm text-text-primary outline-none placeholder:text-text-weak"
        />
        {speechCtor ? (
          <button
            type="button"
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${listening ? "bg-white/20 text-text-primary" : "bg-white/8 text-text-secondary hover:bg-white/14"}`}
            title="语音输入"
            aria-label="语音输入"
            aria-pressed={listening}
            onClick={toggleSpeech}
          >
            <Mic className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/12 text-text-primary hover:bg-white/18 disabled:opacity-40"
          title="发送"
          aria-label="发送"
          disabled={pending || !text.trim()}
          onClick={submit}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      {pending ? <p className="mt-1.5 text-[10px] text-text-weak">应用中…</p> : null}
      {reply ? <p className="mt-1.5 text-[10px] text-text-secondary">{reply}</p> : null}
      {error ? <p role="alert" className="mt-1.5 text-[10px] text-status-error">{error}</p> : null}
    </div>
  )
}