/**
 * Canvas viewport animations must respect the user's motion preference (IC1.1).
 *
 * xyflow tweens fitView/zoomIn/zoomOut over 200-300ms. When the visitor asks for
 * reduced motion the change should land instantly instead of animating, so the
 * duration is collapsed to 0 rather than the call being skipped.
 */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/** Returns 0 when reduced motion is requested, otherwise the requested duration. */
export function canvasMotionDuration(durationMs: number): number {
  return prefersReducedMotion() ? 0 : durationMs
}
