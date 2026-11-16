import type { Plugin } from "vite"
import { defaultRepoRoot } from "./config.ts"
import { createSyncContext, handleSyncRequest } from "./http.ts"

export function localWorkspacePlugin(): Plugin {
  return {
    name: "local-workspace-sync",
    configureServer(server) {
      const repoRoot = server.config.root || defaultRepoRoot()
      const ctx = createSyncContext(repoRoot)
      server.middlewares.use((req, res, next) => {
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
    },
  }
}
