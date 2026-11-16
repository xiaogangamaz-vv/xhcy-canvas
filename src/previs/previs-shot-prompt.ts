import { previsCameraById, type PrevisCamera, type PrevisScene, type PrevisShot } from "./scene-schema"
import { sampleCamera } from "./scene-sample"

/**
 * Compose the photoreal generation prompt for one previs shot.
 *
 * This is the bridge the product video calls "previs → final": the blockout
 * fixes composition, lens and motion, and this prompt tells the image/video
 * model what the blockout *means*. It is pure and offline so the release gate
 * can assert the wording that reaches a paid upstream.
 */

const SHOT_SIZE_LABELS: Record<string, string> = {
  wide: "全景",
  medium: "中景",
  close: "近景",
  extreme_close: "特写",
}

function distanceAt(camera: PrevisCamera, timeSeconds: number): number {
  const sampled = sampleCamera(camera, timeSeconds)
  return Math.hypot(
    sampled.position[0] - sampled.target[0],
    sampled.position[1] - sampled.target[1],
    sampled.position[2] - sampled.target[2],
  )
}

/** Film-language description of what the camera does across the shot. */
export function describePrevisCameraMotion(camera: PrevisCamera, durationSeconds: number): string[] {
  const start = sampleCamera(camera, 0)
  const end = sampleCamera(camera, durationSeconds)
  const moves: string[] = []
  const startDistance = distanceAt(camera, 0)
  const endDistance = distanceAt(camera, durationSeconds)
  const startAngle = Math.atan2(start.position[2] - start.target[2], start.position[0] - start.target[0])
  const endAngle = Math.atan2(end.position[2] - end.target[2], end.position[0] - end.target[0])
  const angleDelta = Math.abs(((endAngle - startAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI)

  if (endDistance > startDistance * 1.12) moves.push("拉远")
  else if (endDistance < startDistance * 0.88) moves.push("推近")
  if (angleDelta > 0.08) moves.push(endAngle > startAngle ? "右摇" : "左摇")
  if (Math.abs(end.target[1] - start.target[1]) > 0.25) moves.push(end.target[1] < start.target[1] ? "镜头下俯" : "镜头上仰")
  if (Math.abs(end.position[1] - start.position[1]) > 0.5) moves.push(end.position[1] > start.position[1] ? "升镜" : "降镜")
  return moves.length === 0 ? ["固定机位"] : moves
}

/** Which entities a shot shows, in scene order, with the blockout's own words. */
export function describePrevisCast(scene: PrevisScene): { characters: string[]; props: string[] } {
  const label = (entity: { name: string; description?: string }) => (entity.description || entity.name).trim()
  return {
    characters: scene.entities.filter(entity => entity.role === "character").map(label),
    props: scene.entities.filter(entity => entity.role === "prop").map(label),
  }
}

export function previsShotById(scene: PrevisScene, shotId?: string): PrevisShot | null {
  const shot = shotId ? scene.shots.find(item => item.id === shotId) : scene.shots[0]
  return shot || null
}

/**
 * The prompt handed to the image/video model for one shot. The blockout frame is
 * passed alongside it as the reference image, so the composition is carried by
 * pixels and the prompt only has to say what everything *is*.
 */
export function previsShotPrompt(input: {
  scene: PrevisScene
  shotId?: string
  /** Appended verbatim by the caller (style/preset directives). */
  styleHint?: string
}): { prompt: string; shot: PrevisShot | null; cameraId: string; durationSeconds: number } {
  const shot = previsShotById(input.scene, input.shotId)
  const camera = previsCameraById(input.scene, shot?.cameraId)
  const durationSeconds = shot?.durationSeconds ?? 3.5
  const cast = describePrevisCast(input.scene)
  const moves = describePrevisCameraMotion(camera, durationSeconds)
  const shotSize = SHOT_SIZE_LABELS[shot?.shotSize || ""] || ""

  const lines: string[] = []
  const sceneLine = (shot?.promptOverride || input.scene.prompt || "").trim()
  if (sceneLine) lines.push(sceneLine)
  if (cast.characters.length > 0) lines.push(`角色：${cast.characters.join("；")}`)
  if (cast.props.length > 0) lines.push(`道具：${cast.props.join("；")}`)
  lines.push(`构图：${[shotSize, moves.join("+")].filter(Boolean).join(" · ")}，时长 ${durationSeconds}s`)
  lines.push("依据参考预演图的构图与机位生成照片级电影画面：真实材质与光影、景深自然、主体一致，不要保留低模方块感。")
  if (input.styleHint?.trim()) lines.push(input.styleHint.trim())

  return { prompt: lines.join("\n"), shot, cameraId: camera.id, durationSeconds }
}

/** What the reference image is, spelled out for the model. */
export function previsShotReferenceNote(): string {
  return "参考图是 3D 预演 blockout（灰模），只取构图、机位、主体位置与比例。"
}
