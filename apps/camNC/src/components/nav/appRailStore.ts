import { demoStorage } from '@/lib/demo/demo-storage';
import { create } from 'zustand';
import { combine, createJSONStorage, persist } from 'zustand/middleware';

/** The left panel: everything in it, only the steps as icons, or none of it with the way back in the top bar. */
export type RailMode = 'full' | 'icons' | 'hidden';

/** The same in every view, so the steps stay in one place going from view to view. */
const kDefaultRail = 'icons' as RailMode;

/** How the left panel was last left: remembered per viewer, across jobs and reloads. */
export const useAppRail = create(
  persist(
    combine({ rail: kDefaultRail }, set => ({
      setRail: (rail: RailMode) => set({ rail }),
    })),
    { storage: createJSONStorage(() => demoStorage), name: 'camnc-app-rail' }
  )
);
