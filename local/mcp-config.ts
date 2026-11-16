import fs from "node:fs"
import path from "node:path"
import { defaultDataDir, defaultSyncUrl, nodeBinary, SERVER_NAME } from "./config.ts"

export type McpLaunchConfig = {
  name: string
  command: string
  args: string[]
  cwd: string
  scriptPath: string
  env: Record<string, string>
}

function tsxCli(repoRoot: string): string {
  const cli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs")
  if (!fs.existsSync(cli)) {
    throw new Error("未找到 tsx，请先在画布项目目录执行 npm install")
  }
  return cli
}

export function buildLaunchConfig(input: {
  repoRoot: string
  dataDir?: string
  syncUrl?: string
  readOnly?: boolean
}): McpLaunchConfig {
  const repoRoot = path.resolve(input.repoRoot)
  const scriptPath = path.join(repoRoot, "local", "mcp-server.ts")
  const args = [tsxCli(repoRoot), scriptPath]
  if (input.readOnly) args.push("--read-only")
  return {
    name: SERVER_NAME,
    command: nodeBinary(),
    args,
    cwd: repoRoot,
    scriptPath,
    env: {
      XHCANVAS_REPO_ROOT: repoRoot,
      XHCANVAS_DATA_DIR: input.dataDir || defaultDataDir(repoRoot),
      XHCANVAS_SYNC_URL: input.syncUrl || defaultSyncUrl(),
    },
  }
}

export function launchToMcpJson(launch: McpLaunchConfig, readOnly = false) {
  const args = readOnly && !launch.args.includes("--read-only")
    ? [...launch.args, "--read-only"]
    : launch.args
  return {
    mcpServers: {
      [launch.name]: {
        command: launch.command,
        args,
        cwd: launch.cwd,
        env: {
          ...launch.env,
          ...(readOnly ? { XHCANVAS_READ_ONLY: "1" } : {}),
        },
      },
    },
  }
}

export function launchToCodexToml(launch: McpLaunchConfig, readOnly = false): string {
  const args = readOnly && !launch.args.includes("--read-only")
    ? [...launch.args, "--read-only"]
    : launch.args
  const env = {
    ...launch.env,
    ...(readOnly ? { XHCANVAS_READ_ONLY: "1" } : {}),
  }
  const envInline = Object.entries(env).map(([key, value]) => `${key} = ${tomlString(value)}`).join(", ")
  return [
    `[mcp_servers.${launch.name}]`,
    `command = ${tomlString(launch.command)}`,
    `args = [${args.map(tomlString).join(", ")}]`,
    `cwd = ${tomlString(launch.cwd)}`,
    `env = { ${envInline} }`,
    "",
  ].join("\n")
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

export function formatConfigBundle(launch: McpLaunchConfig, readOnly: boolean) {
  const json = launchToMcpJson(launch, readOnly)
  return {
    cursorJson: JSON.stringify(json, null, 2),
    claudeJson: JSON.stringify(json, null, 2),
    codexJson: JSON.stringify(json, null, 2),
    codexToml: launchToCodexToml(launch, readOnly),
    npmScript: readOnly ? "npm run mcp:readonly" : "npm run mcp",
  }
}
