import type { CanvasAsset, CanvasDocument, HostPort } from "@/adapters/host"
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
  }
}