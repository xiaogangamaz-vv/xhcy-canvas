import type { CanvasAsset, CanvasDocument, CanvasGenerationRequest, CanvasGenerationResult, HostPort } from "@/adapters/host"
import { listMockImageModels, listMockVideoModels } from "@/adapters/model-catalog"
import { renderPlaceholderDataUrl, renderPlaceholderVideo } from "@/adapters/mock-preview"
import type { CanvasAssetKind, CanvasNode } from "@/domain/types"
import {
  blobToDataUrl,
  blobToObjectUrl,
  dataUrlToBlob,
  getCachedMedia,
  isEphemeralMediaUrl,
  putCachedMedia,
} from "@/lib/media-cache"
import {
  dataUrlToRaw,
  pullWorkspaceDocument,
  pullWorkspaceMedia,
  pushWorkspaceDocument,
  pushWorkspaceMedia,
} from "@/lib/workspace-sync"

export const MOCK_PROJECT_ID = "local-project"
export const MOCK_CANVAS_ID = "local-canvas"
export const MOCK_OWNER_ID = "local"
export const MOCK_STORAGE_KEY = "xhcy-canvas.document"
const SMALL_DATA_URL_LIMIT = 350_000

function now() {
  return Date.now()
}

export function createEmptyDocument(): CanvasDocument {
  return {
    id: MOCK_CANVAS_ID,
    projectId: MOCK_PROJECT_ID,
    name: "Canvas",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    assets: [],
    revision: 0,
  }
}

function isDocument(value: unknown): value is CanvasDocument {
  if (!value || typeof value !== "object") return false
  const doc = value as CanvasDocument
  return Array.isArray(doc.nodes) && Array.isArray(doc.edges) && typeof doc.id === "string"
}

function readStoredDocument(): CanvasDocument | null {
  if (typeof localStorage === "undefined") return null
  try {
    const raw = localStorage.getItem(MOCK_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return isDocument(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeStoredDocument(document: CanvasDocument) {
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(document))
}

function kindFromFile(file: File): CanvasAssetKind {
  const type = String(file.type || "").toLowerCase()
  if (type.startsWith("video/")) return "video"
  if (type.startsWith("audio/")) return "audio"
  if (type.startsWith("image/")) return "image"
  if (/\.(mp4|webm|mov)$/i.test(file.name)) return "video"
  if (/\.(mp3|wav|ogg|m4a)$/i.test(file.name)) return "audio"
  return "image"
}

function persistableUrl(url: string | null | undefined): string | null {
  if (!url || isEphemeralMediaUrl(url)) return null
  if (url.startsWith("data:") && url.length > SMALL_DATA_URL_LIMIT) return null
  return url
}

function cacheKeyForAsset(asset: CanvasAsset): string {
  return asset.storageKey || asset.id
}

async function cacheAssetBytes(asset: CanvasAsset, blob: Blob, name?: string): Promise<CanvasAsset> {
  const key = cacheKeyForAsset(asset)
  await putCachedMedia({ id: key, blob, mimeType: asset.mimeType || blob.type, name: name || asset.title })
  const previewUrl = blobToObjectUrl(blob)
  void pushWorkspaceMedia({
    assetId: asset.id,
    blob,
    mimeType: asset.mimeType || blob.type,
    name: name || asset.title,
  })
  const posterRaw = typeof asset.metadata?.posterDataUrl === "string" ? dataUrlToRaw(asset.metadata.posterDataUrl) : null
  if (posterRaw) {
    void pushWorkspaceMedia({
      assetId: asset.id,
      blob: posterRaw.blob,
      mimeType: posterRaw.mimeType,
      name: `${name || asset.title}-poster`,
      kind: "poster",
    })
  }
  const canEmbed = blob.type.startsWith("image/") && blob.size <= SMALL_DATA_URL_LIMIT
  let embedded: string | null = null
  if (canEmbed) {
    try { embedded = await blobToDataUrl(blob) } catch { embedded = null }
  }
  return {
    ...asset,
    url: previewUrl,
    storageKey: key,
    mimeType: asset.mimeType || blob.type || asset.mimeType,
    size: blob.size,
    metadata: { ...asset.metadata, cache: "idb", name: name || asset.title },
    ...(embedded ? { metadata: { ...asset.metadata, cache: "idb", name: name || asset.title, fallbackDataUrl: embedded } } : {}),
  }
}

function compactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata || {})) {
    if (typeof value === "string" && value.startsWith("data:") && (key !== "fallbackDataUrl" || value.length > SMALL_DATA_URL_LIMIT)) {
      if (key === "fallbackDataUrl" && value.length > SMALL_DATA_URL_LIMIT) continue
      if (key !== "fallbackDataUrl") continue
    }
    next[key] = value
  }
  return next
}

function sanitizeAsset(asset: CanvasAsset): CanvasAsset {
  const metadata = compactMetadata(asset.metadata || {})
  const fallback = typeof metadata.fallbackDataUrl === "string" ? metadata.fallbackDataUrl : null
  return {
    ...asset,
    url: persistableUrl(asset.url) || (fallback && fallback.length <= SMALL_DATA_URL_LIMIT ? fallback : null),
    metadata,
  }
}

