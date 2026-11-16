import { z } from "zod"
import { PREVIS_SCENE_SCHEMA_VERSION, previsSceneSchema, type PrevisScene } from "./scene-schema"
import { applyPrevisOps, previsOpSchema, previsOpSummary, type PrevisOp } from "./scene-ops"

/**
 * Previs document = base scene + an ordered list of edit batches + a cursor.
 *
 * Storing the *edits* instead of a scene snapshot per revision keeps the node
 * param small (a scene can be tens of KB and a node param is a JSON string in
 * SQLite) while still giving exact, replayable revert/redo — which is what the
 * product video's "Actually, back to the lizard." needs.
 */

export const PREVIS_DOCUMENT_SCHEMA_VERSION = "previs_document@1"
export const PREVIS_EDIT_HISTORY_LIMIT = 30

export const previsEditBatchSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    label: z.string().trim().min(1).max(120),
    createdAt: z.number().int().nonnegative(),
    ops: z.array(previsOpSchema).min(1).max(12),
  })
  .strict()

export const previsDocumentSchema = z
  .object({
    schemaVersion: z.literal(PREVIS_DOCUMENT_SCHEMA_VERSION),
    baseScene: previsSceneSchema,
    edits: z.array(previsEditBatchSchema).max(PREVIS_EDIT_HISTORY_LIMIT),
    cursor: z.number().int().min(0).max(PREVIS_EDIT_HISTORY_LIMIT),
  })
  .strict()

export type PrevisEditBatch = z.infer<typeof previsEditBatchSchema>
export type PrevisDocument = z.infer<typeof previsDocumentSchema>

export function createPrevisDocument(scene: PrevisScene): PrevisDocument {
  return {
    schemaVersion: PREVIS_DOCUMENT_SCHEMA_VERSION,
    baseScene: JSON.parse(JSON.stringify(scene)) as PrevisScene,
    edits: [],
    cursor: 0,
  }
}

/** Replay the applied edits from the base scene; never trusted, always recomputed. */
export function previsDocumentScene(document: PrevisDocument): PrevisScene {
  let scene = document.baseScene
  for (const batch of document.edits.slice(0, document.cursor)) {
    const result = applyPrevisOps(scene, batch.ops)
    if (result.issues.length === 0) scene = result.scene
  }
  return scene
}

export function parsePrevisDocument(value: unknown): PrevisDocument {
  const result = previsDocumentSchema.safeParse(value)
  if (!result.success) throw new Error("预演文档不符合 previs_document@1")
  return result.data
}

export function safeParsePrevisDocument(value: unknown): PrevisDocument | null {
  const result = previsDocumentSchema.safeParse(value)
  return result.success ? result.data : null
}

export type PrevisEditResult = {
  document: PrevisDocument
  scene: PrevisScene
  issues: string[]
}

/**
 * Apply one edit batch. Invalid ops reject the whole batch (the scene is
 * untouched), and a new edit after a revert drops the redo tail.
 */
export function applyPrevisDocumentEdit(input: {
  document: PrevisDocument
  ops: unknown[]
  label: string
  now?: number
  id?: string
}): PrevisEditResult {
  const currentScene = previsDocumentScene(input.document)
  if (input.ops.length === 0) {
    return { document: input.document, scene: currentScene, issues: ["没有可应用的编辑"] }
  }
  const applied = applyPrevisOps(currentScene, input.ops)
  if (applied.issues.length > 0) {
    return { document: input.document, scene: currentScene, issues: applied.issues }
  }
  const now = input.now ?? Date.now()
  const parsedOps: PrevisOp[] = []
  for (const op of input.ops) {
    const result = previsOpSchema.safeParse(op)
    if (result.success) parsedOps.push(result.data)
  }
  const batch: PrevisEditBatch = {
    id: input.id || `edit-${now.toString(36)}-${input.document.edits.length + 1}`,
    label: input.label.slice(0, 120) || parsedOps.map(previsOpSummary).join("；").slice(0, 120),
    createdAt: now,
    ops: parsedOps,
  }
  const kept = input.document.edits.slice(0, input.document.cursor)
  const edits = [...kept, batch].slice(-PREVIS_EDIT_HISTORY_LIMIT)
  const dropped = Math.max(0, kept.length + 1 - PREVIS_EDIT_HISTORY_LIMIT)
  const document: PrevisDocument = {
    ...input.document,
    edits,
    cursor: edits.length,
  }
  void dropped
  return { document, scene: applied.scene, issues: [] }
}

export function revertPrevisDocument(document: PrevisDocument, steps = 1): PrevisDocument {
  const cursor = Math.max(0, Math.min(document.cursor, document.cursor - Math.max(1, Math.floor(steps))))
  return { ...document, cursor }
}

export function redoPrevisDocument(document: PrevisDocument, steps = 1): PrevisDocument {
  const cursor = Math.min(document.edits.length, document.cursor + Math.max(1, Math.floor(steps)))
  return { ...document, cursor }
}

export function canRevertPrevisDocument(document: PrevisDocument): boolean {
  return document.cursor > 0
}

export function canRedoPrevisDocument(document: PrevisDocument): boolean {
  return document.cursor < document.edits.length
}

/** The label of the edit that a revert would undo (for the chat/undo affordance). */
export function previsDocumentUndoLabel(document: PrevisDocument): string | null {
  if (document.cursor <= 0) return null
  return document.edits[document.cursor - 1]?.label || null
}

export { PREVIS_SCENE_SCHEMA_VERSION }
