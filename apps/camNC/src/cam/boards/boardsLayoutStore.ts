import { demoStorage } from '@/lib/demo/demo-storage';
import { create } from 'zustand';
import { combine, createJSONStorage, persist } from 'zustand/middleware';

/** How the Boards step was last left: remembered per viewer, across jobs and reloads. */
export const useBoardsLayout = create(
  persist(
    combine({ railClosed: false }, set => ({
      setRailClosed: (railClosed: boolean) => set({ railClosed }),
    })),
    { storage: createJSONStorage(() => demoStorage), name: 'camnc-boards-layout' }
  )
);
