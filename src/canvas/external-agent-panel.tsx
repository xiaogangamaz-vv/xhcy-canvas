import { useEffect, useState } from "react"
import { Bot, Check, Copy, X } from "lucide-react"
import {
  connectExternalClient,
  disconnectExternalClient,
  fetchSyncConfig,
  type SyncClientProbe,
  type WorkspaceSyncConfig,
} from "@/lib/workspace-sync"
import { CANVAS_TOOLBAR_BORDER, CANVAS_TOOLBAR_PANEL } from "@/canvas/canvas-palette"

type ClientId = "claude" | "codex"

export function ExternalAgentPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [readOnly, setReadOnly] = useState(false)
  const [config, setConfig] = useState<WorkspaceSyncConfig | null>(null)
  const [online, setOnline] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<ClientId | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = async () => {
      const next = await fetchSyncConfig(readOnly)
      if (cancelled) return
      setConfig(next)
      setOnline(Boolean(next))
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 4000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [open, readOnly])

  if (!open) return null

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      window.setTimeout(() => setCopied(current => current === label ? null : current), 1600)
    } catch {
      setMessage("复制失败，请手动选择文本复制。")
    }
  }

  const runClientAction = async (id: ClientId, action: "connect" | "disconnect") => {
    setBusy(id)
    setMessage(null)
    try {
      const result = action === "connect"
        ? await connectExternalClient(id, readOnly)
        : await disconnectExternalClient(id)
      setMessage(result.message)
      const refreshed = await fetchSyncConfig(readOnly)
      if (refreshed) setConfig(refreshed)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="absolute bottom-24 right-6 top-20 z-40 flex w-[min(92vw,420px)] flex-col overflow-hidden rounded-2xl border shadow-2xl" style={{ background: CANVAS_TOOLBAR_PANEL, borderColor: CANVAS_TOOLBAR_BORDER }}>
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-text-primary">
          <Bot className="h-4 w-4" />
          外部 Agent / MCP
        </div>
        <button type="button" className="rounded-lg p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary" onClick={onClose} aria-label="关闭面板">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[12px] leading-6 text-text-secondary">
        <p>
          {online
            ? "本地同步服务已运行。把下面的配置交给外部 Agent 后，它可以读写当前这张本地画布。"
            : "还没有连上本地同步服务。请先在本机运行画布开发服务，再刷新这个面板。"}
        </p>
        <p className="text-text-weak">开发地址：http://127.0.0.1:5173/canvas/。外部 Agent 接入时请保持这个页面打开。</p>
        <p className="text-text-weak">内置助手将在网站模型接入后再做。</p>

        <label className="flex items-center gap-2 text-text-primary">
          <input
            type="checkbox"
            checked={readOnly}
            onChange={event => setReadOnly(event.target.checked)}
          />
          只读连接（生成的配置带 --read-only，不注册写工具）
        </label>

        {config ? (
          <>
            <section className="space-y-2">
              <h3 className="text-[11px] font-medium tracking-wide text-text-primary">一键接入</h3>
              <ClientRow
                label="Claude Code"
                probe={config.clients.claude}
                busy={busy === "claude"}
                onConnect={() => void runClientAction("claude", "connect")}
                onDisconnect={() => void runClientAction("claude", "disconnect")}
              />
              <ClientRow
                label="Codex"
                probe={config.clients.codex}
                busy={busy === "codex"}
                onConnect={() => void runClientAction("codex", "connect")}
                onDisconnect={() => void runClientAction("codex", "disconnect")}
              />
            </section>

            <section className="space-y-2">
              <h3 className="text-[11px] font-medium tracking-wide text-text-primary">手动配置</h3>
              <p>Cursor：把 JSON 合并到 ~/.cursor/mcp.json 的 mcpServers。</p>
              <CopyBlock label="Cursor" value={config.cursorJson} copied={copied} onCopy={copyText} />
              <p>Claude Desktop：在「设置 → 开发者 → 编辑配置」中合并下面的 mcpServers，然后完全退出并重新打开。</p>
              <CopyBlock label="Claude Desktop" value={config.claudeJson} copied={copied} onCopy={copyText} />
              <p>Codex：可复制 JSON，或使用同内容的 TOML 片段写入配置文件。也可以在本机用命令行接入。</p>
              <CopyBlock label="Codex JSON" value={config.codexJson} copied={copied} onCopy={copyText} />
              <CopyBlock label="Codex TOML" value={config.codexToml} copied={copied} onCopy={copyText} />
            </section>

            <section className="space-y-1">
              <h3 className="text-[11px] font-medium tracking-wide text-text-primary">命令行启动</h3>
              <p>在画布项目目录执行：</p>
              <CopyBlock label="启动命令" value={config.npmScript} copied={copied} onCopy={copyText} />
              <p className="text-text-weak break-all">数据目录：{config.dataDir}</p>
            </section>

            <section className="space-y-1">
              <h3 className="text-[11px] font-medium tracking-wide text-text-primary">使用说明</h3>
              <pre className="whitespace-pre-wrap rounded-xl bg-black/20 p-3 text-[11px] text-text-secondary">{config.guide}</pre>
            </section>
          </>
        ) : (
          <p>正在读取本地配置… 如果长时间没有结果，请确认开发服务仍在 127.0.0.1:5173 运行。</p>
        )}

        {message ? <p className="rounded-xl bg-black/20 px-3 py-2 text-text-primary">{message}</p> : null}
      </div>
    </div>
  )
}

function ClientRow({
  label,
  probe,
  busy,
  onConnect,
  onDisconnect,
}: {
  label: string
  probe?: SyncClientProbe
  busy: boolean
  onConnect: () => void
  onDisconnect: () => void
}) {
  const available = Boolean(probe?.available)
  const connected = Boolean(probe?.connected)
  return (
    <div className="rounded-xl border border-white/10 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-text-primary">{label}</div>
          <div className="text-[11px] text-text-weak">{probe?.detail || "正在检测命令行…"}</div>
        </div>
        {connected ? (
          <button type="button" disabled={busy} className="rounded-lg border border-white/10 px-2 py-1 text-text-primary hover:bg-surface-hover disabled:opacity-50" onClick={onDisconnect}>
            {busy ? "处理中…" : "断开"}
          </button>
        ) : (
          <button type="button" disabled={busy || !available} className="rounded-lg border border-white/10 px-2 py-1 text-text-primary hover:bg-surface-hover disabled:opacity-50" onClick={onConnect}>
            {busy ? "处理中…" : available ? "一键接入" : "未检测到"}
          </button>
        )}
      </div>
    </div>
  )
}

function CopyBlock({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string
  value: string
  copied: string | null
  onCopy: (label: string, value: string) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-text-primary">{label}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          onClick={() => onCopy(label, value)}
        >
          {copied === label ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied === label ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-black/20 p-3 text-[11px] text-text-secondary">{value}</pre>
    </div>
  )
}
