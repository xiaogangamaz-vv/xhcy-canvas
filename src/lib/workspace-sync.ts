import type { CanvasAsset, CanvasDocument } from "@/adapters/host"

export const WORKSPACE_SYNC_BASE = "/__local"
export const WORKSPACE_WRITER_ID = createWriterId()

function createWriterId(): string {
  try {
    const key = "xhcy-canvas.writer-id"
    const existing = sessionStorage.getItem(key)
    if (existing) return existing
    const id = crypto.randomUUID()
    sessionStorage.setItem(key, id)
    return id
  } catch {
    return crypto.randomUUID()
  }
}

export type SyncClientProbe = {
  id: "claude" | "codex"
  available: boolean
  commandPath: string | null
  connected: boolean
  detail: string
}

export type WorkspaceSyncHealth = {
  ok: boolean
  dataDir: string
  repoRoot: string
  revision: number
  writerId: string | null
  updatedAt: number
  clients: Record<"claude" | "codex", SyncClientProbe>
}

export type WorkspaceSyncConfig = {
  cursorJson: string
  claudeJson: string
  codexJson: string
  codexToml: string
  npmScript: string
  dataDir: string
  repoRoot: string
  serverName: string
  guide: string
  clients: Record<"claude" | "codex", SyncClientProbe>
  devUrl: string
}

export type GenerationCommand = {
  id: string
  operationId: string
  type: "run_generation"
  nodeId: string
  createdAt: number
  status: "pending" | "running"
}

export type GenerationCommandLog = {
  pending: GenerationCommand[]
  results: Record<string, { operationId: string; status: "succeeded" | "failed"; assetId?: string; message?: string }>
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${WORKSPACE_SYNC_BASE}${path}`, {
    ...init,
    headers: {
      "X-Writer-Id": WORKSPACE_WRITER_ID,
      ...(init?.headers || {}),
    },
  })
}

export async function fetchSyncHealth(): Promise<WorkspaceSyncHealth | null> {
  try {
    const response = await request("/health")
    if (!response.ok) return null
    return await response.json() as WorkspaceSyncHealth
  } catch {
    return null
  }
}

export async function fetchSyncConfig(readOnly: boolean): Promise<WorkspaceSyncConfig | null> {
  try {
    const response = await request(`/config?readOnly=${readOnly ? "1" : "0"}`)
    if (!response.ok) return null
    return await response.json() as WorkspaceSyncConfig
  } catch {
    return null
  }
}

export async function connectExternalClient(id: "claude" | "codex", readOnly: boolean) {
  const response = await request(`/clients/${id}/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ readOnly }),
  })
  return await response.json() as { ok: boolean; message: string; probe?: SyncClientProbe }
}

export async function disconnectExternalClient(id: "claude" | "codex") {
  const response = await request(`/clients/${id}/disconnect`, {
    method: "POST",
  })
  return await response.json() as { ok: boolean; message: string; probe?: SyncClientProbe }
}

export async function pullWorkspaceDocument(): Promise<{ exists: boolean; document: CanvasDocument | null; meta?: { revision: number; writerId: string | null } } | null> {
  try {
    const response = await request("/document")
    if (!response.ok) return null
    return await response.json() as { exists: boolean; document: CanvasDocument | null; meta?: { revision: number; writerId: string | null } }
  } catch {
    return null
  }
}

export async function pushWorkspaceDocument(document: CanvasDocument): Promise<{
  ok: boolean
  conflict: boolean
  document: CanvasDocument | null
  revision?: number
}> {
  try {
    const response = await request("/document", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(document),
    })
    const body = await response.json() as { conflict?: boolean; document?: CanvasDocument }
    if (response.status === 409) {
      return { ok: false, conflict: true, document: body.document ?? null, revision: body.document?.revision }
    }
    if (!response.ok) return { ok: false, conflict: false, document: null }
    return { ok: true, conflict: false, document: body.document ?? document, revision: body.document?.revision }
  } catch {
    return { ok: false, conflict: false, document: null }
  }
}

export async function pullWorkspaceMedia(assetId: string): Promise<{ blob: Blob; mimeType: string } | null> {
  try {
    const response = await request(`/media/${encodeURIComponent(assetId)}`)
    if (!response.ok) return null
    const blob = await response.blob()
    return { blob, mimeType: response.headers.get("content-type") || blob.type || "application/octet-stream" }
  } catch {
    return null
  }
}

export async function pushWorkspaceMedia(input: {
  assetId: string
  blob: Blob
  mimeType?: string
  name?: string
  kind?: "media" | "poster"
}): Promise<boolean> {
  try {
    const response = await request(`/media/${encodeURIComponent(input.assetId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": input.mimeType || input.blob.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(input.name || input.assetId),
        ...(input.kind === "poster" ? { "X-Media-Kind": "poster" } : {}),
      },
      body: input.blob,
    })
    return response.ok
  } catch {
    return false
  }
}

export async function fetchGenerationCommands(): Promise<GenerationCommandLog | null> {
  try {
    const response = await request("/commands")
    if (!response.ok) return null
    return await response.json() as GenerationCommandLog
  } catch {
    return null
  }
}

export async function markGenerationCommandRunning(operationId: string): Promise<void> {
  try {
    await request(`/commands/${encodeURIComponent(operationId)}/running`, { method: "POST" })
  } catch {
    // the next poll can retry
  }
}

export async function completeGenerationCommand(operationId: string, result: {
  status: "succeeded" | "failed"
  assetId?: string
  message?: string
}): Promise<void> {
  try {
    await request(`/commands/${encodeURIComponent(operationId)}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    })
  } catch {
    // the MCP client will time out if this never lands
  }
}

export function dataUrlToRaw(dataUrl: string): { blob: Blob; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (!match) return null
  const mimeType = match[1] || "application/octet-stream"
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return { blob: new Blob([bytes], { type: mimeType }), mimeType }
}
