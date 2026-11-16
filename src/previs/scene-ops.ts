import { z } from "zod"
import {
  PREVIS_LIMITS,
  createPrevisCamera,
  createPrevisTransform,
  formatPrevisIssues,
  previsCameraMoves,
  previsEasings,
  previsEntityByRef,
  previsEntitySchema,
  previsSceneSchema,
  previsShotSizes,
  previsShapes,
  previsEntityRoles,
  previsTransformSchema,
  type PrevisCamera,
  type PrevisCameraMove,
  type PrevisEntity,
  type PrevisScene,
  type PrevisShot,
  type PrevisVec3,
} from "./scene-schema"
import { clampTime, sampleCamera, shotSizeDistanceFactor } from "./scene-sample"

/**
 * The edit vocabulary a previs prompt is compiled into.
 *
 * Two properties matter:
 *  - the list is small and closed, so a language model can only ever ask for a
 *    validated edit (never arbitrary code or geometry);
 *  - camera intent stays in film language (`move_camera` + `tilt_down` /
 *    `pull_back` / `shotSize`) and the reducer is what turns it into geometric
 *    keyframes, so "Pull back to a wide shot" is reproducible instead of being
 *    a prompt-level hope.
 */

const entityRef = {
  entityId: z.string().trim().min(1).max(64).optional(),
  entityName: z.string().trim().min(1).max(PREVIS_LIMITS.nameChars).optional(),
}
const vec3 = z.tuple([
  z.number().finite().min(-PREVIS_LIMITS.coordinateAbsMax).max(PREVIS_LIMITS.coordinateAbsMax),
  z.number().finite().min(-PREVIS_LIMITS.coordinateAbsMax).max(PREVIS_LIMITS.coordinateAbsMax),
  z.number().finite().min(-PREVIS_LIMITS.coordinateAbsMax).max(PREVIS_LIMITS.coordinateAbsMax),
])
const scaleVec3 = z.tuple([
  z.number().finite().min(PREVIS_LIMITS.scaleMin).max(PREVIS_LIMITS.scaleMax),
  z.number().finite().min(PREVIS_LIMITS.scaleMin).max(PREVIS_LIMITS.scaleMax),
  z.number().finite().min(PREVIS_LIMITS.scaleMin).max(PREVIS_LIMITS.scaleMax),
])
const rotationVec3 = z.tuple([
  z.number().finite().min(-360).max(360),
  z.number().finite().min(-360).max(360),
  z.number().finite().min(-360).max(360),
])
const keyframeTime = z.number().finite().min(0).max(PREVIS_LIMITS.shotSeconds)
const easing = z.enum(previsEasings)

const entityKeyframeInput = z
  .object({
    t: keyframeTime,
    position: vec3.optional(),
    rotation: rotationVec3.optional(),
    scale: scaleVec3.optional(),
    easing: easing.optional(),
  })
  .strict()

const cameraKeyframeInput = z
  .object({
    t: keyframeTime,
    position: vec3.optional(),
    target: vec3.optional(),
    fovDeg: z.number().finite().min(PREVIS_LIMITS.fovDegMin).max(PREVIS_LIMITS.fovDegMax).optional(),
    easing: easing.optional(),
  })
  .strict()

const entityInput = previsEntitySchema.extend({
  id: z.string().trim().min(1).max(64).optional(),
  // Geometry is optional for an *op*: "add a drone" is a complete instruction,
  // and the reducer fills in an origin transform. The stored scene always has a
  // full transform (previs_scene@1 requires it).
  transform: previsTransformSchema.optional(),
})
const cameraInput = z
  .object({
    id: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(PREVIS_LIMITS.nameChars),
    position: vec3,
    target: vec3,
    fovDeg: z.number().finite().min(PREVIS_LIMITS.fovDegMin).max(PREVIS_LIMITS.fovDegMax),
    keyframes: z.array(cameraKeyframeInput).max(PREVIS_LIMITS.keyframesPerTrack).optional(),
  })
  .strict()
