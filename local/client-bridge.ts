import { spawnSync } from "node:child_process"
import path from "node:path"
import { nodeBinary, SERVER_NAME } from "./config.ts"
import type { McpLaunchConfig } from "./mcp-config.ts"

export type ExternalClientId = "claude" | "codex"

export type ClientProbe = {
  id: ExternalClientId
  available: boolean
  commandPath: string | null
  connected: boolean
  detail: string
}

function lookupCommand(name: string): string | null {
  const tool = process.platform === "win32" ? "where.exe" : "which"
  const result = spawnSync(tool, [name], { encoding: "utf8", timeout: 8000, windowsHide: true })
  if (result.status !== 0) return null
  const lines = String(result.stdout || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  if (!lines.length) return null
  const preferred = process.platform === "win32"
    ? lines.find(line => /\.cmd$/i.test(line)) || lines[0]
    : lines[0]
  return preferred
}

function runCommand(commandPath: string, args: string[]): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(commandPath, args, {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
    env: process.env,
  })
  const stdout = String(result.stdout || "").trim()
  const stderr = String(result.stderr || "").trim()
  const status = result.status
  return { ok: status === 0, stdout, stderr, status }
}

function mentionsOurServer(text: string, launch: McpLaunchConfig): boolean {
  const haystack = text.toLowerCase()
  return haystack.includes(SERVER_NAME.toLowerCase()) && (
    haystack.includes(path.basename(launch.scriptPath).toLowerCase())
    || haystack.includes("mcp-server.ts")
    || haystack.includes(launch.cwd.toLowerCase())
  )
}

function looksLikeOurConfiguredServer(text: string, launch: McpLaunchConfig): boolean {
  if (!text.trim()) return false
  if (/not found|no mcp servers|isn't configured|is not configured/i.test(text) && !text.toLowerCase().includes(SERVER_NAME.toLowerCase())) {
    return false
  }
  return text.toLowerCase().includes(SERVER_NAME.toLowerCase()) && mentionsOurServer(text, launch)
}

export function probeExternalClients(launch: McpLaunchConfig): Record<ExternalClientId, ClientProbe> {
  return {
    claude: probeOne("claude", launch),
    codex: probeOne("codex", launch),
  }
}

function probeOne(id: ExternalClientId, launch: McpLaunchConfig): ClientProbe {
  const commandPath = lookupCommand(id)
  if (!commandPath) {
    return {
      id,
      available: false,
      commandPath: null,
      connected: false,
      detail: `未检测到可用的 ${id} 命令行。安装对应工具并确认它在 PATH 中后，可使用一键接入；也可以先复制手动配置。`,
    }
  }
  const inspect = id === "claude"
    ? runCommand(commandPath, ["mcp", "get", SERVER_NAME])
    : runCommand(commandPath, ["mcp", "get", SERVER_NAME])
  const listed = inspect.ok
    ? inspect.stdout
    : `${inspect.stdout}\n${inspect.stderr}`
  const fallback = runCommand(commandPath, ["mcp", "list"])
  const combined = `${listed}\n${fallback.stdout}\n${fallback.stderr}`
  const connected = looksLikeOurConfiguredServer(combined, launch)
  return {
    id,
    available: true,
    commandPath,
    connected,
    detail: connected ? "已接入" : "命令行可用，尚未接入当前画布。",
  }
}

export function connectExternalClient(
  id: ExternalClientId,
  launch: McpLaunchConfig,
  readOnly: boolean,
): { ok: boolean; message: string; probe: ClientProbe } {
  const before = probeOne(id, launch)
  if (!before.available || !before.commandPath) {
    return { ok: false, message: before.detail, probe: before }
  }
  if (before.connected) {
    return { ok: true, message: "已经接入，无需重复写入。", probe: before }
  }
  const inspect = id === "claude"
    ? runCommand(before.commandPath, ["mcp", "get", SERVER_NAME])
    : runCommand(before.commandPath, ["mcp", "get", SERVER_NAME])
  const existingText = `${inspect.stdout}\n${inspect.stderr}`
  if (inspect.ok && existingText.toLowerCase().includes(SERVER_NAME.toLowerCase()) && !mentionsOurServer(existingText, launch)) {
    return {
      ok: false,
      message: `已存在同名 MCP 条目 ${SERVER_NAME}，但不是当前画布的配置。为避免覆盖，已停止写入。请先在对方工具中手动删除该条目，或改用复制配置。`,
      probe: before,
    }
  }

  const args = readOnly ? [...launch.args, "--read-only"] : launch.args
  const envArgs = Object.entries(launch.env).flatMap(([key, value]) => (
    id === "claude" ? ["-e", `${key}=${value}`] : ["--env", `${key}=${value}`]
  ))

  const addArgs = id === "claude"
    ? ["mcp", "add", "--scope", "user", "--transport", "stdio", ...envArgs, SERVER_NAME, "--", nodeBinary(), ...args]
    : ["mcp", "add", SERVER_NAME, ...envArgs, "--", nodeBinary(), ...args]

  const added = runCommand(before.commandPath, addArgs)
  if (!added.ok) {
    return {
      ok: false,
      message: `写入配置失败，未改动其他条目。${added.stderr || added.stdout || "命令返回了非零退出码。"}`,
      probe: before,
    }
  }

  const after = probeOne(id, launch)
  if (!after.connected) {
    return {
      ok: false,
      message: `命令已执行，但未能确认 ${SERVER_NAME} 已写入。请使用手动配置，不要反复重试以免写坏已有项目。${added.stdout || added.stderr}`.trim(),
      probe: after,
    }
  }
  return { ok: true, message: "已接入。重新打开对应工具后即可使用当前画布。", probe: after }
}

export function disconnectExternalClient(
  id: ExternalClientId,
  launch: McpLaunchConfig,
): { ok: boolean; message: string; probe: ClientProbe } {
  const before = probeOne(id, launch)
  if (!before.available || !before.commandPath) {
    return { ok: false, message: before.detail, probe: before }
  }
  if (!before.connected) {
    const inspect = runCommand(before.commandPath, ["mcp", "get", SERVER_NAME])
    if (inspect.ok && `${inspect.stdout}\n${inspect.stderr}`.toLowerCase().includes(SERVER_NAME.toLowerCase())) {
      return {
        ok: false,
        message: `检测到同名条目，但无法确认为当前画布所写入，已停止删除。如需移除，请在 ${id} 中手动处理。`,
        probe: before,
      }
    }
    return { ok: true, message: "当前没有已接入的条目。", probe: before }
  }
  const removed = id === "claude"
    ? runCommand(before.commandPath, ["mcp", "remove", "--scope", "user", SERVER_NAME])
    : runCommand(before.commandPath, ["mcp", "remove", SERVER_NAME])
  const after = probeOne(id, launch)
  if (!removed.ok && after.connected) {
    return {
      ok: false,
      message: `未能自动移除 ${id} 中的条目。可以在对方工具里手动删除名为 ${SERVER_NAME} 的 MCP 服务。${removed.stderr || removed.stdout}`,
      probe: after,
    }
  }
  return { ok: true, message: "已断开。", probe: after }
}
