import {
  PREVIS_LIMITS,
  previsCameraById,
  type PrevisCamera,
  type PrevisEntity,
  type PrevisScene,
  type PrevisShape,
  type PrevisVec3,
} from "./scene-schema"
import { sampleCamera, sampleEntityTransform } from "./scene-sample"

/**
 * Deterministic software renderer for `previs_scene@1`.
 *
 * Why not a 3D library: the whole point of the previs pass is to be a cheap,
 * reproducible blockout. This renderer is pure TypeScript (no WebGL, no DOM), so
 * the release gate can assert projection, depth order and interpolation as plain
 * functions, and the same output drives both the canvas viewport and the
 * "blockout frame → photoreal shot" reference image.
 *
 * Pipeline per frame: shape mesh → entity transform → camera basis → perspective
 * projection with near-plane clipping → painter's algorithm by depth → flat
 * shading from the face normal against the key light. Shadows are the convex
 * hull of the entity's bounding box projected onto the ground along the light.
 */

export const PREVIS_NEAR_PLANE = 0.15
/**
 * The ground quad spans the whole stage, so its *average* depth sits near the
 * camera even though parts of it are far behind every entity. Painter's algorithm
 * would then paint far trees first and let the ground cover them, so the ground
 * is pinned to the back of the draw order (near-plane clipping still keeps it
 * correct behind the camera).
 */
const PREVIS_GROUND_DEPTH = 1e9

export type PrevisRenderPolygon = {
  /** Screen-space points, already near-clipped and projected. */
  points: Array<[number, number]>
  /** Average camera-space depth (larger = farther). */
  depth: number
  /** 0..1 lightness factor; the component maps it to the blockout clay palette. */
  shade: number
  kind: "ground" | "shadow" | "entity"
  entityId?: string
  role?: string
}

export type PrevisRenderFrame = {
  width: number
  height: number
  cameraId: string
  timeSeconds: number
  polygons: PrevisRenderPolygon[]
  visibleEntityIds: string[]
}

type Mesh = { vertices: PrevisVec3[]; faces: number[][] }

type CameraPoint = { x: number; y: number; z: number }

function revolveProfile(profile: Array<[number, number]>, segments: number): Mesh {
  const vertices: PrevisVec3[] = []
  const faces: number[][] = []
  const ringIndex: number[][] = []
  for (const [radius, y] of profile) {
    const ring: number[] = []
    if (radius <= 1e-6) {
      vertices.push([0, y, 0])
      ring.push(vertices.length - 1)
    } else {
      for (let segment = 0; segment < segments; segment += 1) {
        const angle = (segment / segments) * Math.PI * 2
        vertices.push([Math.cos(angle) * radius, y, Math.sin(angle) * radius])
        ring.push(vertices.length - 1)
      }
    }
    ringIndex.push(ring)
  }
  for (let index = 1; index < ringIndex.length; index += 1) {
    const lower = ringIndex[index - 1]
    const upper = ringIndex[index]
    if (lower.length === 1 && upper.length === 1) continue
    const steps = Math.max(lower.length, upper.length)
    for (let step = 0; step < steps; step += 1) {
      const nextStep = (step + 1) % steps
      if (lower.length === 1) {
        faces.push([lower[0], upper[nextStep], upper[step]])
      } else if (upper.length === 1) {
        faces.push([lower[step], lower[nextStep], upper[0]])
      } else {
        faces.push([lower[step], lower[nextStep], upper[nextStep], upper[step]])
      }
    }
  }
  return { vertices, faces }
}

function sphereProfile(rings: number): Array<[number, number]> {
  const profile: Array<[number, number]> = []
  for (let ring = 0; ring <= rings; ring += 1) {
    const ratio = ring / rings
    profile.push([Math.sin(Math.PI * ratio) * 0.5, -Math.cos(Math.PI * ratio) * 0.5])
  }
  return profile
}

function boxMesh(): Mesh {
  const half = 0.5
  const vertices: PrevisVec3[] = [
    [-half, -half, -half], [half, -half, -half], [half, -half, half], [-half, -half, half],
    [-half, half, -half], [half, half, -half], [half, half, half], [-half, half, half],
  ]
  const faces = [
    [0, 3, 2, 1], // bottom
    [4, 5, 6, 7], // top
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ]
  return { vertices, faces }
}

