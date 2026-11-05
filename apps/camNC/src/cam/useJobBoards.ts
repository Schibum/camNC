import { useMemo } from 'react';
import {
  boardRequest,
  instancesOf,
  nestBoard,
  reconcileBoards,
  withLayout,
  type BoardNest,
  type BoardV1,
  type PartInstance,
} from './boards';
import type { BoardRequest, ModelImport } from './camTypes';
import { useHoldHardware } from './holdHardware';
import type { CamJobV1 } from './jobDb';
import { kDefaultPlan } from './planSettings';

export interface JobBoard {
  board: BoardV1;
  nest: BoardNest;
  request: BoardRequest;
}

export interface MissingPart {
  id: string;
  name: string;
  board: string;
}

/** Parts on a board that don't fit on it: they would silently not be cut. */
export function missingParts(boards: JobBoard[], instances: PartInstance[]): MissingPart[] {
  const byId = new Map(instances.map(i => [i.id, i]));
  return boards.flatMap(b => b.nest.unplaced.map(id => ({ id, name: byId.get(id)?.name ?? id, board: b.board.name })));
}

/** The job's boards, kept in sync with the parts to mill, each nested and ready to generate. */
export function useJobBoards(job: CamJobV1 | null | undefined, model: ModelImport | undefined) {
  const hardware = useHoldHardware(s => s.hardware);
  return useMemo(() => {
    if (!job || !model) return { instances: [] as PartInstance[], boards: [] as JobBoard[], changed: false };
    const milled = new Map(job.parts.map(p => [p.id, p.milled]));
    const instances = instancesOf(model.parts, id => milled.get(id) ?? true);
    const plan = job.plan ?? kDefaultPlan;
    const boards = reconcileBoards(job.boards, instances, plan.material).map(reconciled => {
      const nest = nestBoard(reconciled, instances, plan.bit.diameter, { stickout: plan.bit.stickout, hardware });
      // Stored once nested: from then on its parts stay where they are.
      const board = withLayout(reconciled, nest);
      return { board, nest, request: boardRequest(board, nest, instances, { skin: plan.skin }) };
    });
    const changed = JSON.stringify(boards.map(b => b.board)) !== JSON.stringify(job.boards ?? []);
    return { instances, changed, boards };
  }, [job, model, hardware]);
}
