import type { IncomingMessage, ServerResponse } from "node:http"
import { defaultDataDir, defaultRepoRoot, DEFAULT_SYNC_PREFIXES, MAX_MEDIA_BYTES } from "./config.ts"
import { CANVAS_USAGE_GUIDE } from "./guide.ts"
import { connectExternalClient, disconnectExternalClient, probeExternalClients, type ExternalClientId } from "./client-bridge.ts"
import { buildLaunchConfig, formatConfigBundle } from "./mcp-config.ts"
import {
  completeGeneration,
  createStore,
  documentExists,
  markGenerationRunning,
  readCommands,
  readDocument,
  readMedia,
  readMeta,
  readPoster,
  writeDocument,
  writeMedia,
  writePoster,
  withStoreLock,
} from "./store.ts"
import {
  configureGenerator,
  createEdge,
  createNode,
  deleteEdge,
  deleteNode,
  queueGeneration,
  rememberGenerationResult,
  summarizeDocument,
  updateNode,
} from "./document-ops.ts"
import { isWorkspaceDocument, type GenerationCommandResult } from "./types.ts"
import { proxySiteRequest, publicSiteConfig, readStoredSiteConfig, writeStoredSiteConfig } from "./site-config.ts"

const WRITER_HEADER = "x-writer-id"

type SyncContext = {
  repoRoot: string
  store: ReturnType<typeof createStore>
}

export function createSyncContext(repoRoot = defaultRepoRoot()): SyncContext {
  return {
    repoRoot,
    store: createStore(defaultDataDir(repoRoot)),
  }
}

export function isSyncPath(pathname: string): boolean {
  return DEFAULT_SYNC_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function stripPrefix(pathname: string): string {
  for (const prefix of DEFAULT_SYNC_PREFIXES) {
    if (pathname === prefix) return "/"
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length)
  }
  return pathname
}

function isLocalRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress || ""
  const local = remote === "127.0.0.1"
    || remote === "::1"
    || remote === "::ffff:127.0.0.1"
    || remote === "localhost"
  if (!local) return false
  const host = String(req.headers.host || "").split(":")[0]
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]"
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = `${JSON.stringify(body)}\n`
  res.statusCode = status
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.setHeader("Cache-Control", "no-store")
  res.end(payload)
}

function sendError(res: ServerResponse, status: number, message: string, code = "error") {
  sendJson(res, status, { error: message, code })
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > limit) throw new Error("payload_too_large")
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function readJsonBody(req: IncomingMessage, limit = 8_000_000): Promise<unknown> {
  const raw = await readBody(req, limit)
  if (!raw.length) return {}
  return JSON.parse(raw.toString("utf8"))
}

function launchFrom(ctx: SyncContext, readOnly: boolean) {
  return buildLaunchConfig({
    repoRoot: ctx.repoRoot,
    dataDir: ctx.store.dataDir,
    readOnly,
  })
}

