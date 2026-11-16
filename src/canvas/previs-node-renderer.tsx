import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import {
  previsDocumentScene,
  previsSceneDurationSeconds,
  renderPrevisFrame,
  safeParsePrevisDocument,
  sampleCamera,
  type PrevisCamera,
  type PrevisScene,
} from "@/previs"
import { paintPrevisFrame } from "@/canvas/previs-paint"

/**
 * `previs` node body — the blockout viewport.
 *
 * The node card owns only *view* state (which camera, where in time, free-orbit
 * inspection); the scene document itself is authored by prompts and persisted in
 * the node params, so this component never writes to the graph. That keeps the
 * 8k-line workspace file out of the render path and makes the viewport
 * replaceable (a three.js viewport could consume the same scene document).
 */

export type CanvasPrevisNodeRendererProps = {
  /** JSON string of `previs_document@1`. */
  documentJson: string
  selected: boolean
}

const CLAY_SKY = "#141210"

function freeOrbitCamera(scene: PrevisScene, yawDeg: number, pitchDeg: number, distance: number): PrevisCamera {
  const focus: [number, number, number] = [0, 1.2, 0]
  const yaw = (yawDeg * Math.PI) / 180
  const pitch = (pitchDeg * Math.PI) / 180
  const horizontal = Math.cos(pitch) * distance
  return {
    id: "previs-free-camera",
    name: "自由视角",
    position: [
      focus[0] + Math.sin(yaw) * horizontal,
      Math.max(0.4, focus[1] + Math.sin(pitch) * distance),
      focus[2] + Math.cos(yaw) * horizontal,
    ],
    target: focus,
    fovDeg: Math.min(90, Math.max(12, scene.cameras[0]?.fovDeg ?? 40)),
  }
}

