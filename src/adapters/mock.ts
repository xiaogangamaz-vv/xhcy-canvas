import type { CanvasAsset, CanvasDocument, CanvasGenerationRequest, CanvasGenerationResult, HostPort } from "@/adapters/host"
import { listMockImageModels, listMockVideoModels } from "@/adapters/model-catalog"
import type { CanvasAssetKind } from "@/domain/types"

export const MOCK_PROJECT_ID = "local-project"
export const MOCK_CANVAS_ID = "local-canvas"
export const MOCK_OWNER_ID = "local"
export const MOCK_STORAGE_KEY = "xhcy-canvas.document"

function now() {
  return Date.now()
}

export function createEmptyDocument(): CanvasDocument {
  const timestamp = now()
  void timestamp
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

function parseAspect(ratio: string | undefined, fallback: { w: number; h: number }): { w: number; h: number } {
  const raw = (ratio || "").trim().toLowerCase()
  if (!raw || raw === "auto") return fallback
  const [a, b] = raw.split(":").map(Number)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return fallback
  return { w: a, h: b }
}

function placeholderSize(request: CanvasGenerationRequest): { width: number; height: number } {
  if (request.mediaType === "video") {
    const long = request.resolution === "1080p" ? 960 : 640
    const { w, h } = parseAspect(request.aspectRatio, { w: 16, h: 9 })
    return w >= h
      ? { width: long, height: Math.max(180, Math.round((long * h) / w)) }
      : { width: Math.max(180, Math.round((long * w) / h)), height: long }
  }
  const long = request.imageSize === "4K" ? 1024 : request.imageSize === "1K" ? 512 : 768
  const { w, h } = parseAspect(request.aspectRatio, { w: 1, h: 1 })
  return w >= h
    ? { width: long, height: Math.max(180, Math.round((long * h) / w)) }
    : { width: Math.max(180, Math.round((long * w) / h)), height: long }
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (context.measureText(next).width <= maxWidth) {
      current = next
      continue
    }
    if (current) lines.push(current)
    current = word
    if (lines.length >= maxLines) break
  }
  if (current && lines.length < maxLines) lines.push(current)
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    const last = lines[maxLines - 1]
    lines[maxLines - 1] = last.slice(0, Math.max(1, last.length - 1)) + "…"
  }
  return lines.length ? lines : [text.slice(0, 40)]
}

function renderPlaceholderDataUrl(request: CanvasGenerationRequest): { dataUrl: string; width: number; height: number } {
  const { width, height } = placeholderSize(request)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) {
    throw new Error("无法创建预览画布")
  }
  const gradient = context.createLinearGradient(0, 0, width, height)
  if (request.mediaType === "video") {
    gradient.addColorStop(0, "#1a1518")
    gradient.addColorStop(1, "#2a2230")
  } else {
    gradient.addColorStop(0, "#181715")
    gradient.addColorStop(1, "#2a2622")
  }
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)
  context.strokeStyle = "rgba(245,245,244,0.18)"
  context.lineWidth = 2
  context.strokeRect(16, 16, width - 32, height - 32)

  context.fillStyle = "rgba(245,245,244,0.88)"
  context.font = `600 ${Math.max(18, Math.round(width / 22))}px ui-sans-serif, system-ui, sans-serif`
  context.fillText(request.mediaType === "video" ? "Video Generator" : "Image Generator", 32, 56)

  context.fillStyle = "rgba(245,245,244,0.55)"
  context.font = `${Math.max(12, Math.round(width / 36))}px ui-sans-serif, system-ui, sans-serif`
  const meta = request.mediaType === "video"
    ? `${request.modelName || request.modelId}  ·  ${request.aspectRatio || "16:9"}  ·  ${request.resolution || "720p"}  ·  ${request.durationSeconds || "4"}s`
    : `${request.modelName || request.modelId}  ·  ${request.aspectRatio || "auto"}  ·  ${request.imageSize || "2K"}`
  context.fillText(meta, 32, 82)

  context.fillStyle = "rgba(245,245,244,0.82)"
  context.font = `${Math.max(16, Math.round(width / 28))}px ui-sans-serif, system-ui, sans-serif`
  const prompt = (request.prompt || "未填写提示词").trim()
  const lines = wrapText(context, prompt, width - 64, 5)
  lines.forEach((line, index) => {
    context.fillText(line, 32, 130 + index * Math.max(24, Math.round(width / 24)))
  })

  context.fillStyle = "rgba(245,245,244,0.4)"
  context.font = `${Math.max(11, Math.round(width / 42))}px ui-sans-serif, system-ui, sans-serif`
  context.fillText("Local mock preview", 32, height - 32)

  if (request.mediaType === "video") {
    const cx = width / 2
    const cy = height / 2 + 16
    const r = Math.min(width, height) / 10
    context.beginPath()
    context.arc(cx, cy, r, 0, Math.PI * 2)
    context.fillStyle = "rgba(0,0,0,0.45)"
    context.fill()
    context.beginPath()
    context.moveTo(cx - r * 0.25, cy - r * 0.4)
    context.lineTo(cx - r * 0.25, cy + r * 0.4)
    context.lineTo(cx + r * 0.45, cy)
    context.closePath()
    context.fillStyle = "rgba(245,245,244,0.9)"
    context.fill()
  }

  return { dataUrl: canvas.toDataURL("image/png"), width, height }
}

function delay(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function buildAsset(request: CanvasGenerationRequest, preview: { dataUrl: string; width: number; height: number }): CanvasAsset {
  const timestamp = now()
  const isVideo = request.mediaType === "video"
  return {
    id: crypto.randomUUID(),
    ownerId: MOCK_OWNER_ID,
    projectId: MOCK_PROJECT_ID,
    canvasId: MOCK_CANVAS_ID,
    type: isVideo ? "video" : "image",
    source: "generation",
    sourceTable: isVideo ? "video_assets" : "image_assets",
    title: (request.prompt || (isVideo ? "Video preview" : "Image preview")).slice(0, 80),
    mimeType: "image/png",
    size: Math.round(preview.dataUrl.length * 0.75),
    width: preview.width,
    height: preview.height,
    duration: isVideo ? Number(request.durationSeconds || "4") || 4 : null,
    status: "active",
    url: preview.dataUrl,
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
}

export function createMockHost(): HostPort {
  return {
    async loadDocument() {
      return readStoredDocument() ?? createEmptyDocument()
    },
    async saveDocument(document) {
      const next: CanvasDocument = {
        ...document,
        id: document.id || MOCK_CANVAS_ID,
        projectId: document.projectId || MOCK_PROJECT_ID,
        revision: (document.revision ?? 0) + 1,
      }
      writeStoredDocument(next)
      return next
    },
    async uploadAsset(file) {
      const kind = kindFromFile(file)
      const timestamp = now()
      const asset: CanvasAsset = {
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
        url: URL.createObjectURL(file),
        storageKey: null,
        metadata: { name: file.name, local: true },
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: null,
      }
      return asset
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
      // A short, bounded delay so the running state is visible, then a local preview.
      await delay(480)
      try {
        const preview = renderPlaceholderDataUrl(request)
        const asset = buildAsset(request, preview)
        return { status: "succeeded", asset, previewUrl: preview.dataUrl }
      } catch (error) {
        return { status: "failed", message: error instanceof Error ? error.message : "预览生成失败" }
      }
    },
  }
}
