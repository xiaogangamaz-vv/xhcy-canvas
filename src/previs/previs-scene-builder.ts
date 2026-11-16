import {
  PREVIS_LIMITS,
  createEmptyPrevisScene,
  createPrevisCamera,
  createPrevisTransform,
  type PrevisEntity,
  type PrevisEntityRole,
  type PrevisScene,
  type PrevisShape,
} from "./scene-schema"

/**
 * Deterministic "prompt → blockout scene" fallback.
 *
 * The product video's first instruction is a whole scene in one sentence
 * ("Create a jungle standoff: a chief facing a giant lizard, with a ball hitting
 * its forehead"). The rich version of that (LLM-authored scene graph) arrives
 * with the previs agent; this builder exists so the feature, its tests and the
 * release gate all work with **no model key at all**, and so a missing LLM can
 * never turn the canvas into a dead button.
 *
 * It reads the prompt for known nouns plus size words and lays the scene out
 * deterministically: protagonists on the left facing +x, antagonists on the
 * right facing -x, props between them, set pieces on a ring.
 */

type NounSpec = {
  keys: string[]
  shape: PrevisShape
  role: PrevisEntityRole
  size: number
  /** Relative height of the entity's centre above the ground. */
  centre: number
  facing: 1 | -1
  description: string
}

const NOUNS: NounSpec[] = [  { keys: ["chief", "tribesman", "man", "human", "person", "酋长", "人", "男人"], shape: "capsule", role: "character", size: 1.1, centre: 1.1, facing: 1, description: "村酋长，面向对手" },
  { keys: ["lizard", "chameleon", "dragon", "蜥蜴", "变色龙", "龙"], shape: "capsule", role: "character", size: 1.4, centre: 0.8, facing: -1, description: "巨大的蜥蜴，张嘴对着酋长" },
  { keys: ["lynx", "cat", "cheetah", "leopard", "山猫", "猫", "猎豹"], shape: "capsule", role: "character", size: 1, centre: 0.62, facing: -1, description: "一只山猫，取代蜥蜴" },
  { keys: ["hamster", "mouse", "rabbit", "仓鼠", "老鼠", "兔子"], shape: "sphere", role: "character", size: 0.42, centre: 0.3, facing: -1, description: "一只仓鼠" },
  { keys: ["octopus", "章鱼"], shape: "sphere", role: "character", size: 0.9, centre: 0.5, facing: -1, description: "一只章鱼" },
  { keys: ["ball", "sphere", "球", "足球"], shape: "sphere", role: "prop", size: 0.42, centre: 0.42, facing: 1, description: "黑白条纹的球" },
  { keys: ["tree", "forest", "jungle", "bush", "树", "丛林", "森林"], shape: "cone", role: "set", size: 3.2, centre: 1.6, facing: 1, description: "丛林树冠" },
  { keys: ["rock", "stone", "boulder", "石头", "岩石"], shape: "wedge", role: "set", size: 1.1, centre: 0.45, facing: 1, description: "岩石" },
  { keys: ["bridge", "桥"], shape: "box", role: "set", size: 3.4, centre: 1.2, facing: 1, description: "悬索桥" },
  { keys: ["drone", "无人机"], shape: "box", role: "prop", size: 0.5, centre: 1.6, facing: 1, description: "航拍无人机" },
  { keys: ["house", "building", "房子", "建筑"], shape: "box", role: "set", size: 2.4, centre: 1.2, facing: 1, description: "建筑体块" },
  { keys: ["car", "truck", "车", "汽车"], shape: "box", role: "prop", size: 1.2, centre: 0.6, facing: 1, description: "车辆" },
]

const GIANT_KEYS = ["giant", "huge", "enormous", "巨大", "超大"]
/** A stage smaller than this does not read as a place; the ring is topped up. */
const MIN_SET_PIECES = 8

/**
 * The bilingual noun groups behind the builder, exported so the prompt compiler can
 * resolve an entity across languages: a scene built from an English sentence ("a giant
 * lizard") must still be editable by the product video's Chinese line
 * ("把蜥蜴换成山猫"), and vice versa.
 */
export function previsNounAliasGroups(): string[][] {
  return NOUNS.map(noun => [...noun.keys])
}
const BIG_KEYS = ["big", "large", "大"]
const SMALL_KEYS = ["small", "tiny", "little", "小"]

function sizeMultiplier(text: string, nounIndex: number): number {
  const window = text.slice(Math.max(0, nounIndex - 24), nounIndex + 24)
  if (GIANT_KEYS.some(key => window.includes(key))) return 1.9
  if (SMALL_KEYS.some(key => window.includes(key))) return 0.6
  if (BIG_KEYS.some(key => window.includes(key))) return 1.35
  return 1
}