function wedgeMesh(): Mesh {
  const half = 0.5
  const vertices: PrevisVec3[] = [
    [-half, -half, -half], [half, -half, -half], [half, -half, half], [-half, -half, half],
    [-half * 0.2, half, half * 0.1], [half * 0.2, half, half * 0.1],
  ]
  const faces = [
    [0, 3, 2, 1],
    [0, 1, 5, 4],
    [1, 2, 5],
    [2, 3, 4, 5],
    [3, 0, 4],
  ]
  return { vertices, faces }
}

function planeMesh(): Mesh {
  const half = 0.5
  return { vertices: [[-half, 0, -half], [half, 0, -half], [half, 0, half], [-half, 0, half]], faces: [[0, 1, 2, 3]] }
}

const meshCache = new Map<PrevisShape, Mesh>()

export function previsShapeMesh(shape: PrevisShape): Mesh {
  const cached = meshCache.get(shape)
  if (cached) return cached
  let mesh: Mesh
  switch (shape) {
    case "sphere":
      mesh = revolveProfile(sphereProfile(5), 10)
      break
    case "cylinder":
      mesh = revolveProfile([[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], 10)
      break
    case "cone":
      mesh = revolveProfile([[0, -0.5], [0.5, -0.5], [0, 0.5]], 10)
      break
    case "capsule":
      mesh = revolveProfile([
        [0, -0.5], [0.28, -0.5], [0.44, -0.38], [0.5, -0.2],
        [0.5, 0.2], [0.44, 0.38], [0.28, 0.5], [0, 0.5],
      ], 10)
      break
    case "wedge":
      mesh = wedgeMesh()
      break
    case "plane":
      mesh = planeMesh()
      break
    default:
      mesh = boxMesh()
      break
  }
  meshCache.set(shape, mesh)
  return mesh
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function rotateEuler(point: PrevisVec3, rotation: PrevisVec3): PrevisVec3 {
  const [rx, ry, rz] = rotation.map(toRadians) as PrevisVec3
  const [cosX, sinX] = [Math.cos(rx), Math.sin(rx)]
  const [cosY, sinY] = [Math.cos(ry), Math.sin(ry)]
  const [cosZ, sinZ] = [Math.cos(rz), Math.sin(rz)]
  const [x, y, z] = point
  // X, then Y, then Z — documented so a future renderer matches this one.
  const y1 = y * cosX - z * sinX
  const z1 = y * sinX + z * cosX
  const x2 = x * cosY + z1 * sinY
  const z2 = -x * sinY + z1 * cosY
  return [x2 * cosZ - y1 * sinZ, x2 * sinZ + y1 * cosZ, z2]
}

export type PrevisProjector = {
  cameraId: string
  timeSeconds: number
  /** World → screen. Returns null when the point is behind the near plane. */
  project: (point: PrevisVec3) => [number, number] | null
  /** World → camera space (x right, y up, z forward). */
  cameraSpace: (point: PrevisVec3) => CameraPoint
}

export function createPrevisProjector(input: {
  scene: PrevisScene
  camera: PrevisCamera
  width: number
  height: number
  timeSeconds: number
}): PrevisProjector {
  const sampled = sampleCamera(input.camera, input.timeSeconds)
  const forward = normalize([
    sampled.target[0] - sampled.position[0],
    sampled.target[1] - sampled.position[1],
    sampled.target[2] - sampled.position[2],
  ])
  const right = normalize(cross(forward, [0, 1, 0]))
  const up = normalize(cross(right, forward))
  const focal = (input.height / 2) / Math.tan(toRadians(sampled.fovDeg) / 2)
  const cameraSpace = (point: PrevisVec3): CameraPoint => {
    const dx = point[0] - sampled.position[0]
    const dy = point[1] - sampled.position[1]
    const dz = point[2] - sampled.position[2]
    return {
      x: dx * right[0] + dy * right[1] + dz * right[2],
      y: dx * up[0] + dy * up[1] + dz * up[2],
      z: dx * forward[0] + dy * forward[1] + dz * forward[2],
    }
  }
  return {
    cameraId: input.camera.id,
    timeSeconds: input.timeSeconds,
    cameraSpace,
    project: (point: PrevisVec3) => {
      const space = cameraSpace(point)
      if (space.z <= PREVIS_NEAR_PLANE) return null
      return [input.width / 2 + (space.x * focal) / space.z, input.height / 2 - (space.y * focal) / space.z]
    },
  }
}

function normalize(value: PrevisVec3): PrevisVec3 {
  const length = Math.hypot(value[0], value[1], value[2])
  return length <= 1e-9 ? [0, 0, 1] : [value[0] / length, value[1] / length, value[2] / length]
}

function cross(left: PrevisVec3, right: PrevisVec3): PrevisVec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function subtract(left: PrevisVec3, right: PrevisVec3): PrevisVec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Sutherland–Hodgman clip against the single near plane (camera space). */
function clipNear(points: CameraPoint[]): CameraPoint[] {
  const output: CameraPoint[] = []
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const currentInside = current.z >= PREVIS_NEAR_PLANE
    const nextInside = next.z >= PREVIS_NEAR_PLANE
    if (currentInside) output.push(current)
    if (currentInside !== nextInside) {
      const ratio = (PREVIS_NEAR_PLANE - current.z) / (next.z - current.z)
      output.push({
        x: current.x + (next.x - current.x) * ratio,
        y: current.y + (next.y - current.y) * ratio,
        z: PREVIS_NEAR_PLANE,
      })
    }
  }
  return output
}

function projectCameraPoint(point: CameraPoint, width: number, height: number, focal: number): [number, number] {
  return [width / 2 + (point.x * focal) / point.z, height / 2 - (point.y * focal) / point.z]
}

function entityWorldMesh(entity: PrevisEntity, timeSeconds: number, shapeOverride?: PrevisShape): PrevisVec3[] {
  const mesh = previsShapeMesh(shapeOverride || entity.shape)
  const transform = sampleEntityTransform(entity, timeSeconds)
  return mesh.vertices.map(vertex => {
    const scaled: PrevisVec3 = [vertex[0] * transform.scale[0], vertex[1] * transform.scale[1], vertex[2] * transform.scale[2]]
    const rotated = rotateEuler(scaled, transform.rotation)
    return [
      rotated[0] + transform.position[0],
      rotated[1] + transform.position[1],
      rotated[2] + transform.position[2],
    ]
  })
}

function polygonShade(vertices: PrevisVec3[], face: number[], ambient: number, light: PrevisVec3): number {
  const a = vertices[face[0]]
  const b = vertices[face[1]]
  const c = vertices[face[2]]
  const normal = normalize(cross(subtract(b, a), subtract(c, a)))
  const lambert = Math.max(0, normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2])
  return clamp(ambient + (1 - ambient) * lambert, 0.12, 1)
}

