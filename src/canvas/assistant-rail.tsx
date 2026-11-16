import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type RefObject } from "react"
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  FileText,
  Flame,
  GitBranch,
  Hand,
  KeyRound,
  Maximize2,
  Minimize2,
  Minus,
  PenLine,
  Plus,
  ScanSearch,
  Share2,
  Square,
  Upload,
  Users,
  WandSparkles,
  type LucideIcon,
} from "lucide-react"
import type { CanvasDocument, CanvasNode } from "@/adapters/host"
import { ExternalAgentPanel } from "@/canvas/external-agent-panel"
import {
  buildCanvasOverview,
  collectPromptCandidates,
  describeCanvasNode,
} from "@/canvas/assistant-overview"
import { cn } from "@/lib/utils"

const RAIL_MARGIN_Y = 12
const RAIL_MARGIN_RIGHT = 12
const RAIL_GAP = 8
const RAIL_RADIUS = 28
const RAIL_WIDTH = 378
const RAIL_WIDE_WIDTH = 520
const RAIL_COLLAPSED_WIDTH = 52
const TEXT_EXCERPT_LIMIT = 20000
const TEXT_FILE_MAX_BYTES = 512 * 1024
const HISTORY_LIMIT = 30
const OPEN_KEY = "canvas-assistant-rail-open"
const WIDE_KEY = "canvas-assistant-rail-wide"
const HISTORY_KEY = "canvas-assistant-rail-history-v1"
const EMPTY_TITLE = "让创作助手辅助你的无限创意"
const MODEL_PENDING_REPLY = "已记下以上内容，并保留在当前对话里。现在还没有接入网站模型，因此不会生成完整创作结果。网站模型接入后，会从这里继续。"
const OVERVIEW_PENDING_REPLY = "已读取当前画布概览，并写入对话。现在还没有接入网站模型，因此不会据此展开长文创作。网站模型接入后，会基于这份概览继续。"
const STORY_UPLOAD_ACCEPT = ".txt,.md,.markdown,.text,.rtf,.csv,.json,.pdf,.doc,.docx,text/plain,text/markdown,application/pdf"
const GENERIC_UPLOAD_ACCEPT = `${STORY_UPLOAD_ACCEPT},image/*,audio/*,video/*,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mp3,.wav`

export type AssistantMode = "free" | "script-original" | "script-adapt" | "direct" | "prompt-optimize"

export type AssistantMention = {
  id: string
  title: string
  typeLabel: string
}

export type AssistantAttachment = {
  id: string
  name: string
  size: number
  type: string
  textExcerpt?: string
  truncated?: boolean
}

export type AssistantMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  createdAt: number
  mentions?: AssistantMention[]
  attachments?: AssistantAttachment[]
}

export type AssistantConversation = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  mode: AssistantMode
  messages: AssistantMessage[]
}

export type AssistantPickedNode = {
  id: string
  token: number
}

const MODE_LABELS: Record<AssistantMode, string> = {
  free: "自由对话",
  "script-original": "剧本原创",
  "script-adapt": "剧本改编",
  direct: "导演执导",
  "prompt-optimize": "批量优化提示词",
}

const PRESET_OPTIONS = [
  "都市情感短剧",
  "悬疑反转故事",
  "奇幻冒险旅程",
  "家庭温情故事",
  "职场成长故事",
] as const

const SHORTCUTS: Array<{
  key: "sense" | "preset" | "adapt" | "prompts"
  title: string
  icon: LucideIcon
}> = [
  { key: "sense", title: "感知画布开始创作", icon: ScanSearch },
  { key: "preset", title: "从爆款预设开始剧本原创", icon: Flame },
  { key: "adapt", title: "上传故事来改编", icon: Upload },
  { key: "prompts", title: "批量优化提示词", icon: WandSparkles },
]

const MODE_CHIPS: Array<{ mode: AssistantMode; label: string; icon: LucideIcon }> = [
  { mode: "script-original", label: "剧本原创", icon: PenLine },
  { mode: "script-adapt", label: "剧本改编", icon: FileText },
  { mode: "direct", label: "导演执导", icon: Clapperboard },
]

