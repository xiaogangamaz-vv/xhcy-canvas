/**
 * IC4-2：`storyboard` 节点（计划里叫 `storyboard_board`）只做编排——
 * 按顺序引用**同一个画布里的 scene 节点 id**，不内嵌复制 scene 的 JSON，也不参与生成数据流。
 *
 * 这里的函数都是纯函数：解析容错、顺序操作不做隐式去重以外的加工，
 * 删除/跨画布粘贴后的悬挂引用一律显式返回被丢弃的 id，便于 UI 给出提示并让服务端校验。
 */

import { CANVAS_STORYBOARD_SCHEMA_VERSION } from "@/domain/types"

export const CANVAS_STORYBOARD_MAX_SCENES = 24

export const canvasStoryboardLayouts = ["list", "grid"] as const
export type CanvasStoryboardLayout = typeof canvasStoryboardLayouts[number]

export const canvasStoryboardLayoutLabels: Record<CanvasStoryboardLayout, string> = {
  list: "列表",
  grid: "网格",
}

/** 分镜板的 params（权威形状；卡片、检查器和服务端都走这里，不各自读 JSON）。 */
export type CanvasStoryboardParams = {
  schemaVersion: string
  sceneNodeIds: string[]
  layout: CanvasStoryboardLayout
  note: string
}

/** 解析节点 params 里的分镜顺序：接受 JSON 字符串或数组，其余一律空数组。 */
export function parseCanvasStoryboardSceneIds(value: unknown): string[] {
  let raw: unknown = value
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return []
    try {
      raw = JSON.parse(trimmed)
    } catch {
      return []
    }
  }
  if (!Array.isArray(raw)) return []
  const ids: string[] = []
  for (const entry of raw) {
    if (typeof entry !== "string") continue
    const id = entry.trim()
    if (!id || ids.includes(id)) continue
    ids.push(id)
    if (ids.length >= CANVAS_STORYBOARD_MAX_SCENES) break
  }
  return ids
}

export function serializeCanvasStoryboardSceneIds(ids: readonly string[]): string {
  return JSON.stringify(parseCanvasStoryboardSceneIds(ids))
}

/**
 * 服务端校验用：结构非法返回 null（区别于"合法但为空"）。
 * 旧版本或缺失 schemaVersion 的行按当前版本读，读旧数据不需要迁移脚本。
 */
export function normalizeCanvasStoryboardSceneIds(value: unknown): string[] | null {
  if (value === undefined || value === null) return []
  if (typeof value === "string" && !value.trim()) return []
  let raw: unknown = value
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!Array.isArray(raw)) return null
  for (const entry of raw) {
    if (typeof entry !== "string" || !entry.trim()) return null
  }
  if (raw.length > CANVAS_STORYBOARD_MAX_SCENES) return null
  return parseCanvasStoryboardSceneIds(raw)
}

/** params 归一化：未知字段丢弃、版本升级到当前、layout 回落到 list。 */
export function parseCanvasStoryboardParams(value: unknown): CanvasStoryboardParams {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    schemaVersion: CANVAS_STORYBOARD_SCHEMA_VERSION,
    sceneNodeIds: parseCanvasStoryboardSceneIds(record.sceneNodeIds),
    layout: canvasStoryboardLayout(record.layout),
    note: typeof record.note === "string" ? record.note : "",
  }
}

export function canvasStoryboardLayout(value: unknown): CanvasStoryboardLayout {
  return typeof value === "string" && (canvasStoryboardLayouts as readonly string[]).includes(value)
    ? value as CanvasStoryboardLayout
    : "list"
}

/**
 * 写库形状：params 一律是字符串表（与 registry 默认值一致），版本字段由这里统一盖章，
 * 调用方不必自己记得带上 schemaVersion。
 */
export function serializeCanvasStoryboardParams(
  params: Omit<CanvasStoryboardParams, "schemaVersion">,
): Record<string, string> {
  return {
    schemaVersion: CANVAS_STORYBOARD_SCHEMA_VERSION,
    sceneNodeIds: serializeCanvasStoryboardSceneIds(params.sceneNodeIds),
    layout: canvasStoryboardLayout(params.layout),
    note: params.note,
  }
}

export function addCanvasStoryboardScene(ids: readonly string[], sceneId: string): string[] {
  const next = parseCanvasStoryboardSceneIds(ids)
  const id = sceneId.trim()
  if (!id || next.includes(id) || next.length >= CANVAS_STORYBOARD_MAX_SCENES) return next
  return [...next, id]
}

/** 上移/下移一格：索引越界时原样返回，调用方不必自己夹取。 */
export function moveCanvasStoryboardScene(ids: readonly string[], from: number, to: number): string[] {
  const next = parseCanvasStoryboardSceneIds(ids)
  if (from < 0 || from >= next.length) return next
  const target = Math.max(0, Math.min(next.length - 1, to))
  if (target === from) return next
  const copy = [...next]
  const [moved] = copy.splice(from, 1)
  copy.splice(target, 0, moved)
  return copy
}

export function removeCanvasStoryboardScene(ids: readonly string[], sceneId: string): string[] {
  return parseCanvasStoryboardSceneIds(ids).filter(id => id !== sceneId)
}

/**
 * 丢掉已不存在的引用（scene 被删/被移到别的画布）。返回被丢弃的 id，
 * 让 UI 能告诉用户"有 N 个分镜已被移除"，而不是静默少几行。
 */
export function pruneCanvasStoryboardSceneIds(
  ids: readonly string[],
  existingNodeIds: ReadonlySet<string>,
): { ids: string[]; removed: string[] } {
  const kept: string[] = []
  const removed: string[] = []
  for (const id of parseCanvasStoryboardSceneIds(ids)) {
    if (existingNodeIds.has(id)) kept.push(id)
    else removed.push(id)
  }
  return { ids: kept, removed }
}

/**
 * 复制/粘贴重映射：分镜板只应引用同一批粘贴里的 scene。
 * 不在映射表里的引用会被丢弃（跨画布粘贴时正是这种情况）。
 */
export function remapCanvasStoryboardSceneIds(
  ids: readonly string[],
  idMap: ReadonlyMap<string, string>,
): { ids: string[]; dropped: string[] } {
  const mapped: string[] = []
  const dropped: string[] = []
  for (const id of parseCanvasStoryboardSceneIds(ids)) {
    const next = idMap.get(id)
    if (next) mapped.push(next)
    else dropped.push(id)
  }
  return { ids: mapped, dropped }
}

/**
 * 粘贴时把分镜板的引用对齐到粘贴后的画布：选中的分镜改指副本，
 * 没选中但画布里仍然存活的分镜保留原引用，其余（已删除的悬挂引用）丢弃——
 * 否则服务端会因为引用不存在的节点直接拒绝这次粘贴。
 * 映射表的目标（刚创建的副本）一定算存活，调用方不必自己补进 liveSceneIds。
 */
export function resolveCanvasStoryboardSceneIdsForPaste(
  ids: readonly string[],
  idMap: ReadonlyMap<string, string>,
  liveSceneIds: ReadonlySet<string>,
): { ids: string[]; dropped: string[] } {
  const remapped = parseCanvasStoryboardSceneIds(ids).map(id => idMap.get(id) ?? id)
  const { ids: kept, removed } = pruneCanvasStoryboardSceneIds(remapped, new Set([...liveSceneIds, ...idMap.values()]))
  return { ids: kept, dropped: removed }
}
