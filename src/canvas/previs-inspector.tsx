import { useMemo, useState } from "react"
import { Redo2, Send, Undo2 } from "lucide-react"
import type { CanvasNode } from "@/domain/types"
import {
  applyPrevisDocumentEdit,
  canRedoPrevisDocument,
  canRevertPrevisDocument,
  createEmptyPrevisScene,
  createPrevisDocument,
  interpretPrevisCommand,
  previsDocumentScene,
  previsDocumentUndoLabel,
  redoPrevisDocument,
  revertPrevisDocument,
  safeParsePrevisDocument,
  type PrevisDocument,
} from "@/previs"

const PROMPT_EXAMPLES = [
  "搭建一个酋长在丛林里对峙巨大蜥蜴的场景，蜥蜴上方被球砸到",
  "镜头往下看的同时让蜥蜴模型缩小，球掉在地上",
  "拉远到大全景",
  "把蜥蜴换成山猫",
  "算了还是蜥蜴",
]

export type CanvasPrevisInspectorProps = {
  node: CanvasNode
  draft: Record<string, string>
  setDraft: (draft: Record<string, string>) => void
}

function documentFromDraft(draft: Record<string, string>): PrevisDocument | null {
  if (!draft.document || !draft.document.trim()) return null
  try {
    return safeParsePrevisDocument(JSON.parse(draft.document))
  } catch {
    return null
  }
}

function writeDocument(document: PrevisDocument, draft: Record<string, string>, activeShotId?: string): Record<string, string> {
  const scene = previsDocumentScene(document)
  const shotId = activeShotId || scene.shots[0]?.id || ""
  return {
    ...draft,
    document: JSON.stringify(document),
    activeShotId: shotId,
  }
}

export function CanvasPrevisInspector({ node, draft, setDraft }: CanvasPrevisInspectorProps) {
  void node
  const document = useMemo(() => documentFromDraft(draft), [draft])
  const scene = useMemo(() => (document ? previsDocumentScene(document) : null), [document])
  const [prompt, setPrompt] = useState("")
  const [reply, setReply] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const applyCommand = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) {
      setError("请输入要拍摄的场景或修改")
      return
    }
    const current = document ?? createPrevisDocument(createEmptyPrevisScene())
    const currentScene = previsDocumentScene(current)
    const command = interpretPrevisCommand({ text: trimmed, scene: currentScene })
    if (command.revertSteps > 0) {
      let nextDoc = revertPrevisDocument(current, command.revertSteps)
      if (command.ops.length > 0) {
        const applied = applyPrevisDocumentEdit({ document: nextDoc, ops: command.ops, label: command.reply })
        if (applied.issues.length > 0) {
          setError(applied.issues.join("；"))
          setReply(null)
          return
        }
        nextDoc = applied.document
      }
      setDraft(writeDocument(nextDoc, draft))
      setReply(command.reply)
      setError(null)
      setPrompt("")
      return
    }
    if (!command.matched) {
      setError(command.reply)
      setReply(null)
      return
    }
    const applied = applyPrevisDocumentEdit({ document: current, ops: command.ops, label: command.reply })
    if (applied.issues.length > 0) {
      setError(applied.issues.join("；"))
      setReply(null)
      return
    }
    setDraft(writeDocument(applied.document, draft))
    setReply(command.reply)
    setError(null)
    setPrompt("")
  }

  const undo = () => {
    if (!document || !canRevertPrevisDocument(document)) return
    setDraft(writeDocument(revertPrevisDocument(document), draft))
    setReply(`已撤销：${previsDocumentUndoLabel(document) || "上一版编辑"}`)
    setError(null)
  }

  const redo = () => {
    if (!document || !canRedoPrevisDocument(document)) return
    setDraft(writeDocument(redoPrevisDocument(document), draft))
    setReply("已重做")
    setError(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-[11px] font-medium text-text-primary">3D 预演</h3>
        <p className="mt-1 text-[10px] leading-4 text-text-weak">
          用本地规则解析指令并写入节点文档，不请求远程模型。可以先「搭建一个…的场景」，再调整镜头或角色。
        </p>
      </div>

      {scene ? (
        <p className="text-[10px] text-text-secondary">
          {scene.entities.length} 实体 · {scene.cameras.length} 机位 · {scene.shots.length} 镜头
          {document ? ` · ${document.cursor}/${document.edits.length} 步` : ""}
        </p>
      ) : (
        <p className="text-[10px] text-text-weak">还没有场景。试着输入下面的示例指令。</p>
      )}

      <div className="flex flex-wrap gap-1">
        {PROMPT_EXAMPLES.map(example => (
          <button
            key={example}
            type="button"
            className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[10px] text-text-secondary hover:text-text-primary"
            onClick={() => setPrompt(example)}
          >
            {example}
          </button>
        ))}
      </div>

      <div className="flex items-end gap-1.5">
        <textarea
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          onKeyDown={event => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault()
              applyCommand(prompt)
            }
          }}
          rows={3}
          placeholder="搭建一个…的场景"
          className="canvas-input min-h-[72px] flex-1 resize-none rounded-md border border-border-default bg-surface-inset px-2 py-1.5 text-[11px] text-text-primary outline-none"
        />
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/10 text-text-primary hover:bg-white/16"
          title="应用指令"
          onClick={() => applyCommand(prompt)}
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={!document || !canRevertPrevisDocument(document)}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-surface-hover px-2 text-[10px] text-text-secondary hover:text-text-primary disabled:opacity-40"
          onClick={undo}
        >
          <Undo2 className="h-3 w-3" />
          撤销
        </button>
        <button
          type="button"
          disabled={!document || !canRedoPrevisDocument(document)}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-surface-hover px-2 text-[10px] text-text-secondary hover:text-text-primary disabled:opacity-40"
          onClick={redo}
        >
          <Redo2 className="h-3 w-3" />
          重做
        </button>
      </div>

      {reply ? <p className="text-[10px] text-text-secondary">{reply}</p> : null}
      {error ? <p role="alert" className="text-[10px] text-status-error">{error}</p> : null}

      {scene && scene.shots.length > 0 ? (
        <ul className="space-y-1">
          {scene.shots.map(shot => (
            <li key={shot.id} className="rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5 text-[10px] text-text-secondary">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{shot.name}{shot.shotSize ? ` · ${shot.shotSize}` : ""}</span>
                <span className="shrink-0 tabular-nums text-text-weak">{shot.durationSeconds}s</span>
              </div>
              <p className="mt-1 text-[10px] text-text-weak">出片（连接生成节点）需要生成服务，本地预演只保留到这一步。</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
