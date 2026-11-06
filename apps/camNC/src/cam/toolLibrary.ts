import { demoStorage } from '@/lib/demo/demo-storage';
import type { LibraryTool } from '@wbcnc/cam';
import { readFusionToolLibrary, selectToolPreset } from '@wbcnc/cam/tools';
import { bitKey } from './cuttingData';
import { kDefaultBit } from './planSettings';
import { fusionLibraryText } from './unzip';
import { create } from 'zustand';
import { combine, createJSONStorage, persist } from 'zustand/middleware';

/** A bit offered in every job: from an imported Fusion tool library, or added by hand. */
export interface StoredBit extends LibraryTool {
  id: string;
  source: 'library' | 'custom';
  /** The library file it came from (source "library"). */
  library?: string;
}

export interface LibraryImportRecord {
  file: string;
  at: number;
  added: number;
  updated: number;
}

const sameTool = (a: LibraryTool, b: LibraryTool) =>
  a.guid && b.guid ? a.guid === b.guid : a.number === b.number && a.diameter === b.diameter && a.name === b.name;

/**
 * Merge a library import into the bits: a bit with the same Fusion guid (else the same number, diameter and name) is
 * updated, the others are added. Bits not in the file stay; custom bits are never touched.
 */
export function mergeLibrary(bits: StoredBit[], tools: LibraryTool[], file: string): { bits: StoredBit[]; added: number; updated: number } {
  const out = [...bits];
  let added = 0,
    updated = 0;
  for (const t of tools) {
    const i = out.findIndex(b => b.source === 'library' && sameTool(b, t));
    if (i >= 0) {
      const previous = out[i];
      const selected = previous.presetId && t.presets?.some(p => p.id === previous.presetId) ? selectToolPreset(t, previous.presetId) : t;
      const next = { ...previous, ...selected, library: file, stickout: previous.stickout ?? selected.stickout };
      // Removed preset values become unknown instead of retaining data from the previous selection.
      for (const key of [
        'feed',
        'plungeFeed',
        'rampFeed',
        'leadFeed',
        'leadOutFeed',
        'finishFeed',
        'reducedFeed',
        'transitionFeed',
        'rpm',
        'stepdown',
        'stepover',
        'finalFeedFactor',
        'presetId',
        'presetName',
        'presets',
      ] as const)
        Object.assign(next, { [key]: selected[key] });
      if (JSON.stringify(next) !== JSON.stringify(out[i])) updated++;
      out[i] = next;
    } else {
      out.push({ ...t, id: crypto.randomUUID(), source: 'library', library: file });
      added++;
    }
  }
  return { bits: out, added, updated };
}

/** The next free tool number, for a bit added by hand. */
export const nextToolNumber = (bits: LibraryTool[]) => Math.max(0, ...bits.map(b => b.number)) + 1;

/**
 * The bits offered in every job (persisted in this browser / the desktop app). A job keeps its own copy of the bit it
 * uses, so removing one here doesn't change existing jobs.
 */
export const useToolLibrary = create(
  persist(
    combine({ bits: [] as StoredBit[], imports: [] as LibraryImportRecord[] }, set => ({
      importLibrary: (tools: LibraryTool[], file: string) => {
        let result = { added: 0, updated: 0 };
        set(s => {
          const merged = mergeLibrary(s.bits, tools, file);
          result = { added: merged.added, updated: merged.updated };
          return { bits: merged.bits, imports: [...s.imports, { file, at: Date.now(), ...result }] };
        });
        return result;
      },
      addCustom: (bit: Omit<LibraryTool, 'number'> & { number?: number }) =>
        set(s => ({
          bits: [...s.bits, { ...bit, number: bit.number ?? nextToolNumber(s.bits), id: crypto.randomUUID(), source: 'custom' as const }],
        })),
      updateBit: (id: string, patch: Partial<LibraryTool>) => set(s => ({ bits: s.bits.map(b => (b.id === id ? { ...b, ...patch } : b)) })),
      removeBit: (id: string) => set(s => ({ bits: s.bits.filter(b => b.id !== id) })),
    })),
    {
      storage: createJSONStorage(() => demoStorage),
      name: 'camnc-tool-library',
      version: 2,
      // v1 kept one imported list: those become library bits.
      migrate: (old, version) => {
        if (version < 2) {
          const v1 = old as { tools?: LibraryTool[]; source?: string | null };
          const file = v1.source ?? 'Fusion library';
          return {
            bits: (v1.tools ?? []).map(t => ({ ...t, id: crypto.randomUUID(), source: 'library' as const, library: file })),
            imports: [],
          };
        }
        return old as { bits: StoredBit[]; imports: LibraryImportRecord[] };
      },
    }
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

/** The bits to offer: the built-in 1/8″, the stored ones, and the job's own (it may have been removed since). */
export function offeredBits(stored: LibraryTool[], current: LibraryTool[] = []): LibraryTool[] {
  const bits: LibraryTool[] = [kDefaultBit];
  for (const b of [...stored, ...current]) if (!bits.some(x => bitKey(x) === bitKey(b))) bits.push(b);
  return bits;
}

export function useBits(current: LibraryTool[] = []) {
  const stored = useToolLibrary(s => s.bits);
  return offeredBits(stored, current);
}
