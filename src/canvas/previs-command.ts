import {
  applyPrevisDocumentEdit,
  createEmptyPrevisScene,
  createPrevisDocument,
  interpretPrevisCommand,
  previsDocumentScene,
  revertPrevisDocument,
  safeParsePrevisDocument,
  type PrevisDocument,
} from "@/previs"

export function parsePrevisDraftDocument(draft: Record<string, string> | string | null | undefined): PrevisDocument | null {
  const raw = typeof draft === "string" ? draft : draft?.document
  if (!raw || !raw.trim()) return null
  try {
    return safeParsePrevisDocument(JSON.parse(raw))
  } catch {
    return null
  }
}

export function writePrevisDraftDocument(
  document: PrevisDocument,
  draft: Record<string, string> = {},
  activeShotId?: string,
): Record<string, string> {
  const scene = previsDocumentScene(document)
  const shotId = activeShotId || scene.shots[0]?.id || ""
  return {
    ...draft,
    document: JSON.stringify(document),
    activeShotId: shotId,
  }
}

export function applyPrevisPromptToDocument(
  current: PrevisDocument | null,
  text: string,
): { document: PrevisDocument; reply: string; error: string | null } {
  const trimmed = text.trim()
  if (!trimmed) {
    return { document: current ?? createPrevisDocument(createEmptyPrevisScene()), reply: "", error: "请输入要拍摄的场景或修改" }
  }
  const base = current ?? createPrevisDocument(createEmptyPrevisScene())
  const command = interpretPrevisCommand({ text: trimmed, scene: previsDocumentScene(base) })
  if (command.revertSteps > 0) {
    let nextDoc = revertPrevisDocument(base, command.revertSteps)
    if (command.ops.length > 0) {
      const applied = applyPrevisDocumentEdit({ document: nextDoc, ops: command.ops, label: command.reply })
      if (applied.issues.length > 0) {
        return { document: base, reply: "", error: applied.issues.join("；") }
      }
      nextDoc = applied.document
    }
    return { document: nextDoc, reply: command.reply, error: null }
  }
  if (!command.matched) {
    return { document: base, reply: "", error: command.reply }
  }
  const applied = applyPrevisDocumentEdit({ document: base, ops: command.ops, label: command.reply })
  if (applied.issues.length > 0) {
    return { document: base, reply: "", error: applied.issues.join("；") }
  }
  return { document: applied.document, reply: command.reply, error: null }
}