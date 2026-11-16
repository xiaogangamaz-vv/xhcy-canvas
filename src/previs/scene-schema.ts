import { z } from "zod"

/**
 * `previs_scene@1` — the 3D previs document a `previs` canvas node carries.
 *
 * Mirrors the product video (TapNow 3D Studio 2.0 "Agentic Previs"): a text
 * prompt builds a low-poly blockout scene, then further prompts move the
 * camera, animate entities and swap assets. The document is renderer-agnostic
 * on purpose: `scene-render.ts` is a deterministic software renderer today, so
 * nothing here depends on a 3D library.
 *
 * Sizes are bounded because the document lives in node params (a JSON
 * string) and because every value can come from a language model.
 */
export const PREVIS_SCENE_SCHEMA_VERSION = "previs_scene@1"

export const PREVIS_LIMITS = {
  entities: 60,
  cameras: 12,
  shots: 24,
  keyframesPerTrack: 24,
  shotSeconds: 30,
  nameChars: 60,
  descriptionChars: 400,
  fovDegMin: 12,
  fovDegMax: 90,
  scaleMin: 0.05,
  scaleMax: 20,
  coordinateAbsMax: 500,
  groundHalfExtent: 400,
} as const

export const previsShapes = ["box", "sphere", "cylinder", "cone", "capsule", "wedge", "plane"] as const
export const previsEntityRoles = ["character", "prop", "set", "effect"] as const
export const previsEasings = ["linear", "easeInOut"] as const
export const previsShotStatuses = ["draft", "rendered", "failed"] as const
/** Film-language camera moves; the reducer turns them into geometric keyframes. */
export const previsCameraMoves = [
  "static",
  "tilt_down",
  "tilt_up",
  "pan_left",
  "pan_right",
  "push_in",
  "pull_back",
  "crane_up",
  "crane_down",
] as const
export const previsShotSizes = ["wide", "medium", "close", "extreme_close"] as const

export type PrevisShape = (typeof previsShapes)[number]
export type PrevisEntityRole = (typeof previsEntityRoles)[number]
export type PrevisEasing = (typeof previsEasings)[number]
export type PrevisShotStatus = (typeof previsShotStatuses)[number]
export type PrevisCameraMove = (typeof previsCameraMoves)[number]
export type PrevisShotSize = (typeof previsShotSizes)[number]
export type PrevisVec3 = [number, number, number]

const coordinate = z.number().finite().min(-PREVIS_LIMITS.coordinateAbsMax).max(PREVIS_LIMITS.coordinateAbsMax)
const positiveCoordinate = z.number().finite().gt(0).max(PREVIS_LIMITS.coordinateAbsMax)
const vec3 = z.tuple([coordinate, coordinate, coordinate])
const scaleComponent = z.number().finite().min(PREVIS_LIMITS.scaleMin).max(PREVIS_LIMITS.scaleMax)
const rotationComponent = z.number().finite().min(-360).max(360)
const name = z.string().trim().min(1).max(PREVIS_LIMITS.nameChars)
const description = z.string().trim().max(PREVIS_LIMITS.descriptionChars)
const keyframeTime = z.number().finite().min(0).max(PREVIS_LIMITS.shotSeconds)
const easing = z.enum(previsEasings)

export const previsTransformSchema = z
  .object({
    position: vec3,
    rotation: z.tuple([rotationComponent, rotationComponent, rotationComponent]),
    scale: z.tuple([scaleComponent, scaleComponent, scaleComponent]),
  })
  .strict()

const previsEntityKeyframeSchema = z
  .object({
    t: keyframeTime,
    position: vec3.optional(),
    rotation: z.tuple([rotationComponent, rotationComponent, rotationComponent]).optional(),
    scale: z.tuple([scaleComponent, scaleComponent, scaleComponent]).optional(),
    easing: easing.optional(),
  })
  .strict()

export const previsEntitySchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name,
    role: z.enum(previsEntityRoles),
    shape: z.enum(previsShapes),
    transform: previsTransformSchema,
    keyframes: z.array(previsEntityKeyframeSchema).max(PREVIS_LIMITS.keyframesPerTrack).optional(),
    assetId: z.string().trim().min(1).max(64).optional(),
    description: description.optional(),
  })
  .strict()

const previsCameraKeyframeSchema = z
  .object({
    t: keyframeTime,
    position: vec3.optional(),
    target: vec3.optional(),
    fovDeg: z.number().finite().min(PREVIS_LIMITS.fovDegMin).max(PREVIS_LIMITS.fovDegMax).optional(),
    easing: easing.optional(),
  })
  .strict()

export const previsCameraSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name,
    position: vec3,
    target: vec3,
    fovDeg: z.number().finite().min(PREVIS_LIMITS.fovDegMin).max(PREVIS_LIMITS.fovDegMax),
    keyframes: z.array(previsCameraKeyframeSchema).max(PREVIS_LIMITS.keyframesPerTrack).optional(),
  })
  .strict()

export const previsShotSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name,
    cameraId: z.string().trim().min(1).max(64),
    durationSeconds: z.number().finite().gt(0).max(PREVIS_LIMITS.shotSeconds),
    status: z.enum(previsShotStatuses),
    shotSize: z.enum(previsShotSizes).optional(),
    promptOverride: description.optional(),
    outputAssetId: z.string().trim().min(1).max(64).optional(),
    outputKind: z.enum(["image", "video"]).optional(),
  })
  .strict()

