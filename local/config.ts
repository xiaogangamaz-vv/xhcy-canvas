import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const SERVER_NAME = "xhcy-canvas"
export const SERVER_VERSION = "0.1.0"
export const LOCAL_OWNER_ID = "local"
export const LOCAL_PROJECT_ID = "local-project"
export const LOCAL_CANVAS_ID = "local-canvas"
export const DEFAULT_SYNC_PREFIXES = ["/__local", "/canvas/__local"] as const
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024
export const MAX_MULTIMODAL_BYTES = 4 * 1024 * 1024

export function repoRootFromModule(url = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(url)), "..")
}

export function defaultRepoRoot(): string {
  if (process.env.XHCANVAS_REPO_ROOT) return path.resolve(process.env.XHCANVAS_REPO_ROOT)
  return repoRootFromModule()
}

export function defaultDataDir(root = defaultRepoRoot()): string {
  if (process.env.XHCANVAS_DATA_DIR) return path.resolve(process.env.XHCANVAS_DATA_DIR)
  return path.join(root, ".local", "canvas")
}

export function defaultSyncUrl(): string {
  return process.env.XHCANVAS_SYNC_URL || "http://127.0.0.1:5173/__local"
}

export function isReadOnlyRequest(argv = process.argv, env = process.env): boolean {
  return argv.includes("--read-only") || env.XHCANVAS_READ_ONLY === "1"
}

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

export function nodeBinary(): string {
  return process.execPath
}