const shotInput = z
  .object({
    id: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(PREVIS_LIMITS.nameChars),
    cameraId: z.string().trim().min(1).max(64),
    durationSeconds: z.number().finite().gt(0).max(PREVIS_LIMITS.shotSeconds),
    shotSize: z.enum(previsShotSizes).optional(),
    promptOverride: z.string().trim().max(PREVIS_LIMITS.descriptionChars).optional(),
  })
  .strict()

export const previsOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replace_scene"), scene: previsSceneSchema }).strict(),
  z.object({ op: z.literal("add_entity"), entity: entityInput }).strict(),
  z.object({ op: z.literal("remove_entity"), ...entityRef }).strict(),
  z
    .object({
      op: z.literal("set_entity_transform"),
      ...entityRef,
      position: vec3.optional(),
      rotation: rotationVec3.optional(),
      scale: scaleVec3.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("animate_entity"),
      ...entityRef,
      keyframes: z.array(entityKeyframeInput).min(1).max(PREVIS_LIMITS.keyframesPerTrack),
    })
    .strict(),
  z
    .object({
      op: z.literal("swap_entity"),
      ...entityRef,
      name: z.string().trim().min(1).max(PREVIS_LIMITS.nameChars).optional(),
      shape: z.enum(previsShapes).optional(),
      role: z.enum(previsEntityRoles).optional(),
      scale: scaleVec3.optional(),
      description: z.string().trim().max(PREVIS_LIMITS.descriptionChars).optional(),
      assetId: z.string().trim().min(1).max(64).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("set_camera"),
      cameraId: z.string().trim().min(1).max(64).optional(),
      name: z.string().trim().min(1).max(PREVIS_LIMITS.nameChars).optional(),
      position: vec3.optional(),
      target: vec3.optional(),
      fovDeg: z.number().finite().min(PREVIS_LIMITS.fovDegMin).max(PREVIS_LIMITS.fovDegMax).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("move_camera"),
      cameraId: z.string().trim().min(1).max(64).optional(),
      move: z.enum(previsCameraMoves),
      amount: z.number().finite().min(0.05).max(4).optional(),
      durationSeconds: z.number().finite().min(0.5).max(PREVIS_LIMITS.shotSeconds).optional(),
      shotSize: z.enum(previsShotSizes).optional(),
    })
    .strict(),
  z.object({ op: z.literal("add_shot"), shot: shotInput }).strict(),
  z
    .object({
      op: z.literal("update_shot"),
      shotId: z.string().trim().min(1).max(64),
      name: z.string().trim().min(1).max(PREVIS_LIMITS.nameChars).optional(),
      cameraId: z.string().trim().min(1).max(64).optional(),
      durationSeconds: z.number().finite().gt(0).max(PREVIS_LIMITS.shotSeconds).optional(),
      shotSize: z.enum(previsShotSizes).optional(),
      promptOverride: z.string().trim().max(PREVIS_LIMITS.descriptionChars).optional(),
    })
    .strict(),
  z.object({ op: z.literal("remove_shot"), shotId: z.string().trim().min(1).max(64) }).strict(),
])

export type PrevisOp = z.infer<typeof previsOpSchema>

export type PrevisOpResult = {
  scene: PrevisScene
  applied: number
  /** Empty when every op applied; otherwise the scene is returned unchanged. */
  issues: string[]
}

function cloneScene(scene: PrevisScene): PrevisScene {
  return JSON.parse(JSON.stringify(scene)) as PrevisScene
}

function nextId(prefix: string, existing: string[]): string {
  const used = new Set(existing)
  for (let index = 1; index <= 999; index += 1) {
    const candidate = `${prefix}-${index}`
    if (!used.has(candidate)) return candidate
  }
  return `${prefix}-${Date.now().toString(36)}`
}

function channelDistance(left: PrevisVec3, right: PrevisVec3): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
}

function normalizeVec3(value: PrevisVec3): PrevisVec3 {
  const length = Math.hypot(value[0], value[1], value[2])
  return length <= 1e-6 ? [0, 0, 0] : [value[0] / length, value[1] / length, value[2] / length]
}

