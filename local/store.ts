import fs from "node:fs"
import path from "node:path"
import { ensureDir } from "./config.ts"
import {
  emptyDocument,
  isWorkspaceDocument,
  type CommandLog,
  type GenerationCommand,
  type GenerationCommandResult,
  type StoreMeta,
  type WorkspaceDocument,
  type WorkspaceOpRecord,
} from "./types.ts"

export type WorkspaceStore = {
  dataDir: string
  documentPath: string
  mediaDir: string
  opsPath: string
  commandsPath: string
  metaPath: string
}

type MediaMeta = {
  mimeType: string
  name: string
  size: number
  posterFile?: string
}

const EPHEMERAL_PREFIXES = ["blob:"]

function isEphemeralUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return EPHEMERAL_PREFIXES.some(prefix => url.startsWith(prefix))
}

function replaceFile(tmp: string, dest: string) {
  try {
    fs.renameSync(tmp, dest)
  } catch {
    fs.copyFileSync(tmp, dest)
    fs.unlinkSync(tmp)
  }
}

function writeJson(file: string, value: unknown) {
  ensureDir(path.dirname(file))
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  replaceFile(tmp, file)
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T
  } catch {
    return null
  }
}

export function createStore(dataDir: string): WorkspaceStore {
  const store: WorkspaceStore = {
    dataDir,
    documentPath: path.join(dataDir, "document.json"),
    mediaDir: path.join(dataDir, "media"),
    opsPath: path.join(dataDir, "ops.json"),
    commandsPath: path.join(dataDir, "commands.json"),
    metaPath: path.join(dataDir, "meta.json"),
  }
  ensureDir(store.dataDir)
  ensureDir(store.mediaDir)
  return store
}

export function sanitizeDocument(document: WorkspaceDocument): WorkspaceDocument {
  const assets = document.assets.map(asset => ({
    ...asset,
    url: isEphemeralUrl(asset.url) ? null : asset.url,
    metadata: compactMetadata(asset.metadata || {}),
  }))
  const nodes = document.nodes.map(node => {
    const params = { ...(node.params as Record<string, unknown>) }
    for (const key of ["url", "mediaUrl", "posterUrl"]) {
      const value = params[key]
      if (typeof value === "string" && isEphemeralUrl(value)) params[key] = ""
    }
    return {
      ...node,
      params,
      assetRefs: node.assetRefs.map(ref => ({
        ...ref,
        url: isEphemeralUrl(ref.url) ? null : ref.url,
      })),
    }
  })
  return { ...document, assets, nodes }
}

function compactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string" && value.startsWith("data:") && key !== "posterFile") {
      if (key === "fallbackDataUrl" && value.length <= 350_000) next[key] = value
      continue
    }
    next[key] = value
  }
  return next
}

export function readDocument(store: WorkspaceStore): WorkspaceDocument {
  const raw = readJson<unknown>(store.documentPath)
  if (isWorkspaceDocument(raw)) return raw
  return emptyDocument()
}

export function documentExists(store: WorkspaceStore): boolean {
  return fs.existsSync(store.documentPath)
}

export function writeDocument(store: WorkspaceStore, document: WorkspaceDocument, writerId: string | null): WorkspaceDocument {
  const next = sanitizeDocument(document)
  writeJson(store.documentPath, next)
  const meta: StoreMeta = { revision: next.revision, writerId, updatedAt: Date.now() }
  writeJson(store.metaPath, meta)
  return next
}

export function readMeta(store: WorkspaceStore): StoreMeta {
  return readJson<StoreMeta>(store.metaPath) || {
    revision: readDocument(store).revision,
    writerId: null,
    updatedAt: 0,
  }
}

export function readOps(store: WorkspaceStore): Record<string, WorkspaceOpRecord> {
  return readJson<Record<string, WorkspaceOpRecord>>(store.opsPath) || {}
}

