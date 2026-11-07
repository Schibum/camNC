import { createPlateDocument } from '@wbcnc/cad';
import { afterEach, expect, it } from 'vitest';
import { useStore } from '@/store/store';
import { acceptDesign, boardGeometryKey, saveDesignDraft } from '../cadDesign';
import { boardRequest, instancesOf, nestBoard, reconcileBoards, startOverBoard, withLayout } from '../boards';
import { createDesignJob, getJob, modelKey, saveJob } from '../jobDb';
import { nativeCadModel } from '../nativeCadModel';
import type { PlanResult } from '../camTypes';
import { machineQueue, pinManufacturingRun, useCamMachine } from './camMachine';
import { matchesResumableSetup } from './manufacturingSnapshot';
import { recordNativeRun } from './nativeRunHistory';

afterEach(() => {
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
});

async function twoSheetsWithSameProgram() {
  const empty = await createDesignJob('Two physical sheets');
  const document = { ...createPlateDocument({ width: 100, height: 80, thickness: 18 }), id: empty.design!.draft.id };
  const accepted = await acceptDesign(await saveDesignDraft(empty, document), document);
  const { model } = await nativeCadModel(accepted.design!.accepted!);
  const instances = instancesOf(model.parts, () => true);
  const board = reconcileBoards(undefined, instances, 'oak')[0];
  const held = { ...board, taped: true };
  const placed = withLayout(held, nestBoard(held, instances, 3.175));
  const job = await saveJob({ ...accepted, boards: [placed] });
  const nest = nestBoard(placed, instances, 3.175);
  const request = boardRequest(placed, nest, instances);
  const gcode = 'G21 G90\nG0 Z25\nG1 X10 F300\nM30';
  const plan = {
    sourceKey: boardGeometryKey(
      job,
      document.parts.map(part => part.id)
    ),
    programs: [{ tool: 1, diameter: 3.175, gcode, timeMin: 1 }],
    bits: [3.175],
    size: [nest.board.w, nest.board.h, 18.3],
    ops: [],
    safety: [],
    warnings: [],
    path: [],
    timeMin: 1,
  } as unknown as PlanResult;
  const entry = machineQueue([{ board: placed, nest, request }], [plan])[0];
  expect(entry.kind).toBe('bit');
  const seed = {
    boardWasSaved: true,
    jobId: job.id,
    sourceKey: modelKey(job),
    designRevision: job.design!.acceptedRevision,
    active: entry.key,
    doneId: entry.doneId,
    gcode,
    queue: [entry],
    recordQueue: [entry],
    parts: model.parts,
    instances,
    nestBit: 3.175,
    overlay: null,
  };
  useStore.getState().updateToolpath(gcode, 'Same native program');
  useCamMachine.setState({ jobId: job.id, active: entry.key, loadedSnapshot: structuredClone(seed) });
  const first = pinManufacturingRun(gcode)!;
  await recordNativeRun(first);
  const started = (await getJob(job.id))!;
  // The same command used by Boards > Start over preserves the logical board while replacing its stock generation.
  const replacement = await saveJob({ ...started, boards: started.boards!.map(startOverBoard) }, started);
  const nextSeed = structuredClone(seed);
  nextSeed.queue[0].board.board = replacement.boards![0];
  useCamMachine.setState({ preparingRun: false, runReview: null, loadedSnapshot: nextSeed });
  const second = pinManufacturingRun(gcode)!;
  expect(second.doneId).toBe(first.doneId);
  await recordNativeRun(second);
  return { job, first, second };
}

it.each(['completion', 'resume'] as const)(
  'N1 rejects an old %s after Start over and starting the identical program on a replacement physical sheet',
  async action => {
    const f = await twoSheetsWithSameProgram();
    await expect(recordNativeRun(f.first, action === 'completion', action === 'resume')).rejects.toThrow(/sheet|setup|run/i);
    expect((await getJob(f.job.id))!.boards![0].cut!.keys).not.toContain(f.first.doneId);
  },
  30_000
);

it('N3 distinguishes two separately pinned physical runs even when their source, board and program bytes are identical', async () => {
  const f = await twoSheetsWithSameProgram();
  expect(f.first.runId).toBeTruthy();
  expect(f.second.runId).not.toBe(f.first.runId);
  expect(matchesResumableSetup({ jobId: f.job.id, active: f.second.active, runSnapshot: f.second }, f.first)).toBe(false);
  expect(
    matchesResumableSetup({ jobId: f.job.id, active: f.second.active, runSnapshot: f.second }, { ...f.second, runId: undefined })
  ).toBe(false);
}, 30_000);

it('keeps a later physical program pending when an earlier snapshot finishes with only its own program list', async () => {
  const f = await twoSheetsWithSameProgram();
  const later = structuredClone(f.second);
  later.runId = crypto.randomUUID();
  later.doneId = 'later-physical-program';
  later.queue[0].doneId = later.doneId;
  await recordNativeRun(later);
  const saved = await recordNativeRun(f.second, true);
  const cut = saved!.boards![0].cut!;
  expect(cut.keys).toContain(f.second.doneId);
  expect(cut.startedKeys).toContain(later.doneId);
  expect(cut.keys).not.toContain(later.doneId);
  expect(cut.all).toBeUndefined();
}, 30_000);
