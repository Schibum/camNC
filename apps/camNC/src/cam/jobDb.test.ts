import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDemoModeForTest } from '@/lib/demo/demo-mode';
import { createJob, deleteJob, getJob, getModelBytes, modelKey, replaceModel, saveJob } from './jobDb';
import { kDefaultPlan } from './planSettings';

afterEach(() => {
  setDemoModeForTest(false);
  vi.restoreAllMocks();
});

describe.each([false, true])('replacing a job model (demo: %s)', demo => {
  async function begin() {
    setDemoModeForTest(demo);
    return createJob(new File(['original'], 'part.step'));
  }

  function delayedFile() {
    const file = new File(['replacement'], 'updated.stl');
    let release!: (bytes: ArrayBuffer) => void;
    vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise<ArrayBuffer>(resolve => (release = resolve)));
    return { file, release: () => release(new TextEncoder().encode('replacement').buffer as ArrayBuffer) };
  }

  it('keeps job edits saved while the replacement file is being read', async () => {
    const job = await begin();
    const { file, release } = delayedFile();
    const replacing = replaceModel(job, file);
    const edited = await saveJob({
      ...job,
      name: 'My revised part',
      parts: [{ id: 'part-0', name: 'Named part', quantity: 1, milled: false }],
      plan: { ...kDefaultPlan, material: 'plywood' },
      readError: 'The old model could not be read.',
    });
    release();
    const replaced = await replacing;
    expect(replaced).toEqual({
      ...edited,
      fileName: 'updated.stl',
      modelRevision: 1,
      updatedAt: expect.any(Number),
      readError: undefined,
    });
    expect(await getJob(job.id)).toEqual(replaced);
    expect(new TextDecoder().decode((await getModelBytes(job.id))!)).toBe('replacement');
  });

  it('gives replacements from the same stale job distinct model keys', async () => {
    const job = await begin();
    const first = await replaceModel(job, new File(['first'], 'part.step'));
    const second = await replaceModel(job, new File(['second'], 'part.step'));
    expect(first.modelRevision).toBe(1);
    expect(second.modelRevision).toBe(2);
    expect(modelKey(second)).not.toBe(modelKey(first));
    expect(await getJob(job.id)).toEqual(second);
    expect(new TextDecoder().decode((await getModelBytes(job.id))!)).toBe('second');
  });

  it('increments from the committed revision when file reads finish out of order', async () => {
    const job = await begin();
    const { file, release } = delayedFile();
    const firstRead = replaceModel(job, file);
    const firstSaved = await replaceModel(job, new File(['read sooner'], 'updated.stl'));
    release();
    const secondSaved = await firstRead;
    expect(firstSaved.modelRevision).toBe(1);
    expect(secondSaved.modelRevision).toBe(2);
    expect(modelKey(secondSaved)).not.toBe(modelKey(firstSaved));
    expect(await getJob(job.id)).toEqual(secondSaved);
    expect(new TextDecoder().decode((await getModelBytes(job.id))!)).toBe('replacement');
  });

  it('does not restore a job deleted while the replacement file was being read', async () => {
    const job = await begin();
    const { file, release } = delayedFile();
    const replacing = replaceModel(job, file);
    await deleteJob(job.id);
    release();
    await expect(replacing).rejects.toThrow('no longer exists');
    expect(await getJob(job.id)).toBeNull();
    expect(await getModelBytes(job.id)).toBeNull();
  });
});