function cross(left: PrevisVec3, right: PrevisVec3): PrevisVec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function addScaled(base: PrevisVec3, direction: PrevisVec3, amount: number): PrevisVec3 {
  return [base[0] + direction[0] * amount, base[1] + direction[1] * amount, base[2] + direction[2] * amount]
}

/** Horizontal part of a direction: a dolly keeps the camera's height. */
function horizontalDirection(direction: PrevisVec3): PrevisVec3 {
  const length = Math.hypot(direction[0], direction[2])
  return length <= 1e-6 ? [0, 0, 0] : [direction[0] / length, 0, direction[2] / length]
}

/** The camera basis at the end of its existing animation (or its base pose). */
function cameraBasisAtEnd(camera: PrevisCamera) {
  let endTime = 0
  for (const keyframe of camera.keyframes || []) endTime = Math.max(endTime, keyframe.t)
  const sampled = sampleCamera(camera, endTime)
  const forward = normalizeVec3([
    sampled.target[0] - sampled.position[0],
    sampled.target[1] - sampled.position[1],
    sampled.target[2] - sampled.position[2],
  ])
  const right = normalizeVec3(cross(forward, [0, 1, 0]))
  const up = normalizeVec3(cross(right, forward))
  return { endTime, sampled, forward, right, up }
}

function movedCameraPose(
  camera: PrevisCamera,
  op: { move: PrevisCameraMove; amount?: number; shotSize?: string },
): { position: PrevisVec3; target: PrevisVec3; fovDeg: number } {
  const { sampled, forward, right, up } = cameraBasisAtEnd(camera)
  const distance = Math.max(channelDistance(sampled.position, sampled.target), 0.5)
  const amount = op.amount ?? 0.45
  let position: PrevisVec3 = [...sampled.position]
  let target: PrevisVec3 = [...sampled.target]

  switch (op.move) {
    case "tilt_down":
      target = addScaled(target, up, -amount * distance)
      break
    case "tilt_up":
      target = addScaled(target, up, amount * distance)
      break
    case "pan_left":
      target = addScaled(target, right, -amount * distance)
      break
    case "pan_right":
      target = addScaled(target, right, amount * distance)
      break
    case "push_in":
      position = addScaled(position, horizontalDirection(forward), amount * distance * 0.8)
      break
    case "pull_back":
      position = addScaled(position, horizontalDirection(forward), -amount * distance * 0.8)
      break
    case "crane_up":
      position = addScaled(position, up, amount * 2)
      target = addScaled(target, up, amount * 2)
      break
    case "crane_down":
      position = addScaled(position, up, -amount * 2)
      target = addScaled(target, up, -amount * 2)
      break
    default:
      break
  }

  const sizeFactor = shotSizeDistanceFactor(op.shotSize)
  if (sizeFactor !== 1) {
    // A wider/narrower shot changes the horizontal framing and sits a little
    // higher; the camera must not read as a crane move just because it pulled back.
    position = [
      target[0] + (position[0] - target[0]) * sizeFactor,
      position[1] + (sizeFactor - 1) * 0.28,
      target[2] + (position[2] - target[2]) * sizeFactor,
    ]
  }
  position = position.map(component => clampCoordinate(component)) as PrevisVec3
  target = target.map(component => clampCoordinate(component)) as PrevisVec3
  return { position, target, fovDeg: sampled.fovDeg }
}

function clampCoordinate(value: number): number {
  const limit = PREVIS_LIMITS.coordinateAbsMax
  return Math.min(Math.max(value, -limit), limit)
}

