import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Comlink from 'comlink';
import type { CamWorkerAPI } from '../workers/cam.worker';
import type { BoardRequest, ModelImport, PlanResult } from './camTypes';
import { useStore } from '@/store/store';
import { useCamMachine } from './machine/camMachine';
import { kDefaultPlan, toCamSettings } from './planSettings';
import { rebaseJob } from './rebaseJob';
import { useCuttingData } from './cuttingData';
import { getJob, getModelBytes, listJobs, modelKey, saveJob, updateJobForModel, type CamJobV1 } from './jobDb';
import { modelReadError } from './openModelFile';
import { carriedParts, matchReplacedParts, partPrint, remapBoards, replaceWarning } from './partMatch';
import { withPartNames } from './partNames';
import { useCallback, useRef } from 'react';

export { modelKey } from './jobDb';

let worker: Comlink.Remote<CamWorkerAPI> | undefined;
/** One long-lived worker, started on the first model: occt's wasm is 2.3 MB brotli. */
export function camWorker() {
  worker ??= Comlink.wrap<CamWorkerAPI>(new Worker(new URL('../workers/cam.worker.ts', import.meta.url), { type: 'module' }));
  return worker;
}

export const camKeys = {
  jobs: ['cam', 'jobs'] as const,
  job: (id: string) => ['cam', 'job', id] as const,
  model: (key: string) => ['cam', 'model', key] as const,
  plan: (key: string, partId: string, settings: unknown) => ['cam', 'plan', key, partId, settings] as const,
};

export const useCamJobs = () => useQuery({ queryKey: camKeys.jobs, queryFn: listJobs });

/** Per job id, the number of the newest save started (see useSaveCamJob and useCamModel). */
const latestSave = new Map<string, number>();

export const useCamJob = (id: string) => useQuery({ queryKey: camKeys.job(id), queryFn: () => getJob(id), staleTime: Infinity });

