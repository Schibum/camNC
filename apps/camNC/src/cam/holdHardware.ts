import { kClampWidth, kHoldDefaults, kHoldHeights } from '@wbcnc/cam/holdPoints';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The clamps and screws in the shop, for every job: `d` a clamp's reach in, or a screw head's ⌀; `height` above the stock's top; mm. */
export interface HoldHardware {
  clamp: { d: number; w: number; height: number };
  screw: { d: number; height: number };
}

export const kDefaultHardware: HoldHardware = {
  clamp: { d: kHoldDefaults.clamp, w: kClampWidth, height: kHoldHeights.clamp },
  screw: { d: kHoldDefaults.screw, height: kHoldHeights.screw },
};

export const useHoldHardware = create<{ hardware: HoldHardware; setHardware: (hardware: HoldHardware) => void }>()(
  persist(
    set => ({
      hardware: kDefaultHardware,
      setHardware: hardware => set({ hardware }),
    }),
    { name: 'cam-hold-hardware' }
  )
);
