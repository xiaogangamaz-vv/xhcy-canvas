/**
 * Reserved host-event hook. Phase 1 persists through the Host port only;
 * there is no remote event stream to subscribe to.
 */
export function useCanvasEvents(_canvasId: string | null | undefined, _enabled = true): void {}