import type { CanvasAsset, CanvasGenerationRequest, CanvasGenerationResult } from "@/adapters/host"
import { getImageParamContract } from "@/adapters/image-contract"
import {
  IMAGE_MODULE_KEY,
  VIDEO_MODULE_KEY,
  type CanvasImageModelCatalog,
  type CanvasPublicImageModel,
  type CanvasPublicVideoModel,
  type CanvasVideoModelCatalog,
} from "@/adapters/model-catalog"

export const SITE_API_PROXY_BASE = "/__local/site-api"

const IMAGE_POLL_INTERVAL_MS = 2500
const VIDEO_POLL_INTERVAL_MS = 8000
const IMAGE_POLL_TIMEOUT_MS = 5 * 60 * 1000
const VIDEO_POLL_TIMEOUT_MS = 12 * 60 * 1000
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "timeout", "canceled"])

type JsonMap = Record<string, unknown>

type PlazaModel = {
  id: string
  name: string
  modality: "image" | "video" | "other"
  requiresImage?: boolean
}

type VideoStudioModel = {
  id: string
  name: string
  resolutions?: string[]
  min_duration?: number
  max_duration?: number
  ratios?: string[]
  modes?: string[]
  limits?: Record<string, number>
}

function asRecord(value: unknown): JsonMap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as JsonMap
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => asString(item)).filter(Boolean)
}

function tagsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => asString(item)).filter(Boolean)
  const text = asString(value)
  return text ? [text] : []
}

export function describeSiteError(status: number, payload: unknown, fallback: string): string {
  const record = asRecord(payload)
  const error = asRecord(record?.error) || (typeof record?.error === "string" ? { message: record.error } : null)
  const message = asString(record?.message) || asString(error?.message) || asString(error?.type) || fallback
  const code = asString(record?.code) || asString(error?.code) || asString(error?.type)
  const parts = [message || fallback]
  if (code && !parts[0].includes(code)) parts.push(`（${code}）`)
  if (status && status >= 400) parts.push(`HTTP ${status}`)
  return parts.join(" ").trim()
}

async function siteFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith("http") ? path : `${SITE_API_PROXY_BASE}${path}`
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  })
}

async function siteJson(path: string, init?: RequestInit): Promise<{ status: number; payload: unknown }> {
  const response = await siteFetch(path, init)
  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try { payload = JSON.parse(text) } catch { payload = { message: text.slice(0, 500) } }
  }
  return { status: response.status, payload }
}

function classifyPlazaModality(model: JsonMap): PlazaModel["modality"] {
  const name = asString(model.name)
  const tagText = tagsOf(model.tags).join(" ")
  const usage = asString(model.usage)
  const pricing = asRecord(model.pricing) || {}
  const mode = asString(pricing.mode).toLowerCase()
  const haystack = `${name} ${tagText} ${usage}`
  if (mode === "video" || mode === "second" || /视频|minimax-h3|seedance|\bsora\b/i.test(haystack)) return "video"
  if (mode === "character" || mode === "hour" || /语音|音频|speech-|asr-|voice-/i.test(haystack)) return "other"
  if (/image|绘图|图像|图片|nano-banana|seedream|gpt-image/i.test(haystack) || mode === "unit") return "image"
  return "other"
}

function parseProviderMeta(raw: unknown): PlazaModel[] {
  const root = asRecord(raw)
  const data = typeof root?.data === "string"
    ? (() => { try { return JSON.parse(root.data as string) as unknown } catch { return null } })()
    : root?.data
  const document = asRecord(data) || asRecord(raw)
  const providers = Array.isArray(document?.providers) ? document!.providers : []
  const models: PlazaModel[] = []
  const seen = new Set<string>()
  for (const provider of providers) {
    const entry = asRecord(provider)
    const rows = Array.isArray(entry?.models) ? entry!.models : []
    for (const row of rows) {
      const model = asRecord(row)
      if (!model || model.visible === false) continue
      const id = asString(model.name)
      if (!id || seen.has(id)) continue
      seen.add(id)
      models.push({
        id,
        name: asString(model.displayName) || id,
        modality: classifyPlazaModality(model),
      })
    }
  }
  return models
}

function parsePublicNames(payload: unknown): Set<string> {
  const root = asRecord(payload)
  const data = Array.isArray(root?.data) ? root!.data : Array.isArray(payload) ? payload : []
  return new Set(data.map(item => asString(item)).filter(Boolean))
}

