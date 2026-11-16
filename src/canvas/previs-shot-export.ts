import { paintPrevisFrame } from "@/canvas/previs-paint"
import {
  previsDocumentScene,
  previsShotById,
  renderPrevisFrame,
  safeParsePrevisDocument,
  type PrevisDocument,
  type PrevisScene,
} from "@/previs"

export const PREVIS_SHOT_EXPORT_WIDTH = 1280
export const PREVIS_SHOT_EXPORT_HEIGHT = 720

export function previsShotFileName(shotName: string, shotId: string): string {
  const slug = (shotName || "shot").trim().replace(/[^\w\u4e00-\u9fff-]+/g, "-").replace(/^-+|-+$/g, "") || "shot"
  return `${slug}-${shotId.slice(0, 8)}.png`
}

export async function renderPrevisShotPng(input: {
  document: PrevisDocument | string
  shotId?: string
  timeSeconds?: number
  width?: number
  height?: number
}): Promise<{ dataUrl: string; width: number; height: number; shotId: string; shotName: string }> {
  const previsDocument = typeof input.document === "string"
    ? safeParsePrevisDocument(JSON.parse(input.document))
    : input.document
  if (!previsDocument) throw new Error("这个预演节点还没有场景，先输入一句场景描述")
  const scene: PrevisScene = previsDocumentScene(previsDocument)
  const shot = previsShotById(scene, input.shotId) || scene.shots[0]
  if (!shot) throw new Error("这个预演还没有镜头")
  const width = input.width || PREVIS_SHOT_EXPORT_WIDTH
  const height = input.height || PREVIS_SHOT_EXPORT_HEIGHT
  const timeSeconds = input.timeSeconds ?? Math.max(0, shot.durationSeconds / 2)
  const frame = renderPrevisFrame({
    scene,
    cameraId: shot.cameraId,
    width,
    height,
    timeSeconds,
  })
  const surface = globalThis.document.createElement("canvas")
  surface.width = width
  surface.height = height
  const context = surface.getContext("2d")
  if (!context) throw new Error("浏览器不支持预演截图（缺少 canvas 2d 上下文）")
  const camera = scene.cameras.find(item => item.id === shot.cameraId) ?? scene.cameras[0]
  if (!camera) throw new Error("这个镜头没有可用机位")
  paintPrevisFrame(context, {
    scene,
    frame,
    camera,
    width,
    height,
    timeSeconds,
    showGrid: false,
    showReticle: false,
  })
  let dataUrl = ""
  try {
    dataUrl = surface.toDataURL("image/png")
  } catch {
    throw new Error("预演截图失败")
  }
  if (!dataUrl.startsWith("data:image/")) throw new Error("预演截图失败")
  return { dataUrl, width, height, shotId: shot.id, shotName: shot.name }
}