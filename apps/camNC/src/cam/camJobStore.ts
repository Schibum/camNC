import { DEFAULT_TABS, MATERIALS, type CamSettings, type Tool } from '@wbcnc/cam';
import * as Comlink from 'comlink';
import { create } from 'zustand';
import type { CamWorkerAPI } from './cam.worker';
import type { CamPartSummary, GeneratedJob } from './camTypes';

let worker: Comlink.Remote<CamWorkerAPI> | undefined;
/** One long-lived worker: occt's wasm (2.3 MB brotli) loads on the first STEP file only. */
function camWorker() {
  worker ??= Comlink.wrap<CamWorkerAPI>(new Worker(new URL('./cam.worker.ts', import.meta.url), { type: 'module' }));
  return worker;
}

export type MaterialKey = keyof typeof MATERIALS;

/** What the user picks in the job panel; mapped onto CamSettings. */
export interface JobOptions {
  material: MaterialKey;
  bits: Tool[];
  tabs: boolean;
  /** Final outline pass at half feed (cleaner edge, slower). */
  gentleFinish: boolean;
  /** How far the final pass goes below the stock bottom (into the spoilboard). */
  cutBelow: number;
}

export const kDefaultJobOptions: JobOptions = {
  material: 'oak',
  bits: [{ number: 1, diameter: 3.175, name: 'flat end mill' }],
  tabs: false,
  gentleFinish: true,
  cutBelow: 0.3,
};

export function toCamSettings(o: JobOptions): Partial<CamSettings> {
  return {
    material: MATERIALS[o.material],
    tools: o.bits,
    tabs: o.tabs ? DEFAULT_TABS : false,
    finalFeedFactor: o.gentleFinish ? 0.5 : 1,
    finalZ: -o.cutBelow,
  };
}

export type Side = 'top' | 'bottom';
const jobKey = (id: string, side: Side) => `${id}:${side}`;

interface CamJobState {
  fileName: string | null;
  status: 'idle' | 'reading' | 'ready' | 'error';
  error: string | null;
  readMs: number | null;
  parts: CamPartSummary[];
  selectedId: string | null;
  side: Side;
  options: JobOptions;
  jobs: Record<string, GeneratedJob | 'pending'>;
  openStep: (file: File) => Promise<void>;
  select: (id: string, side?: Side) => void;
  setOptions: (o: Partial<JobOptions>) => void;
  generate: (id: string, side: Side) => Promise<GeneratedJob>;
}

export const useCamJob = create<CamJobState>((set, get) => ({
  fileName: null,
  status: 'idle',
  error: null,
  readMs: null,
  parts: [],
  selectedId: null,
  side: 'top',
  options: kDefaultJobOptions,
  jobs: {},
  async openStep(file) {
    set({ fileName: file.name, status: 'reading', error: null, parts: [], jobs: {}, selectedId: null });
    try {
      const { parts, readMs } = await camWorker().importStep(new Uint8Array(await file.arrayBuffer()));
      set({ parts, readMs, status: 'ready', selectedId: parts[0]?.id ?? null, side: 'top' });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },
  select(id, side = 'top') {
    set({ selectedId: id, side });
  },
  setOptions(o) {
    // Every generated job depends on the options.
    set(s => ({ options: { ...s.options, ...o }, jobs: {} }));
  },
  async generate(id, side) {
    const key = jobKey(id, side);
    set(s => ({ jobs: { ...s.jobs, [key]: 'pending' } }));
    const job = await camWorker().generate(id, toCamSettings(get().options), side);
    set(s => ({ jobs: { ...s.jobs, [key]: job } }));
    return job;
  },
}));

export const useJob = (id: string | null, side: Side) => useCamJob(s => (id ? s.jobs[jobKey(id, side)] : undefined));
