import { useMemo } from 'react';
import { boardRequest, instancesOf, nestBoard, reconcileBoards, type BoardNest, type BoardV1, type PartInstance } from './boards';
import type { BoardRequest, ModelImport } from './camTypes';
import type { CamJobV1 } from './jobDb';
import { kDefaultPlan } from './planSettings';

export interface JobBoard {
  board: BoardV1;
  nest: BoardNest;
  request: BoardRequest;
}

/** The job's boards, kept in sync with the parts to mill, each nested and ready to generate. */
export function useJobBoards(job: CamJobV1 | null | undefined, model: ModelImport | undefined) {
  return useMemo(() => {
    if (!job || !model) return { instances: [] as PartInstance[], boards: [] as JobBoard[], changed: false };
    const milled = new Map(job.parts.map(p => [p.id, p.milled]));
    const instances = instancesOf(model.parts, id => milled.get(id) ?? true);
    const plan = job.plan ?? kDefaultPlan;
    const boards = reconcileBoards(job.boards, instances, plan.material);
    const changed = JSON.stringify(boards) !== JSON.stringify(job.boards ?? []);
    return {
      instances,
      changed,
      boards: boards.map(board => {
        const nest = nestBoard(board, instances, plan.bit.diameter);
        return { board, nest, request: boardRequest(board, nest, instances) };
      }),
    };
  }, [job, model]);
}