function parseKeyModelIds(payload: unknown): Set<string> {
  const root = asRecord(payload)
  const data = Array.isArray(root?.data) ? root!.data : []
  const ids = new Set<string>()
  for (const item of data) {
    const row = asRecord(item)
    const id = asString(row?.id) || asString(item)
    if (id) ids.add(id)
  }
  return ids
}

function parseVideoStudioModels(payload: unknown): VideoStudioModel[] {
  const root = asRecord(payload)
  const data = Array.isArray(root?.data) ? root!.data : []
  return data.map(item => asRecord(item)).filter((item): item is JsonMap => Boolean(item)).map(item => ({
    id: asString(item.id),
    name: asString(item.name) || asString(item.id),
    resolutions: asStringList(item.resolutions),
    min_duration: Number(item.min_duration),
    max_duration: Number(item.max_duration),
    ratios: asStringList(item.ratios),
    modes: asStringList(item.modes),
    limits: asRecord(item.limits) as Record<string, number> | undefined,
  })).filter(item => item.id)
}

function durationOptions(min: number, max: number): string[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return []
  const start = Math.trunc(min)
  const end = Math.trunc(max)
  const options: string[] = []
  for (let value = start; value <= end; value += 1) options.push(String(value))
  return options
}

async function readKeyModelIds(): Promise<Set<string>> {
  const { status, payload } = await siteJson("/v1/models")
  if (status === 401 || status === 403) {
    throw new Error(describeSiteError(status, payload, "令牌无效或没有权限"))
  }
  if (status >= 400) {
    throw new Error(describeSiteError(status, payload, "无法读取该令牌可用的模型目录"))
  }
  const ids = parseKeyModelIds(payload)
  if (!ids.size) {
    throw new Error("该令牌没有可用模型")
  }
  return ids
}

export async function fetchSiteImageCatalog(): Promise<CanvasImageModelCatalog> {
  const [meta, publicNames, keyIds] = await Promise.all([
    siteJson("/api/model_provider_meta"),
    siteJson("/api/public-models"),
    readKeyModelIds(),
  ])
  if (meta.status >= 400) {
    throw new Error(describeSiteError(meta.status, meta.payload, "无法读取广场模型目录"))
  }
  if (publicNames.status >= 400) {
    throw new Error(describeSiteError(publicNames.status, publicNames.payload, "无法读取公开模型名单"))
  }
  const allowed = parsePublicNames(publicNames.payload)
  const models: CanvasPublicImageModel[] = parseProviderMeta(meta.payload)
    .filter(model => model.modality === "image" && allowed.has(model.id) && keyIds.has(model.id))
    .map(model => {
      const contract = getImageParamContract(model.id)
      return {
        id: model.id,
        name: model.name,
        type: "image" as const,
        creditCost: 0,
        requiresPrompt: true,
        requiresImage: false,
        supportsAspectRatio: Boolean(contract?.acceptsAspectRatio),
        supportedAspectRatios: contract?.supportedAspectRatios ?? [],
        supportedImageSizes: contract?.supportedImageSizes ?? [],
        maxGenerationCount: contract?.maxN ?? 1,
      }
    })
  return {
    moduleKey: IMAGE_MODULE_KEY,
    primaryModelId: models[0]?.id ?? null,
    models,
    channelReady: models.length > 0,
    unavailableCode: models.length > 0 ? null : "IMAGE_CHANNEL_NOT_CONFIGURED",
    unavailableMessage: models.length > 0 ? null : "当前令牌在公开目录中没有可用的图像模型",
    source: "site",
    previewOnly: false,
  }
}

export async function fetchSiteVideoCatalog(): Promise<CanvasVideoModelCatalog> {
  const [studio, publicNames, keyIds] = await Promise.all([
    siteJson("/api/video/models"),
    siteJson("/api/public-models"),
    readKeyModelIds(),
  ])
  if (studio.status >= 400) {
    throw new Error(describeSiteError(studio.status, studio.payload, "无法读取视频模型目录"))
  }
  if (publicNames.status >= 400) {
    throw new Error(describeSiteError(publicNames.status, publicNames.payload, "无法读取公开模型名单"))
  }
  const allowed = parsePublicNames(publicNames.payload)
  const models: CanvasPublicVideoModel[] = parseVideoStudioModels(studio.payload)
    .filter(model => allowed.has(model.id) && keyIds.has(model.id))
    .map(model => ({
      id: model.id,
      name: model.name,
      type: "video" as const,
      creditCost: 0,
      supportedAspectRatios: model.ratios ?? [],
      supportedResolutions: model.resolutions ?? [],
      supportedDurations: durationOptions(model.min_duration ?? NaN, model.max_duration ?? NaN),
      requiresImage: Number(model.limits?.reference_image_required) > 0 || (model.modes?.length === 1 && model.modes[0] === "reference"),
      minDuration: Number.isFinite(model.min_duration) ? model.min_duration : undefined,
      maxDuration: Number.isFinite(model.max_duration) ? model.max_duration : undefined,
      maxGenerationCount: 1,
    }))
  return {
    moduleKey: VIDEO_MODULE_KEY,
    primaryModelId: models[0]?.id ?? null,
    models,
    channelReady: models.length > 0,
    unavailableCode: models.length > 0 ? null : "VIDEO_CHANNEL_NOT_CONFIGURED",
    unavailableMessage: models.length > 0 ? null : "当前令牌在公开目录中没有可用的视频模型",
    source: "site",
    previewOnly: false,
  }
}