function detectStandoff(text: string): boolean {
  return /standoff|facing|face[sd]? off|对峙|面对|对峙/.test(text)
}

function entityId(prefix: string, index: number): string {
  return `${prefix}-${index}`
}

export function buildPrevisSceneFromText(text: string): PrevisScene {
  const prompt = text.trim().slice(0, PREVIS_LIMITS.descriptionChars)
  const lowered = prompt.toLowerCase()
  const scene = createEmptyPrevisScene({ prompt, title: prompt.slice(0, 24) || "预演场景" })

  const characters: PrevisEntity[] = []
  const props: PrevisEntity[] = []
  const setPieces: PrevisEntity[] = []
  const usedNames = new Map<string, number>()
  const uniqueName = (key: string) => {
    const count = (usedNames.get(key) || 0) + 1
    usedNames.set(key, count)
    return count === 1 ? key : `${key} ${count}`
  }

  for (const spec of NOUNS) {
    // Canonical name = the key that actually matched, so a Chinese prompt yields
    // Chinese entity names that later Chinese instructions can address.
    const matched = spec.keys.find(key => lowered.includes(key.toLowerCase()))
    if (!matched) continue
    const index = lowered.indexOf(matched.toLowerCase())
    const multiplier = sizeMultiplier(lowered, index)
    const entity: PrevisEntity = {
      id: entityId(spec.role === "set" ? "set" : spec.role === "prop" ? "prop" : "character", characters.length + props.length + setPieces.length + 1),
      name: uniqueName(matched),
      role: spec.role,
      shape: spec.shape,
      transform: createPrevisTransform({
        position: [0, spec.centre * multiplier, 0],
        scale: [spec.size * multiplier, spec.size * multiplier, spec.size * multiplier],
      }),
      description: spec.description,
    }
    if (spec.role === "character" && characters.length < 4) characters.push(entity)
    else if (spec.role === "prop" && props.length < 6) props.push(entity)
    else if (setPieces.length < 18) setPieces.push(entity)
  }

  if (characters.length === 0) {
    // Never hand back an empty room: a default protagonist keeps the viewport and
    // the "generate this shot" path useful for a prompt we did not understand.
    characters.push({
      id: "character-1",
      name: "主角",
      role: "character",
      shape: "capsule",
      transform: createPrevisTransform({ position: [0, 1.1, 0], scale: [1.1, 1.1, 1.1] }),
      description: "场景主角",
    })
  }

  const standoff = detectStandoff(prompt)
  const gap = standoff ? 3.4 : 2.6
  characters.forEach((entity, index) => {
    const slot = index % 2 === 0 ? -gap / 2 - Math.floor(index / 2) * 1.6 : gap / 2 + Math.floor(index / 2) * 1.6
    const facingRight = index % 2 === 0
    entity.transform.position = [slot, entity.transform.position[1], index >= 2 ? (index % 3) * 0.9 - 0.9 : 0]
    entity.transform.rotation = [0, facingRight ? 0 : 180, 0]
    entity.name = entity.name || `角色 ${index + 1}`
  })
  props.forEach((entity, index) => {
    entity.transform.position = [-0.2 + index * 0.9, entity.transform.position[1], 1.6]
  })

  // A prompt usually names a place ("jungle"), which yields a single set piece.
  // Top the ring up so the blockout always reads as a stage rather than one tree
  // floating next to the characters.
  while (setPieces.length < MIN_SET_PIECES) {
    const slot = setPieces.length + 1
    setPieces.push({
      id: `set-ring-${slot}`,
      name: `树 ${slot}`,
      role: "set",
      shape: "cone",
      transform: createPrevisTransform({ scale: [3.2, 3.2, 3.2] }),
      description: "丛林树冠",
    })
  }
  // Every set piece goes on a ring so nothing lands on top of the characters.
  const ringTotal = setPieces.length
  setPieces.forEach((entity, index) => {
    const angle = (index / ringTotal) * Math.PI * 2
    const radius = 8.5 + (index % 3) * 1.7
    entity.transform.position = [
      Math.cos(angle) * radius,
      entity.transform.position[1] || 1.6,
      Math.sin(angle) * radius,
    ]
  })

  scene.entities = [...characters, ...props, ...setPieces].slice(0, PREVIS_LIMITS.entities)
  scene.cameras = [createPrevisCamera({
    id: "camera-1",
    name: "机位 1",
    position: [0.4, 2.7, 8.6],
    target: [0.2, 1.35, 0],
    fovDeg: 38,
  })]
  scene.shots = [{
    id: "shot-1",
    name: "镜头 1",
    cameraId: "camera-1",
    durationSeconds: 3.5,
    status: "draft",
    shotSize: "medium",
  }]
  return scene
}
