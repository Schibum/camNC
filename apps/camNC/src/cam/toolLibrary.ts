import type { LibraryTool } from '@wbcnc/cam';
import { readFusionToolLibrary } from '@wbcnc/cam/tools';
import { fusionLibraryText } from './unzip';
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

/** Where Fusion keeps the local tool library ("Local" in the Tool Library). */
export const kFusionLibraryPaths = {
  mac: '~/Library/Application Support/Autodesk/CAM360/libraries/Local/Library.json',
  windows: '%APPDATA%\\Autodesk\\CAM360\\libraries\\Local\\Library.json',
};

export type LibraryImport =
  | { ok: true; file: string; tools: LibraryTool[]; skipped: Record<string, number> }
  | { ok: false; error: string };

/** Read a Fusion tool library file (.json, or a zipped .tools export): its flat end mills and what was skipped. */
export async function readLibraryFile(file: File): Promise<LibraryImport> {
  try {
    const { tools, skipped } = readFusionToolLibrary(await fusionLibraryText(file));
    if (!tools.length) return { ok: false, error: `No flat end mills in ${file.name}.` };
    return { ok: true, file: file.name, tools, skipped };
  } catch (e) {
    return { ok: false, error: `${file.name}: ${e instanceof Error ? e.message : String(e)}` };
  }
}
