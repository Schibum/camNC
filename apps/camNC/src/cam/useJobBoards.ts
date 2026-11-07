import { useMemo } from 'react';
import {
  boardRequest,
  instancesOf,
  keepFixturesClear,
  keepWithinMachine,
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
import { selectMachineBounds, useStore } from '@/store/store';

/** The machine's work area, X × Y mm, once it is set up: no board fitted to its parts comes out bigger. */
export function useMachineArea() {
  const bounds = useStore(selectMachineBounds);
  return useMemo(
    () => (bounds?.max && bounds.min ? { w: bounds.max.x - bounds.min.x, h: bounds.max.y - bounds.min.y } : undefined),
    [bounds]
  );
}

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
  const machine = useMachineArea();
  return useMemo(() => {
    if (!job || !model) return { instances: [] as PartInstance[], boards: [] as JobBoard[], changed: false };
    const milled = new Map(job.parts.map(p => [p.id, p.milled]));
    const instances = instancesOf(model.parts, id => milled.get(id) ?? true);
    const plan = job.plan ?? kDefaultPlan;
    const opts = { stickout: plan.bit.stickout, hardware, machine, preserveLayout: !!job.design };
    const reconciled = reconcileBoards(job.boards, instances, plan.material, { preserveReferences: !!job.design });
    const reconciledAll = job.design ? reconciled : keepWithinMachine(reconciled, instances, plan.bit.diameter, opts);
    const boards = reconciledAll.map(reconciled => {
      const clear = keepFixturesClear(reconciled, instances, plan.bit.diameter, opts);
      const nest = nestBoard(clear, instances, plan.bit.diameter, opts);
      // Stored once nested: from then on its parts stay where they are.
      const laidOut = withLayout(clear, nest);
      const board =
        job.design && clear.layout
          ? { ...laidOut, layout: { ...clear.layout, ...laidOut.layout, at: { ...clear.layout.at, ...laidOut.layout?.at } } }
          : laidOut;
      return {
        board,
        nest,
        request: boardRequest(board, nest, instances, { skin: plan.skin, holes: plan.holes, leaveOut: plan.leaveOut }),
      };
    });
    const changed = JSON.stringify(boards.map(b => b.board)) !== JSON.stringify(job.boards ?? []);
    return { instances, changed, boards };
  }, [job, model, hardware, machine]);
}
