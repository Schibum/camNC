import { afterEach, expect, it, vi } from 'vitest';
import type { CamJobV1 } from '../jobDb';
import { newBoard } from '../boards';
import { rebaseJob } from '../rebaseJob';
import type { ManufacturingSnapshot } from './manufacturingSnapshot';
import { recordNativeRun } from './nativeRunHistory';

const h = vi.hoisted(() => ({
  demo: true,
  rehearsal: null as string | null,
  get: vi.fn<(id: string) => Promise<CamJobV1 | null>>(),
  save: vi.fn<(job: CamJobV1, base?: CamJobV1) => Promise<CamJobV1>>(),
}));
vi.mock('../jobDb', async original => ({
  ...(await original<typeof import('../jobDb')>()),
  getJob: h.get,
  saveJob: h.save,
}));
vi.mock('@/lib/demo/demo-mode', async original => ({
  ...(await original<typeof import('@/lib/demo/demo-mode')>()),
  isDemoMode: () => h.demo,
  getRehearsalId: () => h.rehearsal,
}));
afterEach(() => {
  h.get.mockReset();
  h.save.mockReset();
});

it.each(['demo exit', 'rehearsal replacement'] as const)(
  'never writes run history into another storage namespace after %s during a read',
  async change => {
    h.demo = true;
    h.rehearsal = change === 'demo exit' ? null : 'rehearsal-a';
    let resolve!: (job: CamJobV1) => void;
    h.get.mockReturnValue(
      new Promise(yes => {
        resolve = yes;
      })
    );
    h.save.mockImplementation(async job => job);
    const board = { ...newBoard([], 18, 'oak', [], 'board'), physicalSheetId: 'sheet' };
    const snapshot = {
      jobId: 'job',
      sourceKey: 'source',
      designRevision: 1,
      runId: 'run',
      boardWasSaved: true,
      active: 'board:bit:0',
      doneId: 'program',
      gcode: 'G21',
      queue: [{ key: 'board:bit:0', doneId: 'program', kind: 'bit', board: { board } }],
      parts: [],
      instances: [],
      nestBit: 3,
      overlay: null,
    } as unknown as ManufacturingSnapshot;
    const operation = recordNativeRun(snapshot);
    if (change === 'demo exit') h.demo = false;
    else h.rehearsal = 'rehearsal-b';
    resolve({ id: 'job', boards: [board] } as unknown as CamJobV1);
    await expect(operation).rejects.toThrow(/mode|storage|context/i);
    expect(h.save).not.toHaveBeenCalled();
  }
);

it('refuses execution when the transaction preserves a replacement sheet instead of the old history patch', async () => {
  h.demo = true;
  h.rehearsal = null;
  const board = { ...newBoard([], 18, 'oak', [], 'board'), physicalSheetId: 'sheet-a' };
  const source = { id: 'job', boards: [board] } as unknown as CamJobV1;
  const replacement = { ...source, boards: [{ ...board, physicalSheetId: 'sheet-b' }] } as CamJobV1;
  h.get.mockResolvedValue(source);
  h.save.mockImplementation(async () => {
    h.get.mockResolvedValue(replacement);
    return replacement;
  });
  const snapshot = {
    jobId: 'job',
    sourceKey: 'source',
    designRevision: 1,
    runId: 'run',
    boardWasSaved: true,
    active: 'board:bit:0',
    doneId: 'program',
    gcode: 'G21',
    queue: [{ key: 'board:bit:0', doneId: 'program', kind: 'bit', board: { board } }],
    parts: [],
    instances: [],
    nestBit: 3,
    overlay: null,
  } as unknown as ManufacturingSnapshot;
  await expect(recordNativeRun(snapshot)).rejects.toThrow(/sheet|setup/i);
  expect(h.save).toHaveBeenCalledTimes(1);
  expect(replacement.boards![0].cut).toBeUndefined();
});

it('checks the committed source even when a competing source started the identical Done ID after the helper read', async () => {
  h.demo = true;
  h.rehearsal = null;
  const board = { ...newBoard([], 18, 'oak', [], 'board'), physicalSheetId: 'sheet' };
  const clean = { v: 1, id: 'job', name: 'Native', fileName: 'Native', parts: [], createdAt: 0, updatedAt: 0, boards: [board] } as CamJobV1;
  const competing = {
    ...clean,
    boards: [{ ...board, cut: { at: 1, sourceKey: 'part-source-a', keys: [], startedKeys: ['same-program'] } }],
  } as CamJobV1;
  h.get.mockResolvedValue(clean);
  let committed = competing;
  h.save.mockImplementation(async (next, base) => {
    // A commits after B's read, before the real transaction's existing rebase boundary.
    committed = rebaseJob(base!, next, competing);
    h.get.mockResolvedValue(committed);
    return committed;
  });
  const snapshot = {
    jobId: 'job',
    sourceKey: 'global-revision-two',
    designRevision: 2,
    runId: 'run-b',
    boardWasSaved: true,
    active: 'board:bit:0',
    doneId: 'same-program',
    gcode: 'G21',
    queue: [{ key: 'board:bit:0', sourceKey: 'part-source-b', doneId: 'same-program', kind: 'bit', board: { board } }],
    parts: [],
    instances: [],
    nestBit: 3,
    overlay: null,
  } as unknown as ManufacturingSnapshot;
  await expect(recordNativeRun(snapshot)).rejects.toThrow(/source|design|sheet/i);
  expect(committed.boards![0].cut).toEqual(competing.boards![0].cut);
  expect(h.save).toHaveBeenCalledTimes(1);
});
