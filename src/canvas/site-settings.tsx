import { useEffect, useState } from "react"
import { KeyRound, X } from "lucide-react"
import {
  DEFAULT_SITE_BASE_URL,
  fetchSiteConnection,
  saveSiteConnection,
  type SiteConnection,
} from "@/adapters/site-config"
import { CANVAS_TOOLBAR_BORDER, CANVAS_TOOLBAR_PANEL } from "@/canvas/canvas-palette"

export function SiteSettingsButton() {
  const [open, setOpen] = useState(false)
  const [connection, setConnection] = useState<SiteConnection | null>(null)
  const [baseUrl, setBaseUrl] = useState(DEFAULT_SITE_BASE_URL)
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchSiteConnection().then(next => {
      if (cancelled || !next) return
      setConnection(next)
      setBaseUrl(next.baseUrl || DEFAULT_SITE_BASE_URL)
    })
    return () => { cancelled = true }
  }, [])

  const configured = Boolean(connection?.tokenConfigured)

  async function persist(input: { baseUrl?: string; token?: string; clearToken?: boolean }) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const next = await saveSiteConnection(input)
      setConnection(next)
      setBaseUrl(next.baseUrl || DEFAULT_SITE_BASE_URL)
      setToken("")
      setMessage(next.tokenConfigured ? "已保存，目录与生成将走网站模型" : "已清除令牌，现为本地预览")
    } catch (item) {
      setError(item instanceof Error ? item.message : "保存失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        className={`rounded-xl p-1.5 hover:bg-surface-hover ${configured ? "text-text-primary" : "text-text-secondary"}`}
        title={configured ? "网站模型：已配置令牌" : "网站模型：尚未配置令牌"}
        aria-label="打开网站模型配置"
        aria-pressed={open}
        onClick={() => setOpen(value => !value)}
      >
        <KeyRound className="h-4 w-4" />
      </button>
      {open ? (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-40 w-[320px] rounded-2xl border p-3 text-[12px] text-text-primary shadow-xl"
          style={{ background: CANVAS_TOOLBAR_PANEL, borderColor: CANVAS_TOOLBAR_BORDER }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-medium">网站模型</div>
            <button type="button" className="rounded-lg p-1 text-text-secondary hover:bg-surface-hover" onClick={() => setOpen(false)} aria-label="关闭网站模型配置">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mb-2 text-[11px] leading-4 text-text-secondary">
            {configured ? "已配置 API Token（不会回显）。目录与生成走 ai.xhcyai.org 网站模型，费用按站内规则计费。" : "尚未接通网站模型。未配置令牌时，生成只做本地预览，不是真模型结果。"}
          </p>
          <label className="mb-1 block text-[10px] text-text-secondary">网站地址</label>
          <input
            className="mb-2 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[11px] outline-none focus:border-white/25"
            value={baseUrl}
            onChange={event => setBaseUrl(event.target.value)}
            placeholder={DEFAULT_SITE_BASE_URL}
            autoComplete="off"
            spellCheck={false}
          />
          <label className="mb-1 block text-[10px] text-text-secondary">API Token</label>
          <input
            className="mb-2 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[11px] outline-none focus:border-white/25"
            type="password"
            value={token}
            onChange={event => setToken(event.target.value)}
            placeholder={configured ? "已配置（不会回显），粘贴新令牌可替换" : "粘贴在站内申请的 API Token"}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              className="rounded-lg bg-white/10 px-2 py-1 text-[11px] hover:bg-white/15 disabled:opacity-50"
              onClick={() => void persist({ baseUrl, token: token.trim() || undefined })}
            >
              保存
            </button>
            <button
              type="button"
              disabled={busy || !configured}
              className="rounded-lg px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover disabled:opacity-50"
              onClick={() => void persist({ baseUrl, clearToken: true })}
            >
              清除令牌
            </button>
            <span className={`ml-auto text-[10px] ${configured ? "text-text-primary" : "text-text-weak"}`}>
              {configured ? "已配置" : "未配置"}
            </span>
          </div>
          {message ? <p className="mt-2 text-[10px] leading-4 text-text-secondary">{message}</p> : null}
          {error ? <p className="mt-2 text-[10px] leading-4 text-status-error" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
