import type { LibraryTool } from '@wbcnc/cam';
import { create } from 'zustand';
import { combine, persist } from 'zustand/middleware';

/** Flat end mills imported from a Fusion tool library, offered as bits in every job. */
export const useToolLibrary = create(
  persist(
    combine({ tools: [] as LibraryTool[], source: null as string | null }, set => ({
      setTools: (tools: LibraryTool[], source: string) => set({ tools, source }),
    })),
    { name: 'camnc-tool-library' }
  )
);
