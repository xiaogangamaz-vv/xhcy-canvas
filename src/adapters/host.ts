import type { CanvasAsset, CanvasEdge, CanvasNode, CanvasViewport } from "@/domain/types"
export type { CanvasAsset, CanvasEdge, CanvasNode, CanvasViewport }

/** The document the host loads and saves in one batched write. */
export type CanvasDocument = {
  id: string
  projectId: string
  name: string
  viewport: CanvasViewport
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  assets: CanvasAsset[]
  revision: number
}

export type HostPort = {
  loadDocument(): Promise<CanvasDocument>
  /** Single batched save of the full graph, positions, edges, and viewport. */
  saveDocument(document: CanvasDocument): Promise<CanvasDocument>
  uploadAsset?(file: File): Promise<CanvasAsset>
}