/**
 * Canvas palette — the values are taken from the reference canvas we are matching
 * (`basketikun/infinite-canvas`, dark theme): a warm stone gray family rather than a
 * neutral black, with a hairline stroke, a soft panel, and one muted label gray.
 *
 * Two rules matter here:
 *  - the canvas is monochrome apart from the selection, so nothing on the surface uses
 *    the product's accent violet or status green;
 *  - `globals.css` carries an unlayered `* { border-color: var(--color-border) }`, which
 *    outranks every border-color utility (unlayered beats `@layer utilities`), so every
 *    colour here is applied inline instead of through a class.
 */

/** Node surface: one fill for every node type — deep charcoal. */
export const CANVAS_FILL = "#1E1E1E"
/** Group frames sit one step lighter than the nodes they hold. */
export const CANVAS_FRAME_FILL = "#272729"
/** Inner panels (port dots) read as a hole punched in the node. */
export const CANVAS_PANEL = "#181715"
/** Canvas background behind the dot grid. */
export const CANVAS_BACKGROUND = "#181715"
export const CANVAS_DOT = "rgba(245,245,244,0.24)"

/** Idle node stroke. */
export const CANVAS_STROKE = "#44403c"
/** Direct neighbour of the current selection. */
export const CANVAS_STROKE_RELATED = "#d6d3d1"
/** The selected node. */
export const CANVAS_STROKE_ACTIVE = "#fafaf9"

/** Labels and secondary text on the canvas. */
export const CANVAS_LABEL = "#d6d3d1"
export const CANVAS_TEXT = "#f5f5f4"
export const CANVAS_MUTED = "#d6d3d1"
export const CANVAS_PLACEHOLDER = "#a8a29e"
export const CANVAS_FAINT = "#78716c"

/** Toolbar / composer chrome. */
export const CANVAS_TOOLBAR_PANEL = "rgba(31,29,26,0.96)"
export const CANVAS_TOOLBAR_BORDER = "#44403c"
export const CANVAS_TOOLBAR_ACTIVE_BG = "#3a3631"

/** Edges. */
export const CANVAS_EDGE = CANVAS_MUTED
export const CANVAS_EDGE_WIDTH = 2
export const CANVAS_EDGE_ACTIVE_WIDTH = 3
export const CANVAS_EDGE_OPACITY = 0.82
export const CANVAS_CONNECTION_IDLE = CANVAS_MUTED
export const CANVAS_CONNECTION_VALID = CANVAS_STROKE_ACTIVE
export const CANVAS_CONNECTION_INVALID = CANVAS_STROKE

/** Corner radius and stroke width shared by every node surface. */
export const CANVAS_NODE_RADIUS = 24
export const CANVAS_NODE_BORDER = 2

/**
 * The border colour a node surface must render, and the shadow that carries the state
 * that a border alone cannot express.
 */
export function canvasBorderColor(state: {
  selected?: boolean
  highlighted?: boolean
  connectable?: boolean
}): string {
  if (state.selected) return CANVAS_STROKE_ACTIVE
  if (state.connectable) return CANVAS_STROKE_RELATED
  if (state.highlighted) return CANVAS_STROKE_RELATED
  return CANVAS_STROKE
}

export function canvasSurfaceStyle(state: {
  selected?: boolean
  highlighted?: boolean
  connectable?: boolean
  fill?: string
}): { background: string; borderColor: string } {
  return {
    background: state.fill ?? CANVAS_FILL,
    borderColor: canvasBorderColor(state),
  }
}

/** A group frame's surface: its own lighter fill, never the node fill. */
export function canvasFrameStyle(state: {
  selected?: boolean
  highlighted?: boolean
  connectable?: boolean
}): { background: string; borderColor: string } {
  return canvasSurfaceStyle({ ...state, fill: CANVAS_FRAME_FILL })
}