export function rememberOp(store: WorkspaceStore, record: WorkspaceOpRecord) {
  const ops = readOps(store)
  ops[record.operationId] = record
  const ids = Object.keys(ops)
  if (ids.length > 400) {
    const trimmed = ids
      .map(id => ops[id])
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 200)
    const next: Record<string, WorkspaceOpRecord> = {}
    for (const item of trimmed) next[item.operationId] = item
    writeJson(store.opsPath, next)
    return
  }
  writeJson(store.opsPath, ops)
}

export function readCommands(store: WorkspaceStore): CommandLog {
  return readJson<CommandLog>(store.commandsPath) || { pending: [], results: {} }
}

export function writeCommands(store: WorkspaceStore, log: CommandLog) {
  const results = log.results
  const keys = Object.keys(results)
  if (keys.length > 200) {
    const kept = keys
      .map(key => results[key])
      .sort((a, b) => b.completedAt - a.completedAt)
      .slice(0, 100)
    const next: Record<string, GenerationCommandResult> = {}
    for (const item of kept) next[item.operationId] = item
    writeJson(store.commandsPath, { pending: log.pending, results: next })
    return
  }
  writeJson(store.commandsPath, log)
}

export function enqueueGeneration(store: WorkspaceStore, command: GenerationCommand): GenerationCommand {
  const log = readCommands(store)
  const existing = log.pending.find(item => item.operationId === command.operationId)
  if (existing) return existing
  if (log.results[command.operationId]) return command
  log.pending.push(command)
  writeCommands(store, log)
  return command
}

export function completeGeneration(store: WorkspaceStore, result: GenerationCommandResult) {
  const log = readCommands(store)
  log.pending = log.pending.filter(item => item.operationId !== result.operationId)
  log.results[result.operationId] = result
  writeCommands(store, log)
}

export function markGenerationRunning(store: WorkspaceStore, operationId: string) {
  const log = readCommands(store)
  log.pending = log.pending.map(item => item.operationId === operationId ? { ...item, status: "running" } : item)
  writeCommands(store, log)
}

export function mediaFile(store: WorkspaceStore, assetId: string): string {
  return path.join(store.mediaDir, encodeURIComponent(assetId))
}

export function mediaMetaFile(store: WorkspaceStore, assetId: string): string {
  return `${mediaFile(store, assetId)}.json`
}

export function writeMedia(store: WorkspaceStore, assetId: string, bytes: Buffer, meta: MediaMeta) {
  const file = mediaFile(store, assetId)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, bytes)
  replaceFile(tmp, file)
  writeJson(mediaMetaFile(store, assetId), meta)
}

export function readMedia(store: WorkspaceStore, assetId: string): { bytes: Buffer; meta: MediaMeta } | null {
  const file = mediaFile(store, assetId)
  if (!fs.existsSync(file)) return null
  const bytes = fs.readFileSync(file)
  const meta = readJson<MediaMeta>(mediaMetaFile(store, assetId)) || {
    mimeType: "application/octet-stream",
    name: assetId,
    size: bytes.length,
  }
  return { bytes, meta }
}

export function writePoster(store: WorkspaceStore, assetId: string, bytes: Buffer, mimeType: string) {
  const file = path.join(store.mediaDir, `${encodeURIComponent(assetId)}.poster`)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, bytes)
  replaceFile(tmp, file)
  const current = readJson<MediaMeta>(mediaMetaFile(store, assetId)) || { mimeType, name: assetId, size: 0 }
  writeJson(mediaMetaFile(store, assetId), { ...current, posterFile: `${encodeURIComponent(assetId)}.poster` })
}

export function readPoster(store: WorkspaceStore, assetId: string): { bytes: Buffer; mimeType: string } | null {
  const file = path.join(store.mediaDir, `${encodeURIComponent(assetId)}.poster`)
  if (!fs.existsSync(file)) return null
  return { bytes: fs.readFileSync(file), mimeType: "image/png" }
}

let lock: Promise<unknown> = Promise.resolve()

export function withStoreLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = lock.then(fn, fn)
  lock = run.then(() => undefined, () => undefined)
  return run
}
