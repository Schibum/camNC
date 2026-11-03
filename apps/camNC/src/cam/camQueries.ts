import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Comlink from 'comlink';
import type { CamWorkerAPI } from '../workers/cam.worker';
import type { BoardRequest, ModelImport, PlanResult } from './camTypes';
import { kDefaultPlan, toCamSettings } from './planSettings';
import { getJob, getModelBytes, listJobs, saveJob, type CamJobV1 } from './jobDb';

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
 * import the job's part list is filled in, later imports keep `milled` by part id.
 */
export function useCamModel(job: CamJobV1 | null | undefined) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: camKeys.model(job?.id ?? '', job?.fileName ?? ''),
    enabled: !!job,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    queryFn: async (): Promise<ModelImport> => {
      const bytes = await getModelBytes(job!.id);
      if (!bytes) throw new Error('The model file of this job is missing.');
      const model = await camWorker().importModel(Comlink.transfer(bytes, [bytes.buffer as ArrayBuffer]), job!.fileName, modelKey(job!));
      const known = new Map(job!.parts.map(p => [p.id, p]));
      const parts = model.parts.map(p => ({
        id: p.id,
        name: p.name,
        quantity: p.names.length,
        milled: known.get(p.id)?.milled ?? !p.summary.notFlat,
      }));
      if (JSON.stringify(parts) !== JSON.stringify(job!.parts)) {
        const saved = await saveJob({ ...job!, parts });
        queryClient.setQueryData(camKeys.job(saved.id), saved);
      }
      return model;
    },
  });
}

const modelKey = (job: CamJobV1) => `${job.id}:${job.fileName}`;

/** Toolpaths + G-code of one part with the job's plan settings; recomputed (~0.3s) when they change. */
export function useCamPlan(job: CamJobV1 | null | undefined, partId: string | undefined, modelReady: boolean) {
  const settings = toCamSettings(job?.plan ?? kDefaultPlan);
  return useQuery({
    queryKey: camKeys.plan(job?.id ?? '', job?.fileName ?? '', partId ?? '', settings),
    enabled: !!job && !!partId && modelReady,
    staleTime: Infinity,
    gcTime: 60_000,
    placeholderData: prev => prev,
    queryFn: (): Promise<PlanResult> => camWorker().generate(modelKey(job!), partId!, settings),
  });
}

/** Programs for every board (they decide the queue order by their bits); recomputed when a board or setting changes. */
export function useBoardPlans(
  job: CamJobV1 | null | undefined,
  boards: { request: BoardRequest; material: string }[],
  modelReady: boolean
) {
  const plan = job?.plan ?? kDefaultPlan;
  return useQueries({
    queries: boards.map(({ request, material }) => {
      const settings = toCamSettings(plan, material as typeof plan.material);
      return {
        queryKey: ['cam', 'board-plan', job?.id ?? '', job?.fileName ?? '', request, settings] as const,
        enabled: !!job && modelReady && request.parts.length > 0,
        staleTime: Infinity,
        gcTime: 60_000,
        queryFn: (): Promise<PlanResult> => camWorker().generateBoard(modelKey(job!), request, settings),
      };
    }),
  });
}

export function useSaveCamJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveJob,
    onMutate: job => queryClient.setQueryData(camKeys.job(job.id), job),
    onSuccess: saved => {
      queryClient.setQueryData(camKeys.job(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: camKeys.jobs });
    },
  });
}
