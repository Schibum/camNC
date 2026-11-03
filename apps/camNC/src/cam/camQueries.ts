import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Comlink from 'comlink';
import type { CamWorkerAPI } from '../workers/cam.worker';
import type { BoardRequest, ModelImport, PlanResult } from './camTypes';
import { kDefaultPlan, toCamSettings } from './planSettings';
import { useCuttingData } from './cuttingData';
import { getJob, getModelBytes, listJobs, saveJob, type CamJobV1 } from './jobDb';
import { modelReadError } from './openModelFile';
import { withPartNames } from './partNames';
import { useCallback, useRef } from 'react';

let worker: Comlink.Remote<CamWorkerAPI> | undefined;
/** One long-lived worker, started on the first model: occt's wasm is 2.3 MB brotli. */
export function camWorker() {
  worker ??= Comlink.wrap<CamWorkerAPI>(new Worker(new URL('../workers/cam.worker.ts', import.meta.url), { type: 'module' }));
  return worker;
}

export const camKeys = {
  jobs: ['cam', 'jobs'] as const,
  job: (id: string) => ['cam', 'job', id] as const,
  model: (id: string, fileName: string) => ['cam', 'model', id, fileName] as const,
  plan: (id: string, fileName: string, partId: string, settings: unknown) => ['cam', 'plan', id, fileName, partId, settings] as const,
};

export const useCamJobs = () => useQuery({ queryKey: camKeys.jobs, queryFn: listJobs });

export const useCamJob = (id: string) => useQuery({ queryKey: camKeys.job(id), queryFn: () => getJob(id), staleTime: Infinity });

/**
 * The imported model of a job (parts + display meshes). Recomputed from the stored file per session; on the first
 * import the job's part list is filled in, later imports keep `milled` and the user's names by part id. The parts
 * come named as the job names them (renames, one name per body: see `withPartNames`).
 */
export function useCamModel(job: CamJobV1 | null | undefined) {
  const queryClient = useQueryClient();
  const jobParts = job?.parts;
  const select = useCallback(
    (model: ModelImport): ModelImport => ({ ...model, parts: withPartNames(model.parts, jobParts ?? []) }),
    [jobParts]
  );
  return useQuery({
    select,
    queryKey: camKeys.model(job?.id ?? '', job?.fileName ?? ''),
    enabled: !!job,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    // A file that can't be read fails the same way again: say so now, not after three slow retries.
    retry: false,
    queryFn: async (): Promise<ModelImport> => {
      const write = async (next: CamJobV1) => {
        const saved = await saveJob(next);
        queryClient.setQueryData(camKeys.job(saved.id), saved);
        void queryClient.invalidateQueries({ queryKey: camKeys.jobs });
      };
      let model: ModelImport;
      try {
        const bytes = await getModelBytes(job!.id);
        if (!bytes) throw new Error('The model file of this job is missing.');
        model = await camWorker().importModel(Comlink.transfer(bytes, [bytes.buffer as ArrayBuffer]), job!.fileName, modelKey(job!));
      } catch (e) {
        // Kept on the job, so the job list shows it failed.
        const readError = modelReadError(job!.fileName, e);
        if (job!.readError !== readError) await write({ ...job!, readError });
        throw new Error(readError, { cause: e });
      }
      const known = new Map(job!.parts.map(p => [p.id, p]));
      const parts = model.parts.map(p => ({
        id: p.id,
        name: known.get(p.id)?.name ?? p.name,
        quantity: p.names.length,
        milled: known.get(p.id)?.milled ?? !p.summary.notFlat,
      }));
      if (JSON.stringify(parts) !== JSON.stringify(job!.parts) || job!.readError) {
        const next = { ...job!, parts };
        delete next.readError;
        await write(next);
      }
      return model;
    },
  });
}

export const modelKey = (job: CamJobV1) => `${job.id}:${job.fileName}`;

/** Toolpaths + G-code of one part with the job's plan settings; recomputed (~0.3s) when they change. */
export function useCamPlan(job: CamJobV1 | null | undefined, partId: string | undefined, modelReady: boolean) {
  const saved = useCuttingData(s => s.saved);
  const settings = toCamSettings(job?.plan ?? kDefaultPlan, undefined, saved);
  return useQuery({
    queryKey: camKeys.plan(job?.id ?? '', job?.fileName ?? '', partId ?? '', settings),
    enabled: !!job && !!partId && modelReady,
    staleTime: Infinity,
    gcTime: 60_000,
    placeholderData: prev => prev,
    queryFn: (): Promise<PlanResult> => camWorker().generate(modelKey(job!), partId!, settings),
  });
}

/**
 * Programs for every board (they decide the queue order by their bits); recomputed when a board or setting changes.
 * `keepShown`: while one is recomputed, its last program stays (`isPlaceholderData`), so what's shown doesn't blink
 * away; never hand such a stale one to the machine.
 */
export function useBoardPlans(
  job: CamJobV1 | null | undefined,
  boards: { request: BoardRequest; material: string }[],
  modelReady: boolean,
  { keepShown = false } = {}
) {
  const plan = job?.plan ?? kDefaultPlan;
  const saved = useCuttingData(s => s.saved);
  // Per board id, its last program (a changed setting is a new query: useQueries keeps no placeholder across keys).
  const last = useRef(new Map<string, PlanResult>());
  const results = useQueries({
    queries: boards.map(({ request, material }) => {
      const settings = toCamSettings(plan, material as typeof plan.material, saved);
      return {
        queryKey: ['cam', 'board-plan', job?.id ?? '', job?.fileName ?? '', request, settings] as const,
        enabled: !!job && modelReady && request.parts.length > 0,
        staleTime: Infinity,
        gcTime: 60_000,
        queryFn: (): Promise<PlanResult> => camWorker().generateBoard(modelKey(job!), request, settings),
      };
    }),
  });
  if (!keepShown) return results;
  return results.map((r, i) => {
    const id = boards[i].request.id;
    if (r.data) {
      last.current.set(id, r.data);
      return { ...r, isPlaceholderData: false };
    }
    const shown = last.current.get(id);
    return shown ? { ...r, data: shown, isPlaceholderData: true } : r;
  });
}

/** Per job id, the number of the newest save started (see useSaveCamJob). */
const latestSave = new Map<string, number>();

export function useSaveCamJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveJob,
    onMutate: job => {
      queryClient.setQueryData(camKeys.job(job.id), job);
      const save = (latestSave.get(job.id) ?? 0) + 1;
      latestSave.set(job.id, save);
      return { save };
    },
    onSuccess: (saved, _job, context) => {
      // Only the newest save writes back: a slow earlier one must not bring back the job it held.
      if (context?.save === latestSave.get(saved.id)) queryClient.setQueryData(camKeys.job(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: camKeys.jobs });
    },
  });
}
