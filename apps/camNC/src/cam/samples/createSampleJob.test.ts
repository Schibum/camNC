import { afterEach, describe, expect, it, vi } from 'vitest';
import { camWorker, modelKey } from '../camQueries';
import { boardRequest, instancesOf, nestBoard, reconcileBoards } from '../boards';
import { planBlock } from '../boardBlock';
import { createJob, deleteJob, getJob, getModelBytes, listJobs, replaceModel, saveJob } from '../jobDb';
import { toCamSettings } from '../planSettings';
import { createSampleJob } from './createSampleJob';
import { setDemoModeForTest } from '@/lib/demo/demo-mode';

afterEach(() => {
  setDemoModeForTest(false);
  vi.restoreAllMocks();
});

describe('saved sample project', () => {
  it('creates independent ordinary jobs and plans the bundled tray through the real worker', async () => {
    const first = await createSampleJob();
    const second = await createSampleJob();
    expect(second.id).not.toBe(first.id);
    expect(second.name).toBe(`${first.name} (2)`);
    expect(first.origin).toEqual({ kind: 'sample', id: 'pocket-tray', revision: 1 });
    expect(first.parts).toEqual([]);
    const bytes = (await getModelBytes(first.id))!;
    const model = await camWorker().importModel(bytes, first.fileName, modelKey(first));
    expect(model.parts).toHaveLength(1);
    expect(model.parts[0].size).toEqual([180, 120, 12]);
    expect(model.parts[0].shape.pockets).toHaveLength(1);
    expect(model.parts[0].shape.pockets[0].region).toHaveLength(2);
    expect(model.parts[0].shape.pockets[0].depth).toBe(6);
    const instances = instancesOf(model.parts, () => true);
    const board = reconcileBoards(first.boards, instances, 'plywood')[0];
    const nest = nestBoard(board, instances, first.plan!.bit.diameter);
    expect(nest.unplaced).toEqual([]);
    const plan = await camWorker().generateBoard(modelKey(first), boardRequest(board, nest, instances), toCamSettings(first.plan!));
    expect(planBlock(plan)).toBeNull();
    expect(plan.programs).toHaveLength(1);
    expect(plan.ops.some(o => o.kind === 'pocket')).toBe(true);
    expect(plan.ops.some(o => o.kind === 'profile')).toBe(true);
    await saveJob({ ...first, name: 'My tray' });
    expect((await getJob(first.id))?.name).toBe('My tray');
    expect((await getJob(second.id))?.name).toBe(second.name);
    await deleteJob(first.id);
    expect(await getJob(first.id)).toBeNull();
    expect(await getModelBytes(first.id)).toBeNull();
    expect(await getJob(second.id)).not.toBeNull();
  }, 60_000);

  it('does not create a partial job if the model asset cannot be loaded', async () => {
    const before = (await listJobs()).length;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    await expect(createSampleJob()).rejects.toThrow('sample model could not be loaded');
    expect(await listJobs()).toHaveLength(before);
  });

  it('keeps demo edits, deletion and model replacement out of normal documents', async () => {
    const original = await createJob(new File(['original'], 'original.stl'));
    const saved = await getJob(original.id);
    setDemoModeForTest(true);
    expect(await getJob(original.id)).toBeNull();
    expect(await getModelBytes(original.id)).toBeNull();
    // Even a physical document id accidentally passed to demo code cannot overwrite the real document.
    await saveJob({ ...original, name: 'Demo changed this' });
    await replaceModel(original, new File(['demo'], 'replacement.stl'));
    await deleteJob(original.id);
    const demo = await createJob(new File(['demo'], 'Demo.stl'));
    const bytes = (await getModelBytes(demo.id))!;
    bytes[0] = 0;
    expect(new TextDecoder().decode((await getModelBytes(demo.id))!)).toBe('demo');
    setDemoModeForTest(false);
    expect(await getJob(original.id)).toEqual(saved);
    expect(new TextDecoder().decode((await getModelBytes(original.id))!)).toBe('original');
    expect(await getJob(demo.id)).toBeNull();
  });
});
