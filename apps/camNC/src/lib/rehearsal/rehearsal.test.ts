import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJob, getJob, getModelBytes } from '@/cam/jobDb';
import { useCamMachine } from '@/cam/machine/camMachine';
import { useCuttingData } from '@/cam/cuttingData';
import { useToolLibrary } from '@/cam/toolLibrary';
import { useStore } from '@/store/store';
import { setDemoModeForTest } from '../demo/demo-mode';
import { demoStorage } from '../demo/demo-storage';
import { loadJobProgress, loadJobRecord, saveJobProgress, saveJobRecord, clearJobRecord } from '../machine/jobRecord';
import { launchRehearsal, prepareRehearsal, rehearsalBlockedReason } from './rehearsal';
import { makeSnapshot, saveSnapshot } from './snapshots';
import { DEFAULT_TABS } from '@wbcnc/cam';

const context = vi.hoisted(() => ({
  id: null as string | null,
  api: null as null | {
    jobProgress: { value: number | null };
    jobStartedAt: { value: number | null };
    status: { value: { state: string } };
  },
}));
vi.mock('../demo/demo-mode', async original => ({
  ...(await original<typeof import('../demo/demo-mode')>()),
  getRehearsalId: () => context.id,
}));
vi.mock('@/lib/fluidnc/machine', () => ({
  getExistingCncApi: () => context.api,
  getCncApi: () => context.api,
  setSimulatedMachine: vi.fn(),
}));

afterEach(() => {
  setDemoModeForTest(false);
  context.id = null;
  context.api = null;
  sessionStorage.removeItem('camnc-rehearsal');
});

describe('rehearsal isolation', () => {
  it('restores a new temporary copy and replans without inheriting physical placement or cut history', async () => {
    const source = await createJob(new File(['model bytes'], 'source.stl'));
    const snapshot = makeSnapshot(
      source,
      (await getModelBytes(source.id))!,
      [
        {
          id: 'a',
          name: 'A',
          thickness: 12,
          material: 'plywood',
          size: { fit: false, w: 400, h: 300 },
          retention: 'tabs',
          tabs: DEFAULT_TABS,
          items: [],
          cut: { at: 1, keys: ['already-cut'] },
          bed: { a: { x: 100, y: 200 } },
        },
      ],
      { bits: [], cutting: { test: { feed: 123 } }, pauseEachTab: true, spindle: 'hand' }
    );
    snapshot.job.boards!.push({ ...snapshot.job.boards![0], id: 'b', name: 'B' });
    snapshot.boardId = 'b';
    await saveSnapshot(snapshot);
    const saved = await getJob(source.id);
    // Real persisted data must survive both bootstrapping and editing the rehearsal.
    const keys = ['camnc-tool-library', 'camnc-cutting-data', 'camnc-cam-machine', 'camnc-plan-layout', 'camnc-plan-3d-view'];
    for (const key of keys) localStorage.setItem(key, JSON.stringify({ state: { marker: 'real:' + key }, version: 2 }));
    setDemoModeForTest(true);
    context.id = snapshot.id;
    sessionStorage.setItem('camnc-rehearsal', snapshot.id);
    for (const key of keys) expect(demoStorage.getItem(key) ?? '').not.toContain('real:' + key);
    await prepareRehearsal();
    const firstId = useCamMachine.getState().jobId!;
    expect(firstId).not.toBe(source.id);
    expect(useCamMachine.getState().active).toBe('b:');
    const copy = (await getJob(firstId))!;
    expect(copy.boards![0].cut).toBeUndefined();
    expect(copy.boards![0].bed).toBeUndefined();
    expect(await getJob(source.id)).toBeNull();
    expect(new TextDecoder().decode((await getModelBytes(firstId))!)).toBe('model bytes');
    expect(useStore.getState().camSources).toEqual({});
    expect(useCuttingData.getState().saved).toEqual(snapshot.cutting);
    useCamMachine.getState().markDone('simulated-cut');
    useToolLibrary.getState().addCustom({ diameter: 9, name: 'Demo bit' });
    useCuttingData.getState().save('test', { feed: 999 });
    for (const key of keys) expect(localStorage.getItem(key)).toContain('real:' + key);
    // Reload/restart restores only the original snapshot; simulated setup and completion never survive.
    await prepareRehearsal();
    expect(useCamMachine.getState().jobId).not.toBe(firstId);
    expect(useCamMachine.getState().done).toEqual([]);
    expect(useCuttingData.getState().saved).toEqual(snapshot.cutting);
    await new Promise(resolve => setTimeout(resolve, 700));
    setDemoModeForTest(false);
    expect(await getJob(source.id)).toEqual(saved);
    expect(await getJob(firstId)).toBeNull();
    for (const key of keys) localStorage.removeItem(key);
  });

  it('does not read, overwrite or clear physical machine recovery records', async () => {
    const host = 'same-controller';
    const record = {
      host,
      sdFile: 'job.nc',
      gcode: 'G0 X1',
      toolpathName: 'physical',
      toolpathOffset: { x: 0, y: 0, z: 0 },
      stockHeight: 12,
      toolDiameter: 3.175,
      wco: { x: 0, y: 0, z: 0 },
      startedAt: 1,
      homed: true,
      zZeroedAt: 1,
    };
    const progress = { host, file: 'job.nc', percent: 50, mpos: { x: 0, y: 0, z: 0 }, wco: { x: 0, y: 0, z: 0 }, at: 2 };
    await saveJobRecord(record);
    await saveJobProgress(progress);
    setDemoModeForTest(true);
    expect(await loadJobRecord(host)).toBeNull();
    expect(await loadJobProgress(host)).toBeNull();
    await saveJobRecord({ ...record, toolpathName: 'simulated' });
    await saveJobProgress({ ...progress, percent: 100 });
    await clearJobRecord(host);
    setDemoModeForTest(false);
    expect(await loadJobRecord(host)).toEqual(record);
    expect(await loadJobProgress(host)).toEqual(progress);
  });

  it('refuses rehearsal while a real job is running, held or moving', async () => {
    const source = await createJob(new File(['x'], 'source.stl'));
    for (const state of ['Run', 'Hold', 'Door', 'Jog', 'Home']) {
      context.api = { jobProgress: { value: null }, jobStartedAt: { value: null }, status: { value: { state } } };
      expect(rehearsalBlockedReason()).toContain('real machine');
      await expect(launchRehearsal(source, [])).rejects.toThrow('real machine');
    }
    context.api!.status.value.state = 'Idle';
    context.api!.jobStartedAt.value = 1;
    expect(rehearsalBlockedReason()).toContain('real machine');
    context.api = null;
    expect(rehearsalBlockedReason()).toBeNull();
  });
});
