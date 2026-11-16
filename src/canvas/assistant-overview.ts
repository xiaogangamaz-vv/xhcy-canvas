import type { CanvasDocument, CanvasNode } from "@/adapters/host"
import { CANVAS_NODE_REGISTRY } from "@/canvas/node-registry"
import type { CanvasNodeType } from "@/domain/types"

const SNIPPET_LIMIT = 80
const OVERVIEW_NODE_LIMIT = 40

export type CanvasOverviewNode = {
  id: string
  type: CanvasNodeType
  typeLabel: string
  title: string
  status: string
  snippet: string | null
}

export type CanvasOverview = {
  text: string
  canvasName: string
  nodeCount: number
  edgeCount: number
  assetCount: number
  selectedNodeId: string | null
  nodes: CanvasOverviewNode[]
}

function firstString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function snippetFromNode(node: CanvasNode): string | null {
  const params = node.params as Record<string, unknown>
  const candidates = [
    firstString(params.text),
    firstString(params.script),
    firstString(params.prompt),
    firstString(params.caption),
    firstString(params.dialogue),
    firstString(params.note),
    firstString(params.outline),
    firstString(params.negativePrompt),
  ]
  const found = candidates.find(Boolean) ?? null
  if (!found) return null
  const compact = found.replace(/\s+/g, " ").trim()
  if (compact.length <= SNIPPET_LIMIT) return compact
  return `${compact.slice(0, SNIPPET_LIMIT)}…`
}

export function describeCanvasNode(node: CanvasNode): CanvasOverviewNode {
  const type = node.type
  return {
    id: node.id,
    type,
    typeLabel: CANVAS_NODE_REGISTRY[type].label,
    title: node.title?.trim() || CANVAS_NODE_REGISTRY[type].label,
    status: node.status,
    snippet: snippetFromNode(node),
  }
}

export function collectPromptCandidates(document: CanvasDocument | null): CanvasOverviewNode[] {
  if (!document) return []
  return document.nodes
    .map(describeCanvasNode)
    .filter(node => Boolean(node.snippet) && (node.type === "generation" || node.type === "scene" || node.type === "script" || node.type === "text" || node.type === "previs"))
}

export function buildCanvasOverview(
  document: CanvasDocument | null,
  selectedNodeId?: string | null,
): CanvasOverview {
  if (!document) {
    return {
      text: "当前还没有加载画布，因此没有可读取的概览。",
      canvasName: "",
      nodeCount: 0,
      edgeCount: 0,
      assetCount: 0,
      selectedNodeId: selectedNodeId ?? null,
      nodes: [],
    }
  }

  const nodes = document.nodes.map(describeCanvasNode)
  const lines: string[] = []
  const canvasName = document.name?.trim() || "未命名画布"
  lines.push(`画布「${canvasName}」概览`)
  lines.push(`节点 ${document.nodes.length} 个，连线 ${document.edges.length} 条，素材 ${document.assets.length} 个。`)

  if (nodes.length === 0) {
    lines.push("画布上还没有节点。")
  } else {
    const counts = new Map<string, number>()
    for (const node of nodes) {
      counts.set(node.typeLabel, (counts.get(node.typeLabel) ?? 0) + 1)
    }
    lines.push(`类型分布：${[...counts.entries()].map(([label, count]) => `${label} ${count}`).join("，")}。`)
    const listed = nodes.slice(0, OVERVIEW_NODE_LIMIT)
    for (const node of listed) {
      const status = node.status !== "idle" ? `，状态 ${node.status}` : ""
      const snippet = node.snippet ? `：${node.snippet}` : ""
      lines.push(`- ${node.typeLabel}「${node.title}」${status}${snippet}`)
    }
    if (nodes.length > listed.length) {
      lines.push(`- 其余 ${nodes.length - listed.length} 个节点已省略。`)
    }
  }

  if (selectedNodeId) {
    const selected = nodes.find(node => node.id === selectedNodeId)
    if (selected) {
      lines.push(`当前选中：${selected.typeLabel}「${selected.title}」。`)
    }
  }

  return {
    text: lines.join("\n"),
    canvasName,
    nodeCount: document.nodes.length,
    edgeCount: document.edges.length,
    assetCount: document.assets.length,
    selectedNodeId: selectedNodeId ?? null,
    nodes,
  }
}
