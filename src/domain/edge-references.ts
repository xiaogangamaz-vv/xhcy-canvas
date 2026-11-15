/**
 * 从连线派生"参考图"（纯函数，无 IO）。
 *
 * ## 为什么需要它
 *
 * 画布上给生成节点连一张图片节点，是"把这张图作为参考图"的**唯一直觉操作**，
 * 而且服务端确实按这个语义消费：`resolveUpstreamInputs` 会把内容型上游
 * （image/video/audio）的 `assetRefs` 作为输入资产收集起来。
 *
 * 但编辑器侧的参考图区只读节点自己的 `assetRefs`（手动勾选 / 上传 / 生成结果回写），
 * 连线完全不参与——于是出现"线连上了，参考图区却是空的，得手动再选一次"。
 *
 * ## 为什么不把连线结果写回 assetRefs
 *
 * 连线本身已经是这件事的事实来源。把上游资产再复制进下游 `assetRefs` 会产生第二份副本：
 * 删掉连线后参考图仍在（漂移），而且同一张图可能被记两次。
 * 因此这里**只派生、不持久化**，与分组归属（几何派生）、上游驱动 module 切换（计算得出）保持同一种做法。
 *
 * ## 只派生"服务端确实会采用"的部分
 *
 * 服务端对内容型上游的回退只取 `asset_refs_json` 里的 **assetId**，不看 `params.url`。
 * 所以仅有一张 URL、没有资产记录的图片节点，连上去**不会被采用**。
 * 本模块对这种上游不产出参考图（否则界面会显示一张实际不生效的图），
 * 而是把它计入 `unusableUpstreams`，由界面明确告知用户为什么没出现——
 * 这才是"智能识别"，而不是假装成功。
 */

import type { CanvasAssetKind, CanvasAssetRef } from "@/domain/types"

export type CanvasEdgeReferenceNode = {
  id: string
  type: string
  title?: string
  params?: Record<string, unknown> | null
  assetRefs?: readonly CanvasAssetRef[] | null
}

export type CanvasEdgeReferenceEdge = {
  source: string
  target: string
}

/** 派生出的参考图：带来源信息，界面据此标注"来自连线"并禁止就地删除。 */
export type CanvasDerivedReference = CanvasAssetRef & {
  origin: "connection"
  sourceNodeId: string
  sourceNodeTitle: string
}

/** 连了线但服务端不会采用的上游（目前只有"有图无资产记录"这一种）。 */
export type CanvasUnusableUpstream = {
  sourceNodeId: string
  sourceNodeTitle: string
  reason: "no-asset-record"
}

export type CanvasDerivedReferences = {
  references: CanvasDerivedReference[]
  unusableUpstreams: CanvasUnusableUpstream[]
}

/** 节点自身是否承载某种媒体：资源节点看类型，生成节点看它产出的 mediaType。 */
function providedMediaKind(node: CanvasEdgeReferenceNode): CanvasAssetKind | null {
  if (node.type === "image" || node.type === "video" || node.type === "audio") {
    return node.type
  }
  if (node.type !== "generation") return null
  const mediaType = node.params?.mediaType
  return mediaType === "image" || mediaType === "video" || mediaType === "audio" ? mediaType : null
}

/** 该节点是否"有图但没资产记录"（会被服务端忽略）。 */
function hasUrlWithoutAssetRecord(node: CanvasEdgeReferenceNode, kind: CanvasAssetKind): boolean {
  if ((node.assetRefs || []).some(ref => ref.assetId)) return false
  const url = node.params?.url
  if (kind === "image" && typeof url === "string" && url.trim() !== "") return true
  // 视频节点用 poster/url 展示，这里只把 url 视作"有内容"。
  return typeof url === "string" && url.trim() !== ""
}

/**
 * 派生目标节点的上游参考图。
 *
 * @param acceptKinds 该编辑器接受的媒体类型（图片生成器只收 image；视频生成器收 image/video/audio）
 * @param excludeAssetIds 已经手动选中的资产，避免同一张图在参考图区出现两次
 */
export function deriveCanvasUpstreamReferences(input: {
  targetNodeId: string
  nodes: readonly CanvasEdgeReferenceNode[]
  edges: readonly CanvasEdgeReferenceEdge[]
  acceptKinds: readonly CanvasAssetKind[]
  excludeAssetIds?: readonly string[]
}): CanvasDerivedReferences {
  const accept = new Set<string>(input.acceptKinds)
  const excluded = new Set(input.excludeAssetIds || [])
  const byId = new Map(input.nodes.map(node => [node.id, node]))

  const references: CanvasDerivedReference[] = []
  const unusableUpstreams: CanvasUnusableUpstream[] = []
  const seenSourceNodes = new Set<string>()
  const seenAssetIds = new Set<string>()

  for (const edge of input.edges) {
    if (edge.target !== input.targetNodeId) continue
    if (seenSourceNodes.has(edge.source)) continue
    seenSourceNodes.add(edge.source)

    const source = byId.get(edge.source)
    if (!source) continue
    const kind = providedMediaKind(source)
    if (!kind || !accept.has(kind)) continue

    const title = source.title || source.id
    const usable = (source.assetRefs || []).filter(ref => ref.assetId && accept.has(ref.type))

    if (usable.length === 0) {
      if (hasUrlWithoutAssetRecord(source, kind)) {
        unusableUpstreams.push({ sourceNodeId: source.id, sourceNodeTitle: title, reason: "no-asset-record" })
      }
      continue
    }

    for (const ref of usable) {
      if (excluded.has(ref.assetId) || seenAssetIds.has(ref.assetId)) continue
      seenAssetIds.add(ref.assetId)
      references.push({
        assetId: ref.assetId,
        type: ref.type,
        url: ref.url ?? null,
        origin: "connection",
        sourceNodeId: source.id,
        sourceNodeTitle: title,
      })
    }
  }

  return { references, unusableUpstreams }
}
