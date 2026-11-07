import { physicalSheetIdOf, type BoardV1 } from '../boards';
import { useBoardPlans, useCamJob, useCamModel, useSaveCamJob } from '../camQueries';
import { kDefaultPlan } from '../planSettings';
import { missingParts, useJobBoards } from '../useJobBoards';
import { currentEntry, doneEntries, machineQueue, useCamMachine } from './camMachine';
import { modelKey } from '../jobDb';
import { rebaseJob } from '../rebaseJob';
import { useMachineSetupLocked } from './useMachineBusy';

/**
 * The CAM job at the machine: its queue (programs with each board's rotation baked in) and the active entry. All
 * programs come from the board's plan. While a board is planned again (turned, or "Pause before each tab" changed) its
 * entries stay in the queue, but its programs can't be loaded: see `stale`. A board not planned yet, or whose plan
 * failed, stays in it too, as one entry saying so; one that fails a check has `blocked` on its entries.
 */
export function useMachineQueue() {
  'use no memo';
  const { jobId, rotation, active, done: doneHere, runSnapshot } = useCamMachine();
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
  const liveQueue = machineQueue(
    boards,
    plans.map(p => p.data),
    {
      bit: settings.bit.diameter,
      missing: missingParts(plain, instances).filter(m => !settings.leaveOut?.includes(m.id)),
      errors: plans.map(p => (p.isError ? p.error.message : undefined)),
    }
  );
  const previousRun = runSnapshot?.jobId === jobId ? runSnapshot : null;
  const protectedRun = useMachineSetupLocked(false);
  const snapshot = protectedRun && previousRun?.active === active ? previousRun : null;
  const protectedEntry = snapshot?.queue.find(entry => entry.key === snapshot.active);
  // Only the program actually running/resumable is frozen. The rest of the job keeps
  // fresh planning errors, placeholders and programs, including other sides/boards.
  const queue = protectedEntry
    ? [
        protectedEntry,
        ...liveQueue.filter(
          entry =>
            entry.key !== protectedEntry.key &&
            !(entry.board.board.id === protectedEntry.board.board.id && (entry.kind === 'pending' || entry.kind === 'error'))
        ),
      ]
    : liveQueue;
  const runBoard = previousRun?.queue.find(entry => entry.key === previousRun.active)?.board.board.id;
  const history = (previousRun?.recordQueue ?? previousRun?.queue ?? []).filter(entry => entry.board.board.id === runBoard);
  const recordedBoards = new Set(history.map(entry => entry.board.board.id));
  const recordQueue = [
    ...history.map(entry => ({
      ...entry,
      board: {
        ...entry.board,
        board: {
          ...entry.board.board,
          // Start over can clear cut history while old run metadata still exists.
          cut: job?.boards?.find(board => board.id === entry.board.board.id)?.cut,
        },
      },
    })),
    ...liveQueue.filter(entry => !recordedBoards.has(entry.board.board.id)),
  ];
  const save = useSaveCamJob(job);
  const done = doneEntries(queue, doneHere);
  const patchBoards = (patches: Record<string, Partial<BoardV1>>, expectedSheets?: Readonly<Record<string, string>>) => {
    if (!job) return;
    const expected =
      expectedSheets ??
      Object.fromEntries((model.data ? plain.map(b => b.board) : (job.boards ?? [])).map(board => [board.id, physicalSheetIdOf(board)]));
    save.mutateCurrent(current => {
      if (modelKey(current) !== modelKey(job)) return null;
      // A ready model can introduce stock without visiting Boards. Persist its layout
      // with the first machine action, rebased over any action since this render.
      // Loading/error projections must never erase the existing physical stock (M1).
      const baseline = model.data ? rebaseJob(job, { ...job, boards: plain.map(b => b.board) }, current).boards : current.boards;
      const applies = (board: BoardV1) => !!patches[board.id] && expected[board.id] === physicalSheetIdOf(board);
      if (!baseline?.some(applies)) return null;
      return { ...current, boards: baseline.map(board => (applies(board) ? { ...board, ...patches[board.id] } : board)) };
    });
  };
  return {
    job,
    loading: !snapshot && !!jobId && !model.isError && !model.data,
    /** The job's model can't be read: there is no queue. */
    modelError: snapshot ? undefined : model.error?.message,
    queue,
    /** Completed programs retain their original geometry even after executable setup protection ends. */
    recordQueue,
    /** The job's parts (shapes as seen from above), once its model is read. */
    parts: snapshot?.parts ?? model.data?.parts,
    current: currentEntry(queue, active, done),
    done,
    /** Boards (ids) whose shown programs are being replaced: never load those. */
    stale: new Set(boards.filter((_, i) => plans[i].isPlaceholderData).map(b => b.board.id)),
    snapshot,
    designChanged: !!snapshot && !!job && snapshot.sourceKey !== modelKey(job),
    /** A change to a board (holds, its spot on the bed): saved to the job; holds plan it again. */
    updateBoard: (boardId: string, patch: Partial<BoardV1>) => {
      if (!protectedRun) patchBoards({ [boardId]: patch });
    },
    /** Several boards changed at once (what's cut). */
    patchBoards,
    /** The job's parts, as nested on the boards. */
    instances: snapshot?.instances ?? instances,
    /** The bit the boards are nested for (gap and margin around it). */
    nestBit: snapshot?.nestBit ?? settings.bit.diameter,
    /** The measured stock thickness of a board: its programs are planned again from it. */
    setStockThickness: (boardId: string, measuredThickness: number) => {
      if (!protectedRun) patchBoards({ [boardId]: { measuredThickness } });
    },
  };
}
