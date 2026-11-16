export const SITE_CONFIG_CHANGED_EVENT = "xhcy-canvas-site-config-changed"
export const DEFAULT_SITE_BASE_URL = "https://ai.xhcyai.org"
const SITE_CONFIG_PATH = "/__local/site-config"

export type SiteConnection = {
  baseUrl: string
  tokenConfigured: boolean
}

async function requestSiteConfig(init?: RequestInit): Promise<SiteConnection> {
  const response = await fetch(SITE_CONFIG_PATH, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  })
  const payload = await response.json().catch(() => null) as { baseUrl?: string; tokenConfigured?: boolean; error?: string } | null
  if (!response.ok) {
    throw new Error(payload?.error || `无法保存网站配置（HTTP ${response.status}）`)
  }
  return {
    baseUrl: payload?.baseUrl || DEFAULT_SITE_BASE_URL,
    tokenConfigured: Boolean(payload?.tokenConfigured),
  }
}

export async function fetchSiteConnection(): Promise<SiteConnection | null> {
  try {
    return await requestSiteConfig()
  } catch {
    return null
  }
}

export async function saveSiteConnection(input: {
  baseUrl?: string
  token?: string
  clearToken?: boolean
}): Promise<SiteConnection> {
  const connection = await requestSiteConfig({
    method: "PUT",
    body: JSON.stringify(input),
  })
  window.dispatchEvent(new CustomEvent(SITE_CONFIG_CHANGED_EVENT))
  return connection
}

export function onSiteConnectionChange(listener: () => void): () => void {
  window.addEventListener(SITE_CONFIG_CHANGED_EVENT, listener)
  return () => window.removeEventListener(SITE_CONFIG_CHANGED_EVENT, listener)
}
