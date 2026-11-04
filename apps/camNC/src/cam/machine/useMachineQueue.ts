import type { BoardV1 } from '../boards';
import { useBoardPlans, useCamJob, useCamModel, useSaveCamJob } from '../camQueries';
import { kDefaultPlan } from '../planSettings';
import { missingParts, useJobBoards } from '../useJobBoards';
import { currentEntry, doneEntries, machineQueue, useCamMachine } from './camMachine';

/**
 * The CAM job at the machine: its queue (programs with each board's rotation baked in) and the active entry. All
 * programs come from the board's plan. While a board is planned again (turned, or "Pause before each tab" changed) its
 * entries stay in the queue, but its programs can't be loaded: see `stale`. A board not planned yet, or whose plan
 * failed, stays in it too, as one entry saying so; one that fails a check has `blocked` on its entries.
 */
export function useMachineQueue() {
  const { jobId, rotation, active, done: doneHere } = useCamMachine();
  const { data: job } = useCamJob(jobId ?? '');
  const model = useCamModel(jobId ? job : null);
  const { boards: plain, instances } = useJobBoards(job, model.data);
  const boards = plain.map(b => {
    // As turned here, else as saved with the job.
    const [sideA, sideB] = [rotation[b.board.id] ?? b.board.bed?.a?.deg, rotation[`${b.board.id}:b`] ?? b.board.bed?.b?.deg];
    // A board lying straight asks for what the Plan step asked for: the same plan.
    return {
      ...b,
      request: { ...b.request, ...(sideA && { rotationDeg: sideA }), ...(sideB !== undefined && { sideBRotationDeg: sideB }) },
    };
  });
  const plans = useBoardPlans(
    job,
    boards.map(b => ({ request: b.request, material: b.board.material })),
    !!model.data,
    { keepShown: true }
  );
  const settings = job?.plan ?? kDefaultPlan;
  const queue = machineQueue(
    boards,
    plans.map(p => p.data),
    {
      bit: settings.bit.diameter,
      missing: missingParts(plain, instances).filter(m => !settings.leaveOut?.includes(m.id)),
      errors: plans.map(p => (p.isError ? p.error.message : undefined)),
    }
  );
  const save = useSaveCamJob(job);
  const done = doneEntries(queue, doneHere);
  const patchBoards = (patches: Record<string, Partial<BoardV1>>) => {
    if (job) save.mutate({ ...job, boards: plain.map(b => (patches[b.board.id] ? { ...b.board, ...patches[b.board.id] } : b.board)) });
  };
  return {
    job,
    loading: !!jobId && !model.isError && !model.data,
    /** The job's model can't be read: there is no queue. */
    modelError: model.error?.message,
    queue,
    /** The job's parts (shapes as seen from above), once its model is read. */
    parts: model.data?.parts,
    current: currentEntry(queue, active, done),
    done,
    /** Boards (ids) whose shown programs are being replaced: never load those. */
    stale: new Set(boards.filter((_, i) => plans[i].isPlaceholderData).map(b => b.board.id)),
    /** A change to a board (holds, its spot on the bed): saved to the job; holds plan it again. */
    updateBoard: (boardId: string, patch: Partial<BoardV1>) => patchBoards({ [boardId]: patch }),
    /** Several boards changed at once (what's cut). */
    patchBoards,
    /** The job's parts, as nested on the boards. */
    instances,
    /** The bit the boards are nested for (gap and margin around it). */
    nestBit: settings.bit.diameter,
    /** The measured stock thickness of a board: its programs are planned again from it. */
    setStockThickness: (boardId: string, measuredThickness: number) => {
      if (job) save.mutate({ ...job, boards: plain.map(b => (b.board.id === boardId ? { ...b.board, measuredThickness } : b.board)) });
    },
  };
}