function sanitizeNode(node: CanvasNode): CanvasNode {
  const params = { ...(node.params as Record<string, string>) }
  for (const key of ["url", "mediaUrl", "posterUrl"]) {
    if (key in params) params[key] = persistableUrl(params[key]) || ""
  }
  return {
    ...node,
    params,
    assetRefs: node.assetRefs.map(ref => ({ ...ref, url: persistableUrl(ref.url) })),
  } as CanvasNode
}

function sanitizeDocument(document: CanvasDocument): CanvasDocument {
  return {
    ...document,
    assets: document.assets.map(sanitizeAsset),
    nodes: document.nodes.map(sanitizeNode),
  }
}

function assignNodeMediaUrl(node: CanvasNode, asset: CanvasAsset): CanvasNode {
  const params = { ...(node.params as Record<string, string>) }
  if ("url" in params || node.type === "image" || node.type === "video" || node.type === "audio") {
    params.url = asset.url || params.url || ""
  }
  if ("mediaUrl" in params || node.type === "scene" || node.type === "character") {
    if (node.assetRefs.some(ref => ref.assetId === asset.id) || params.mediaUrl) {
      // fill only when this node already points at the asset or has a dead media url
      const metaId = (() => {
        try {
          const raw = params.mediaMeta ? JSON.parse(params.mediaMeta) as { assetId?: string } : null
          return raw?.assetId || ""
        } catch {
          return ""
        }
      })()
      if (metaId === asset.id || node.assetRefs.some(ref => ref.assetId === asset.id) || isEphemeralMediaUrl(params.mediaUrl) || !params.mediaUrl) {
        if (metaId === asset.id || node.assetRefs.some(ref => ref.assetId === asset.id)) {
          params.mediaUrl = asset.url || params.mediaUrl || ""
        }
      }
    }
  }
  const resultAssetId = params.resultAssetId
  return {
    ...node,
    params,
    assetRefs: node.assetRefs.map(ref => ref.assetId === asset.id ? { ...ref, url: asset.url } : { ...ref, url: isEphemeralMediaUrl(ref.url) ? null : ref.url }),
  } as CanvasNode
}

async function hydrateDocument(document: CanvasDocument): Promise<CanvasDocument> {
  const assets: CanvasAsset[] = []
  for (const asset of document.assets) {
    const key = cacheKeyForAsset(asset)
    const cached = await getCachedMedia(key)
    if (cached?.blob) {
      assets.push({
        ...asset,
        url: blobToObjectUrl(cached.blob),
        mimeType: asset.mimeType || cached.mimeType,
        storageKey: key,
      })
      continue
    }
    const fallback = typeof asset.metadata?.fallbackDataUrl === "string" ? asset.metadata.fallbackDataUrl : null
    if (fallback) {
      try {
        const blob = await dataUrlToBlob(fallback)
        await putCachedMedia({ id: key, blob, mimeType: blob.type || asset.mimeType || "image/png", name: asset.title })
        assets.push({ ...asset, url: blobToObjectUrl(blob), storageKey: key })
        continue
      } catch {
        assets.push({ ...asset, url: fallback })
        continue
      }
    }
    if (asset.url && asset.url.startsWith("data:")) {
      try {
        const blob = await dataUrlToBlob(asset.url)
        await putCachedMedia({ id: key, blob, mimeType: blob.type || asset.mimeType || "application/octet-stream", name: asset.title })
        assets.push({ ...asset, url: blobToObjectUrl(blob), storageKey: key })
        continue
      } catch {
        assets.push(asset)
        continue
      }
    }
    const remoteMedia = await pullWorkspaceMedia(asset.id)
    if (remoteMedia?.blob) {
      await putCachedMedia({ id: key, blob: remoteMedia.blob, mimeType: remoteMedia.mimeType, name: asset.title })
      assets.push({
        ...asset,
        url: blobToObjectUrl(remoteMedia.blob),
        mimeType: asset.mimeType || remoteMedia.mimeType,
        storageKey: key,
      })
      continue
    }
    assets.push({
      ...asset,
      url: isEphemeralMediaUrl(asset.url) ? null : asset.url,
    })
  }

  const assetById = new Map(assets.map(asset => [asset.id, asset]))
  const nodes = document.nodes.map(node => {
    let next = node
    for (const ref of node.assetRefs) {
      const asset = assetById.get(ref.assetId)
      if (asset) next = assignNodeMediaUrl(next, asset)
    }
    const params = next.params as Record<string, string>
    const resultId = params.resultAssetId
    if (resultId && assetById.get(resultId)) next = assignNodeMediaUrl(next, assetById.get(resultId)!)
    try {
      const raw = params.mediaMeta ? JSON.parse(params.mediaMeta) as { assetId?: string } : null
      if (raw?.assetId && assetById.get(raw.assetId)) next = assignNodeMediaUrl(next, assetById.get(raw.assetId)!)
    } catch {
      // ignore malformed media meta
    }
    return next
  })

  return { ...document, assets, nodes }
}

