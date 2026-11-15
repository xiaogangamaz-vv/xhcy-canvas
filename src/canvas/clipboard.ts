import type { CanvasNodeType } from "@/domain/types"

/**
 * Same-canvas node clipboard (IC1.3).
 *
 * Deliberately an in-app payload, never the system clipboard: prompts, model ids
 * and private media URLs must not leave the page through a browser clipboard.
 * The payload only carries what a new node needs — type, geometry, params and the
 * owner+project validated asset references — so a paste can never resurrect a
 * generation task, node output, ledger row or usage record.
 */

export const CANVAS_CLIPBOARD_VERSION = 1
/** Each paste lands one step further down-right so repeated pastes do not stack. */
export const CANVAS_CLIPBOARD_OFFSET = 32

export type CanvasClipboardAssetRef = { assetId: string; type: string; url?: string | null }

export type CanvasClipboardSourceNode = {
  id: string
  type: CanvasNodeType
  title: string
  x: number
  y: number
  width: number
  height: number
  params: Record<string, unknown>
  assetRefs: CanvasClipboardAssetRef[]
}

export type CanvasClipboardSourceEdge = {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

/** `sourceId` 是画布上的原节点 id：粘贴分镜板时要用它把引用改指到新复制的分镜。 */
export type CanvasClipboardNode = Omit<CanvasClipboardSourceNode, "id"> & { sourceId: string }

/** Edges are stored by clipboard index; the created node ids only exist after the paste. */
export type CanvasClipboardEdge = {
  sourceIndex: number
  targetIndex: number
  sourceHandle: string | null
  targetHandle: string | null
}

export type CanvasClipboardPayload = {
  version: number
  canvasId: string
  nodes: CanvasClipboardNode[]
  edges: CanvasClipboardEdge[]
}

export function buildCanvasClipboard(input: {
  canvasId: string | null | undefined
  nodes: readonly CanvasClipboardSourceNode[]
  edges: readonly CanvasClipboardSourceEdge[]
}): CanvasClipboardPayload | null {
  if (!input.canvasId || input.nodes.length === 0) return null
  const indexById = new Map(input.nodes.map((node, index) => [node.id, index]))
  const nodes: CanvasClipboardNode[] = input.nodes.map(node => ({
    sourceId: node.id,
    type: node.type,
    title: node.title,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    params: { ...node.params },
    assetRefs: node.assetRefs.map(ref => ({ assetId: ref.assetId, type: ref.type, url: ref.url })),
  }))
  // Only edges with both ends inside the selection: a half-copied edge would dangle.
  const edges: CanvasClipboardEdge[] = input.edges
    .filter(edge => indexById.has(edge.source) && indexById.has(edge.target))
    .map(edge => ({
      sourceIndex: indexById.get(edge.source) as number,
      targetIndex: indexById.get(edge.target) as number,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    }))
  return { version: CANVAS_CLIPBOARD_VERSION, canvasId: input.canvasId, nodes, edges }
}

/** Cross-canvas paste is deferred, so a payload only pastes into the canvas it came from. */
export function canPasteCanvasClipboard(
  payload: CanvasClipboardPayload | null | undefined,
  canvasId: string | null | undefined,
): boolean {
  if (!payload || !canvasId) return false
  return payload.version === CANVAS_CLIPBOARD_VERSION
    && payload.canvasId === canvasId
    && payload.nodes.length > 0
}

export function canvasClipboardOffset(pasteCount: number): { x: number; y: number } {
  const step = Math.max(1, Math.round(pasteCount))
  return { x: CANVAS_CLIPBOARD_OFFSET * step, y: CANVAS_CLIPBOARD_OFFSET * step }
}

/** The POST body for a pasted node — `sourceId` stays in the payload, never on the wire. */
export function canvasClipboardNodeBody(
  node: CanvasClipboardNode,
  offset: { x: number; y: number },
): {
  type: CanvasNodeType
  title: string
  x: number
  y: number
  width: number
  height: number
  params: Record<string, unknown>
  assetRefs: CanvasClipboardAssetRef[]
} {
  return {
    type: node.type,
    title: node.title,
    x: node.x + offset.x,
    y: node.y + offset.y,
    width: node.width,
    height: node.height,
    params: { ...node.params },
    assetRefs: node.assetRefs.map(ref => ({ assetId: ref.assetId, type: ref.type, url: ref.url })),
  }
}

/** Rebuilds the copied edges against the ids the server assigned to the pasted nodes. */
export function canvasClipboardEdgePayloads(
  payload: CanvasClipboardPayload,
  createdNodeIds: readonly string[],
): Array<{
  sourceNodeId: string
  targetNodeId: string
  sourceHandle: string | null
  targetHandle: string | null
  edgeType: string
}> {
  return payload.edges.flatMap(edge => {
    const sourceNodeId = createdNodeIds[edge.sourceIndex]
    const targetNodeId = createdNodeIds[edge.targetIndex]
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return []
    return [{
      sourceNodeId,
      targetNodeId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      edgeType: "default",
    }]
  })
}
