import { useCamSource, useStore } from '@/store/store';
import { Vector3 } from 'three';
import { create } from 'zustand';
import { guessZeroAt, ZeroAt } from './depthInspection';
import { ParsedToolpath } from './gcodeParsing';

export interface HoverInfo {
  point: Vector3;
  motion?: string;
}

interface DepthViewState {
  zScale: number;
  showRapids: boolean;
  videoEnabled: boolean;
  // Z0 placement chosen by the user, guessed from the toolpath when null.
  zeroAt: ZeroAt | null;
  // Selection and hover refer to one toolpath's geometry, they are tagged with it so that
  // loading another file implicitly clears them.
  selected: { toolpath: ParsedToolpath; z: number } | null;
  hover: { toolpath: ParsedToolpath; info: HoverInfo } | null;
  setZScale: (zScale: number) => void;
  setShowRapids: (showRapids: boolean) => void;
  setVideoEnabled: (videoEnabled: boolean) => void;
  setZeroAt: (zeroAt: ZeroAt | null) => void;
  setSelected: (toolpath: ParsedToolpath, z: number | null) => void;
  setHover: (toolpath: ParsedToolpath, info: HoverInfo | null) => void;
}

/** UI state of the 3D depth views, shared between the scene inside the canvas and the overlay panel. */
export const useDepthView = create<DepthViewState>()(set => ({
  zScale: 1,
  showRapids: true,
  videoEnabled: true,
  zeroAt: null,
  selected: null,
  hover: null,
  setZScale: zScale => set({ zScale }),
  setShowRapids: showRapids => set({ showRapids }),
  setVideoEnabled: videoEnabled => set({ videoEnabled }),
  setZeroAt: zeroAt => set({ zeroAt }),
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

/**
 * Where the toolpath's Z0 lies on the stock, and `shift`: the offset from toolpath Z to Z relative to the stock top.
 */
export function useZeroPlacement(toolpath: ParsedToolpath) {
  const stockHeight = useStore(s => s.stockHeight);
  const chosen = useDepthView(s => s.zeroAt);
  const guessed = guessZeroAt(toolpath, stockHeight);
  const zeroAt = chosen ?? guessed;
  return { zeroAt, guessed, isGuess: chosen === null, shift: zeroAt === 'bottom' ? -stockHeight : 0 };
}
