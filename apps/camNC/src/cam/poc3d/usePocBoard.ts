/**
 * THROWAWAY (3D concept prototypes): real board programs from the fixtures, without a job.
 * - 'kinderregal': the kinderregal eiche left side on a fitted board (pockets, rabbet, curved outline, tabs)
 * - 'besteck': the besteckkasten vert1 board (pockets, 3 through holes, outline)
 */
import { useQuery } from '@tanstack/react-query';
import { parseGCode, type ParsedToolpath } from '@/visualize/gcodeParsing';
import besteckUrl from '../../../../../packages/cam/test/fixtures/besteckkasten.step?url';
import kinderregalUrl from '../../../../../packages/cam/test/fixtures/kinderregal-eiche.step?url';
import { boardRequest, instancesOf, nestBoard, newBoard } from '../boards';
import { camWorker } from '../camQueries';
import type { CamPartInfo, PlanResult } from '../camTypes';
import { kDefaultPlan, toCamSettings } from '../planSettings';

export type PocBoardName = 'kinderregal' | 'besteck';

const kSources: Record<PocBoardName, { url: string; file: string; body: string }> = {
  kinderregal: { url: kinderregalUrl, file: 'kinderregal-eiche.step', body: 'left' },
  besteck: { url: besteckUrl, file: 'besteckkasten.step', body: 'vert1' },
};

/** One operation of the board program and the range of toolpath points it covers. */
export interface PocOp {
  index: number;
  /** e.g. "left: Pocket 1 z=3.8" */
  name: string;
  /** e.g. "Pocket 4.2 deep" */
  label: string;
  kind: 'pocket' | 'profile';
  /** First and last (inclusive) index into toolpath.pathPoints. */
  from: number;
  to: number;
  /** Start/end time (s) in the program, from the toolpath's job timeline. */
  timeMin: number;
}

export interface PocBoard {
  part: CamPartInfo;
  plan: PlanResult;
  toolpath: ParsedToolpath;
  ops: PocOp[];
  /** Board size [w, h, stock top]. */
  size: [number, number, number];
}

/** Toolpath point ranges per operation, from the (OP n/N …) markers in the program. */
export function opRanges(gcode: string, toolpath: ParsedToolpath): { name: string; from: number; to: number }[] {
  const markers = gcode
    .split('\n')
    .map((l, i) => ({ line: i + 1, m: l.match(/^\(OP \d+\/\d+ (.+) - T\d+ D=[\d.]+\)$/) }))
    .filter(x => x.m)
    .map(x => ({ line: x.line, name: x.m![1] }));
  return markers.map((mk, k) => {
    const next = markers[k + 1]?.line ?? Infinity;
    let from = -1,
      to = -1;
    toolpath.lines.forEach((line, i) => {
      if (line > mk.line && line < next) {
        if (from < 0) from = i;
        to = i;
      }
    });
    return { name: mk.name, from: Math.max(0, from), to: Math.max(from, to) };
  });
}

export function usePocBoard(which: PocBoardName) {
  return useQuery({
    queryKey: ['cam', 'poc3d', which],
    staleTime: Infinity,
    queryFn: async (): Promise<PocBoard> => {
      const src = kSources[which];
      const bytes = new Uint8Array(await (await fetch(src.url)).arrayBuffer());
      const key = `poc3d:${which}`;
      const model = await camWorker().importModel(bytes, src.file, key);
      const part = model.parts.find(p => p.names.includes(src.body))!;
      const instances = instancesOf(model.parts, id => id === part.id).filter(i => i.name === src.body);
      const board = {
        ...newBoard(
          [],
          part.thickness,
          'oak',
          instances.map(i => i.id)
        ),
        holdDown: 'tabs' as const,
      };
      const nest = nestBoard(board, instances, kDefaultPlan.bit.diameter);
      const plan = await camWorker().generateBoard(key, boardRequest(board, nest, instances), toCamSettings(kDefaultPlan));
      const toolpath = parseGCode(plan.gcode);
      const ops = opRanges(plan.gcode, toolpath).map((r, index) => ({
        ...r,
        index,
        label: plan.ops[index]?.label ?? r.name,
        kind: plan.ops[index]?.kind ?? 'pocket',
        timeMin: plan.ops[index]?.timeMin ?? 0,
      }));
      return { part, plan, toolpath, ops, size: plan.size };
    },
  });
}