function taskIdOf(payload: unknown): string {
  const record = asRecord(payload)
  return asString(record?.task_id) || asString(record?.id) || asString(asRecord(record?.data)?.task_id)
}

function statusOf(payload: unknown): string {
  return asString(asRecord(payload)?.status).toLowerCase()
}

function contentUrlOf(payload: unknown): string {
  const record = asRecord(payload)
  const content = asRecord(record?.content)
  const data = Array.isArray(record?.data) ? asRecord(record.data[0]) : asRecord(record?.data)
  return asString(content?.url) || asString(data?.url) || asString(record?.url)
}

function failureMessage(payload: unknown, fallback: string): string {
  const record = asRecord(payload)
  const error = asRecord(record?.error) || asRecord(record?.failure)
  return describeSiteError(0, record || payload, asString(error?.message) || asString(record?.message) || fallback)
}

function toProxyPath(url: string): string {
  if (url.startsWith("/v1/") || url.startsWith("/api/")) return url
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

async function downloadMedia(url: string): Promise<{ blob: Blob; mimeType: string }> {
  const path = toProxyPath(url)
  const response = await siteFetch(path)
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    let payload: unknown = text
    try { payload = text ? JSON.parse(text) : null } catch { payload = { message: text.slice(0, 400) } }
    throw new Error(describeSiteError(response.status, payload, "下载生成结果失败"))
  }
  const blob = await response.blob()
  const mimeType = blob.type || response.headers.get("content-type") || "application/octet-stream"
  return { blob, mimeType: mimeType.split(";")[0].trim() }
}

function sleep(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

async function pollTask(path: string, intervalMs: number, timeoutMs: number): Promise<JsonMap> {
  const deadline = Date.now() + timeoutMs
  let last: unknown = null
  while (Date.now() < deadline) {
    const { status, payload } = await siteJson(path)
    last = payload
    if (status >= 400) {
      throw new Error(describeSiteError(status, payload, "查询生成任务失败"))
    }
    const taskStatus = statusOf(payload)
    if (TERMINAL_STATUSES.has(taskStatus)) {
      if (taskStatus === "succeeded") return asRecord(payload) || {}
      throw new Error(failureMessage(payload, `生成任务${taskStatus}`))
    }
    await sleep(intervalMs)
  }
  throw new Error(failureMessage(last, "生成任务超时，请稍后在网站任务记录中查看"))
}

async function referencePayloads(urls: string[] | undefined): Promise<string[]> {
  const result: string[] = []
  for (const url of urls || []) {
    if (!url) continue
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) {
      result.push(url)
      continue
    }
    try {
      const response = await fetch(url)
      if (!response.ok) continue
      const blob = await response.blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ""))
        reader.onerror = () => reject(new Error("参考图读取失败"))
        reader.readAsDataURL(blob)
      })
      if (dataUrl) result.push(dataUrl)
    } catch {
      throw new Error("参考图无法发送到网站，请改用已上传的画布素材")
    }
  }
  return result
}

function clampN(request: CanvasGenerationRequest, maxN: number): number {
  const next = Number(request.generationCount || 1) || 1
  return Math.min(Math.max(1, Math.trunc(next)), Math.max(1, maxN))
}

function buildImageBody(request: CanvasGenerationRequest, references: string[], asyncMode: boolean): JsonMap {
  const contract = getImageParamContract(request.modelId)
  const body: JsonMap = {
    model: request.modelId,
    prompt: request.prompt,
    n: clampN(request, contract?.maxN ?? 1),
  }
  if (asyncMode) body.async = true
  if (contract?.acceptsAspectRatio) {
    const ratio = (request.aspectRatio || "").trim()
    if (ratio && !(contract.omitAspectWhenAuto && ratio === "auto")) body.aspect_ratio = ratio
  }
  const size = (request.imageSize || "").trim()
  if (size && contract?.sizeField) body[contract.sizeField] = size
  else if (size && !contract) body.size = size
  if (references.length && (contract?.acceptsReferenceImage || !contract)) {
    body.image = references.length === 1 ? references[0] : references
  }
  return body
}

