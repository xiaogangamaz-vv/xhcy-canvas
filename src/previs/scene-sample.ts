import {
  PREVIS_LIMITS,
  type PrevisCamera,
  type PrevisCameraKeyframe,
  type PrevisEasing,
  type PrevisEntity,
  type PrevisEntityKeyframe,
  type PrevisTransform,
  type PrevisVec3,
} from "./scene-schema"

/**
 * Keyframe sampling for the previs document.
 *
 * Keyframes are sparse per channel: a keyframe may set only `position`, only
 * `scale`, or any combination. Each channel is sampled independently and falls
 * back to the entity's base transform, which is what makes "the lizard shrinks
 * while the ball drops" expressible as two independent tracks.
 *
 * Every function here is pure and time-deterministic so the release gate can
 * assert endpoints and midpoints without a browser.
 */

function ease(easing: PrevisEasing | undefined, ratio: number): number {
  if (easing !== "easeInOut") return ratio
  return ratio < 0.5 ? 2 * ratio * ratio : 1 - 2 * (1 - ratio) * (1 - ratio)
}

export function lerpNumber(from: number, to: number, ratio: number): number {
  return from + (to - from) * ratio
}

export function lerpVec3(from: PrevisVec3, to: PrevisVec3, ratio: number): PrevisVec3 {
  return [
    lerpNumber(from[0], to[0], ratio),
    lerpNumber(from[1], to[1], ratio),
    lerpNumber(from[2], to[2], ratio),
  ]
}

type ChannelKeyframe<T> = { t: number; value: T; easing?: PrevisEasing }

function sampleChannel<T>(base: T, keyframes: Array<ChannelKeyframe<T>>, timeSeconds: number, mix: (a: T, b: T, r: number) => T): T {
  if (keyframes.length === 0) return base
  const sorted = [...keyframes].sort((a, b) => a.t - b.t)
  if (timeSeconds <= sorted[0].t) return sorted[0].value
  const last = sorted[sorted.length - 1]
  if (timeSeconds >= last.t) return last.value

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const next = sorted[index]
    if (timeSeconds > next.t) continue
    const span = next.t - previous.t
    const raw = span <= 0 ? 1 : (timeSeconds - previous.t) / span
    return mix(previous.value, next.value, ease(previous.easing, raw))
  }
  return last.value
}

function channelKeyframes<K extends keyof PrevisEntityKeyframe>(
  keyframes: PrevisEntityKeyframe[] | undefined,
  channel: K,
): Array<ChannelKeyframe<NonNullable<PrevisEntityKeyframe[K]>>> {
  const collected: Array<ChannelKeyframe<NonNullable<PrevisEntityKeyframe[K]>>> = []
  for (const keyframe of keyframes || []) {
    const value = keyframe[channel]
    if (value === undefined) continue
    collected.push({ t: keyframe.t, value: value as NonNullable<PrevisEntityKeyframe[K]>, easing: keyframe.easing })
  }
  return collected
}

function channelKeyframesForCamera<K extends keyof PrevisCameraKeyframe>(
  keyframes: PrevisCameraKeyframe[] | undefined,
  channel: K,
): Array<ChannelKeyframe<NonNullable<PrevisCameraKeyframe[K]>>> {
  const collected: Array<ChannelKeyframe<NonNullable<PrevisCameraKeyframe[K]>>> = []
  for (const keyframe of keyframes || []) {
    const value = keyframe[channel]
    if (value === undefined) continue
    collected.push({ t: keyframe.t, value: value as NonNullable<PrevisCameraKeyframe[K]>, easing: keyframe.easing })
  }
  return collected
}

/** The entity's transform at `timeSeconds` (seconds inside the shot). */
export function sampleEntityTransform(entity: PrevisEntity, timeSeconds: number): PrevisTransform {
  const time = clampTime(timeSeconds)
  const base = entity.transform
  return {
    position: sampleChannel<PrevisVec3>(
      base.position,
      channelKeyframes(entity.keyframes, "position"),
      time,
      lerpVec3,
    ),
    rotation: sampleChannel<PrevisVec3>(
      base.rotation,
      channelKeyframes(entity.keyframes, "rotation"),
      time,
      lerpVec3,
    ),
    scale: sampleChannel<PrevisVec3>(
      base.scale,
      channelKeyframes(entity.keyframes, "scale"),
      time,
      lerpVec3,
    ),
  }
}

export type SampledCamera = {
  position: PrevisVec3
  target: PrevisVec3
  fovDeg: number
}

export function sampleCamera(camera: PrevisCamera, timeSeconds: number): SampledCamera {
  const time = clampTime(timeSeconds)
  return {
    position: sampleChannel<PrevisVec3>(
      camera.position,
      channelKeyframesForCamera(camera.keyframes, "position"),
      time,
      lerpVec3,
    ),
    target: sampleChannel<PrevisVec3>(
      camera.target,
      channelKeyframesForCamera(camera.keyframes, "target"),
      time,
      lerpVec3,
    ),
    fovDeg: sampleChannel<number>(
      camera.fovDeg,
      channelKeyframesForCamera(camera.keyframes, "fovDeg"),
      time,
      lerpNumber,
    ),
  }
}

export function clampTime(timeSeconds: number): number {
  if (!Number.isFinite(timeSeconds)) return 0
  return Math.min(Math.max(timeSeconds, 0), PREVIS_LIMITS.shotSeconds)
}

/** The furthest keyframe time in the scene; used to bound playback scrubbing. */
export function previsSceneDurationSeconds(scene: { entities: PrevisEntity[]; cameras: PrevisCamera[]; shots: { durationSeconds: number }[] }): number {
  let duration = 0
  for (const shot of scene.shots) duration = Math.max(duration, shot.durationSeconds)
  for (const entity of scene.entities) {
    for (const keyframe of entity.keyframes || []) duration = Math.max(duration, keyframe.t)
  }
  for (const camera of scene.cameras) {
    for (const keyframe of camera.keyframes || []) duration = Math.max(duration, keyframe.t)
  }
  return Math.min(Math.max(duration, 4), PREVIS_LIMITS.shotSeconds)
}

/**
 * Scale multiplier for the transition between two shot sizes; used when a
 * `move_camera` op carries a `shotSize` ("pull back to a wide shot").
 */
export function shotSizeDistanceFactor(shotSize: string | undefined): number {
  switch (shotSize) {
    case "wide":
      return 1.9
    case "medium":
      return 1.35
    case "close":
      return 0.7
    case "extreme_close":
      return 0.5
    default:
      return 1
  }
}
