import type { Plugin } from "vite"
import { defaultRepoRoot } from "./config.ts"
import { createSyncContext, handleSyncRequest } from "./http.ts"

function attachLocalMiddleware(server: { config: { root?: string }; middlewares: { use: Function } }) {
  const repoRoot = server.config.root || defaultRepoRoot()
  const ctx = createSyncContext(repoRoot)
  server.middlewares.use((req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: (error?: unknown) => void) => {
    void handleSyncRequest(ctx, req, res).then(handled => {
      if (!handled) next()
    }).catch(error => {
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader("Content-Type", "application/json; charset=utf-8")
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : "本地同步服务出错" }))
        return
      }
      next(error)
    })
  })
}

export function localWorkspacePlugin(): Plugin {
  return {
    name: "local-workspace-sync",
    configureServer(server) {
      attachLocalMiddleware(server)
    },
    configurePreviewServer(server) {
      attachLocalMiddleware(server)
    },
  }
}
