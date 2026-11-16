import {
  previsEntityByRef,
  type PrevisCameraMove,
  type PrevisEntity,
  type PrevisScene,
  type PrevisShape,
  type PrevisShotSize,
  type PrevisVec3,
} from "./scene-schema"
import type { PrevisOp } from "./scene-ops"
import { buildPrevisSceneFromText, previsNounAliasGroups } from "./previs-scene-builder"

/**
 * Deterministic prompt → previs ops parser (English + Chinese).
 *
 * It covers every instruction the product video actually shows, and it is the
 * path the release gate exercises: no model key, no network, same answer every
 * time. The LLM path shares the same closed op vocabulary, so a model-authored
 * edit and a rule-authored edit are indistinguishable downstream.
 *
 * Entity targeting is mention-based: for each animation verb the parser picks
 * the entity whose name appears closest *before* the verb in the sentence, which
 * is what makes "the lizard model shrinks and the ball drops to the ground"
 * animate two different entities in one instruction.
 */

export type PrevisCommand = {
  matched: boolean
  ops: PrevisOp[]
  /** "Actually, back to the lizard" — handled by the revision cursor. */
  revertSteps: number
  reply: string
}

const BUILD_PATTERN = /create|build|make|set ?up|generate|搭建|生成|做一个|来一个/
const REVERT_PATTERN = /actually|never ?mind|revert|undo|go ?back|back to the|算了|还是|改回|回到|撤销|撤回/
const SWAP_EN = /swap\s+(?:the\s+|out\s+)?(.+?)\s+(?:for|to|with)\s+(?:a\s+|an\s+|the\s+)?([^.,;]+)/i
const SWAP_ZH = /(?:把|让|将)\s*([^，。,.]{1,20}?)\s*(?:变成|换成|改成|替换成|变为)\s*([^，。,.]{1,20})/
const BACK_TO = /back to the ([\w\u4e00-\u9fa5-]+)/i

const DROP_KEYS = ["drops to the ground", "drop to the ground", "falls to the ground", "falls", "hits the ground", "落地", "掉在地上", "掉到地上", "落到地面"]
const RISE_KEYS = ["rises", "lift off", "floats up", "升起", "飞起"]
const SHRINK_KEYS = ["shrink", "shrinks", "smaller", "缩小", "变小"]
const GROW_KEYS = ["grow", "grows", "bigger", "放大", "变大"]

const SHAPE_HINTS: Array<{ keys: string[]; shape: PrevisShape }> = [
  { keys: ["lynx", "cat", "cheetah", "leopard", "dog", "山猫", "猫", "猎豹"], shape: "capsule" },
  { keys: ["hamster", "mouse", "rabbit", "仓鼠", "老鼠", "兔子"], shape: "sphere" },
  { keys: ["octopus", "章鱼"], shape: "sphere" },
  { keys: ["lizard", "chameleon", "dragon", "蜥蜴", "变色龙"], shape: "capsule" },
  { keys: ["ball", "sphere", "球"], shape: "sphere" },
  { keys: ["tree", "树"], shape: "cone" },
  { keys: ["rock", "stone", "石头"], shape: "wedge" },
  { keys: ["box", "crate", "箱子"], shape: "box" },
]

function shapeForName(name: string): PrevisShape | undefined {
  const lowered = name.trim().toLowerCase()
  return SHAPE_HINTS.find(hint => hint.keys.some(key => lowered.includes(key.toLowerCase())))?.shape
}

type CameraIntent = { move: PrevisCameraMove; shotSize?: PrevisShotSize }

function cameraMoveIn(text: string): CameraIntent | null {
  const lowered = text.toLowerCase()
  const shotSize: PrevisShotSize | undefined = /extreme close|大特写/.test(lowered)
    ? "extreme_close"
    : /wide shot|wide|全景|大全景/.test(lowered)
      ? "wide"
      : /close[- ]?up|特写|近景/.test(lowered)
        ? "close"
        : /medium shot|中景/.test(lowered)
          ? "medium"
          : undefined

  const withSize = (move: PrevisCameraMove): CameraIntent => (shotSize ? { move, shotSize } : { move })
  if (/tilt down|下俯|俯拍|往下看|镜头往下|镜头下移/.test(lowered)) return withSize("tilt_down")
  if (/tilt up|上仰|仰拍|往上看/.test(lowered)) return withSize("tilt_up")
  if (/pan left|左摇/.test(lowered)) return withSize("pan_left")
  if (/pan right|右摇/.test(lowered)) return withSize("pan_right")
  if (/push in|dolly in|zoom in|推近|推进|推镜/.test(lowered)) return withSize("push_in")
  if (/pull back|pull out|dolly out|zoom out|拉远|拉出|推远/.test(lowered)) return withSize("pull_back")
  if (/crane up|升镜/.test(lowered)) return withSize("crane_up")
  if (/crane down|降镜/.test(lowered)) return withSize("crane_down")
  return null
}