type PersistShape = {
  conversations: AssistantConversation[]
  activeId: string
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createConversation(mode: AssistantMode = "free"): AssistantConversation {
  const now = Date.now()
  return {
    id: newId(),
    title: "新对话",
    createdAt: now,
    updatedAt: now,
    mode,
    messages: [],
  }
}

function titleFromText(text: string, fallback = "新对话"): string {
  const compact = text.replace(/\s+/g, " ").trim()
  if (!compact) return fallback
  return compact.length > 18 ? `${compact.slice(0, 18)}…` : compact
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`
  return `${Math.round(size / 1024 / 102.4) / 10} MB`
}

function isTextLikeFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true
  return /\.(txt|md|markdown|text|rtf|csv|json)$/i.test(file.name)
}

async function attachmentFromFile(file: File): Promise<AssistantAttachment> {
  const base: AssistantAttachment = {
    id: newId(),
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
  }
  if (!isTextLikeFile(file)) return base
  if (file.size > TEXT_FILE_MAX_BYTES) {
    return { ...base, truncated: true }
  }
  try {
    const text = await file.text()
    const compact = text.trim()
    if (!compact) return base
    if (compact.length > TEXT_EXCERPT_LIMIT) {
      return { ...base, textExcerpt: compact.slice(0, TEXT_EXCERPT_LIMIT), truncated: true }
    }
    return { ...base, textExcerpt: compact }
  } catch {
    return base
  }
}

function mentionFromNode(node: CanvasNode): AssistantMention {
  const item = describeCanvasNode(node)
  return { id: item.id, title: item.title, typeLabel: item.typeLabel }
}

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return raw === "1"
  } catch {
    return fallback
  }
}

function writeBoolean(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0")
  } catch {
    // ignore quota / private mode
  }
}

function readHistory(): PersistShape | null {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistShape
    if (!Array.isArray(parsed.conversations) || parsed.conversations.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

function writeHistory(value: PersistShape) {
  try {
    const trimmed: PersistShape = {
      activeId: value.activeId,
      conversations: value.conversations.slice(0, HISTORY_LIMIT).map(conversation => ({
        ...conversation,
        messages: conversation.messages.map(message => ({
          ...message,
          attachments: message.attachments?.map(item => ({
            id: item.id,
            name: item.name,
            size: item.size,
            type: item.type,
            textExcerpt: item.textExcerpt,
            truncated: item.truncated,
          })),
        })),
      })),
    }
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed))
  } catch {
    // ignore quota / private mode
  }
}

function railCardStyle(): { background: string; borderColor: string } {
  return {
    background: "linear-gradient(180deg, #1a1917 0%, #141312 100%)",
    borderColor: "rgba(255,255,255,0.08)",
  }
}

export function AssistantRail({
  open,
  onOpenChange,
  document,
  selectedNodeId,
  pickedNode,
  pickNodeActive,
  onPickNodeActiveChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: CanvasDocument | null
  selectedNodeId: string | null
  pickedNode: AssistantPickedNode | null
  pickNodeActive: boolean
  onPickNodeActiveChange: (active: boolean) => void
}) {
  const [wide, setWide] = useState(() => readBoolean(WIDE_KEY, false))
  const [view, setView] = useState<"chat" | "mcp">("chat")
  const [historyOpen, setHistoryOpen] = useState(false)
  const [resourceOpen, setResourceOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([])
  const [mentions, setMentions] = useState<AssistantMention[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [showPresets, setShowPresets] = useState(false)
  const initial = useMemo(() => {
    const stored = readHistory()
    if (stored) return stored
    const conversation = createConversation()
    return { conversations: [conversation], activeId: conversation.id }
  }, [])
  const [conversations, setConversations] = useState<AssistantConversation[]>(initial.conversations)
  const [activeId, setActiveId] = useState(initial.activeId)

  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const storyInputRef = useRef<HTMLInputElement | null>(null)
  const plusInputRef = useRef<HTMLInputElement | null>(null)
  const docInputRef = useRef<HTMLInputElement | null>(null)
  const historyRef = useRef<HTMLDivElement | null>(null)
  const lastPickedTokenRef = useRef<number | null>(null)

  const active = conversations.find(item => item.id === activeId) ?? conversations[0]
  const mode = active?.mode ?? "free"
  const isEmpty = (active?.messages.length ?? 0) === 0 && view === "chat"

  useEffect(() => {
    writeBoolean(OPEN_KEY, open)
  }, [open])

  useEffect(() => {
    writeBoolean(WIDE_KEY, wide)
  }, [wide])

  useEffect(() => {
    writeHistory({ conversations, activeId })
  }, [conversations, activeId])

  useEffect(() => {
    if (!historyOpen) return
    const onPointer = (event: PointerEvent) => {
      if (!historyRef.current?.contains(event.target as Node)) setHistoryOpen(false)
    }
    window.addEventListener("pointerdown", onPointer)
    return () => window.removeEventListener("pointerdown", onPointer)
  }, [historyOpen])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3600)
    return () => window.clearTimeout(timer)
  }, [notice])

  const mentionCandidates = useMemo(() => {
    if (!document || mentionQuery === null) return []
    const query = mentionQuery.trim().toLowerCase()
    return document.nodes
      .map(mentionFromNode)
      .filter(item => {
        if (!query) return true
        return item.title.toLowerCase().includes(query)
          || item.typeLabel.toLowerCase().includes(query)
          || item.id.toLowerCase().includes(query)
      })
      .slice(0, 12)
  }, [document, mentionQuery])

  const resourceItems = useMemo(() => {
    if (!document) return []
    return document.nodes.map(mentionFromNode)
  }, [document])

  const promptCandidates = useMemo(() => collectPromptCandidates(document), [document])

  const updateActive = useCallback((updater: (current: AssistantConversation) => AssistantConversation) => {
    setConversations(current => current.map(item => item.id === activeId ? updater(item) : item))
  }, [activeId])

  const appendMessages = useCallback((messages: AssistantMessage[], nextMode?: AssistantMode, title?: string) => {
    const now = Date.now()
    updateActive(current => {
      const nextMessages = [...current.messages, ...messages]
      const shouldTitle = current.title === "新对话" && title
      return {
        ...current,
        mode: nextMode ?? current.mode,
        title: shouldTitle ? title : current.title,
        updatedAt: now,
        messages: nextMessages,
      }
    })
  }, [updateActive])

  const resetComposer = useCallback(() => {
    setDraft("")
    setAttachments([])
    setMentions([])
    setMentionQuery(null)
    setResourceOpen(false)
  }, [])

  const startNewConversation = useCallback((nextMode: AssistantMode = "free") => {
    const conversation = createConversation(nextMode)
    setConversations(current => [conversation, ...current].slice(0, HISTORY_LIMIT))
    setActiveId(conversation.id)
    setView("chat")
    setHistoryOpen(false)
    setShowPresets(nextMode === "script-original")
    setNotice(null)
    resetComposer()
    onPickNodeActiveChange(false)
  }, [onPickNodeActiveChange, resetComposer])

  const switchConversation = useCallback((id: string) => {
    setActiveId(id)
    setView("chat")
    setHistoryOpen(false)
    setShowPresets(false)
    resetComposer()
  }, [resetComposer])

  const addMentions = useCallback((items: AssistantMention[]) => {
    if (!items.length) return
    setMentions(current => {
      const seen = new Set(current.map(item => item.id))
      const added = items.filter(item => !seen.has(item.id))
      return added.length ? [...current, ...added] : current
    })
    setDraft(current => {
      let next = current
      for (const item of items) {
        const token = `@${item.title}`
        if (!next.includes(token)) {
          next = next ? `${next.trimEnd()} ${token} ` : `${token} `
        }
      }
      return next
    })
    setMentionQuery(null)
    setResourceOpen(false)
    composerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!pickedNode || !pickNodeActive) return
    if (lastPickedTokenRef.current === pickedNode.token) return
    lastPickedTokenRef.current = pickedNode.token
    const node = document?.nodes.find(item => item.id === pickedNode.id)
    if (!node) return
    addMentions([mentionFromNode(node)])
  }, [addMentions, document, pickNodeActive, pickedNode])

  const insertMention = useCallback((item: AssistantMention) => {
    const textarea = composerRef.current
    const value = draft
    const cursor = textarea?.selectionStart ?? value.length
    const before = value.slice(0, cursor)
    const after = value.slice(cursor)
    const at = before.lastIndexOf("@")
    const prefix = at >= 0 ? before.slice(0, at) : before
    const next = `${prefix}@${item.title} ${after}`
    setDraft(next)
    setMentions(current => current.some(existing => existing.id === item.id) ? current : [...current, item])
    setMentionQuery(null)
    window.requestAnimationFrame(() => {
      const position = (prefix + `@${item.title} `).length
      composerRef.current?.focus()
      composerRef.current?.setSelectionRange(position, position)
    })
  }, [draft])

  const onDraftChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value
    setDraft(value)
    const cursor = event.target.selectionStart ?? value.length
    const before = value.slice(0, cursor)
    const match = before.match(/(^|[\s，。；！？、])@([^\s@]*)$/)
    if (match) {
      setMentionQuery(match[2] ?? "")
      setMentionIndex(0)
    } else {
      setMentionQuery(null)
    }
    setMentions(current => current.filter(item => value.includes(`@${item.title}`)))
  }, [])

  const receiveFiles = useCallback(async (files: FileList | File[], autoNote?: string) => {
    const list = Array.from(files)
    if (!list.length) return [] as AssistantAttachment[]
    const next = await Promise.all(list.map(attachmentFromFile))
    setAttachments(current => [...current, ...next])
    if (autoNote) setNotice(autoNote)
    composerRef.current?.focus()
    return next
  }, [])

  const sendPayload = useCallback((input: {
    text: string
    mentions?: AssistantMention[]
    attachments?: AssistantAttachment[]
    mode?: AssistantMode
    assistantText?: string
    title?: string
  }) => {
    const text = input.text.trim()
    const files = input.attachments ?? []
    if (!text && files.length === 0) return
    const userMessage: AssistantMessage = {
      id: newId(),
      role: "user",
      text: text || (files.length ? `附上了 ${files.map(item => item.name).join("、")}` : ""),
      createdAt: Date.now(),
      mentions: input.mentions?.length ? input.mentions : undefined,
      attachments: files.length ? files : undefined,
    }
    const assistantMessage: AssistantMessage = {
      id: newId(),
      role: "assistant",
      text: input.assistantText ?? MODEL_PENDING_REPLY,
      createdAt: Date.now() + 1,
    }
    appendMessages([userMessage, assistantMessage], input.mode, input.title ?? titleFromText(userMessage.text))
    resetComposer()
    setShowPresets(false)
    setView("chat")
  }, [appendMessages, resetComposer])

  const sendDraft = useCallback(() => {
    const extra: string[] = []
    if (mode !== "free") extra.push(`当前模式：${MODE_LABELS[mode]}。`)
    if (mentions.length) extra.push(`引用：${mentions.map(item => `${item.typeLabel}「${item.title}」`).join("，")}。`)
    const body = [draft.trim(), extra.join("")].filter(Boolean).join("\n")
    sendPayload({ text: body, mentions, attachments, mode })
  }, [attachments, draft, mentions, mode, sendPayload])

  const runSenseCanvas = useCallback(() => {
    const overview = buildCanvasOverview(document, selectedNodeId)
    sendPayload({
      text: `感知画布开始创作\n\n${overview.text}`,
      mode: mode === "free" ? "free" : mode,
      assistantText: OVERVIEW_PENDING_REPLY,
      title: "感知画布开始创作",
    })
  }, [document, mode, selectedNodeId, sendPayload])

  const enterMode = useCallback((nextMode: AssistantMode, options?: { presets?: boolean; notice?: string }) => {
    setView("chat")
    updateActive(current => ({ ...current, mode: nextMode, updatedAt: Date.now() }))
    setShowPresets(Boolean(options?.presets))
    if (options?.notice) setNotice(options.notice)
    composerRef.current?.focus()
  }, [updateActive])

  const applyPreset = useCallback((preset: string) => {
    enterMode("script-original")
    setShowPresets(false)
    setDraft(current => {
      const line = `请以「${preset}」为方向开始剧本原创。`
      return current.includes(line) ? current : (current ? `${current.trim()}\n${line}` : line)
    })
    setNotice(`已选择预设「${preset}」。请补充角色、风格或其他要求后发送。`)
    composerRef.current?.focus()
  }, [enterMode])

  const runPromptOptimize = useCallback(() => {
    enterMode("prompt-optimize", {
      notice: promptCandidates.length
        ? "已进入批量优化提示词。可勾选画布上的现有提示词，或直接粘贴后发送。"
        : "已进入批量优化提示词。请粘贴要优化的提示词后发送。当前画布里还没有可直接引用的提示词。",
    })
    if (promptCandidates.length && !draft.trim()) {
      const lines = promptCandidates.map((item, index) => `${index + 1}. ${item.typeLabel}「${item.title}」：${item.snippet}`)
      setDraft(`请批量优化以下提示词：\n${lines.join("\n")}`)
    }
  }, [draft, enterMode, promptCandidates])

  const onComposerKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionCandidates.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setMentionIndex(index => (index + 1) % mentionCandidates.length)
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setMentionIndex(index => (index - 1 + mentionCandidates.length) % mentionCandidates.length)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        insertMention(mentionCandidates[mentionIndex] ?? mentionCandidates[0])
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setMentionQuery(null)
        return
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      sendDraft()
    }
  }, [insertMention, mentionCandidates, mentionIndex, mentionQuery, sendDraft])

  const canSend = Boolean(draft.trim() || attachments.length)
  const width = open ? (wide ? RAIL_WIDE_WIDTH : RAIL_WIDTH) : RAIL_COLLAPSED_WIDTH
  const card = railCardStyle()

  const showUnavailable = (label: string) => {
    setNotice(`${label}尚未接入，不会执行任何操作。`)
  }

  return (
    <aside
      className="flex h-full shrink-0 flex-col"
      style={{
        width: width + RAIL_GAP + RAIL_MARGIN_RIGHT,
        padding: `${RAIL_MARGIN_Y}px ${RAIL_MARGIN_RIGHT}px ${RAIL_MARGIN_Y}px ${RAIL_GAP}px`,
      }}
    >
      <section
        className="flex h-full min-h-0 flex-col overflow-hidden border shadow-[0_16px_48px_rgba(0,0,0,0.38)]"
        style={{ ...card, borderRadius: RAIL_RADIUS }}
        aria-label="创作助手对话栏"
      >
        {open ? (
          <>
            <header className="flex shrink-0 items-center justify-between gap-2 px-3 pb-1 pt-3">
              <div className="relative" ref={historyRef}>
                <div className="flex items-center rounded-lg text-[13px] text-text-primary">
                  <button
                    type="button"
                    className="rounded-l-lg px-1.5 py-1 hover:bg-white/8"
                    onClick={() => startNewConversation(mode === "free" ? "free" : mode)}
                  >
                    新对话
                  </button>
                  <button
                    type="button"
                    className="rounded-r-lg px-1 py-1 text-text-secondary hover:bg-white/8 hover:text-text-primary"
                    aria-label="打开对话列表"
                    aria-expanded={historyOpen}
                    onClick={() => setHistoryOpen(value => !value)}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                {historyOpen ? (
                  <div className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-white/10 bg-[#1c1b19] py-1 shadow-2xl">
                    <button
                      type="button"
                      className="flex w-full px-3 py-2 text-left text-[12px] text-text-primary hover:bg-white/8"
                      onClick={() => startNewConversation()}
                    >
                      开始新对话
                    </button>
                    <div className="my-1 h-px bg-white/8" />
                    {conversations.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        className={cn(
                          "flex w-full flex-col px-3 py-2 text-left hover:bg-white/8",
                          item.id === activeId ? "bg-white/6 text-text-primary" : "text-text-secondary",
                        )}
                        onClick={() => switchConversation(item.id)}
                      >
                        <span className="truncate text-[12px]">{item.title}</span>
                        <span className="text-[10px] text-text-weak">{MODE_LABELS[item.mode]}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-0.5 text-text-secondary">
                <RailIconButton label="协作" onClick={() => showUnavailable("协作分享")} icon={Users} />
                <RailIconButton label="分享" onClick={() => showUnavailable("分享")} icon={Share2} />
                <RailIconButton label="分支" onClick={() => showUnavailable("对话分支")} icon={GitBranch} />
                <RailIconButton
                  label="外部 Agent / MCP"
                  active={view === "mcp"}
                  onClick={() => setView(current => current === "mcp" ? "chat" : "mcp")}
                  icon={KeyRound}
                />
                <RailIconButton
                  label={wide ? "收窄对话栏" : "展开对话栏"}
                  active={wide}
                  onClick={() => setWide(value => !value)}
                  icon={wide ? Minimize2 : Maximize2}
                />
                <RailIconButton label="收起对话栏" onClick={() => onOpenChange(false)} icon={Minus} />
              </div>
            </header>

            {view === "mcp" ? (
              <div className="min-h-0 flex-1">
                <ExternalAgentPanel open variant="embedded" />
              </div>
            ) : (
              <>
                <div className="relative min-h-0 flex-1 overflow-y-auto px-4">
                  {isEmpty ? (
                    <EmptyState
                      mode={mode}
                      showPresets={showPresets}
                      promptCandidates={promptCandidates}
                      onShortcut={key => {
                        if (key === "sense") runSenseCanvas()
                        if (key === "preset") enterMode("script-original", { presets: true, notice: "已进入剧本原创。请选择一个预设，或直接输入你的故事想法。" })
                        if (key === "adapt") {
                          enterMode("script-adapt", { notice: "已进入剧本改编。请上传故事文件，并可补充改编要求。" })
                          window.setTimeout(() => storyInputRef.current?.click(), 0)
                        }
                        if (key === "prompts") runPromptOptimize()
                      }}
                      onChip={nextMode => {
                        enterMode(nextMode, {
                          presets: nextMode === "script-original",
                          notice: `已进入${MODE_LABELS[nextMode]}。请在下方输入内容后发送，输入会保留在对话里。`,
                        })
                        if (nextMode === "script-adapt") {
                          window.setTimeout(() => storyInputRef.current?.click(), 0)
                        }
                      }}
                      onPreset={applyPreset}
                    />
                  ) : (
                    <MessageList messages={active?.messages ?? []} />
                  )}
                </div>

                {notice ? (
                  <p className="mx-4 mb-2 rounded-xl bg-white/6 px-3 py-2 text-[11px] leading-5 text-text-secondary">{notice}</p>
                ) : null}

                {mode !== "free" ? (
                  <div className="mx-4 mb-2 flex items-center justify-between gap-2 rounded-full bg-white/6 px-3 py-1 text-[11px] text-text-secondary">
                    <span>当前模式：{MODE_LABELS[mode]}</span>
                    <button type="button" className="text-text-weak hover:text-text-primary" onClick={() => enterMode("free")}>
                      退出
                    </button>
                  </div>
                ) : null}

                {pickNodeActive ? (
                  <p className="mx-4 mb-2 text-[11px] text-cyan-200/80">在画布上点选一个节点，即可引用到对话里。</p>
                ) : null}

                <Composer
                  draft={draft}
                  canSend={canSend}
                  attachments={attachments}
                  mentions={mentions}
                  mentionQuery={mentionQuery}
                  mentionCandidates={mentionCandidates}
                  mentionIndex={mentionIndex}
                  resourceOpen={resourceOpen}
                  resourceItems={resourceItems}
                  composerRef={composerRef}
                  pickNodeActive={pickNodeActive}
                  onDraftChange={onDraftChange}
                  onComposerKeyDown={onComposerKeyDown}
                  onSend={sendDraft}
                  onRemoveAttachment={id => setAttachments(current => current.filter(item => item.id !== id))}
                  onInsertMention={insertMention}
                  onAddMentions={addMentions}
                  onToggleResources={() => setResourceOpen(value => !value)}
                  onPlus={() => plusInputRef.current?.click()}
                  onDocument={() => docInputRef.current?.click()}
                  onTogglePick={() => onPickNodeActiveChange(!pickNodeActive)}
                />
              </>
            )}
          </>
        ) : (
          <CollapsedRail onOpen={() => onOpenChange(true)} />
        )}
      </section>

      <input
        ref={storyInputRef}
        type="file"
        accept={STORY_UPLOAD_ACCEPT}
        className="hidden"
        onChange={event => {
          const files = event.target.files
          event.target.value = ""
          if (files?.length) {
            enterMode("script-adapt")
            void receiveFiles(files, "已选中故事文件。可继续补充改编要求后发送。")
          }
        }}
      />
      <input
        ref={plusInputRef}
        type="file"
        accept={GENERIC_UPLOAD_ACCEPT}
        multiple
        className="hidden"
        onChange={event => {
          const files = event.target.files
          event.target.value = ""
          if (files?.length) void receiveFiles(files)
        }}
      />
      <input
        ref={docInputRef}
        type="file"
        accept={STORY_UPLOAD_ACCEPT}
        multiple
        className="hidden"
        onChange={event => {
          const files = event.target.files
          event.target.value = ""
          if (files?.length) void receiveFiles(files)
        }}
      />
    </aside>
  )
}

export function readAssistantRailOpen(): boolean {
  return readBoolean(OPEN_KEY, true)
}

function RailIconButton({
  label,
  icon: Icon,
  onClick,
  active = false,
}: {
  label: string
  icon: LucideIcon
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-lg hover:bg-white/8 hover:text-text-primary",
        active ? "text-text-primary bg-white/8" : "",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}

function CollapsedRail({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="flex h-full w-full flex-col items-center gap-3 px-1 py-4 text-text-secondary hover:text-text-primary"
      onClick={onOpen}
      title="打开创作助手对话栏"
      aria-label="打开创作助手对话栏"
    >
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-cyan-300/15 text-cyan-200">
        <WandSparkles className="h-4 w-4" />
      </span>
      <span className="text-[11px] leading-4 tracking-[0.2em]" style={{ writingMode: "vertical-rl" }}>
        创作助手
      </span>
    </button>
  )
}

function CyanOrb() {
  return (
    <div className="relative mx-auto h-28 w-28">
      <div
        className="absolute inset-0 rounded-full opacity-80 blur-2xl"
        style={{ background: "radial-gradient(circle, rgba(90,235,230,0.55) 0%, rgba(90,235,230,0) 70%)" }}
      />
      <div
        className="absolute inset-[18px] rounded-full"
        style={{
          background: "radial-gradient(circle at 34% 30%, #f4ffff 0%, #7af3ee 28%, #2ec8c4 58%, #0e6f74 100%)",
          boxShadow: "0 0 36px rgba(80,230,230,0.42), inset 0 0 18px rgba(255,255,255,0.28)",
        }}
      />
      <div
        className="absolute left-[34%] top-[28%] h-6 w-6 rounded-full opacity-70 blur-[2px]"
        style={{ background: "rgba(255,255,255,0.85)" }}
      />
    </div>
  )
}

function EmptyState({
  mode,
  showPresets,
  promptCandidates,
  onShortcut,
  onChip,
  onPreset,
}: {
  mode: AssistantMode
  showPresets: boolean
  promptCandidates: ReturnType<typeof collectPromptCandidates>
  onShortcut: (key: "sense" | "preset" | "adapt" | "prompts") => void
  onChip: (mode: AssistantMode) => void
  onPreset: (preset: string) => void
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center pb-4 pt-8">
      <CyanOrb />
      <h2 className="mt-5 text-center text-[16px] font-medium leading-7 text-white">
        {EMPTY_TITLE}
      </h2>
      <div className="mt-6 w-full space-y-1">
        {SHORTCUTS.map(item => {
          const Icon = item.icon
          return (
            <button
              key={item.key}
              type="button"
              className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left text-[13px] text-text-secondary hover:bg-white/6 hover:text-text-primary"
              onClick={() => onShortcut(item.key)}
            >
              <Icon className="h-4 w-4 shrink-0 text-text-weak" />
              <span className="min-w-0 flex-1">{item.title}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-text-weak" />
            </button>
          )
        })}
      </div>
      <div className="mt-4 flex w-full flex-wrap justify-center gap-2">
        {MODE_CHIPS.map(item => {
          const Icon = item.icon
          const active = mode === item.mode
          return (
            <button
              key={item.mode}
              type="button"
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px]",
                active
                  ? "border-white/20 bg-white/10 text-text-primary"
                  : "border-white/10 text-text-secondary hover:border-white/16 hover:text-text-primary",
              )}
              onClick={() => onChip(item.mode)}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          )
        })}
      </div>
      {showPresets ? (
        <div className="mt-4 flex w-full flex-wrap gap-2">
          {PRESET_OPTIONS.map(preset => (
            <button
              key={preset}
              type="button"
              className="rounded-full border border-white/10 px-3 py-1 text-[12px] text-text-secondary hover:border-white/16 hover:text-text-primary"
              onClick={() => onPreset(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
      ) : null}
      {mode === "prompt-optimize" && promptCandidates.length ? (
        <p className="mt-4 w-full text-[11px] leading-5 text-text-weak">
          已从当前画布收集到 {promptCandidates.length} 条提示词，写入输入框后可再编辑发送。
        </p>
      ) : null}
    </div>
  )
}

function MessageList({ messages }: { messages: AssistantMessage[] }) {
  return (
    <div className="flex flex-col gap-4 py-3">
      {messages.map(message => (
        <article key={message.id} className={cn("flex flex-col gap-2", message.role === "user" ? "items-end" : "items-start")}>
          <div
            className={cn(
              "max-w-full whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-6",
              message.role === "user" ? "bg-white/8 text-text-primary" : "text-text-secondary",
            )}
          >
            {message.text}
          </div>
          {message.mentions?.length ? (
            <div className="flex flex-wrap gap-1">
              {message.mentions.map(item => (
                <span key={item.id} className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-text-secondary">
                  @{item.title}
                </span>
              ))}
            </div>
          ) : null}
          {message.attachments?.length ? (
            <div className="flex w-full flex-col gap-1">
              {message.attachments.map(item => (
                <div key={item.id} className="rounded-xl bg-white/6 px-2.5 py-1.5 text-[11px] text-text-secondary">
                  <div className="text-text-primary">{item.name}</div>
                  <div className="text-text-weak">{formatBytes(item.size)}{item.truncated ? " · 文本过长，只保留了节选" : ""}</div>
                  {item.textExcerpt ? (
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-text-weak">{item.textExcerpt}</pre>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  )
}

function Composer({
  draft,
  canSend,
  attachments,
  mentions,
  mentionQuery,
  mentionCandidates,
  mentionIndex,
  resourceOpen,
  resourceItems,
  composerRef,
  pickNodeActive,
  onDraftChange,
  onComposerKeyDown,
  onSend,
  onRemoveAttachment,
  onInsertMention,
  onAddMentions,
  onToggleResources,
  onPlus,
  onDocument,
  onTogglePick,
}: {
  draft: string
  canSend: boolean
  attachments: AssistantAttachment[]
  mentions: AssistantMention[]
  mentionQuery: string | null
  mentionCandidates: AssistantMention[]
  mentionIndex: number
  resourceOpen: boolean
  resourceItems: AssistantMention[]
  composerRef: RefObject<HTMLTextAreaElement | null>
  pickNodeActive: boolean
  onDraftChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onSend: () => void
  onRemoveAttachment: (id: string) => void
  onInsertMention: (item: AssistantMention) => void
  onAddMentions: (items: AssistantMention[]) => void
  onToggleResources: () => void
  onPlus: () => void
  onDocument: () => void
  onTogglePick: () => void
}) {
  return (
    <div className="relative shrink-0 px-3 pb-3 pt-1">
      {mentionQuery !== null ? (
        <div className="absolute inset-x-3 bottom-full z-20 mb-1 overflow-hidden rounded-xl border border-white/10 bg-[#1c1b19] py-1 shadow-2xl">
          {mentionCandidates.length ? mentionCandidates.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                "flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px]",
                index === mentionIndex ? "bg-white/8 text-text-primary" : "text-text-secondary hover:bg-white/6",
              )}
              onClick={() => onInsertMention(item)}
            >
              <span className="truncate">@{item.title}</span>
              <span className="ml-2 shrink-0 text-[10px] text-text-weak">{item.typeLabel}</span>
            </button>
          )) : (
            <p className="px-3 py-2 text-[12px] text-text-weak">没有匹配的节点。</p>
          )}
        </div>
      ) : null}

      {resourceOpen ? (
        <div className="mb-2 max-h-40 overflow-y-auto rounded-xl border border-white/10 bg-black/20 py-1">
          {resourceItems.length ? resourceItems.map(item => (
            <button
              key={item.id}
              type="button"
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] text-text-secondary hover:bg-white/6 hover:text-text-primary"
              onClick={() => onAddMentions([item])}
            >
              <span className="truncate">@{item.title}</span>
              <span className="ml-2 shrink-0 text-[10px] text-text-weak">{item.typeLabel}</span>
            </button>
          )) : (
            <p className="px-3 py-2 text-[12px] text-text-weak">当前没有可引用的节点。也还没有可引用的工作流。</p>
          )}
          {resourceItems.length ? (
            <p className="px-3 py-1 text-[10px] text-text-weak">当前没有可引用的工作流。</p>
          ) : null}
        </div>
      ) : null}

      {(attachments.length || mentions.length) ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {mentions.map(item => (
            <span key={item.id} className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-text-secondary">
              @{item.title}
            </span>
          ))}
          {attachments.map(item => (
            <button
              key={item.id}
              type="button"
              className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-text-secondary hover:text-text-primary"
              onClick={() => onRemoveAttachment(item.id)}
              title="移除附件"
            >
              {item.name} · {formatBytes(item.size)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="rounded-[22px] border border-white/8 bg-black/25 px-3 pb-2 pt-2.5">
        <textarea
          ref={composerRef}
          value={draft}
          rows={2}
          onChange={onDraftChange}
          onKeyDown={onComposerKeyDown}
          placeholder="开始你的创作，或者 @ 引用工作流/节点/资源"
          className="max-h-32 min-h-[44px] w-full resize-none bg-transparent text-[13px] leading-6 text-text-primary outline-none placeholder:text-text-weak"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5 text-text-secondary">
            <RailIconButton label="添加附件" icon={Plus} onClick={onPlus} />
            <RailIconButton label="引用节点或资源" icon={Square} active={resourceOpen} onClick={onToggleResources} />
            <RailIconButton label="上传文档" icon={FileText} onClick={onDocument} />
            <RailIconButton label="从画布点选节点" icon={Hand} active={pickNodeActive} onClick={onTogglePick} />
          </div>
          <button
            type="button"
            aria-label="发送"
            disabled={!canSend}
            onClick={onSend}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-full transition",
              canSend ? "bg-white text-black hover:bg-white/90" : "bg-white/12 text-text-weak",
            )}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