function withCameraMove(camera: PrevisCamera, op: { move: PrevisCameraMove; amount?: number; durationSeconds?: number; shotSize?: string }): PrevisCamera {
  if (op.move === "static" && !op.shotSize) return camera
  const { endTime, sampled } = cameraBasisAtEnd(camera)
  const available = PREVIS_LIMITS.shotSeconds - endTime
  const duration = Math.max(0.5, Math.min(op.durationSeconds ?? Math.max(available, 3), available))
  const moved = movedCameraPose(camera, op)
  const pinned: PrevisCamera[] = []
  const existing = camera.keyframes || []
  const keep = existing.filter(keyframe => keyframe.t < endTime)
  const startKeyframe = {
    t: clampTime(endTime),
    position: sampled.position,
    target: sampled.target,
    fovDeg: sampled.fovDeg,
    easing: "easeInOut" as const,
  }
  const endKeyframe = {
    t: clampTime(endTime + duration),
    position: moved.position,
    target: moved.target,
    fovDeg: moved.fovDeg,
    easing: "easeInOut" as const,
  }
  void pinned
  const keyframes = [...keep, startKeyframe, endKeyframe]
    .sort((left, right) => left.t - right.t)
    .slice(-PREVIS_LIMITS.keyframesPerTrack)
  return { ...camera, keyframes }
}

function normalizeEntityKeyframes(keyframes: PrevisEntity["keyframes"]): PrevisEntity["keyframes"] {
  if (!keyframes || keyframes.length === 0) return undefined
  return [...keyframes].sort((left, right) => left.t - right.t).slice(0, PREVIS_LIMITS.keyframesPerTrack)
}

function requireEntityRef(ref: { entityId?: string; entityName?: string }): string | null {
  if (ref.entityId || ref.entityName) return null
  return "缺少 entityId 或 entityName"
}

/**
 * Pre-flight one validated op against the current scene: every reason the op
 * could not be applied. Reporting all of them at once is what makes an agent
 * loop cheap — the model gets "entity 2 is unknown AND shot 4 needs a camera in
 * one reply" instead of discovering failures one round trip at a time.
 */
function planOpIssues(scene: PrevisScene, op: PrevisOp): string[] {
  const entityRefIssue = (ref: { entityId?: string; entityName?: string }): string[] => {
    if (!ref.entityId && !ref.entityName) return ["缺少 entityId 或 entityName"]
    if (!previsEntityByRef(scene, ref)) return [`找不到实体 ${ref.entityId || ref.entityName}`]
    return []
  }
  switch (op.op) {
    case "add_entity":
      return scene.entities.length >= PREVIS_LIMITS.entities ? [`实体数量已达上限 ${PREVIS_LIMITS.entities}`] : []
    case "remove_entity":
    case "set_entity_transform":
    case "animate_entity":
    case "swap_entity":
      return entityRefIssue(op)
    case "add_shot":
      return scene.shots.length >= PREVIS_LIMITS.shots ? [`镜头数量已达上限 ${PREVIS_LIMITS.shots}`] : []
    case "update_shot":
    case "remove_shot":
      return scene.shots.some(shot => shot.id === op.shotId) ? [] : [`找不到镜头 ${op.shotId}`]
    case "set_camera":
      if (op.cameraId && !scene.cameras.some(camera => camera.id === op.cameraId) && scene.cameras.length >= PREVIS_LIMITS.cameras) {
        return [`机位数量已达上限 ${PREVIS_LIMITS.cameras}`]
      }
      return []
    case "move_camera":
      return scene.cameras.length === 0 ? ["场景没有可用机位"] : []
    default:
      return []
  }
}

/**
 * Validate every op first, then apply them all. A single invalid op rejects the
 * whole batch and leaves the scene untouched — a language model must never be
 * able to leave a half-applied edit behind.
 */
