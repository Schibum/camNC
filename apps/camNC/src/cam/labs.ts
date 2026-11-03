import { create } from 'zustand';
import { combine, persist } from 'zustand/middleware';

/**
 * Opt-in features that are not ready for everyone. Kept out of the main settings store so that flags come and go
 * without settings migrations or backups.
 */
export const useLabs = create(
  persist(
    combine({ camBeta: false }, set => ({
      setCamBeta: (camBeta: boolean) => set({ camBeta }),
    })),
    { name: 'camnc-labs' }
  )
);