/**
 * The imported model of a job (parts + display meshes). Recomputed from the stored file per session; on the first
 * import the job's part list is filled in, later imports keep `milled` and the user's names by part id, and a replaced
 * model's by what the parts are (`partMatch`). The parts
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
    queryKey: camKeys.model(job ? modelKey(job) : ''),
    enabled: !!job,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    // A file that can't be read fails the same way again: say so now, not after three slow retries.
    retry: false,
    queryFn: async (): Promise<ModelImport> => {
      // Importing can outlive a replacement or deletion. The storage transaction checks model identity and existence;
      // the save counter and cache check also protect edits started while that transaction is running.
      const write = async (update: (current: CamJobV1) => CamJobV1 | null) => {
        const key = camKeys.job(job!.id);
        const cached = queryClient.getQueryData<CamJobV1 | null>(key);
        if (cached === null || (cached && modelKey(cached) !== modelKey(job!))) return;
        let save: number | undefined;
        const saved = await updateJobForModel(job!, current => {
          const now = queryClient.getQueryData<CamJobV1 | null>(key);
          if (now === null || (now && modelKey(now) !== modelKey(job!))) return null;
          const merged = now ? rebaseJob(job!, now, current) : current;
          const next = update(merged);
          if (next) {
            save = (latestSave.get(next.id) ?? 0) + 1;
            latestSave.set(next.id, save);
          }
          // Before returning to the event loop: subsequent edits rebase onto the imported fields too. Another tab
          // may have already saved this import; refresh the cache then without writing the same document again.
          queryClient.setQueryData(key, next ?? merged);
          return next;
        });
        if (!saved) return;
        if (save === latestSave.get(saved.id))
          queryClient.setQueryData<CamJobV1 | null>(key, now => (now === null || (now && modelKey(now) !== modelKey(saved)) ? now : saved));
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
        await write(now => (now.readError === readError ? null : { ...now, readError }));
        throw new Error(readError, { cause: e });
      }
      await write(now => {
        const revision = now.modelRevision ?? 0;
        const partsFrom = { revision, prints: Object.fromEntries(model.parts.map(p => [p.id, partPrint(p)])) };
        const from = now.partsFrom;
        // An importer update can split or reorder groups without replacing the stored model file.
        const replaced = !!from && (from.revision !== revision || JSON.stringify(from.prints) !== JSON.stringify(partsFrom.prints));
        const match = replaced
          ? matchReplacedParts(
              now.parts.flatMap(p => (from.prints[p.id] ? [{ id: p.id, name: p.name, print: from.prints[p.id] }] : [])),
              model.parts.map(p => ({ id: p.id, print: partsFrom.prints[p.id] }))
            )
          : null;
        const parts = carriedParts(model.parts, now.parts, match && { matched: match.matched, prints: from!.prints });
        if (
          !match &&
          JSON.stringify(parts) === JSON.stringify(now.parts) &&
          JSON.stringify(partsFrom) === JSON.stringify(from) &&
          !now.readError
        )
          return null;
        const next = {
          ...now,
          parts,
          partsFrom,
          ...(match && {
            replaceWarning: replaceWarning(match.affected),
            ...(now.boards && { boards: remapBoards(now.boards, match.matched) }),
          }),
        };
        delete next.readError;
        return next;
      });
      return model;
    },
  });
}

/** Toolpaths + G-code of one part with the job's plan settings; recomputed (~0.3s) when they change. */
export function useCamPlan(job: CamJobV1 | null | undefined, partId: string | undefined, modelReady: boolean) {
  const saved = useCuttingData(s => s.saved);
  const spindle = useStore(s => s.machinePrefs.spindleSwitch ?? 'hand');
  const settings = { ...toCamSettings(job?.plan ?? kDefaultPlan, undefined, saved), spindle };
  return useQuery({
    queryKey: camKeys.plan(job ? modelKey(job) : '', partId ?? '', settings),
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
  const pauseEachTab = useCamMachine(s => s.pauseEachTab);
  const spindle = useStore(s => s.machinePrefs.spindleSwitch ?? 'hand');
  // Per board id, its last program (a changed setting is a new query: useQueries keeps no placeholder across keys).
  const last = useRef(new Map<string, PlanResult>());
  const results = useQueries({
    queries: boards.map(({ request, material }) => {
      const settings = { ...toCamSettings(plan, material as typeof plan.material, saved), spindle };
      // The guided tab removal is planned with the board: only boards that have one plan again when this changes.
      const perPart = request.holdDown === 'tabs-guided' && !pauseEachTab;
      return {
        queryKey: ['cam', 'board-plan', job ? modelKey(job) : '', request, settings, perPart] as const,
        enabled: !!job && modelReady && request.parts.length > 0,
        staleTime: Infinity,
        gcTime: 60_000,
        queryFn: (): Promise<PlanResult> => camWorker().generateBoard(modelKey(job!), request, settings, { perPart }),
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
    // A failed one shows its error, not the program before it.
    const shown = r.isError ? undefined : last.current.get(id);
    return shown ? { ...r, data: shown, isPlaceholderData: true } : r;
  });
}

/**
 * Saves the job. `rendered`: the job the caller builds its saves from; what a save changed from it goes on top of the job
 * as it is now, so a save right after another (before the next render) doesn't undo it (`rebaseJob`).
 */
export function useSaveCamJob(rendered?: CamJobV1 | null) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ job, base }: { job: CamJobV1; base?: CamJobV1 }) => saveJob(job, base),
    onMutate: ({ job }) => {
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
  const base = useRef(rendered);
  base.current = rendered;
  const edit = (job: CamJobV1) => {
    const current = queryClient.getQueryData<CamJobV1>(camKeys.job(job.id));
    const next = base.current && current ? rebaseJob(base.current, job, current) : job;
    // Now, not in onMutate (a tick later): the next save may come before that.
    queryClient.setQueryData(camKeys.job(next.id), next);
    // The transaction rebases too: an import may commit after this snapshot but before this save reaches IndexedDB.
    return { job: next, base: current ?? base.current ?? undefined };
  };
  return {
    ...mutation,
    mutate: (job: CamJobV1) => mutation.mutate(edit(job)),
    mutateAsync: (job: CamJobV1) => mutation.mutateAsync(edit(job)),
  };
}