export function applyPrevisOps(scene: PrevisScene, ops: unknown[]): PrevisOpResult {
  const parsed: PrevisOp[] = []
  const issues: string[] = []
  ops.forEach((raw, index) => {
    const result = previsOpSchema.safeParse(raw)
    if (result.success) parsed.push(result.data)
    else issues.push(`ops[${index}]: ${formatPrevisIssues(result.error).join("；")}`)
  })
  // Report schema failures *and* pre-flight failures in one reply; the batch is
  // rejected either way, so hiding the second class only costs a round trip.
  parsed.forEach((op, index) => {
    for (const issue of planOpIssues(scene, op)) issues.push(`ops[${index}]: ${issue}`)
  })
  const plannedEntities = parsed.filter(op => op.op === "add_entity").length
  if (scene.entities.length + plannedEntities > PREVIS_LIMITS.entities) {
    issues.push(`ops: 实体数量将超过上限 ${PREVIS_LIMITS.entities}`)
  }
  const plannedShots = parsed.filter(op => op.op === "add_shot").length
  if (scene.shots.length + plannedShots > PREVIS_LIMITS.shots) {
    issues.push(`ops: 镜头数量将超过上限 ${PREVIS_LIMITS.shots}`)
  }
  if (issues.length > 0) return { scene, applied: 0, issues }

  const next = cloneScene(scene)
  for (const op of parsed) {
    switch (op.op) {
      case "replace_scene": {
        return { scene: cloneScene(op.scene), applied: parsed.length, issues: [] }
      }
      case "add_entity": {
        if (next.entities.length >= PREVIS_LIMITS.entities) {
          return { scene, applied: 0, issues: [`实体数量已达上限 ${PREVIS_LIMITS.entities}`] }
        }
        const entity: PrevisEntity = {
          ...op.entity,
          id: op.entity.id || nextId("entity", next.entities.map(item => item.id)),
          transform: op.entity.transform ?? createPrevisTransform(),
          keyframes: normalizeEntityKeyframes(op.entity.keyframes),
        }
        next.entities.push(entity)
        break
      }
      case "remove_entity": {
        const missing = requireEntityRef(op)
        if (missing) return { scene, applied: 0, issues: [missing] }
        const target = previsEntityByRef(next, op)
        if (!target) return { scene, applied: 0, issues: [`找不到实体 ${op.entityId || op.entityName}`] }
        next.entities = next.entities.filter(entity => entity.id !== target.id)
        break
      }
      case "set_entity_transform": {
        const missing = requireEntityRef(op)
        if (missing) return { scene, applied: 0, issues: [missing] }
        const target = previsEntityByRef(next, op)
        if (!target) return { scene, applied: 0, issues: [`找不到实体 ${op.entityId || op.entityName}`] }
        if (op.position) target.transform.position = [...op.position]
        if (op.rotation) target.transform.rotation = [...op.rotation]
        if (op.scale) target.transform.scale = [...op.scale]
        break
      }
      case "animate_entity": {
        const missing = requireEntityRef(op)
        if (missing) return { scene, applied: 0, issues: [missing] }
        const target = previsEntityByRef(next, op)
        if (!target) return { scene, applied: 0, issues: [`找不到实体 ${op.entityId || op.entityName}`] }
        target.keyframes = normalizeEntityKeyframes(op.keyframes)
        break
      }
      case "swap_entity": {
        const missing = requireEntityRef(op)
        if (missing) return { scene, applied: 0, issues: [missing] }
        const target = previsEntityByRef(next, op)
        if (!target) return { scene, applied: 0, issues: [`找不到实体 ${op.entityId || op.entityName}`] }
        // Identity (id + transform + keyframes) is preserved: a swap changes what
        // the entity *is*, never where it is or how it moves, so an in-flight
        // animation and a later "back to the lizard" both keep working.
        if (op.name) target.name = op.name
        if (op.shape) target.shape = op.shape
        if (op.role) target.role = op.role
        if (op.scale) target.transform.scale = [...op.scale]
        if (op.description !== undefined) target.description = op.description
        if (op.assetId) target.assetId = op.assetId
        break
      }
      case "set_camera": {
        const existing = op.cameraId ? next.cameras.find(camera => camera.id === op.cameraId) : undefined
        if (existing) {
          if (op.name) existing.name = op.name
          if (op.position) existing.position = [...op.position]
          if (op.target) existing.target = [...op.target]
          if (op.fovDeg !== undefined) existing.fovDeg = op.fovDeg
          break
        }
        if (next.cameras.length >= PREVIS_LIMITS.cameras) {
          return { scene, applied: 0, issues: [`机位数量已达上限 ${PREVIS_LIMITS.cameras}`] }
        }
        next.cameras.push(createPrevisCamera({
          id: op.cameraId || nextId("camera", next.cameras.map(camera => camera.id)),
          name: op.name || `机位 ${next.cameras.length + 1}`,
          ...(op.position ? { position: op.position } : {}),
          ...(op.target ? { target: op.target } : {}),
          ...(op.fovDeg !== undefined ? { fovDeg: op.fovDeg } : {}),
        }))
        break
      }
      case "move_camera": {
        const existing = op.cameraId ? next.cameras.find(camera => camera.id === op.cameraId) : next.cameras[0]
        if (!existing) return { scene, applied: 0, issues: ["场景没有可用机位"] }
        const moved = withCameraMove(existing, op)
        existing.keyframes = moved.keyframes
        // "Pull back to a wide shot" changes the framing *and* the shot's declared
        // size, so the storyboard, the batch and the render prompt all agree.
        if (op.shotSize) {
          for (const shot of next.shots) {
            if (shot.cameraId !== existing.id) continue
            shot.shotSize = op.shotSize
            shot.status = "draft"
          }
        }
        break
      }
      case "add_shot": {
        if (next.shots.length >= PREVIS_LIMITS.shots) {
          return { scene, applied: 0, issues: [`镜头数量已达上限 ${PREVIS_LIMITS.shots}`] }
        }
        const shot: PrevisShot = {
          ...op.shot,
          id: op.shot.id || nextId("shot", next.shots.map(item => item.id)),
          status: "draft",
        }
        next.shots.push(shot)
        break
      }
      case "update_shot": {
        const target = next.shots.find(shot => shot.id === op.shotId)
        if (!target) return { scene, applied: 0, issues: [`找不到镜头 ${op.shotId}`] }
        if (op.name) target.name = op.name
        if (op.cameraId) target.cameraId = op.cameraId
        if (op.durationSeconds !== undefined) target.durationSeconds = op.durationSeconds
        if (op.shotSize) target.shotSize = op.shotSize
        if (op.promptOverride !== undefined) target.promptOverride = op.promptOverride
        target.status = "draft"
        break
      }
      case "remove_shot": {
        if (!next.shots.some(shot => shot.id === op.shotId)) {
          return { scene, applied: 0, issues: [`找不到镜头 ${op.shotId}`] }
        }
        next.shots = next.shots.filter(shot => shot.id !== op.shotId)
        break
      }
      default:
        break
    }
  }

  const validated = previsSceneSchema.safeParse(next)
  if (!validated.success) {
    return { scene, applied: 0, issues: formatPrevisIssues(validated.error) }
  }
  return { scene: validated.data, applied: parsed.length, issues: [] }
}