export async function handleSyncRequest(ctx: SyncContext, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url || "/", "http://127.0.0.1")
  if (!isSyncPath(url.pathname)) return false
  if (!isLocalRequest(req)) {
    sendError(res, 403, "本地同步服务只接受本机请求", "forbidden")
    return true
  }

  const route = stripPrefix(url.pathname)
  const method = (req.method || "GET").toUpperCase()
  try {
    if (route === "/site-config" && method === "GET") {
      sendJson(res, 200, publicSiteConfig(readStoredSiteConfig(ctx.repoRoot)))
      return true
    }

    if (route === "/site-config" && method === "PUT") {
      const body = await readJsonBody(req, 32_000) as Record<string, unknown>
      try {
        const saved = writeStoredSiteConfig(ctx.repoRoot, {
          baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
          token: typeof body.token === "string" ? body.token : undefined,
          clearToken: body.clearToken === true,
        })
        sendJson(res, 200, publicSiteConfig(saved))
      } catch (error) {
        sendError(res, 400, error instanceof Error ? error.message : "无效的网站配置", "invalid_config")
      }
      return true
    }

    if (route.startsWith("/site-api/")) {
      const rest = route.slice("/site-api".length) + url.search
      await proxySiteRequest(ctx.repoRoot, req, res, rest)
      return true
    }

    if (route === "/health" && method === "GET") {
      const meta = readMeta(ctx.store)
      const readOnly = url.searchParams.get("readOnly") === "1"
      const launch = launchFrom(ctx, readOnly)
      sendJson(res, 200, {
        ok: true,
        dataDir: ctx.store.dataDir,
        repoRoot: ctx.repoRoot,
        revision: meta.revision,
        writerId: meta.writerId,
        updatedAt: meta.updatedAt,
        clients: probeExternalClients(launch),
      })
      return true
    }

    if (route === "/config" && method === "GET") {
      const readOnly = url.searchParams.get("readOnly") === "1"
      const launch = launchFrom(ctx, readOnly)
      sendJson(res, 200, {
        ...formatConfigBundle(launch, readOnly),
        dataDir: ctx.store.dataDir,
        repoRoot: ctx.repoRoot,
        serverName: launch.name,
        launch,
        guide: CANVAS_USAGE_GUIDE,
        clients: probeExternalClients(launch),
        devUrl: "http://127.0.0.1:5173/canvas/",
      })
      return true
    }

    if (route === "/guide" && method === "GET") {
      sendJson(res, 200, { guide: CANVAS_USAGE_GUIDE })
      return true
    }

    if (route === "/document" && method === "GET") {
      if (!documentExists(ctx.store)) {
        sendJson(res, 200, { exists: false, document: null, meta: readMeta(ctx.store) })
        return true
      }
      const document = readDocument(ctx.store)
      sendJson(res, 200, { exists: true, document, meta: readMeta(ctx.store) })
      return true
    }

    if (route === "/document" && method === "PUT") {
      const body = await readJsonBody(req)
      const writerId = headerValue(req, WRITER_HEADER)
      const incoming = isWorkspaceDocument(body) ? body : isWorkspaceDocument((body as { document?: unknown }).document)
        ? (body as { document: import("./types.ts").WorkspaceDocument }).document
        : null
      if (!incoming) {
        sendError(res, 400, "无效的画布文档", "invalid_document")
        return true
      }
      const result = await withStoreLock(() => {
        const current = documentExists(ctx.store) ? readDocument(ctx.store) : null
        if (current && incoming.revision < current.revision) {
          return { conflict: true, document: current, meta: readMeta(ctx.store) }
        }
        const saved = writeDocument(ctx.store, incoming, writerId)
        return { conflict: false, document: saved, meta: readMeta(ctx.store) }
      })
      sendJson(res, result.conflict ? 409 : 200, result)
      return true
    }

    if (route.startsWith("/media/") && method === "GET") {
      const assetId = decodeURIComponent(route.slice("/media/".length))
      if (!assetId || assetId.includes("..") || assetId.includes("/") || assetId.includes("\\")) {
        sendError(res, 400, "无效的素材 id", "invalid_id")
        return true
      }
      const poster = url.searchParams.get("poster") === "1"
      if (poster) {
        const data = readPoster(ctx.store, assetId)
        if (!data) {
          sendError(res, 404, "没有可用的封面帧", "not_found")
          return true
        }
        res.statusCode = 200
        res.setHeader("Content-Type", data.mimeType)
        res.setHeader("Cache-Control", "no-store")
        res.end(data.bytes)
        return true
      }
      const data = readMedia(ctx.store, assetId)
      if (!data) {
        sendError(res, 404, "素材文件不存在", "not_found")
        return true
      }
      res.statusCode = 200
      res.setHeader("Content-Type", data.meta.mimeType || "application/octet-stream")
      res.setHeader("Cache-Control", "no-store")
      res.end(data.bytes)
      return true
    }

    if (route.startsWith("/media/") && method === "PUT") {
      const assetId = decodeURIComponent(route.slice("/media/".length))
      if (!assetId || assetId.includes("..") || assetId.includes("/") || assetId.includes("\\")) {
        sendError(res, 400, "无效的素材 id", "invalid_id")
        return true
      }
      const bytes = await readBody(req, MAX_MEDIA_BYTES)
      const mimeType = headerValue(req, "content-type") || "application/octet-stream"
      const name = decodeURIComponent(headerValue(req, "x-file-name") || assetId)
      const kind = headerValue(req, "x-media-kind")
      if (kind === "poster") {
        writePoster(ctx.store, assetId, bytes, mimeType)
        sendJson(res, 200, { ok: true, poster: true, size: bytes.length })
        return true
      }
      writeMedia(ctx.store, assetId, bytes, { mimeType, name, size: bytes.length })
      sendJson(res, 200, { ok: true, size: bytes.length })
      return true
    }

    if (route === "/commands" && method === "GET") {
      sendJson(res, 200, readCommands(ctx.store))
      return true
    }

    if (route.startsWith("/commands/") && route.endsWith("/running") && method === "POST") {
      const operationId = decodeURIComponent(route.slice("/commands/".length, -"/running".length))
      markGenerationRunning(ctx.store, operationId)
      sendJson(res, 200, { ok: true })
      return true
    }

    if (route.startsWith("/commands/") && route.endsWith("/complete") && method === "POST") {
      const operationId = decodeURIComponent(route.slice("/commands/".length, -"/complete".length))
      const body = await readJsonBody(req) as Partial<GenerationCommandResult>
      const result: GenerationCommandResult = {
        operationId,
        status: body.status === "succeeded" ? "succeeded" : "failed",
        assetId: body.assetId,
        message: body.message,
        completedAt: Date.now(),
      }
      completeGeneration(ctx.store, result)
      rememberGenerationResult(ctx.store, operationId, result)
      sendJson(res, 200, { ok: true, result })
      return true
    }

    if (route === "/ops" && method === "POST") {
      const body = await readJsonBody(req) as Record<string, unknown>
      const writerId = headerValue(req, WRITER_HEADER) || "mcp"
      const result = await withStoreLock(() => dispatchOp(ctx, body, writerId))
      const failed = result && typeof result === "object" && "error" in result
      sendJson(res, failed ? 400 : 200, result)
      return true
    }

    if (route.startsWith("/clients/") && route.endsWith("/connect") && method === "POST") {
      const id = route.slice("/clients/".length, -"/connect".length)
      if (id !== "claude" && id !== "codex") {
        sendError(res, 400, "只支持 claude 或 codex 的一键接入", "invalid_client")
        return true
      }
      const body = await readJsonBody(req) as { readOnly?: boolean }
      const launch = launchFrom(ctx, Boolean(body.readOnly))
      const result = connectExternalClient(id as ExternalClientId, launch, Boolean(body.readOnly))
      sendJson(res, result.ok ? 200 : 400, result)
      return true
    }

    if (route.startsWith("/clients/") && route.endsWith("/disconnect") && method === "POST") {
      const id = route.slice("/clients/".length, -"/disconnect".length)
      if (id !== "claude" && id !== "codex") {
        sendError(res, 400, "只支持 claude 或 codex 的断开", "invalid_client")
        return true
      }
      const launch = launchFrom(ctx, false)
      const result = disconnectExternalClient(id as ExternalClientId, launch)
      sendJson(res, result.ok ? 200 : 400, result)
      return true
    }

    sendError(res, 404, "未知的本地同步接口", "not_found")
    return true
  } catch (error) {
    if (error instanceof Error && error.message === "payload_too_large") {
      sendError(res, 413, "请求体过大", "payload_too_large")
      return true
    }
    sendError(res, 500, error instanceof Error ? error.message : "本地同步服务出错", "internal")
    return true
  }
}