function shotDuration(scene: PrevisScene): number {
  return scene.shots[0]?.durationSeconds ?? 3.5
}

type Mention = { entity: PrevisEntity; index: number }

/**
 * The alias group a piece of text names, if any.
 *
 * A prompt and the scene it edits are often in different languages (the product
 * video shows Chinese instructions over an English scene prompt), so entity
 * resolution goes through the same bilingual noun table the builder uses.
 */
function aliasGroupFor(text: string): string[] | null {
  const lowered = text.trim().toLowerCase()
  if (!lowered) return null
  let best: string[] | null = null
  let bestLength = 0
  for (const group of previsNounAliasGroups()) {
    for (const alias of group) {
      const needle = alias.toLowerCase()
      if (needle.length > bestLength && lowered.includes(needle)) {
        best = group
        bestLength = needle.length
      }
    }
  }
  return best
}

/** Every string that could name this entity, including cross-language aliases. */
function entityNeedles(entityName: string): string[] {
  const lower = entityName.toLowerCase().trim()
  const needles = new Set<string>([lower])
  for (const group of previsNounAliasGroups()) {
    if (group.some(alias => alias.toLowerCase().includes(lower) || lower.includes(alias.toLowerCase()))) {
      for (const alias of group) needles.add(alias.toLowerCase())
    }
  }
  return [...needles].filter(needle => needle.length > 0)
}

/** Every entity whose name literally appears in the prompt, in text order. */
function entityMentions(scene: PrevisScene, textLower: string): Mention[] {
  const mentions: Mention[] = []
  for (const entity of scene.entities) {
    let index = -1
    for (const needle of entityNeedles(entity.name)) {
      // A one-character name is normal in Chinese ("球", "树") but meaningless in a
      // latin prompt, where a single letter would match almost any sentence.
      const isCjk = /[\u3400-\u9fff]/.test(needle)
      if (!isCjk && needle.length < 3) continue
      const found = textLower.indexOf(needle)
      if (found >= 0 && (index < 0 || found < index)) index = found
    }
    if (index >= 0) mentions.push({ entity, index })
  }
  return mentions.sort((left, right) => left.index - right.index)
}

function mentionBefore(mentions: Mention[], position: number): Mention | null {
  let best: Mention | null = null
  for (const mention of mentions) {
    if (mention.index <= position) best = mention
    else break
  }
  return best
}

type AnimationHit = { entity: PrevisEntity; kind: "scale_down" | "scale_up" | "drop" | "rise"; at: number }

function animationHits(scene: PrevisScene, textLower: string): AnimationHit[] {
  const mentions = entityMentions(scene, textLower)
  // Names that do not appear in the prompt at all (a scene built from an English
  // sentence, then edited in Chinese) still get a sensible subject: a size change
  // reads as the character, a drop/rise reads as the prop.
  const fallbackFor = (kind: AnimationHit["kind"]): PrevisEntity | undefined => {
    if (kind === "drop" || kind === "rise") {
      return scene.entities.find(entity => entity.role === "prop")
        || scene.entities.find(entity => entity.role === "character")
        || scene.entities[0]
    }
    return scene.entities.find(entity => entity.role === "character") || scene.entities[0]
  }
  const hits: AnimationHit[] = []
  const consider = (kind: AnimationHit["kind"], keys: string[]) => {
    let at = -1
    for (const key of keys) {
      const index = textLower.indexOf(key.toLowerCase())
      if (index >= 0 && (at < 0 || index < at)) at = index
    }
    if (at < 0) return
    const mention = mentionBefore(mentions, at)
    const entity = mention?.entity || fallbackFor(kind)
    if (entity) hits.push({ entity, kind, at })
  }
  consider("scale_down", SHRINK_KEYS)
  consider("scale_up", GROW_KEYS)
  consider("drop", DROP_KEYS)
  consider("rise", RISE_KEYS)
  return hits.sort((left, right) => left.at - right.at)
}

function animationOps(scene: PrevisScene, textLower: string): PrevisOp[] {
  const hits = animationHits(scene, textLower)
  if (hits.length === 0) return []
  const duration = shotDuration(scene)
  const byEntity = new Map<string, { entity: PrevisEntity; keyframes: Array<{ t: number; position?: PrevisVec3; scale?: PrevisVec3; easing?: "easeInOut" }> }>()
  for (const hit of hits) {
    const entry = byEntity.get(hit.entity.id) || { entity: hit.entity, keyframes: [] }
    const base = hit.entity.transform
    if (hit.kind === "scale_down" || hit.kind === "scale_up") {
      const factor = hit.kind === "scale_down" ? 0.34 : 1.8
      entry.keyframes.push({ t: 0, scale: [...base.scale] })
      entry.keyframes.push({
        t: duration,
        scale: [base.scale[0] * factor, base.scale[1] * factor, base.scale[2] * factor],
        easing: "easeInOut",
      })
    } else {
      const groundY = Math.max(0.12, base.scale[1] * 0.5)
      entry.keyframes.push({ t: 0, position: [...base.position] })
      entry.keyframes.push({
        t: duration,
        position: [base.position[0], hit.kind === "rise" ? base.position[1] + 2.4 : groundY, base.position[2]],
        easing: "easeInOut",
      })
    }
    byEntity.set(hit.entity.id, entry)
  }
  return [...byEntity.values()].map(entry => ({
    op: "animate_entity",
    entityId: entry.entity.id,
    keyframes: entry.keyframes.sort((left, right) => left.t - right.t),
  }) as PrevisOp)
}

