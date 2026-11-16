import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { defaultDataDir, defaultRepoRoot, defaultSyncUrl, isReadOnlyRequest, MAX_MULTIMODAL_BYTES, SERVER_NAME, SERVER_VERSION } from "./config.ts"
import { CANVAS_USAGE_GUIDE } from "./guide.ts"
import { createStore, readDocument, readMedia, readPoster } from "./store.ts"
import { summarizeDocument } from "./document-ops.ts"
import type { WorkspaceAsset, WorkspaceDocument } from "./types.ts"

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }

const syncUrl = defaultSyncUrl().replace(/\/$/, "")
const writerId = `mcp-${process.pid}`
const readOnly = isReadOnlyRequest()
const store = createStore(defaultDataDir(defaultRepoRoot()))

async function syncRequest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${syncUrl}${path}`, {
    ...init,
    headers: {
      "X-Writer-Id": writerId,
      ...(init?.headers || {}),
    },
  })
}

async function requireSync(): Promise<void> {
  try {
    const response = await syncRequest("/health")
    if (!response.ok) throw new Error(`同步服务返回 ${response.status}`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`无法连接本地画布同步服务（${syncUrl}）。请先运行画布开发服务后再试。${detail}`)
  }
}

async function loadDocument(): Promise<WorkspaceDocument> {
  try {
    const response = await syncRequest("/document")
    if (response.ok) {
      const body = await response.json() as { exists?: boolean; document?: WorkspaceDocument | null }
      if (body.document) return body.document
    }
  } catch {
    // fall back to the on-disk copy if the dev server is mid-reload
  }
  return readDocument(store)
}

async function postOp(payload: Record<string, unknown>): Promise<unknown> {
  await requireSync()
  const response = await syncRequest("/ops", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const body = await response.json() as unknown
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body
      ? String((body as { error: unknown }).error)
      : `同步服务返回 ${response.status}`
    throw new Error(message)
  }
  return body
}

function textResult(payload: unknown, extra: ContentBlock[] = []) {
  return {
    content: [
      { type: "text" as const, text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) },
      ...extra,
    ],
  }
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: "text" as const, text: message }], isError: true }
}

function guessMime(asset: WorkspaceAsset, fallback = "application/octet-stream"): string {
  return asset.mimeType || fallback
}

async function readAssetBytes(assetId: string, poster = false): Promise<{ bytes: Buffer; mimeType: string } | null> {
  try {
    const response = await syncRequest(`/media/${encodeURIComponent(assetId)}${poster ? "?poster=1" : ""}`)
    if (response.ok) {
      const mimeType = response.headers.get("content-type") || (poster ? "image/png" : "application/octet-stream")
      const bytes = Buffer.from(await response.arrayBuffer())
      return { bytes, mimeType }
    }
  } catch {
    // use local files when the HTTP media route is unavailable
  }
  if (poster) {
    const local = readPoster(store, assetId)
    return local
  }
  const local = readMedia(store, assetId)
  return local ? { bytes: local.bytes, mimeType: local.meta.mimeType } : null
}

function posterFromMetadata(asset: WorkspaceAsset): { bytes: Buffer; mimeType: string } | null {
  const raw = asset.metadata?.posterDataUrl
  if (typeof raw !== "string" || !raw.startsWith("data:")) return null
  const match = /^data:([^;]+);base64,(.+)$/.exec(raw)
  if (!match) return null
  return { bytes: Buffer.from(match[2], "base64"), mimeType: match[1] || "image/png" }
}

async function assetContent(asset: WorkspaceAsset): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = []
  const summary = {
    id: asset.id,
    type: asset.type,
    title: asset.title,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
    size: asset.size,
  }

  if (asset.type === "image") {
    const media = await readAssetBytes(asset.id)
    if (media && media.bytes.length <= MAX_MULTIMODAL_BYTES) {
      blocks.push({ type: "text", text: JSON.stringify(summary, null, 2) })
      blocks.push({ type: "image", data: media.bytes.toString("base64"), mimeType: guessMime(asset, media.mimeType) })
      return blocks
    }
    blocks.push({
      type: "text",
      text: `${JSON.stringify(summary, null, 2)}\n${media ? "图片超过多模态返回上限，已省略二进制内容。" : "没有在本地找到这张图片的文件。"}`,
    })
    return blocks
  }

  if (asset.type === "audio") {
    const media = await readAssetBytes(asset.id)
    if (media && media.bytes.length <= MAX_MULTIMODAL_BYTES) {
      blocks.push({ type: "text", text: JSON.stringify(summary, null, 2) })
      blocks.push({ type: "audio", data: media.bytes.toString("base64"), mimeType: guessMime(asset, media.mimeType) })
      return blocks
    }
    blocks.push({
      type: "text",
      text: `${JSON.stringify(summary, null, 2)}\n${media ? "音频超过多模态返回上限，已省略二进制内容。" : "没有在本地找到这份音频的文件。"}`,
    })
    return blocks
  }

  if (asset.type === "video") {
    const poster = await readAssetBytes(asset.id, true) || posterFromMetadata(asset)
    const note = "视频不会以完整二进制返回。下面是素材说明，以及在可用时提供的封面帧。"
    blocks.push({ type: "text", text: `${note}\n${JSON.stringify(summary, null, 2)}` })
    if (poster && poster.bytes.length <= MAX_MULTIMODAL_BYTES) {
      blocks.push({ type: "image", data: poster.bytes.toString("base64"), mimeType: poster.mimeType || "image/png" })
    }
    return blocks
  }

  blocks.push({ type: "text", text: JSON.stringify(summary, null, 2) })
  return blocks
}

async function waitForGeneration(operationId: string, timeoutMs = 45000): Promise<unknown> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const response = await syncRequest("/commands")
    if (response.ok) {
      const log = await response.json() as { results?: Record<string, unknown> }
      const result = log.results?.[operationId]
      if (result) return result
    }
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  throw new Error("等待本地预览生成超时。请确认画布页面已打开，且开发服务仍在运行。")
}

const operationId = z.string().trim().min(1).max(160).describe("幂等键。相同值的重复提交会返回第一次的结果。")

function registerReadTools(server: McpServer) {
  server.registerTool("canvas_guide", {
    title: "画布使用说明",
    description: "读取当前本地画布的 MCP 使用说明。开始操作前建议先看一遍。",
  }, async () => textResult(CANVAS_USAGE_GUIDE))

  server.registerTool("canvas_overview", {
    title: "画布概览",
    description: "读取当前本地工作区画布的概览，包括节点、连线和素材摘要。",
  }, async () => {
    const document = await loadDocument()
    return textResult(summarizeDocument(document))
  })

  server.registerTool("canvas_get_node", {
    title: "读取节点",
    description: "按 id 读取一个完整节点，包括参数、尺寸和关联素材。",
    inputSchema: { nodeId: z.string().trim().min(1).max(160) },
  }, async ({ nodeId }) => {
    const document = await loadDocument()
    const node = document.nodes.find(item => item.id === nodeId)
    if (!node) return errorResult("节点不存在")
    const assets = document.assets.filter(asset => node.assetRefs.some(ref => ref.assetId === asset.id) || node.params.resultAssetId === asset.id)
    return textResult({ node, assets: assets.map(asset => ({ id: asset.id, type: asset.type, title: asset.title, mimeType: asset.mimeType })) })
  })

  server.registerTool("canvas_get_asset", {
    title: "查看素材",
    description: "查看一个素材。图片和音频以多模态内容块返回；视频只返回说明和封面帧。",
    inputSchema: { assetId: z.string().trim().min(1).max(160) },
  }, async ({ assetId }) => {
    const document = await loadDocument()
    const asset = document.assets.find(item => item.id === assetId)
    if (!asset) return errorResult("素材不存在")
    return { content: await assetContent(asset) }
  })
}

function registerWriteTools(server: McpServer) {
  server.registerTool("canvas_create_node", {
    title: "创建节点",
    description: "在当前画布创建节点。支持 text、image、video、audio、script、scene、character、group、storyboard、generation、previs。",
    inputSchema: {
      operationId,
      type: z.enum(["text", "image", "video", "audio", "script", "scene", "character", "group", "storyboard", "generation", "previs"]),
      title: z.string().trim().min(1).max(120).optional(),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      width: z.number().finite().optional(),
      height: z.number().finite().optional(),
      params: z.record(z.string(), z.unknown()).optional(),
    },
  }, async (input) => textResult(await postOp({ ...input, type: "create_node", nodeType: input.type })))

  server.registerTool("canvas_update_node", {
    title: "更新节点",
    description: "按 id 更新节点标题、位置、尺寸、状态或参数。",
    inputSchema: {
      operationId,
      nodeId: z.string().trim().min(1).max(160),
      title: z.string().trim().min(1).max(120).optional(),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      width: z.number().finite().optional(),
      height: z.number().finite().optional(),
      status: z.enum(["idle", "running", "succeeded", "failed"]).optional(),
      params: z.record(z.string(), z.unknown()).optional(),
    },
  }, async (input) => textResult(await postOp({ ...input, type: "update_node" })))

  server.registerTool("canvas_delete_node", {
    title: "删除节点",
    description: "按 id 删除节点，并移除与它相关的连线。",
    inputSchema: {
      operationId,
      nodeId: z.string().trim().min(1).max(160),
    },
  }, async (input) => textResult(await postOp({ ...input, type: "delete_node" })))

  server.registerTool("canvas_create_edge", {
    title: "创建连线",
    description: "在两个节点之间创建连线。会校验连接规则并拒绝成环。",
    inputSchema: {
      operationId,
      sourceNodeId: z.string().trim().min(1).max(160),
      targetNodeId: z.string().trim().min(1).max(160),
      sourceHandle: z.string().trim().max(80).nullable().optional(),
      targetHandle: z.string().trim().max(80).nullable().optional(),
    },
  }, async (input) => textResult(await postOp({ ...input, type: "create_edge" })))

  server.registerTool("canvas_delete_edge", {
    title: "删除连线",
    description: "按 id 删除一条连线。",
    inputSchema: {
      operationId,
      edgeId: z.string().trim().min(1).max(160),
    },
  }, async (input) => textResult(await postOp({ ...input, type: "delete_edge" })))

  server.registerTool("canvas_configure_generator", {
    title: "配置生成节点",
    description: "设置生成节点的提示词、比例、尺寸、时长或模型。不会立即开始生成。",
    inputSchema: {
      operationId,
      nodeId: z.string().trim().min(1).max(160),
      prompt: z.string().optional(),
      aspectRatio: z.string().optional(),
      imageSize: z.string().optional(),
      resolution: z.string().optional(),
      durationSeconds: z.string().optional(),
      modelId: z.string().optional(),
      mediaType: z.enum(["image", "video"]).optional(),
      negativePrompt: z.string().optional(),
    },
  }, async (input) => textResult(await postOp({ ...input, type: "configure_generator" })))

  server.registerTool("canvas_run_generation", {
    title: "触发生成",
    description: "对一个已配置的生成节点触发生成。若已配置网站 API Token，则走网站模型并按站内规则计费；未配置时只做本地占位预览。需要画布页面保持打开。",
    inputSchema: {
      operationId,
      nodeId: z.string().trim().min(1).max(160),
    },
  }, async (input) => {
    const queued = await postOp({ ...input, type: "run_generation" }) as { error?: string; replayed?: boolean; result?: unknown; queued?: boolean }
    if (queued && "error" in queued && queued.error) throw new Error(String(queued.error))
    if (queued.replayed) return textResult(queued.result ?? queued)
    const result = await waitForGeneration(input.operationId)
    return textResult(result)
  })
}

async function main() {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
  registerReadTools(server)
  if (!readOnly) registerWriteTools(server)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`${SERVER_NAME} mcp ${readOnly ? "read-only" : "read-write"}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
