import { describe, expect, it } from 'vitest';
import { createJob } from '@/cam/jobDb';
import { DEFAULT_TABS } from '@wbcnc/cam';
import {
  cleanExpiredSnapshots,
  deleteSnapshot,
  kRehearsalLifetime,
  loadSnapshot,
  makeSnapshot,
  returnToSource,
  saveSnapshot,
} from './snapshots';

async function fixture() {
  const job = await createJob(new File(['model'], 'tray.stl'));
  const board = {
    id: 'board-a',
    name: 'A',
    thickness: 12,
    material: 'plywood' as const,
    size: { fit: true as const },
    retention: 'tabs' as const,
    tabs: DEFAULT_TABS,
    items: [],
    cut: { at: 123, keys: ['cut'], all: true },
    bed: { a: { x: 99, y: 88 } },
  };
  const snapshot = makeSnapshot(job, new Uint8Array([1, 2, 3]), [board], { bits: [], cutting: {}, pauseEachTab: false, spindle: 'hand' });
  return { job, board, snapshot };
}

describe('rehearsal handoff', () => {
  it('copies the job without physical completion, placement, hosts or camera settings', async () => {
    const { board, snapshot } = await fixture();
    expect(snapshot.job.boards![0].cut).toBeUndefined();
    expect(snapshot.job.boards![0].bed).toBeUndefined();
    expect(snapshot.job.boards![0].physicalSheetId).toBeTruthy();
    expect(snapshot.job.boards![0].physicalSheetId).not.toBe(board.id);
    expect(board.cut.all).toBe(true);
    expect(board.bed.a.x).toBe(99);
    expect(snapshot.expiresAt).toBeGreaterThan(Date.now() + kRehearsalLifetime - 1000);
    await saveSnapshot(snapshot);
    const loaded = await loadSnapshot(snapshot.id);
    expect(loaded).toEqual(snapshot);
    loaded.job.name = 'changed copy';
    expect((await loadSnapshot(snapshot.id)).job.name).not.toBe('changed copy');
    await deleteSnapshot(snapshot.id);
    await expect(loadSnapshot(snapshot.id)).rejects.toThrow('expired or is unavailable');
  });

  it('refuses expired and unknown handoffs and removes expired snapshots without touching valid ones', async () => {
    const { snapshot } = await fixture();
    const expired = { ...snapshot, id: crypto.randomUUID(), expiresAt: Date.now() - 1 };
    await saveSnapshot(snapshot);
    await saveSnapshot(expired);
    await expect(loadSnapshot(expired.id)).rejects.toThrow('expired');
    await expect(loadSnapshot('missing')).rejects.toThrow('expired');
    await cleanExpiredSnapshots();
    expect(await loadSnapshot(snapshot.id)).toEqual(snapshot);
    // If expiry had only been hidden, a past time would reveal the record again.
    await expect(loadSnapshot(expired.id, 0)).rejects.toThrow('expired');
  });

  it('builds only a local CAM return route', () => {
    expect(returnToSource('job-1')).toBe('/cam/job-1/plan?rehearsed=1');
    expect(returnToSource('https://other.example/')).toBe('/cam/https%3A%2F%2Fother.example%2F/plan?rehearsed=1');
  });
});
