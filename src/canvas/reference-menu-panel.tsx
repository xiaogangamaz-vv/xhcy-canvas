import {
  CANVAS_REFERENCE_MENU_ENTRIES,
  CANVAS_REFERENCE_MENU_TITLE,
  resolveCanvasReferenceMenuTarget,
  type CanvasReferenceSource,
  type CanvasReferenceTarget,
} from "@/canvas/reference-menu"

export type CanvasReferenceMenuPanelProps = {
  source: CanvasReferenceSource
  x: number
  y: number
  onClose: () => void
  onSelect: (target: CanvasReferenceTarget) => void
}

export function CanvasReferenceMenuPanel({ source, x, y, onClose, onSelect }: CanvasReferenceMenuPanelProps) {
  return (
    <div
      className="absolute z-50 w-[184px] overflow-hidden rounded-xl border border-border-default bg-surface-overlay shadow-2xl"
      style={{ left: x, top: y }}
      role="menu"
      aria-label={CANVAS_REFERENCE_MENU_TITLE}
    >
      <div className="flex items-center justify-between border-b border-white/8 px-2.5 py-1.5">
        <span className="text-[10px] font-semibold text-text-primary">{CANVAS_REFERENCE_MENU_TITLE}</span>
        <button type="button" className="text-[10px] text-text-weak hover:text-text-primary" onClick={onClose}>
          关闭
        </button>
      </div>
      <ul className="p-1">
        {CANVAS_REFERENCE_MENU_ENTRIES.map(entry => {
          const target = resolveCanvasReferenceMenuTarget(entry, source)
          const disabled = !entry.resolve || !target
          const Icon = entry.icon
          return (
            <li key={entry.key}>
              <button
                type="button"
                role="menuitem"
                disabled={disabled}
                className="flex h-[34px] w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-text-weak"
                onClick={() => {
                  if (!target) return
                  onSelect(target)
                }}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 truncate">{entry.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}