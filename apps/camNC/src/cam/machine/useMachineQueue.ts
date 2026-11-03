import { useQuery } from '@tanstack/react-query';
import { camWorker, modelKey, useBoardPlans, useCamJob, useCamModel } from '../camQueries';
import type { TabRemovalResult } from '../camTypes';
import { useCuttingData } from '../cuttingData';
import { kDefaultPlan, toCamSettings } from '../planSettings';
import { useJobBoards } from '../useJobBoards';
import { machineQueue, useCamMachine } from './camMachine';

/**
 * The CAM job at the machine: its queue (programs with each board's rotation baked in) and the active entry,
 * plus the guided tab removal program when that's the active entry.
 */
export function useMachineQueue() {
  const { jobId, rotation, active, done } = useCamMachine();
  const { data: job } = useCamJob(jobId ?? '');
  const model = useCamModel(jobId ? job : null);
  const { boards: plain } = useJobBoards(job, model.data);
  const boards = plain.map(b => ({ ...b, request: { ...b.request, rotationDeg: rotation[b.board.id] ?? 0 } }));
  const plans = useBoardPlans(
    job,
    boards.map(b => ({ request: b.request, material: b.board.material })),
    !!model.data
  );
  const queue = machineQueue(
    boards,
    plans.map(p => p.data)
  );
  const current = queue.find(e => e.key === active) ?? queue.find(e => !done.includes(e.key)) ?? null;
  const saved = useCuttingData(s => s.saved);
  const settings = toCamSettings(job?.plan ?? kDefaultPlan, current?.board.board.material, saved);
  const tabs = useQuery({
    queryKey: ['cam', 'tab-removal', job?.id, job?.fileName, current?.board.request, settings],
    enabled: !!job && current?.kind === 'tabs',
    staleTime: Infinity,
    queryFn: (): Promise<TabRemovalResult> => camWorker().generateTabRemoval(modelKey(job!), current!.board.request, settings),
  });
  return {
    job,
    loading: !!jobId && (!model.data || plans.some(p => p.isPending && p.fetchStatus !== 'idle')),
    queue,
    current,
    done,
    tabRemoval: tabs.data,
  };
}