function buildVideoBody(request: CanvasGenerationRequest, references: string[]): JsonMap {
  const content: JsonMap[] = [{ type: "text", text: request.prompt }]
  for (const url of references) {
    content.push({ type: "image_url", role: "reference_image", image_url: { url } })
  }
  const body: JsonMap = {
    model: request.modelId,
    content,
  }
  if (request.resolution) body.resolution = request.resolution
  if (request.durationSeconds) body.duration = Number(request.durationSeconds)
  if (request.aspectRatio) body.ratio = request.aspectRatio
  return body
}

export type SiteGenerationBlob = {
  blob: Blob
  mimeType: string
  taskId?: string
}

export async function runSiteImageGeneration(request: CanvasGenerationRequest): Promise<SiteGenerationBlob> {
  const references = await referencePayloads(request.referenceUrls)
  const submit = async (asyncMode: boolean) => siteJson("/v1/images/generations", {
    method: "POST",
    body: JSON.stringify(buildImageBody(request, references, asyncMode)),
  })

  let { status, payload } = await submit(true)
  const code = asString(asRecord(payload)?.code) || asString(asRecord(asRecord(payload)?.error)?.code)
  if (status === 400 && (code === "async_generation_disabled" || /async_generation_disabled/i.test(describeSiteError(status, payload, "")))) {
    ;({ status, payload } = await submit(false))
  }
  if (status >= 400) {
    throw new Error(describeSiteError(status, payload, "提交图片生成失败"))
  }

  const queuedId = taskIdOf(payload)
  if (queuedId && !contentUrlOf(payload)) {
    const finished = await pollTask(`/v1/images/tasks/${encodeURIComponent(queuedId)}`, IMAGE_POLL_INTERVAL_MS, IMAGE_POLL_TIMEOUT_MS)
    const contentUrl = contentUrlOf(finished) || `/v1/images/tasks/${encodeURIComponent(queuedId)}/content`
    const media = await downloadMedia(contentUrl)
    return { ...media, taskId: queuedId }
  }

  const syncUrl = contentUrlOf(payload)
  if (!syncUrl) throw new Error(describeSiteError(status, payload, "网站没有返回图片地址"))
  const media = await downloadMedia(syncUrl)
  return { ...media, taskId: queuedId || undefined }
}

export async function runSiteVideoGeneration(request: CanvasGenerationRequest): Promise<SiteGenerationBlob> {
  const references = await referencePayloads(request.referenceUrls)
  const { status, payload } = await siteJson("/v1/video/generations", {
    method: "POST",
    body: JSON.stringify(buildVideoBody(request, references)),
  })
  if (status >= 400) {
    throw new Error(describeSiteError(status, payload, "提交视频生成失败"))
  }
  const queuedId = taskIdOf(payload)
  if (!queuedId) throw new Error(describeSiteError(status, payload, "网站没有返回视频任务 id"))
  const currentStatus = statusOf(payload)
  const finished = currentStatus && TERMINAL_STATUSES.has(currentStatus)
    ? (asRecord(payload) || {})
    : await pollTask(`/v1/video/generations/${encodeURIComponent(queuedId)}`, VIDEO_POLL_INTERVAL_MS, VIDEO_POLL_TIMEOUT_MS)
  if (statusOf(finished) && statusOf(finished) !== "succeeded") {
    throw new Error(failureMessage(finished, "视频生成失败"))
  }
  const contentUrl = contentUrlOf(finished) || `/v1/video/generations/${encodeURIComponent(queuedId)}/content`
  const media = await downloadMedia(contentUrl)
  return { ...media, taskId: queuedId }
}

export async function runSiteGeneration(request: CanvasGenerationRequest): Promise<SiteGenerationBlob> {
  if (request.mediaType === "video") return runSiteVideoGeneration(request)
  return runSiteImageGeneration(request)
}

export function siteAssetMetadata(request: CanvasGenerationRequest, taskId?: string): Record<string, unknown> {
  return {
    local: false,
    mock: false,
    site: true,
    modelId: request.modelId,
    aspectRatio: request.aspectRatio,
    imageSize: request.imageSize,
    resolution: request.resolution,
    durationSeconds: request.durationSeconds,
    taskId: taskId || null,
  }
}

export type { CanvasAsset, CanvasGenerationResult }