function delay(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

async function cacheGenerationAsset(request: CanvasGenerationRequest): Promise<CanvasAsset> {
  const timestamp = now()
  const isVideo = request.mediaType === "video"
  const base: CanvasAsset = {
    id: crypto.randomUUID(),
    ownerId: MOCK_OWNER_ID,
    projectId: MOCK_PROJECT_ID,
    canvasId: MOCK_CANVAS_ID,
    type: isVideo ? "video" : "image",
    source: "generation",
    sourceTable: isVideo ? "video_assets" : "image_assets",
    title: (request.prompt || (isVideo ? "Video preview" : "Image preview")).slice(0, 80),
    mimeType: isVideo ? "video/webm" : "image/png",
    size: 0,
    width: null,
    height: null,
    duration: isVideo ? Number(request.durationSeconds || "4") || 4 : null,
    status: "active",
    url: null,
    storageKey: null,
    metadata: {
      local: true,
      mock: true,
      modelId: request.modelId,
      aspectRatio: request.aspectRatio,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
  }

  if (isVideo) {
    try {
      const video = await renderPlaceholderVideo(request)
      const asset = await cacheAssetBytes({
        ...base,
        mimeType: video.mimeType,
        width: video.width,
        height: video.height,
        duration: video.duration,
        metadata: { ...base.metadata, posterDataUrl: video.posterDataUrl, playable: true },
      }, video.blob, base.title)
      return asset
    } catch (error) {
      const preview = renderPlaceholderDataUrl(request)
      const blob = await dataUrlToBlob(preview.dataUrl)
      const asset = await cacheAssetBytes({
        ...base,
        type: "video",
        mimeType: "image/png",
        width: preview.width,
        height: preview.height,
        metadata: {
          ...base.metadata,
          playable: false,
          posterOnly: true,
          reason: error instanceof Error ? error.message : "本地视频封装失败",
        },
      }, blob, base.title)
      return asset
    }
  }

  const preview = renderPlaceholderDataUrl(request)
  const blob = await dataUrlToBlob(preview.dataUrl)
  return cacheAssetBytes({
    ...base,
    mimeType: "image/png",
    width: preview.width,
    height: preview.height,
  }, blob, base.title)
}

export function createMockHost(): HostPort {
  return {
    async loadDocument() {
      const stored = readStoredDocument()
      const remote = await pullWorkspaceDocument()
      let chosen = stored ?? createEmptyDocument()
      if (remote?.document) {
        if (!stored || (remote.document.revision ?? 0) >= (stored.revision ?? 0)) {
          chosen = remote.document
        } else {
          await pushWorkspaceDocument(sanitizeDocument(stored))
        }
      } else if (stored) {
        await pushWorkspaceDocument(sanitizeDocument(stored))
      }
      return hydrateDocument(chosen)
    },
    async saveDocument(document) {
      const next: CanvasDocument = {
        ...document,
        id: document.id || MOCK_CANVAS_ID,
        projectId: document.projectId || MOCK_PROJECT_ID,
        revision: (document.revision ?? 0) + 1,
      }
      try {
        writeStoredDocument(sanitizeDocument(next))
      } catch {
        writeStoredDocument(sanitizeDocument({
          ...next,
          assets: next.assets.map(asset => ({ ...sanitizeAsset(asset), url: null })),
        }))
      }
      const pushed = await pushWorkspaceDocument(sanitizeDocument(next))
      if (pushed.conflict && pushed.document) {
        return hydrateDocument(pushed.document)
      }
      return next
    },
    async uploadAsset(file) {
      const kind = kindFromFile(file)
      const timestamp = now()
      const draft: CanvasAsset = {
        id: crypto.randomUUID(),
        ownerId: MOCK_OWNER_ID,
        projectId: MOCK_PROJECT_ID,
        canvasId: MOCK_CANVAS_ID,
        type: kind,
        source: "upload",
        sourceTable: "external",
        title: file.name || "untitled",
        mimeType: file.type || null,
        size: file.size,
        width: null,
        height: null,
        duration: null,
        status: "active",
        url: null,
        storageKey: null,
        metadata: { name: file.name, local: true },
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: null,
      }
      return cacheAssetBytes(draft, file, file.name)
    },
    async listImageModels() {
      return listMockImageModels()
    },
    async listVideoModels() {
      return listMockVideoModels()
    },
    async runGeneration(request) {
      const prompt = (request.prompt || "").trim()
      if (!prompt) {
        return { status: "failed", message: "请先填写提示词" }
      }
      if (!request.modelId) {
        return { status: "failed", message: "请选择一个模型" }
      }
      await delay(480)
      try {
        const asset = await cacheGenerationAsset(request)
        return { status: "succeeded", asset, previewUrl: asset.url || undefined }
      } catch (error) {
        return { status: "failed", message: error instanceof Error ? error.message : "预览生成失败" }
      }
    },
  }
}
export async function hydrateCanvasDocument(document: CanvasDocument): Promise<CanvasDocument> {
  return hydrateDocument(document)
}
