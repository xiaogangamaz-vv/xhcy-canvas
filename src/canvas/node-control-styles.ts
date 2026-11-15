import { CANVAS_FILL, CANVAS_STROKE } from "@/canvas/canvas-palette"

/**
 * Shared control styles for Canvas canvas nodes (image / video / text / future).
 * One visual language: dark surface, gray borders, muted controls.
 * Do not introduce per-node accent colors (no purple text vs blue video).
 */

/** Shared frame/panel surface — text body + generation composer. */
export const NODE_SURFACE_BG = CANVAS_FILL
export const NODE_FRAME_BG = CANVAS_FILL
export const NODE_BORDER = 'border-white/20'
export const NODE_BORDER_SELECTED = 'border-[#7a8ea8] shadow-[0_0_0_1px_rgba(122,142,168,0.28)]'

/** Soft outer shell — one surface for chips + prompt + actions (no nested input frame). */
export const GENERATION_COMPOSER_PANEL =
  'nodrag nowheel relative w-full rounded-3xl border-2 px-4 py-3.5 shadow-[0_8px_28px_rgba(0,0,0,0.22)]'

/**
 * Inline surface for the composer panel: fill and stroke match the node frame exactly, so
 * the node and its composer read as one material. Inline because `globals.css` carries an
 * unlayered `* { border-color }` that outranks border-color utilities.
 */
export const GENERATION_COMPOSER_SURFACE_STYLE = {
  background: CANVAS_FILL,
  borderColor: CANVAS_STROKE,
} as const

/** Floating toolbar / popover chrome (text toolbar shares this with generation popovers). */
export const NODE_TOOLBAR_SURFACE =
  'flex items-center gap-0.5 rounded-lg border border-white/16 bg-[#1a1d22] px-1.5 py-1 shadow-xl'

export const NODE_TOOLBAR_BUTTON =
  'inline-flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-medium text-white/55 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40'

export const NODE_TOOLBAR_BUTTON_ACTIVE = 'bg-white/12 text-white'

export const GENERATION_PILL =
  'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.10] bg-white/[0.05] px-2.5 text-[11px] font-medium text-white/75 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50'

export const GENERATION_PILL_ACTIVE = 'border-white/25 bg-white/12 text-white'

export const GENERATION_CHIP =
  'inline-flex h-7 max-w-[140px] shrink-0 items-center gap-1.5 truncate whitespace-nowrap rounded-full border border-transparent bg-white/[0.06] px-2.5 text-[11px] text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'

export const GENERATION_CHIP_ACTIVE = 'bg-white/12 text-white'

export const GENERATION_MUTED = 'text-[12px] text-white/45'

/**
 * Prompt is borderless: lives inside the composer shell as free text area.
 * No focus ring / box so the whole bottom region feels like one input surface.
 */
export const GENERATION_PROMPT =
  'ui-scrollbar nodrag nowheel min-h-[76px] w-full resize-none appearance-none border-0 bg-transparent px-0.5 py-2.5 text-[13px] leading-6 text-white/90 shadow-none outline-none ring-0 placeholder:text-white/35 focus:border-0 focus:outline-none focus:ring-0 disabled:opacity-60'

/** Primary run button. */
export const GENERATION_BTN_PRIMARY =
  'ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-white/[0.12] px-3 text-[12px] font-semibold tabular-nums text-white transition-colors hover:bg-white/18 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-white/35'

export const GENERATION_BTN_MUTED =
  'ml-auto inline-flex h-8 shrink-0 items-center rounded-full border border-white/15 px-3 text-[12px] text-white/70'

export const GENERATION_POPOVER =
  'fixed z-[130] rounded-xl border border-white/16 bg-[#1a1d22] p-2 shadow-2xl'

export const GENERATION_POPOVER_OPTION =
  'h-7 rounded-lg border border-white/12 bg-white/[0.06] text-[11px] text-white/70 transition-colors hover:border-white/25 hover:text-white'

export const GENERATION_POPOVER_OPTION_ACTIVE =
  'h-7 rounded-lg border border-white/30 bg-white/12 text-[11px] text-white'