/** Human-readable one-liner for a revision label / chat bubble. */
export function previsOpSummary(op: PrevisOp): string {
  switch (op.op) {
    case "replace_scene":
      return `重写场景（${op.scene.entities.length} 个实体 / ${op.scene.shots.length} 个镜头）`
    case "add_entity":
      return `新增“${op.entity.name}”`
    case "remove_entity":
      return `删除 ${op.entityName || op.entityId}`
    case "set_entity_transform":
      return `调整 ${op.entityName || op.entityId} 的位置/朝向/大小`
    case "animate_entity":
      return `${op.entityName || op.entityId} 动画（${op.keyframes.length} 个关键帧）`
    case "swap_entity":
      return `替换 ${op.entityName || op.entityId} → ${op.name || op.shape || "新资产"}`
    case "set_camera":
      return `设置机位 ${op.name || op.cameraId || "1"}`
    case "move_camera": {
      const moveLabel: Record<string, string> = {
        static: "固定机位",
        tilt_down: "镜头下俯",
        tilt_up: "镜头上仰",
        pan_left: "左摇",
        pan_right: "右摇",
        push_in: "推近",
        pull_back: "拉远",
        crane_up: "升镜",
        crane_down: "降镜",
      }
      const size = op.shotSize ? `（${op.shotSize}）` : ""
      return `运镜：${moveLabel[op.move] || op.move}${size}`
    }
    case "add_shot":
      return `新增镜头“${op.shot.name}”`
    case "update_shot":
      return `调整镜头 ${op.shotId}`
    case "remove_shot":
      return `删除镜头 ${op.shotId}`
    default:
      return "编辑"
  }
}
