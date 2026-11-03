import { useBoardPlans, useCamJob, useCamModel } from '../camQueries';
import { useJobBoards } from '../useJobBoards';
import { machineQueue, useCamMachine } from './camMachine';

/**
 * The CAM job at the machine: its queue (programs with each board's rotation baked in) and the active entry. All
 * programs come from the board's plan. While a board is planned again (turned, or "Pause after each tab" changed) its
 * entries stay in the queue, but its programs can't be loaded: see `stale`.
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
    !!model.data,
    { keepShown: true }
  );
  const queue = machineQueue(
    boards,
    plans.map(p => p.data)
  );
  const current = queue.find(e => e.key === active) ?? queue.find(e => !done.includes(e.key)) ?? null;
  return {
    job,
    loading: !!jobId && (!model.data || plans.some(p => p.isPending && p.fetchStatus !== 'idle')),
    queue,
    current,
    done,
    /** Boards (ids) whose shown programs are being replaced: never load those. */
    stale: new Set(boards.filter((_, i) => plans[i].isPlaceholderData).map(b => b.board.id)),
  };
}
