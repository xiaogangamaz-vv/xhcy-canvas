import fs from "node:fs"
import http, { type IncomingMessage, type ServerResponse } from "node:http"
import https from "node:https"
import path from "node:path"
import { defaultRepoRoot } from "./config.ts"

export const DEFAULT_SITE_BASE_URL = "https://ai.xhcyai.org"

const CONFIG_FILE = "site-api.json"
const ALLOWED_PREFIXES = ["/v1", "/api"]
const PROXY_TIMEOUT_MS = 180_000

export type StoredSiteConfig = {
  baseUrl: string
  token: string
}

export function siteConfigPath(repoRoot = defaultRepoRoot()): string {
  return path.join(repoRoot, ".local", CONFIG_FILE)
}

export function normalizeBaseUrl(value: string): string {
  const raw = String(value || "").trim().replace(/\/+$/, "")
  if (!raw) return DEFAULT_SITE_BASE_URL
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error("无效的网站地址")
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("网站地址必须是 http 或 https")
  }
  return `${parsed.protocol}//${parsed.host}`
}

export function readStoredSiteConfig(repoRoot = defaultRepoRoot()): StoredSiteConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(siteConfigPath(repoRoot), "utf8")) as Record<string, unknown>
    return {
      baseUrl: normalizeBaseUrl(typeof raw.baseUrl === "string" ? raw.baseUrl : DEFAULT_SITE_BASE_URL),
      token: typeof raw.token === "string" ? raw.token.trim() : "",
    }
  } catch {
    return { baseUrl: DEFAULT_SITE_BASE_URL, token: "" }
  }
}

export function writeStoredSiteConfig(
  repoRoot: string,
  next: { baseUrl?: string; token?: string; clearToken?: boolean },
): StoredSiteConfig {
  const current = readStoredSiteConfig(repoRoot)
  const baseUrl = next.baseUrl != null
    ? normalizeBaseUrl(String(next.baseUrl))
    : (current.baseUrl || DEFAULT_SITE_BASE_URL)
  let token = current.token
  if (next.clearToken) token = ""
  else if (typeof next.token === "string") token = next.token.trim()
  const payload: StoredSiteConfig = { baseUrl, token }
  const file = siteConfigPath(repoRoot)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  return payload
}

export function publicSiteConfig(config: StoredSiteConfig) {
  return {
    baseUrl: config.baseUrl || DEFAULT_SITE_BASE_URL,
    tokenConfigured: Boolean(config.token),
  }
}

function allowedSitePath(pathname: string): string | null {
  if (!pathname.startsWith("/") || pathname.includes("..") || pathname.includes("//")) return null
  const ok = ALLOWED_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
  return ok ? pathname : null
}

export function proxySiteRequest(
  repoRoot: string,
  req: IncomingMessage,
  res: ServerResponse,
  sitePathWithQuery: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const pathname = sitePathWithQuery.split("?")[0] || ""
    const allowed = allowedSitePath(pathname)
    if (!allowed) {
      res.statusCode = 400
      res.setHeader("Content-Type", "application/json; charset=utf-8")
      res.end(JSON.stringify({ error: "只能代理网站的 /v1 或 /api 接口", code: "invalid_proxy_path" }))
      resolve()
      return
    }

    const config = readStoredSiteConfig(repoRoot)
    const target = new URL(sitePathWithQuery, `${config.baseUrl}/`)
    if (target.origin !== new URL(config.baseUrl).origin) {
      res.statusCode = 400
      res.setHeader("Content-Type", "application/json; charset=utf-8")
      res.end(JSON.stringify({ error: "代理目标与已配置的网站地址不一致", code: "invalid_proxy_target" }))
      resolve()
      return
    }

    const headers: http.OutgoingHttpHeaders = {
      accept: req.headers.accept || "*/*",
      "accept-encoding": "identity",
      "user-agent": "xhcy-canvas-local",
    }
    if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"]
    if (config.token) headers.authorization = `Bearer ${config.token}`

    const transport = target.protocol === "https:" ? https.request : http.request
    const upstream = transport({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: (req.method || "GET").toUpperCase(),
      headers,
      timeout: PROXY_TIMEOUT_MS,
    }, upstreamRes => {
      res.statusCode = upstreamRes.statusCode || 502
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        const lower = key.toLowerCase()
        if (lower === "transfer-encoding" || lower === "connection" || lower === "content-encoding") continue
        if (value != null) res.setHeader(key, value)
      }
      res.setHeader("Cache-Control", "no-store")
      upstreamRes.pipe(res)
      upstreamRes.on("end", () => resolve())
      upstreamRes.on("error", error => reject(error))
    })

    upstream.on("timeout", () => {
      upstream.destroy(new Error("网站接口超时"))
    })
    upstream.on("error", error => {
      if (!res.headersSent) {
        res.statusCode = 502
        res.setHeader("Content-Type", "application/json; charset=utf-8")
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : "无法连接网站接口", code: "proxy_error" }))
        resolve()
        return
      }
      reject(error)
    })

    req.pipe(upstream)
  })
}