/** Andrew's monotone chain — the shadow of a box is its silhouette's hull. */
function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length < 3) return points
  const sorted = [...points].sort((left, right) => (left[0] === right[0] ? left[1] - right[1] : left[0] - right[0]))
  const cross2 = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Array<[number, number]> = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: Array<[number, number]> = []
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]
    while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
    upper.push(point)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

function lightDirection(scene: PrevisScene): PrevisVec3 {
  const azimuth = toRadians(scene.world.keyLightAzimuthDeg)
  const elevation = toRadians(scene.world.keyLightElevationDeg)
  return normalize([
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  ])
}

export function renderPrevisFrame(input: {
  scene: PrevisScene
  cameraId?: string
  /** An explicit camera (the viewport's free-orbit inspection camera). */
  camera?: PrevisCamera
  width: number
  height: number
  timeSeconds: number
}): PrevisRenderFrame {
  const width = Math.max(64, Math.round(input.width))
  const height = Math.max(64, Math.round(input.height))
  const camera = input.camera || previsCameraById(input.scene, input.cameraId)
  const projector = createPrevisProjector({ scene: input.scene, camera, width, height, timeSeconds: input.timeSeconds })
  const sampled = sampleCamera(camera, input.timeSeconds)
  const focal = (height / 2) / Math.tan(toRadians(sampled.fovDeg) / 2)
  const light = lightDirection(input.scene)
  const polygons: PrevisRenderPolygon[] = []

  const pushPolygon = (
    worldVertices: PrevisVec3[],
    shade: number,
    kind: PrevisRenderPolygon["kind"],
    entityId?: string,
    role?: string,
    depthOverride?: number,
  ) => {
    const cameraPoints = worldVertices.map(projector.cameraSpace)
    const clipped = clipNear(cameraPoints)
    if (clipped.length < 3) return
    const points = clipped.map(point => projectCameraPoint(point, width, height, focal))
    const depth = depthOverride ?? clipped.reduce((sum, point) => sum + point.z, 0) / clipped.length
    polygons.push({ points, depth, shade, kind, ...(entityId ? { entityId } : {}), ...(role ? { role } : {}) })
  }

  // Ground: one quad; the grid is drawn by the viewport component from the
  // projector so it keeps perspective without thousands of polygons here.
  const extent = clamp(input.scene.world.groundHalfExtent, 1, PREVIS_LIMITS.groundHalfExtent)
  const groundShade = clamp(input.scene.world.ambient + 0.42, 0.2, 1)
  pushPolygon(
    [[-extent, 0, -extent], [extent, 0, -extent], [extent, 0, extent], [-extent, 0, extent]],
    groundShade,
    "ground",
    undefined,
    undefined,
    PREVIS_GROUND_DEPTH,
  )

  const visibleEntityIds: string[] = []
  for (const entity of input.scene.entities) {
    const vertices = entityWorldMesh(entity, input.timeSeconds)
    const mesh = previsShapeMesh(entity.shape)
    let visible = false
    for (const face of mesh.faces) {
      const worldFace = face.map(index => vertices[index])
      const shade = polygonShade(vertices, face, input.scene.world.ambient, light)
      const before = polygons.length
      pushPolygon(worldFace, shade, "entity", entity.id, entity.role)
      if (polygons.length > before) visible = true
    }
    if (visible) visibleEntityIds.push(entity.id)

    // Hard shadow: the bounding box silhouette projected along the light.
    if (light[1] > 0.08 && entity.role !== "effect") {
      const transform = sampleEntityTransform(entity, input.timeSeconds)
      const half = [0.5 * transform.scale[0], 0.5 * transform.scale[1], 0.5 * transform.scale[2]]
      const corners: Array<[number, number]> = []
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const world: PrevisVec3 = [
            transform.position[0] + sx * half[0],
            transform.position[1] - half[1],
            transform.position[2] + sz * half[2],
          ]
          const travel = world[1] / light[1]
          const projected: [number, number] = [world[0] - light[0] * travel, world[2] - light[2] * travel]
          corners.push(projected)
        }
      }
      const hull = convexHull(corners)
      if (hull.length >= 3) {
        pushPolygon(hull.map(point => [point[0], 0.002, point[1]] as PrevisVec3), clamp(groundShade - 0.12, 0.08, 1), "shadow", entity.id)
      }
    }
  }

  polygons.sort((left, right) => right.depth - left.depth)
  return {
    width,
    height,
    cameraId: camera.id,
    timeSeconds: input.timeSeconds,
    polygons,
    visibleEntityIds,
  }
}

/** Stable, rounded signature of a frame — used by the release gate for determinism. */
export function previsFrameSignature(frame: PrevisRenderFrame): string {
  return JSON.stringify({
    width: frame.width,
    height: frame.height,
    cameraId: frame.cameraId,
    polygons: frame.polygons.map(polygon => ({
      kind: polygon.kind,
      entityId: polygon.entityId || null,
      depth: Number(polygon.depth.toFixed(3)),
      shade: Number(polygon.shade.toFixed(3)),
      points: polygon.points.map(point => [Number(point[0].toFixed(2)), Number(point[1].toFixed(2))]),
    })),
  })
}
