import { useMemo } from "react"
import { createMockHost } from "@/adapters/mock"
import { CanvasWorkspace } from "@/canvas/workspace"

export function App() {
  const host = useMemo(() => createMockHost(), [])
  return <CanvasWorkspace host={host} />
}