export function CanvasPrevisNodeRenderer({ documentJson, selected }: CanvasPrevisNodeRendererProps) {
  const document = useMemo(() => safeParsePrevisDocument(safeJson(documentJson)), [documentJson])
  const scene = useMemo(() => (document ? previsDocumentScene(document) : null), [document])

  const [cameraId, setCameraId] = useState<string>("")
  const [freeView, setFreeView] = useState(false)
  const [yaw, setYaw] = useState(24)
  const [pitch, setPitch] = useState(14)
  const [distance, setDistance] = useState(15)
  const [timeSeconds, setTimeSeconds] = useState(0)
  const [playing, setPlaying] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)
  const playStartRef = useRef<{ at: number; started: number } | null>(null)
  // Node cards are resizable and the viewport is fluid: repaint on any size change
  // instead of only when a React dependency happens to change.
  const [resizeTick, setResizeTick] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => setResizeTick(tick => tick + 1))
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  const duration = scene ? previsSceneDurationSeconds(scene) : 4
  const activeCameraId = cameraId && scene?.cameras.some(item => item.id === cameraId)
    ? cameraId
    : scene?.cameras[0]?.id || ""

  const resetView = useCallback(() => {
    setTimeSeconds(0)
    setPlaying(false)
  }, [])

  useEffect(() => {
    if (!playing) return
    // The play handler pins the start position; the loop only advances the clock,
    // so re-rendering on every frame must not restart the effect.
    const origin = playStartRef.current
    if (!origin) return
    let frame = 0
    const tick = (now: number) => {
      const next = origin.at + (now - origin.started) / 1000
      if (next >= duration) {
        setTimeSeconds(duration)
        setPlaying(false)
        return
      }
      setTimeSeconds(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, duration])

  // Paint the blockout: ground, shadows and flat-shaded primitives, far → near.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !scene) return
    const rect = canvas.getBoundingClientRect()
    const width = Math.max(80, Math.round(rect.width))
    const height = Math.max(60, Math.round(rect.height))
    const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    const context = canvas.getContext("2d")
    if (!context) return
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, width, height)

    const camera = freeView ? freeOrbitCamera(scene, yaw, pitch, distance) : undefined
    const frame = renderPrevisFrame({
      scene,
      cameraId: camera ? undefined : activeCameraId,
      camera,
      width,
      height,
      timeSeconds,
    })

    paintPrevisFrame(context, {
      scene,
      frame,
      camera: camera || scene.cameras.find(item => item.id === frame.cameraId) || scene.cameras[0],
      width,
      height,
      timeSeconds,
      showGrid: true,
      showReticle: !freeView,
    })
  }, [scene, activeCameraId, freeView, yaw, pitch, distance, timeSeconds, resizeTick])

  if (!scene || scene.entities.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-2xl bg-white/[0.02] p-4 text-center text-[11px] leading-5 text-white/45">
        3D 预演：在右侧检查器输入「搭建一个…的场景」，这里会渲染可编辑的低模预演。
      </div>
    )
  }

  const activeShot = scene.shots.find(shot => shot.cameraId === activeCameraId) || scene.shots[0]
  const sampled = sampleCamera(
    freeView ? freeOrbitCamera(scene, yaw, pitch, distance) : (scene.cameras.find(item => item.id === activeCameraId) || scene.cameras[0]),
    timeSeconds,
  )

  return (
    <div className="flex h-full w-full flex-col gap-1.5 overflow-hidden">
      <div
        className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10"
        onPointerDown={event => {
          if (!freeView) return
          dragRef.current = { x: event.clientX, y: event.clientY, yaw, pitch }
          ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
        }}
        onPointerMove={event => {
          const drag = dragRef.current
          if (!drag || !freeView) return
          setYaw(drag.yaw + (event.clientX - drag.x) * 0.4)
          setPitch(Math.max(-6, Math.min(62, drag.pitch - (event.clientY - drag.y) * 0.3)))
        }}
        onPointerUp={() => { dragRef.current = null }}
        onPointerCancel={() => { dragRef.current = null }}
      >
        <canvas ref={canvasRef} className="h-full w-full" style={{ touchAction: "none" }} />
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/45 px-1.5 py-0.5 text-[10px] tabular-nums text-white/70">
          {scene.entities.length} 实体 · {scene.cameras.length} 机位 · {timeSeconds.toFixed(1)}s / {duration.toFixed(1)}s
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 text-[10px]">
        {scene.shots.length > 0 ? scene.shots.map(shot => (
          <button
            key={shot.id}
            type="button"
            className={`rounded px-1.5 py-0.5 tabular-nums transition ${shot.cameraId === activeCameraId && !freeView ? "bg-white/20 text-white" : "bg-surface-hover text-text-secondary hover:text-white"}`}
            onClick={() => {
              setFreeView(false)
              setCameraId(shot.cameraId)
              setTimeSeconds(0)
            }}
            title={shot.promptOverride || shot.name}
          >
            {shot.name} · {shot.durationSeconds}s
          </button>
        )) : null}
        <button
          type="button"
          className={`rounded px-1.5 py-0.5 transition ${freeView ? "bg-white/20 text-white" : "bg-surface-hover text-text-secondary hover:text-white"}`}
          onClick={() => setFreeView(value => !value)}
          title="自由视角：拖动旋转，滚轮缩放"
        >
          自由视角
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2 text-[10px] text-text-secondary">
        <button
          type="button"
          className="rounded bg-surface-hover px-1.5 py-0.5 text-white/80 transition hover:text-white"
          onClick={() => {
            if (playing) {
              setPlaying(false)
              return
            }
            const from = timeSeconds >= duration ? 0 : timeSeconds
            if (from !== timeSeconds) setTimeSeconds(from)
            playStartRef.current = { at: from, started: performance.now() }
            setPlaying(true)
          }}
        >
          {playing ? "暂停" : "播放"}
        </button>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.05}
          value={timeSeconds}
          onChange={event => {
            setPlaying(false)
            setTimeSeconds(Number(event.target.value))
          }}
          className="h-1 min-w-0 flex-1 accent-white/70"
          aria-label="预演时间轴"
        />
        <button type="button" className="rounded bg-surface-hover px-1.5 py-0.5 transition hover:text-white" onClick={resetView}>
          回到开头
        </button>
      </div>

      {freeView ? (
        <input
          type="range"
          min={5}
          max={40}
          step={0.5}
          value={distance}
          onChange={event => setDistance(Number(event.target.value))}
          className="h-1 shrink-0 accent-white/70"
          aria-label="自由视角距离"
        />
      ) : null}

      {document && document.edits.length > 0 ? (
        <div className="shrink-0 truncate text-[10px] text-white/40">
          {document.cursor}/{document.edits.length} 步 · 最近：{document.edits[document.cursor - 1]?.label || "—"}
          {sampled.fovDeg ? ` · ${Math.round(sampled.fovDeg)}°` : ""}
          {selected ? " · 已选中" : ""}
        </div>
      ) : null}
    </div>
  )
}

function safeJson(value: string): unknown {
  if (!value || !value.trim()) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export const CANVAS_PREVIS_RENDERER_COMPONENTS = {
  previs: CanvasPrevisNodeRenderer,
} satisfies Record<"previs", ComponentType<CanvasPrevisNodeRendererProps>>
