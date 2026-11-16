import type { CanvasGenerationRequest } from "@/adapters/host"

export type PlaceholderPreview = {
  dataUrl: string
  width: number
  height: number
}

export type PlaceholderVideo = {
  blob: Blob
  posterDataUrl: string
  width: number
  height: number
  duration: number
  mimeType: string
}

function parseAspect(ratio: string | undefined, fallback: { w: number; h: number }): { w: number; h: number } {
  const raw = (ratio || "").trim().toLowerCase()
  if (!raw || raw === "auto") return fallback
  const [a, b] = raw.split(":").map(Number)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return fallback
  return { w: a, h: b }
}

export function placeholderSize(request: CanvasGenerationRequest): { width: number; height: number } {
  if (request.mediaType === "video") {
    const long = request.resolution === "1080p" ? 960 : 640
    const { w, h } = parseAspect(request.aspectRatio, { w: 16, h: 9 })
    return w >= h
      ? { width: long, height: Math.max(180, Math.round((long * h) / w)) }
      : { width: Math.max(180, Math.round((long * w) / h)), height: long }
  }
  const long = request.imageSize === "4K" ? 1024 : request.imageSize === "1K" ? 512 : 768
  const { w, h } = parseAspect(request.aspectRatio, { w: 1, h: 1 })
  return w >= h
    ? { width: long, height: Math.max(180, Math.round((long * h) / w)) }
    : { width: Math.max(180, Math.round((long * w) / h)), height: long }
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (context.measureText(next).width <= maxWidth) {
      current = next
      continue
    }
    if (current) lines.push(current)
    current = word
    if (lines.length >= maxLines) break
  }
  if (current && lines.length < maxLines) lines.push(current)
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    const last = lines[maxLines - 1]
    lines[maxLines - 1] = last.slice(0, Math.max(1, last.length - 1)) + "…"
  }
  return lines.length ? lines : [text.slice(0, 40)]
}

export function renderPlaceholderDataUrl(request: CanvasGenerationRequest): PlaceholderPreview {
  const { width, height } = placeholderSize(request)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) {
    throw new Error("无法创建预览画布")
  }
  paintPlaceholderFrame(context, request, width, height, 0)
  return { dataUrl: canvas.toDataURL("image/png"), width, height }
}

function paintPlaceholderFrame(
  context: CanvasRenderingContext2D,
  request: CanvasGenerationRequest,
  width: number,
  height: number,
  progress: number,
) {
  const gradient = context.createLinearGradient(0, 0, width, height)
  if (request.mediaType === "video") {
    gradient.addColorStop(0, "#1a1518")
    gradient.addColorStop(1, "#2a2230")
  } else {
    gradient.addColorStop(0, "#181715")
    gradient.addColorStop(1, "#2a2622")
  }
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)
  context.strokeStyle = "rgba(245,245,244,0.18)"
  context.lineWidth = 2
  context.strokeRect(16, 16, width - 32, height - 32)

  context.fillStyle = "rgba(245,245,244,0.88)"
  context.font = `600 ${Math.max(18, Math.round(width / 22))}px ui-sans-serif, system-ui, sans-serif`
  context.fillText(request.mediaType === "video" ? "Video Generator" : "Image Generator", 32, 56)

  context.fillStyle = "rgba(245,245,244,0.55)"
  context.font = `${Math.max(12, Math.round(width / 36))}px ui-sans-serif, system-ui, sans-serif`
  const meta = request.mediaType === "video"
    ? `${request.modelName || request.modelId}  ·  ${request.aspectRatio || "16:9"}  ·  ${request.resolution || "720p"}  ·  ${request.durationSeconds || "4"}s`
    : `${request.modelName || request.modelId}  ·  ${request.aspectRatio || "auto"}  ·  ${request.imageSize || "2K"}`
  context.fillText(meta, 32, 82)

  context.fillStyle = "rgba(245,245,244,0.82)"
  context.font = `${Math.max(16, Math.round(width / 28))}px ui-sans-serif, system-ui, sans-serif`
  const prompt = (request.prompt || "未填写提示词").trim()
  const lines = wrapText(context, prompt, width - 64, 5)
  lines.forEach((line, index) => {
    context.fillText(line, 32, 130 + index * Math.max(24, Math.round(width / 24)))
  })

  context.fillStyle = "rgba(245,245,244,0.4)"
  context.font = `${Math.max(11, Math.round(width / 42))}px ui-sans-serif, system-ui, sans-serif`
  context.fillText("Local mock preview", 32, height - 32)

  if (request.mediaType === "video") {
    const barWidth = width - 64
    context.fillStyle = "rgba(245,245,244,0.12)"
    context.fillRect(32, height - 54, barWidth, 6)
    context.fillStyle = "rgba(245,245,244,0.7)"
    context.fillRect(32, height - 54, Math.max(4, barWidth * progress), 6)
  }
}

function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return null
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ]
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || null
}

export async function renderPlaceholderVideo(request: CanvasGenerationRequest): Promise<PlaceholderVideo> {
  const poster = renderPlaceholderDataUrl(request)
  const mimeType = pickRecorderMime()
  if (!mimeType || typeof HTMLCanvasElement === "undefined" || !HTMLCanvasElement.prototype.captureStream) {
    throw new Error("当前浏览器无法在本地封装可播视频")
  }
  const width = poster.width
  const height = poster.height
  const duration = Math.min(4, Math.max(1.5, Number(request.durationSeconds || "4") || 4))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("无法创建预览画布")

  const stream = canvas.captureStream(15)
  let audioContext: AudioContext | null = null
  try {
    audioContext = new AudioContext()
    if (audioContext.state === "suspended") await audioContext.resume()
    const destination = audioContext.createMediaStreamDestination()
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    oscillator.frequency.value = 196
    gain.gain.value = 0.03
    oscillator.connect(gain)
    gain.connect(destination)
    oscillator.start()
    const audioTrack = destination.stream.getAudioTracks()[0]
    if (audioTrack) stream.addTrack(audioTrack)
    window.setTimeout(() => {
      try { oscillator.stop() } catch { /* already stopped */ }
    }, duration * 1000 + 80)
  } catch {
    audioContext = null
  }

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 280_000 })
  const chunks: BlobPart[] = []
  recorder.ondataavailable = event => {
    if (event.data && event.data.size > 0) chunks.push(event.data)
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error("本地视频封装失败"))
    recorder.onstop = () => {
      void audioContext?.close()
      stream.getTracks().forEach(track => track.stop())
      if (!chunks.length) {
        reject(new Error("本地视频封装失败"))
        return
      }
      resolve(new Blob(chunks, { type: mimeType.split(";")[0] }))
    }
    recorder.start(200)
    const started = performance.now()
    const tick = () => {
      const elapsed = (performance.now() - started) / 1000
      const progress = Math.min(1, elapsed / duration)
      paintPlaceholderFrame(context, request, width, height, progress)
      if (elapsed >= duration) {
        if (recorder.state !== "inactive") recorder.stop()
        return
      }
      requestAnimationFrame(tick)
    }
    tick()
  })

  return {
    blob,
    posterDataUrl: poster.dataUrl,
    width,
    height,
    duration,
    mimeType: blob.type || mimeType.split(";")[0],
  }
}