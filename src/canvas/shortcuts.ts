/**
 * Single source of truth for the canvas keyboard guide.
 *
 * Every entry must be backed by a real handler, and `handler` records where that
 * handler lives so the help panel can never advertise a shortcut the canvas does
 * not implement. Entries are added only once the behaviour ships.
 *
 * Deliberately absent until IC1 implements them: Select/Hand tools (the toolbar
 * has only fit and minimap).
 */
export type CanvasShortcut = {
  action: string
  keys: string[]
  /** Mouse gesture rendered instead of key caps. */
  scrollWheel?: boolean
  /** Where this shortcut is implemented, for the help panel's audit trail. */
  handler: string
}

export const CANVAS_SHORTCUTS_LEFT: readonly CanvasShortcut[] = [
  { action: "Delete", keys: ["Delete"], handler: "xyflow deleteKeyCode" },
  { action: "Undo", keys: ["Ctrl", "Z"], handler: "keydown: ctrl+z" },
  { action: "Redo", keys: ["Ctrl", "Y"], handler: "keydown: ctrl+y" },
  { action: "Redo (alt)", keys: ["Ctrl", "Shift", "Z"], handler: "keydown: ctrl+shift+z" },
  { action: "Select all", keys: ["Ctrl", "A"], handler: "keydown: ctrl+a" },
  { action: "Copy", keys: ["Ctrl", "C"], handler: "keydown: ctrl+c" },
  { action: "Paste node / image", keys: ["Ctrl", "V"], handler: "window paste event" },
  { action: "Box select", keys: ["Ctrl", "Drag"], handler: "xyflow selectionKeyCode" },
  { action: "Multi-select", keys: ["Ctrl/Shift", "+ Click"], handler: "xyflow multiSelectionKeyCode" },
  { action: "Duplicate", keys: ["Alt", "Drag"], handler: "onNodeDragStop: altKey" },
  { action: "Zoom canvas", keys: [], scrollWheel: true, handler: "xyflow zoomOnScroll (default)" },
]

export const CANVAS_SHORTCUTS_RIGHT: readonly CanvasShortcut[] = [
  { action: "Zoom in", keys: ["Ctrl", "+"], handler: "keydown: ctrl+=" },
  { action: "Zoom out", keys: ["Ctrl", "-"], handler: "keydown: ctrl+-" },
  { action: "Fit to screen", keys: ["Shift", "1"], handler: "keydown: shift+Digit1" },
  { action: "Zoom to selection", keys: ["Shift", "2"], handler: "keydown: shift+Digit2" },
  { action: "Pan canvas", keys: ["Space", "Drag"], handler: "xyflow panActivationKeyCode" },
  { action: "Shortcuts help", keys: ["?"], handler: "keydown: ?" },
]
