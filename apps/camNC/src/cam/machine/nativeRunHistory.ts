import { isCut, physicalSheetIdOf } from '../boards';
import { getJob, saveJob } from '../jobDb';
import type { CamJobV1 } from '../jobDb';
import type { ManufacturingSnapshot } from './manufacturingSnapshot';
import { getRehearsalId, isDemoMode } from '@/lib/demo/demo-mode';

import { nativeRunHistoryChanged } from './nativeRunEvents';
export { nativeRunHistoryChanged } from './nativeRunEvents';

/** Shared durable target validation for preparation, dispatch history and original completion/resume. */
export function nativeRunTarget(snapshot: ManufacturingSnapshot, job: CamJobV1, finished = false, requireStartedSheet = false) {
  const entry = snapshot.queue.find(e => e.key === snapshot.active);
  if (!entry || entry.kind === 'pending' || entry.kind === 'error') throw new Error('The original manufacturing program is missing.');
  const original = entry.board.board;
  const boards = job.boards ?? [];
  const savedBoard = boards.find(b => b.id === original.id);
  if (!savedBoard && (snapshot.boardWasSaved || finished || requireStartedSheet))
    throw new Error('The original physical board was removed. Load and review a new board setup before starting.');
  const board = savedBoard ?? original;
  if (physicalSheetIdOf(board) !== physicalSheetIdOf(original))
    throw new Error('The original physical sheet was replaced. Load and review its new setup before starting.');
  const sourceKey = entry.sourceKey ?? snapshot.sourceKey;
  if (!finished && !requireStartedSheet && board.cut?.sourceKey && board.cut.sourceKey !== sourceKey)
    throw new Error('This physical sheet was started from another design. Start over with a new sheet before using this program.');
  if (
    (isCut(original) && !isCut(board)) ||
    ((finished || requireStartedSheet) && !board.cut?.startedKeys?.includes(snapshot.doneId) && !board.cut?.keys.includes(snapshot.doneId))
  )
    throw new Error('The original physical sheet was started over. This program cannot be applied to the replacement sheet.');
  return { entry, original, boards, board, sourceKey };
}

/** Physical history is recorded before dispatch; completion alone adds the original program to completed keys. */
export async function recordNativeRun(snapshot: ManufacturingSnapshot, finished = false, requireStartedSheet = false) {
  const context = JSON.stringify([isDemoMode(), getRehearsalId()]);
  const assertContext = () => {
    if (JSON.stringify([isDemoMode(), getRehearsalId()]) !== context)
      throw new Error('The project storage mode changed. Review the machine setup before starting.');
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    assertContext();
    const job = await getJob(snapshot.jobId);
    assertContext();
    if (!job) throw new Error('The CAM project was removed. The program was not started.');
    const { original, boards, board, sourceKey } = nativeRunTarget(snapshot, job, finished, requireStartedSheet);
    const keys = [...new Set([...(board.cut?.keys ?? []), ...(finished ? [snapshot.doneId] : [])])];
    const startedKeys = [...new Set([...(board.cut?.startedKeys ?? []), snapshot.doneId])];
    const programs = (snapshot.recordQueue ?? snapshot.queue).filter(
      e => e.board.board.id === original.id && e.kind !== 'pending' && e.kind !== 'error' && e.kind !== 'flip'
    );
    const cut = {
      ...(board.cut?.startClaims && { startClaims: board.cut.startClaims }),
      at: isCut(board) ? board.cut!.at : Date.now(),
      keys,
      startedKeys,
      sourceKey: board.cut?.sourceKey ?? sourceKey,
      ...(programs.length > 0 && programs.every(e => keys.includes(e.doneId)) && startedKeys.every(key => keys.includes(key))
        ? { all: true }
        : {}),
    };
    const next = { ...board, cut };
    try {
      const saved = await saveJob(
        { ...job, boards: boards.some(b => b.id === board.id) ? boards.map(b => (b.id === board.id ? next : b)) : [...boards, next] },
        job
      );
      assertContext();
      const recorded = saved.boards?.find(b => b.id === original.id);
      if (
        !recorded ||
        physicalSheetIdOf(recorded) !== physicalSheetIdOf(original) ||
        !(recorded.cut?.startedKeys?.includes(snapshot.doneId) || recorded.cut?.keys.includes(snapshot.doneId))
      )
        throw new Error('The physical sheet changed before its run history could be recorded. Review the new setup before starting.');
      if (!finished && !requireStartedSheet && recorded.cut?.sourceKey !== sourceKey)
        throw new Error('This physical sheet was started from another design. Start over with a new sheet before using this program.');
      window.dispatchEvent(new CustomEvent(nativeRunHistoryChanged, { detail: saved.id }));
      return saved;
    } catch (error) {
      assertContext();
      if (attempt === 2) throw error;
      const current = await getJob(snapshot.jobId);
      assertContext();
      if (!current) throw error;
    }
  }
}
