/**
 * Browser media cache for uploaded and generated blobs.
 *
 * The canvas graph stays in localStorage; this store only keeps the bytes so
 * previews survive a refresh without turning IndexedDB into the source of truth.
 */
const DB_NAME = "canvas-media-cache"
const DB_VERSION = 1
const STORE_NAME = "blobs"

export type CachedMediaRecord = {
  id: string
  blob: Blob
  mimeType: string
  name: string
  updatedAt: number
}

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== "undefined"
}

function openMediaCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("无法打开本地媒体缓存"))
  })
}

export function isEphemeralMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return url.startsWith("blob:")
}

export async function putCachedMedia(input: {
  id: string
  blob: Blob
  mimeType?: string
  name?: string
}): Promise<void> {
  if (!canUseIndexedDb()) return
  const db = await openMediaCache()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("无法写入本地媒体缓存"))
      tx.objectStore(STORE_NAME).put({
        id: input.id,
        blob: input.blob,
        mimeType: input.mimeType || input.blob.type || "application/octet-stream",
        name: input.name || "",
        updatedAt: Date.now(),
      } satisfies CachedMediaRecord)
    })
  } finally {
    db.close()
  }
}

export async function getCachedMedia(id: string): Promise<CachedMediaRecord | null> {
  if (!canUseIndexedDb() || !id) return null
  const db = await openMediaCache()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly")
      const request = tx.objectStore(STORE_NAME).get(id)
      request.onsuccess = () => resolve((request.result as CachedMediaRecord | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error("无法读取本地媒体缓存"))
    })
  } finally {
    db.close()
  }
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl)
  return response.blob()
}

export function blobToObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob)
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(reader.error ?? new Error("无法读取文件"))
    reader.readAsDataURL(blob)
  })
}

export function mediaLooksLikeVideo(url: string | null | undefined, mimeType?: string | null, kind?: string | null): boolean {
  if (kind === "video") return true
  if (mimeType && mimeType.startsWith("video/")) return true
  if (!url) return false
  return url.startsWith("data:video/") || /\.(mp4|webm|mov)(?:$|\?)/i.test(url)
}

export function mediaLooksLikeAudio(url: string | null | undefined, mimeType?: string | null, kind?: string | null): boolean {
  if (kind === "audio") return true
  if (mimeType && mimeType.startsWith("audio/")) return true
  if (!url) return false
  return url.startsWith("data:audio/") || /\.(mp3|wav|ogg|m4a)(?:$|\?)/i.test(url)
}