export const previsWorldSchema = z
  .object({
    groundHalfExtent: positiveCoordinate,
    ambient: z.number().finite().min(0).max(1),
    keyLightAzimuthDeg: z.number().finite().min(-360).max(360),
    keyLightElevationDeg: z.number().finite().min(0).max(90),
    grid: z.boolean(),
  })
  .strict()

export const previsSceneSchema = z
  .object({
    schemaVersion: z.literal(PREVIS_SCENE_SCHEMA_VERSION),
    title: z.string().trim().max(PREVIS_LIMITS.nameChars),
    prompt: description,
    world: previsWorldSchema,
    entities: z.array(previsEntitySchema).max(PREVIS_LIMITS.entities),
    cameras: z.array(previsCameraSchema).min(1).max(PREVIS_LIMITS.cameras),
    shots: z.array(previsShotSchema).max(PREVIS_LIMITS.shots),
  })
  .strict()

export type PrevisTransform = z.infer<typeof previsTransformSchema>
export type PrevisEntityKeyframe = z.infer<typeof previsEntityKeyframeSchema>
export type PrevisCameraKeyframe = z.infer<typeof previsCameraKeyframeSchema>
export type PrevisEntity = z.infer<typeof previsEntitySchema>
export type PrevisCamera = z.infer<typeof previsCameraSchema>
export type PrevisShot = z.infer<typeof previsShotSchema>
export type PrevisWorld = z.infer<typeof previsWorldSchema>
export type PrevisScene = z.infer<typeof previsSceneSchema>

export function createPrevisTransform(overrides: Partial<PrevisTransform> = {}): PrevisTransform {
  return {
    position: overrides.position ? [...overrides.position] : [0, 0, 0],
    rotation: overrides.rotation ? [...overrides.rotation] : [0, 0, 0],
    scale: overrides.scale ? [...overrides.scale] : [1, 1, 1],
  }
}

export function createEmptyPrevisScene(input: { title?: string; prompt?: string } = {}): PrevisScene {
  return {
    schemaVersion: PREVIS_SCENE_SCHEMA_VERSION,
    title: (input.title || "新预演场景").slice(0, PREVIS_LIMITS.nameChars),
    prompt: (input.prompt || "").slice(0, PREVIS_LIMITS.descriptionChars),
    world: {
      groundHalfExtent: 24,
      ambient: 0.34,
      keyLightAzimuthDeg: 38,
      keyLightElevationDeg: 52,
      grid: true,
    },
    entities: [],
    cameras: [createPrevisCamera({ name: "机位 1" })],
    shots: [],
  }
}

export function createPrevisCamera(overrides: Partial<PrevisCamera> = {}): PrevisCamera {
  return {
    id: overrides.id || "camera-1",
    name: (overrides.name || "机位 1").slice(0, PREVIS_LIMITS.nameChars),
    position: overrides.position ? [...overrides.position] : [7, 3.4, 9],
    target: overrides.target ? [...overrides.target] : [0, 1.2, 0],
    fovDeg: overrides.fovDeg ?? 40,
    ...(overrides.keyframes ? { keyframes: overrides.keyframes } : {}),
  }
}

export function formatPrevisIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 8).map(issue => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)"
    return `${path}: ${issue.message}`
  })
}

/** Throwing parse used by the node write boundary and by the ops reducer. */
export function parsePrevisScene(value: unknown): PrevisScene {
  const result = previsSceneSchema.safeParse(value)
  if (!result.success) {
    throw new Error(`预演场景不符合 ${PREVIS_SCENE_SCHEMA_VERSION}：${formatPrevisIssues(result.error).join("；")}`)
  }
  return result.data
}

export function safeParsePrevisScene(value: unknown): { ok: true; scene: PrevisScene } | { ok: false; issues: string[] } {
  const result = previsSceneSchema.safeParse(value)
  return result.success ? { ok: true, scene: result.data } : { ok: false, issues: formatPrevisIssues(result.error) }
}

export function previsEntitiesByName(scene: PrevisScene, query: string): PrevisEntity[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  return scene.entities.filter(entity => entity.name.toLowerCase().includes(needle))
}

export function previsEntityByRef(scene: PrevisScene, ref: { entityId?: string; entityName?: string }): PrevisEntity | null {
  if (ref.entityId) {
    const byId = scene.entities.find(entity => entity.id === ref.entityId)
    if (byId) return byId
  }
  if (ref.entityName) {
    const matches = previsEntitiesByName(scene, ref.entityName)
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
      // Prefer an exact (case-insensitive) name, then the first match.
      const exact = matches.find(entity => entity.name.toLowerCase() === ref.entityName!.trim().toLowerCase())
      return exact || matches[0]
    }
  }
  return null
}

export function previsCameraById(scene: PrevisScene, cameraId: string | undefined): PrevisCamera {
  if (cameraId) {
    const found = scene.cameras.find(camera => camera.id === cameraId)
    if (found) return found
  }
  return scene.cameras[0]
}
