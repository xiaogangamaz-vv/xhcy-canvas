/**
 * The visual fields the canvas injects into node data (selection highlight, upstream
 * summary, media metadata).
 *
 * This lives outside the workspace for one specific reason: the injection effect rewrites
 * `nodes`, so anything it depends on must not be derived from `nodes`. Computing the fields
 * here — from `edges` plus the asset list, and applied idempotently — keeps the effect from
 * re-triggering itself, which is what took the canvas page down with React's "maximum update
 * depth" error. `applyCanvasNodeVisualData` returns the same array when nothing changed, so
 * the invariant is testable: applying it twice must report no change.
 */

export type CanvasUpstreamSummary = { media: number; text: number; generation: number }

/**
 * The newest terminal failure of a node's task, shown on the card so a user can read the
 * reason and decide whether to regenerate (batch failures surface the same way).
 */
export type CanvasNodeFailure = {
  taskId: string
  message: string
  code: string | null
  status: string
}

export type CanvasVisualNode = {
  id: string
  data: {
    rawNode: { type: string; assetRefs: readonly { assetId?: string }[] }
    highlighted?: boolean
    connectable?: boolean
    useThumbnail?: boolean
    upstreamCount?: number
    upstreamSummary?: CanvasUpstreamSummary
    mediaMeta?: string
    mediaDuration?: string
    taskFailure?: CanvasNodeFailure | null
  }
}

export type CanvasAssetMetaRow = {
  id: string
  type: string
  width?: number | null
  height?: number | null
  duration?: number | null
}

export function sameCanvasUpstreamSummary(a?: CanvasUpstreamSummary, b?: CanvasUpstreamSummary): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.media === b.media && a.text === b.text && a.generation === b.generation
}

export function sameCanvasNodeFailure(a?: CanvasNodeFailure | null, b?: CanvasNodeFailure | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.taskId === b.taskId && a.message === b.message && a.code === b.code && a.status === b.status
}

/** What each node's upstream edges actually carry: media assets, text content, or a result. */
export function canvasUpstreamSummaryByNode(
  nodes: readonly { id: string; type: string }[],
  edges: readonly { source: string; target: string }[],
): Map<string, CanvasUpstreamSummary> {
  const typeById = new Map(nodes.map(node => [node.id, node.type]))
  const map = new Map<string, CanvasUpstreamSummary>()
  for (const edge of edges) {
    const sourceType = typeById.get(edge.source)
    if (!sourceType) continue
    const summary = map.get(edge.target) || { media: 0, text: 0, generation: 0 }
    if (sourceType === "image" || sourceType === "video" || sourceType === "audio") summary.media += 1
    else if (sourceType === "generation") summary.generation += 1
    else summary.text += 1
    map.set(edge.target, summary)
  }
  return map
}

/** The measured size (and a video's duration) of the asset a media node references. */
export function canvasMediaMetaByNode(
  nodes: readonly CanvasVisualNode[],
  assetRows: readonly CanvasAssetMetaRow[],
): Map<string, { meta: string; duration: string }> {
  const assetById = new Map(assetRows.map(asset => [asset.id, asset]))
  const map = new Map<string, { meta: string; duration: string }>()
  for (const node of nodes) {
    const type = node.data.rawNode.type
    if (type !== "image" && type !== "video") continue
    const asset = assetById.get(node.data.rawNode.assetRefs[0]?.assetId || "")
    if (!asset) continue
    const dimensions = asset.width && asset.height ? `${asset.width}×${asset.height}` : ""
    const duration = asset.type === "video" && asset.duration ? `${Math.round(asset.duration)}s` : ""
    if (dimensions || duration) map.set(node.id, { meta: dimensions, duration })
  }
  return map
}

/**
 * Applies the visual fields to every node, preserving object identity for nodes whose
 * fields did not change and returning the same array when nothing changed at all.
 */
export function applyCanvasNodeVisualData<T extends CanvasVisualNode>(
  nodes: readonly T[],
  options: {
    edges: readonly { source: string; target: string }[]
    assetRows: readonly CanvasAssetMetaRow[]
    highlightedNodeIds: ReadonlySet<string>
    connectableNodeIds: ReadonlySet<string>
    perfMode: string
    /** Newest terminal failure per node (from the canvas task list, never from `nodes`). */
    taskFailureByNode?: Readonly<Record<string, CanvasNodeFailure>>
  },
): T[] {
  const summaryByNode = canvasUpstreamSummaryByNode(
    nodes.map(node => ({ id: node.id, type: node.data.rawNode.type })),
    options.edges,
  )
  const metaByNode = canvasMediaMetaByNode(nodes, options.assetRows)

  let changed = false
  const next = nodes.map(node => {
    const upstreamSummary = summaryByNode.get(node.id)
    const media = metaByNode.get(node.id)
    const taskFailure = options.taskFailureByNode?.[node.id] || null
    const fields = {
      highlighted: options.highlightedNodeIds.has(node.id),
      connectable: options.connectableNodeIds.has(node.id),
      useThumbnail: options.perfMode === "speed" && (node.data.rawNode.type === "image" || node.data.rawNode.type === "video"),
      upstreamCount: upstreamSummary ? upstreamSummary.media + upstreamSummary.text + upstreamSummary.generation : 0,
      upstreamSummary,
      mediaMeta: media?.meta,
      mediaDuration: media?.duration,
      taskFailure,
    }
    const previous = node.data
    const unchanged = previous.highlighted === fields.highlighted
      && previous.connectable === fields.connectable
      && previous.useThumbnail === fields.useThumbnail
      && previous.upstreamCount === fields.upstreamCount
      && previous.mediaMeta === fields.mediaMeta
      && previous.mediaDuration === fields.mediaDuration
      && sameCanvasUpstreamSummary(previous.upstreamSummary, fields.upstreamSummary)
      && sameCanvasNodeFailure(previous.taskFailure, fields.taskFailure)
    if (unchanged) return node
    changed = true
    return { ...node, data: { ...node.data, ...fields } }
  })
  return changed ? next : (nodes as readonly T[] as T[])
}
