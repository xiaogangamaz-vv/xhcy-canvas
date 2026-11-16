/**
 * IC4-0：`script` 节点的分镜大纲（story_outline）文档模式。
 *
 * 不新增节点类型、不改 DB enum：大纲存在节点 params 里的 `outline`（JSON 字符串），
 * `documentKind` 决定 script 节点是自由文本还是结构化大纲。结构化大纲同时会被渲染成
 * `params.script` 文本，这样服务端既有的「script → 生成节点」提示词通道无需改动。
 *
 * 所有函数都是纯函数：解析时裁剪长度与数量、丢弃未知字段、跨版本拒绝。
 */

export const CANVAS_STORY_OUTLINE_SCHEMA_VERSION = 1

export const CANVAS_SCRIPT_DOCUMENT_KINDS = ["free", "story_outline"] as const
export type CanvasScriptDocumentKind = (typeof CANVAS_SCRIPT_DOCUMENT_KINDS)[number]

export const CANVAS_STORY_OUTLINE_LIMITS = {
  synopsis: 2000,
  actTitle: 120,
  actSummary: 400,
  shotTitle: 120,
  shotDescription: 400,
  acts: 12,
  shotsPerAct: 12,
} as const

export type CanvasStoryOutlineShot = {
  id: string
  title: string
  description: string
}

export type CanvasStoryOutlineAct = {
  id: string
  title: string
  summary: string
  shots: CanvasStoryOutlineShot[]
}

export type CanvasStoryOutline = {
  schemaVersion: number
  synopsis: string
  acts: CanvasStoryOutlineAct[]
}

export function isCanvasScriptDocumentKind(value: unknown): value is CanvasScriptDocumentKind {
  return typeof value === "string" && (CANVAS_SCRIPT_DOCUMENT_KINDS as readonly string[]).includes(value)
}

/** 文档模式：缺省是自由文本，只有显式写了 story_outline 才切换。 */
export function canvasScriptDocumentKind(value: unknown): CanvasScriptDocumentKind {
  return isCanvasScriptDocumentKind(value) ? value : "free"
}

let outlineIdCounter = 0

