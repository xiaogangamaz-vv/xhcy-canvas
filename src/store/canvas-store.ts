import { create } from "zustand"

type CanvasUiState = {
  selectedNodeId: string | null
  isAssetPanelOpen: boolean
  isInspectorOpen: boolean
  dirtyNodeIds: string[]
  setSelectedNodeId: (nodeId: string | null) => void
  setAssetPanelOpen: (open: boolean) => void
  setInspectorOpen: (open: boolean) => void
  markNodeDirty: (nodeId: string) => void
  clearNodeDirty: (nodeId: string) => void
}

export const useCanvasStore = create<CanvasUiState>((set) => ({
  selectedNodeId: null,
  isAssetPanelOpen: true,
  isInspectorOpen: true,
  dirtyNodeIds: [],
  setSelectedNodeId: selectedNodeId => set({ selectedNodeId }),
  setAssetPanelOpen: isAssetPanelOpen => set({ isAssetPanelOpen }),
  setInspectorOpen: isInspectorOpen => set({ isInspectorOpen }),
  markNodeDirty: nodeId => set(state => ({
    dirtyNodeIds: state.dirtyNodeIds.includes(nodeId)
      ? state.dirtyNodeIds
      : [...state.dirtyNodeIds, nodeId],
  })),
  clearNodeDirty: nodeId => set(state => ({
    dirtyNodeIds: state.dirtyNodeIds.filter(id => id !== nodeId),
  })),
}))