function entityTarget(scene: PrevisScene, name: string): { entityId?: string; entityName?: string } {
  const trimmed = name.trim().replace(/^(the|a|an)\s+/i, "").replace(/(的|那个)$/g, "")
  if (!trimmed) return {}
  const hit = previsEntityByRef(scene, { entityName: trimmed })
  if (hit) return { entityId: hit.id }
  // Cross-language fallback: the prompt names the noun in another language than the
  // scene does ("把蜥蜴换成山猫" against a scene whose entity is called `lizard`).
  const group = aliasGroupFor(trimmed)
  if (group) {
    const byAlias = scene.entities.find(entity => entityNeedles(entity.name).some(needle => group.some(alias => alias.toLowerCase() === needle)))
    if (byAlias) return { entityId: byAlias.id }
  }
  return { entityName: trimmed }
}

export function interpretPrevisCommand(input: { text: string; scene: PrevisScene }): PrevisCommand {
  const text = (input.text || "").trim()
  const scene = input.scene
  if (!text) return { matched: false, ops: [], revertSteps: 0, reply: "请输入要拍摄的场景或修改" }
  const lowered = text.toLowerCase()

  // 1) Revert — "Actually, back to the lizard."
  if (REVERT_PATTERN.test(lowered)) {
    const wanted = (text.match(SWAP_EN)?.[2] || text.match(BACK_TO)?.[1] || "").trim()
    const ops: PrevisOp[] = []
    if (wanted) {
      const current = scene.entities.find(entity => entity.role === "character") || scene.entities[0]
      if (current && !current.name.toLowerCase().includes(wanted.toLowerCase())) {
        const shape = shapeForName(wanted)
        ops.push({
          op: "swap_entity",
          entityId: current.id,
          name: wanted,
          ...(shape ? { shape } : {}),
          description: `${wanted}（回退）`,
        } as PrevisOp)
      }
    }
    return {
      matched: true,
      ops,
      revertSteps: 1,
      reply: wanted ? `回退上一版编辑，并改回「${wanted}」` : "回退上一版编辑",
    }
  }

  const ops: PrevisOp[] = []
  let workingScene = scene

  // 2) Build first when the canvas is still empty. The rest of the sentence is
  //    then interpreted against the *built* scene, so
  //    "Create a jungle standoff … Pull back to a wide shot" is one instruction
  //    that both builds and moves the camera.
  if (BUILD_PATTERN.test(lowered) && scene.entities.length <= 1) {
    const built = buildPrevisSceneFromText(text)
    ops.push({ op: "replace_scene", scene: built } as PrevisOp)
    workingScene = built
  }

  // 3) Asset swap — "Swap the lizard for a lynx" / 把蜥蜴变成山猫.
  const swap = text.match(SWAP_EN) || text.match(SWAP_ZH)
  if (swap) {
    const target = entityTarget(workingScene, swap[1])
    if (Object.keys(target).length > 0) {
      const replacement = swap[2].trim()
      const shape = shapeForName(replacement)
      ops.push({
        op: "swap_entity",
        ...target,
        name: replacement,
        ...(shape ? { shape } : {}),
        description: replacement,
      } as PrevisOp)
    }
  }

  // 4) Camera move — film language; the reducer turns it into geometry.
  const camera = cameraMoveIn(text)
  if (camera) {
    ops.push({
      op: "move_camera",
      cameraId: workingScene.cameras[0]?.id,
      move: camera.move,
      durationSeconds: shotDuration(workingScene),
      ...(camera.shotSize ? { shotSize: camera.shotSize } : {}),
    } as PrevisOp)
  }

  // 5) Entity animation — one op per entity mentioned before an animation verb.
  ops.push(...animationOps(workingScene, lowered))

  if (ops.length === 0) {
    return {
      matched: false,
      ops: [],
      revertSteps: 0,
      reply: "没听懂这条指令可以怎么改预演；试试「镜头往下看的同时让蜥蜴缩小、球掉在地上」「把蜥蜴换成山猫」「拉远到大全景」",
    }
  }
  return { matched: true, ops, revertSteps: 0, reply: `已应用 ${ops.length} 项编辑` }
}