/** 生成大纲内部的稳定 id（幕/镜头）。仅用于本地文档结构，不参与服务端授权。 */
export function createCanvasStoryOutlineId(prefix: "act" | "shot"): string {
  outlineIdCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${outlineIdCounter.toString(36)}`
}

export function createEmptyCanvasStoryOutline(): CanvasStoryOutline {
  return { schemaVersion: CANVAS_STORY_OUTLINE_SCHEMA_VERSION, synopsis: "", acts: [] }
}

function clampText(value: unknown, max: number): string {
  if (typeof value !== "string") return ""
  return value.slice(0, max)
}

function parseShot(raw: unknown): CanvasStoryOutlineShot | null {
  if (!raw || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>
  const id = clampText(record.id, 64)
  const title = clampText(record.title, CANVAS_STORY_OUTLINE_LIMITS.shotTitle)
  const description = clampText(record.description, CANVAS_STORY_OUTLINE_LIMITS.shotDescription)
  // 编辑器里「刚加、还没填」的镜头是合法状态：只要带 id 就保留。
  // 只有既没有 id 也没有任何内容的条目才当成噪声丢掉。
  if (!id && !title && !description) return null
  return { id: id || createCanvasStoryOutlineId("shot"), title, description }
}

function parseAct(raw: unknown): CanvasStoryOutlineAct | null {
  if (!raw || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>
  const id = clampText(record.id, 64)
  const shots = Array.isArray(record.shots)
    ? record.shots.slice(0, CANVAS_STORY_OUTLINE_LIMITS.shotsPerAct).map(parseShot).filter((shot): shot is CanvasStoryOutlineShot => Boolean(shot))
    : []
  const title = clampText(record.title, CANVAS_STORY_OUTLINE_LIMITS.actTitle)
  const summary = clampText(record.summary, CANVAS_STORY_OUTLINE_LIMITS.actSummary)
  // 同上：带 id 的空幕（刚点「添加幕」）必须保留，否则编辑器加完幕立刻就没了。
  if (!id && !title && !summary && shots.length === 0) return null
  return { id: id || createCanvasStoryOutlineId("act"), title, summary, shots }
}

/**
 * 解析大纲：接受 JSON 字符串或对象。版本不匹配、结构不是对象、或整体为空时返回 null，
 * 调用方据此回退到自由文本模式。
 */
export function parseCanvasStoryOutline(raw: unknown): CanvasStoryOutline | null {
  let value: unknown = raw
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!trimmed) return null
    try {
      value = JSON.parse(trimmed)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const version = Number(record.schemaVersion)
  if (!Number.isInteger(version) || version !== CANVAS_STORY_OUTLINE_SCHEMA_VERSION) return null
  const acts = Array.isArray(record.acts)
    ? record.acts.slice(0, CANVAS_STORY_OUTLINE_LIMITS.acts).map(parseAct).filter((act): act is CanvasStoryOutlineAct => Boolean(act))
    : []
  return {
    schemaVersion: CANVAS_STORY_OUTLINE_SCHEMA_VERSION,
    synopsis: clampText(record.synopsis, CANVAS_STORY_OUTLINE_LIMITS.synopsis),
    acts,
  }
}

/** 稳定序列化：键顺序固定，便于快照与比较。 */
export function serializeCanvasStoryOutline(outline: CanvasStoryOutline): string {
  return JSON.stringify({
    schemaVersion: CANVAS_STORY_OUTLINE_SCHEMA_VERSION,
    synopsis: clampText(outline.synopsis, CANVAS_STORY_OUTLINE_LIMITS.synopsis),
    acts: outline.acts.slice(0, CANVAS_STORY_OUTLINE_LIMITS.acts).map(act => ({
      id: act.id,
      title: clampText(act.title, CANVAS_STORY_OUTLINE_LIMITS.actTitle),
      summary: clampText(act.summary, CANVAS_STORY_OUTLINE_LIMITS.actSummary),
      shots: act.shots.slice(0, CANVAS_STORY_OUTLINE_LIMITS.shotsPerAct).map(shot => ({
        id: shot.id,
        title: clampText(shot.title, CANVAS_STORY_OUTLINE_LIMITS.shotTitle),
        description: clampText(shot.description, CANVAS_STORY_OUTLINE_LIMITS.shotDescription),
      })),
    })),
  })
}

export function summarizeCanvasStoryOutline(outline: CanvasStoryOutline): { acts: number; shots: number } {
  return {
    acts: outline.acts.length,
    shots: outline.acts.reduce((total, act) => total + act.shots.length, 0),
  }
}

/**
 * 大纲 → 文本。写回 params.script，这样「script → 生成节点」的提示词通道和自由文本模式
 * 共用同一条服务端路径（服务端只读 params.script）。
 */
export function storyOutlineToScriptText(outline: CanvasStoryOutline): string {
  const lines: string[] = []
  if (outline.synopsis.trim()) lines.push(outline.synopsis.trim())
  outline.acts.forEach((act, actIndex) => {
    const header = act.title.trim() || `第 ${actIndex + 1} 幕`
    lines.push(`${header}${act.summary.trim() ? `：${act.summary.trim()}` : ""}`)
    act.shots.forEach((shot, shotIndex) => {
      const label = shot.title.trim() || `镜头 ${shotIndex + 1}`
      lines.push(`  ${shotIndex + 1}. ${label}${shot.description.trim() ? ` — ${shot.description.trim()}` : ""}`)
    })
  })
  return lines.join("\n").slice(0, 4000)
}

export function addCanvasStoryOutlineAct(outline: CanvasStoryOutline, id: string, title = ""): CanvasStoryOutline {
  if (outline.acts.length >= CANVAS_STORY_OUTLINE_LIMITS.acts) return outline
  return { ...outline, acts: [...outline.acts, { id, title, summary: "", shots: [] }] }
}

export function updateCanvasStoryOutlineAct(
  outline: CanvasStoryOutline,
  actId: string,
  patch: Partial<Pick<CanvasStoryOutlineAct, "title" | "summary">>,
): CanvasStoryOutline {
  return {
    ...outline,
    acts: outline.acts.map(act => (act.id === actId ? { ...act, ...patch } : act)),
  }
}

export function removeCanvasStoryOutlineAct(outline: CanvasStoryOutline, actId: string): CanvasStoryOutline {
  return { ...outline, acts: outline.acts.filter(act => act.id !== actId) }
}

export function addCanvasStoryOutlineShot(
  outline: CanvasStoryOutline,
  actId: string,
  id: string,
  title = "",
): CanvasStoryOutline {
  return {
    ...outline,
    acts: outline.acts.map(act => {
      if (act.id !== actId) return act
      if (act.shots.length >= CANVAS_STORY_OUTLINE_LIMITS.shotsPerAct) return act
      return { ...act, shots: [...act.shots, { id, title, description: "" }] }
    }),
  }
}

export function updateCanvasStoryOutlineShot(
  outline: CanvasStoryOutline,
  actId: string,
  shotId: string,
  patch: Partial<Pick<CanvasStoryOutlineShot, "title" | "description">>,
): CanvasStoryOutline {
  return {
    ...outline,
    acts: outline.acts.map(act => (
      act.id === actId
        ? { ...act, shots: act.shots.map(shot => (shot.id === shotId ? { ...shot, ...patch } : shot)) }
        : act
    )),
  }
}

export function removeCanvasStoryOutlineShot(outline: CanvasStoryOutline, actId: string, shotId: string): CanvasStoryOutline {
  return {
    ...outline,
    acts: outline.acts.map(act => (act.id === actId ? { ...act, shots: act.shots.filter(shot => shot.id !== shotId) } : act)),
  }
}