function headerValue(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  if (Array.isArray(value)) return value[0] || ""
  return value || ""
}

function dispatchOp(ctx: SyncContext, body: Record<string, unknown>, writerId: string) {
  const operationId = String(body.operationId || "").trim()
  const type = String(body.type || "").trim()
  if (!operationId) return { error: "缺少 operationId", code: "missing_operation_id" }
  const store = ctx.store
  switch (type) {
    case "create_node":
      return createNode(store, { operationId, type: String(body.nodeType || body.kind || ""), title: body.title as string | undefined, x: num(body.x), y: num(body.y), width: num(body.width), height: num(body.height), params: asRecord(body.params) }, writerId)
    case "update_node":
      return updateNode(store, { operationId, nodeId: String(body.nodeId || ""), title: body.title as string | undefined, x: num(body.x), y: num(body.y), width: num(body.width), height: num(body.height), status: body.status as never, params: asRecord(body.params) }, writerId)
    case "delete_node":
      return deleteNode(store, { operationId, nodeId: String(body.nodeId || "") }, writerId)
    case "create_edge":
      return createEdge(store, { operationId, sourceNodeId: String(body.sourceNodeId || ""), targetNodeId: String(body.targetNodeId || ""), sourceHandle: (body.sourceHandle as string | null | undefined) ?? null, targetHandle: (body.targetHandle as string | null | undefined) ?? null }, writerId)
    case "delete_edge":
      return deleteEdge(store, { operationId, edgeId: String(body.edgeId || "") }, writerId)
    case "configure_generator":
      return configureGenerator(store, {
        operationId,
        nodeId: String(body.nodeId || ""),
        prompt: body.prompt as string | undefined,
        aspectRatio: body.aspectRatio as string | undefined,
        imageSize: body.imageSize as string | undefined,
        resolution: body.resolution as string | undefined,
        durationSeconds: body.durationSeconds as string | undefined,
        modelId: body.modelId as string | undefined,
        mediaType: body.mediaType === "video" || body.mediaType === "image" ? body.mediaType : undefined,
        negativePrompt: body.negativePrompt as string | undefined,
      }, writerId)
    case "run_generation":
      return queueGeneration(store, { operationId, nodeId: String(body.nodeId || "") }, writerId)
    default:
      return { error: "未知的操作类型", code: "invalid_op" }
  }
}

function num(value: unknown): number | undefined {
  if (value == null || value === "") return undefined
  const next = Number(value)
  return Number.isFinite(next) ? next : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
