import { useCamSource } from '@/store/store';
import { Vector3 } from 'three';
import { create } from 'zustand';
import { ParsedToolpath } from './gcodeParsing';

export interface HoverInfo {
  point: Vector3;
  motion?: string;
}

interface DepthViewState {
  zScale: number;
  showRapids: boolean;
  videoEnabled: boolean;
  // Selection and hover refer to one toolpath's geometry, they are tagged with it so that
  // loading another file implicitly clears them.
  selected: { toolpath: ParsedToolpath; z: number } | null;
  hover: { toolpath: ParsedToolpath; info: HoverInfo } | null;
  setZScale: (zScale: number) => void;
  setShowRapids: (showRapids: boolean) => void;
  setVideoEnabled: (videoEnabled: boolean) => void;
  setSelected: (toolpath: ParsedToolpath, z: number | null) => void;
  setHover: (toolpath: ParsedToolpath, info: HoverInfo | null) => void;
}

/** UI state of the 3D depth views, shared between the scene inside the canvas and the overlay panel. */
export const useDepthView = create<DepthViewState>()(set => ({
  zScale: 1,
  showRapids: true,
  videoEnabled: true,
  selected: null,
  hover: null,
  setZScale: zScale => set({ zScale }),
  setShowRapids: showRapids => set({ showRapids }),
  setVideoEnabled: videoEnabled => set({ videoEnabled }),
  setSelected: (toolpath, z) => set({ selected: z === null ? null : { toolpath, z } }),
  setHover: (toolpath, info) => set({ hover: info ? { toolpath, info } : null }),
}));

export function useSelectedLevel(toolpath: ParsedToolpath) {
  return useDepthView(s => (s.selected?.toolpath === toolpath ? s.selected.z : null));
}

export function useHoverInfo(toolpath: ParsedToolpath | null | undefined) {
  return useDepthView(s => (toolpath && s.hover?.toolpath === toolpath ? s.hover.info : null));
}

/** Whether the live camera image can and should be shown on the stock top in the 3D views. */
export function useShowStockVideo() {
  const camSource = useCamSource();
  const videoEnabled = useDepthView(s => s.videoEnabled);
  return !!camSource?.extrinsics && !!camSource.machineBounds && videoEnabled;
}
