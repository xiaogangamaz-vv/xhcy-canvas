import type { CanvasAsset, CanvasEdge, CanvasNode, CanvasViewport } from "@/domain/types"
import type { CanvasImageModelCatalog, CanvasVideoModelCatalog } from "@/adapters/model-catalog"

export type { CanvasAsset, CanvasEdge, CanvasNode, CanvasViewport }
export type { CanvasImageModelCatalog, CanvasVideoModelCatalog }

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

export type CanvasGenerationRequest = {
  nodeId: string
  mediaType: "image" | "video"
  prompt: string
  modelId: string
  modelName?: string
  aspectRatio: string
  imageSize?: string
  resolution?: string
  durationSeconds?: string
  generationCount?: number
  referenceUrls?: string[]
}

export type CanvasGenerationResult = {
  status: "succeeded" | "failed"
  asset?: CanvasAsset
  previewUrl?: string
  message?: string
}

export type HostPort = {
  loadDocument(): Promise<CanvasDocument>
  /** Single batched write of the full graph, positions, edges, and viewport. */
  saveDocument(document: CanvasDocument): Promise<CanvasDocument>
  uploadAsset?(file: File): Promise<CanvasAsset>
  listImageModels(): Promise<CanvasImageModelCatalog>
  listVideoModels(): Promise<CanvasVideoModelCatalog>
  runGeneration(request: CanvasGenerationRequest): Promise<CanvasGenerationResult>
}
