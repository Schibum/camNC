import { getRehearsalId, isDemoMode } from '@/lib/demo/demo-mode';
import { isCut, physicalSheetIdOf, type BoardCut, type BoardV1 } from '../boards';
import { getJob, updateJobForModel } from '../jobDb';
import type { ManufacturingSnapshot } from './manufacturingSnapshot';
import { nativeRunHistoryChanged, nativeRunTarget } from './nativeRunHistory';

export interface NativePreparationReceipt {
  readonly jobId: string;
  readonly boardId: string;
  readonly physicalSheetId: string;
  readonly sourceKey: string;
  readonly doneId: string;
  readonly executionId: string;
  readonly storageContext: string;
}

/** A claim transaction was attempted; callers must compensate this receipt or retain explicit review. */
export class NativePreparationFailure extends Error {
  constructor(
    message: string,
    readonly receipt: NativePreparationReceipt,
    cause: unknown
  ) {
    super(message, { cause });
    this.name = 'NativePreparationFailure';
  }
}

const storageContext = () => JSON.stringify([isDemoMode(), getRehearsalId()]);
function assertContext(expected: string) {
  if (storageContext() !== expected)
    throw new Error('The project storage mode changed. Its original preparation remains reserved for review.');
}
const changed = (id: string) => window.dispatchEvent(new CustomEvent(nativeRunHistoryChanged, { detail: id }));

/** Reserve a physical start before dispatch, with ownership that can be released only while no run was requested. */
export async function prepareNativeRun(snapshot: ManufacturingSnapshot, executionId: string): Promise<NativePreparationReceipt> {
  if (!executionId) throw new Error('The execution identity is missing.');
  const context = storageContext();
  for (let attempt = 0; attempt < 3; attempt++) {
    assertContext(context);
    const job = await getJob(snapshot.jobId);
    assertContext(context);
    if (!job) throw new Error('The CAM project was removed. The program was not started.');
    const target = nativeRunTarget(snapshot, job);
    const receipt: NativePreparationReceipt = {
      jobId: job.id,
      boardId: target.board.id,
      physicalSheetId: physicalSheetIdOf(target.board),
      sourceKey: target.sourceKey,
      doneId: snapshot.doneId,
      executionId,
      storageContext: context,
    };
    let failure: unknown;
    let attempted = false;
    try {
      const saved = await updateJobForModel(job, current => {
        try {
          const { board, boards, sourceKey } = nativeRunTarget(snapshot, current);
          const claims = board.cut?.startClaims ?? {};
          const existing = claims[executionId];
          if (existing && existing.doneId !== snapshot.doneId) throw new Error('This execution already owns another program preparation.');
          const sameProgram = Object.values(claims).filter(claim => claim.doneId === snapshot.doneId);
          const priorStarted =
            !!board.cut?.startedKeys?.includes(snapshot.doneId) && (!sameProgram.length || sameProgram.some(claim => claim.priorStarted));
          const priorAll = board.cut?.all || Object.values(claims).some(claim => claim.priorAll);
          const keys = board.cut?.keys ?? [];
          const startedKeys = [
            ...new Set([...(board.cut?.startedKeys ?? []), ...(keys.includes(snapshot.doneId) ? [] : [snapshot.doneId])]),
          ];
          const cut: BoardCut = {
            ...board.cut,
            at: isCut(board) ? board.cut!.at : Date.now(),
            keys,
            ...(startedKeys.length && { startedKeys }),
            sourceKey: board.cut?.sourceKey ?? sourceKey,
            startClaims: {
              ...claims,
              [executionId]: existing ?? { doneId: snapshot.doneId, priorStarted, ...(priorAll && { priorAll: true }) },
            },
          };
          if (!startedKeys.every(key => keys.includes(key))) delete cut.all;
          const next = { ...board, cut };
          attempted = true;
          return {
            ...current,
            boards: boards.some(b => b.id === board.id) ? boards.map(b => (b.id === board.id ? next : b)) : [...boards, next],
          };
        } catch (error) {
          failure = error;
          return null;
        }
      });
      assertContext(context);
      if (failure) throw failure;
      if (!saved) continue;
      const { board, sourceKey } = nativeRunTarget(snapshot, saved);
      if (board.cut?.sourceKey !== sourceKey || board.cut?.startClaims?.[executionId]?.doneId !== snapshot.doneId)
        throw new Error('The physical preparation changed before it could be recorded. Review the setup before starting.');
      changed(saved.id);
      return receipt;
    } catch (error) {
      if (attempted) throw new NativePreparationFailure(error instanceof Error ? error.message : String(error), receipt, error);
      throw error;
    }
  }
  throw new Error('The project changed while preparing this program. Review the setup before starting.');
}

/** Call only before any controller run request. A later execution or physical generation is never rolled back. */
export async function rollbackNativePreparation(receipt: NativePreparationReceipt): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    assertContext(receipt.storageContext);
    const job = await getJob(receipt.jobId);
    assertContext(receipt.storageContext);
    if (!job) return false;
    let visited = false;
    const saved = await updateJobForModel(job, current => {
      visited = true;
      const board = current.boards?.find(b => b.id === receipt.boardId);
      const cut = board?.cut;
      const claim = cut?.startClaims?.[receipt.executionId];
      if (
        !board ||
        physicalSheetIdOf(board) !== receipt.physicalSheetId ||
        cut?.sourceKey !== receipt.sourceKey ||
        claim?.doneId !== receipt.doneId
      )
        return null;
      const startClaims = { ...cut.startClaims };
      delete startClaims[receipt.executionId];
      const retained = Object.values(startClaims).some(other => other.doneId === receipt.doneId);
      const startedKeys = (cut.startedKeys ?? []).filter(
        key => key !== receipt.doneId || claim.priorStarted || retained || cut.keys.includes(key)
      );
      const nextCut: BoardCut = { ...cut };
      if (Object.keys(startClaims).length) nextCut.startClaims = startClaims;
      else delete nextCut.startClaims;
      if (startedKeys.length) nextCut.startedKeys = startedKeys;
      else delete nextCut.startedKeys;
      if ((cut.all || claim.priorAll) && startedKeys.every(key => cut.keys.includes(key))) nextCut.all = true;
      else delete nextCut.all;
      const next: BoardV1 = { ...board, cut: nextCut };
      if (!nextCut.keys.length && !startedKeys.length && !Object.keys(startClaims).length) delete next.cut;
      return { ...current, boards: current.boards!.map(b => (b.id === board.id ? next : b)) };
    });
    assertContext(receipt.storageContext);
    if (saved) {
      changed(saved.id);
      return true;
    }
    if (visited) return false;
  }
  throw new Error('The project kept changing. Its original preparation remains reserved for review.');
}
