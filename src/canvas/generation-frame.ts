/**
 * Generation-node frame geometry (product choice B: frame follows aspectRatio).
 *
 * The single media frame is the node's only persistent border. Its outer width/height
 * scale with the resolved aspect ratio (16:9 landscape, 9:16 portrait, 1:1 square, …)
 * while staying inside a fixed max box so the canvas does not explode.
 */

export type FrameBox = { width: number; height: number }

/** Longest side of the frame in canvas px (landscape uses this as width). */
export const GENERATION_FRAME_BASE = 360
/** Cap so extreme ratios (21:9 / 9:21) stay usable on the canvas. */
export const GENERATION_FRAME_MAX = 420
/**
 * Composer / params panel width is independent of the adaptive frame.
 * Wide enough for aspect-ratio chips + video media pills on one line without a horizontal scrollbar.
 */
export const GENERATION_COMPOSER_WIDTH = 600

/**
 * Parse "16:9" / "9:16" / "auto". Unknown or auto → 1:1 (stable square default).
 */
export function parseAspectRatioParts(ratio: string | null | undefined): { w: number; h: number } {
  const raw = (ratio || "").trim().toLowerCase()
  if (!raw || raw === "auto") return { w: 1, h: 1 }
  const [a, b] = raw.split(":").map(part => Number(part))
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return { w: 1, h: 1 }
  return { w: a, h: b }
}

/**
 * Compute the frame box for a given aspect ratio string.
 * Landscape: width = base, height = base * h/w.
 * Portrait: height = base, width = base * w/h.
 * Both sides are then scaled down if either exceeds GENERATION_FRAME_MAX.
 */
export function frameBoxFromAspectRatio(
  ratio: string | null | undefined,
  base: number = GENERATION_FRAME_BASE,
): FrameBox {
  const { w, h } = parseAspectRatioParts(ratio)
  let width: number
  let height: number
  if (w >= h) {
    width = base
    height = Math.max(120, Math.round((base * h) / w))
  } else {
    height = base
    width = Math.max(120, Math.round((base * w) / h))
  }
  const scale = Math.min(1, GENERATION_FRAME_MAX / width, GENERATION_FRAME_MAX / height)
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  }
}

/**
 * The frame box a generation node renders at.
 *
 * The box is normally derived from the resolved aspect ratio, but a node the user has resized
 * keeps its own size — the resizer holds the ratio, so a saved box that still matches the
 * derived ratio is a real resize and not a stale default. Changing the aspect ratio re-derives
 * the box instead of keeping a size that no longer describes the ratio it is drawn from.
 */
export function frameBoxForNode(
  ratio: string | null | undefined,
  saved: FrameBox | null | undefined,
): FrameBox {
  const derived = frameBoxFromAspectRatio(ratio)
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height) || saved.width <= 0 || saved.height <= 0) {
    return derived
  }
  const savedRatio = saved.width / saved.height
  const derivedRatio = derived.width / derived.height
  return Math.abs(savedRatio - derivedRatio) <= 0.02
    ? { width: Math.round(saved.width), height: Math.round(saved.height) }
    : derived
}

/** Map resolution label + aspect ratio to a display size string "W × H". */
export function displayPixelSize(
  mediaType: string,
  aspectRatio: string,
  resolution: string,
  imageSize: string,
): string {
  if (mediaType === "video") {
    const long = resolution === "1080p" ? 1920 : resolution === "480p" ? 854 : 1280
    const { w, h } = parseAspectRatioParts(aspectRatio === "auto" ? "16:9" : aspectRatio)
    if (w >= h) {
      return `${long} × ${Math.round((long * h) / w)}`
    }
    return `${Math.round((long * w) / h)} × ${long}`
  }
  // Image: G2-ish nominal long side by imageSize tier.
  const long = imageSize === "4K" ? 3840 : imageSize === "1K" ? 1024 : 2048
  const { w, h } = parseAspectRatioParts(aspectRatio === "auto" ? "1:1" : aspectRatio)
  if (w >= h) {
    return `${long} × ${Math.round((long * h) / w)}`
  }
  return `${Math.round((long * w) / h)} × ${long}`
}

/** Bottom-right badge: "16:9 · 5s" for video, "16:9 · 2K" for image. */
export function frameCornerBadge(
  mediaType: string,
  aspectRatio: string,
  durationSeconds: string,
  imageSize: string,
): string {
  const ratio = aspectRatio || (mediaType === "video" ? "16:9" : "auto")
  if (mediaType === "video") {
    const sec = durationSeconds || "4"
    return `${ratio} · ${sec}s`
  }
  return `${ratio} · ${imageSize || "2K"}`
}
