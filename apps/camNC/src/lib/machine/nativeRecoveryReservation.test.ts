import { signal } from '@preact/signals-react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { isManufacturingLocked, useCamMachine } from '@/cam/machine/camMachine';
import { loadIntoMachineView } from '@/cam/showOnMachine';
import { useStore } from '@/store/store';
import type { CncApi } from '../fluidnc/cnc-api';
import { interruptedJob, recoveryPending, watchJobRecovery } from './jobRecovery';
import type { JobRecord } from './jobRecord';

const h = vi.hoisted(() => ({ api: null as unknown as CncApi, load: vi.fn<() => Promise<JobRecord | null>>(), percent: 40 }));
vi.mock('@/lib/fluidnc/machine', () => ({ getExistingCncApi: () => h.api, getCncApi: () => h.api }));
vi.mock('./jobRecord', async original => ({
  ...(await original<typeof import('./jobRecord')>()),
  loadJobRecord: h.load,
  readJobRecordHead: async (host: string, demo = false) => {
    const stored = await h.load();
    return { host, demo, stored, record: stored, marker: { memory: undefined, stored: null, readable: true } };
  },
  loadJobProgress: async () => ({
    host: 'reload.test',
    file: 'camnc.gcode',
    percent: h.percent,
    at: 2,
    mpos: { x: 0, y: 0, z: 0 },
    wco: { x: 0, y: 0, z: 0 },
  }),
}));
const dispose: (() => void)[] = [];
beforeEach(() => {
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  interruptedJob.value = null;
  recoveryPending.value = false;
  h.percent = 40;
  h.api = {
    host: signal('reload.test'),
    isConnected: signal(true),
    status: signal({ state: 'Idle', wco: { x: 0, y: 0, z: 0 } }),
    jobStartedAt: signal(null),
    jobProgress: signal(null),
    lastAlarm: signal(null),
    homed: signal(false),
    zZeroedAt: signal(null),
  } as unknown as CncApi;
});
afterEach(() => {
  dispose.splice(0).forEach(f => f());
  interruptedJob.value = null;
  recoveryPending.value = false;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});
function record(native: boolean): JobRecord {
  const gcode = 'G21\nG1 X10 F300';
  return {
    host: 'reload.test',
    sdFile: 'camnc.gcode',
    gcode,
    toolpathName: 'Original',
    startedAt: 1,
    toolpathOffset: { x: 0, y: 0, z: 0 },
    stockHeight: 18,
    toolDiameter: 3,
    wco: { x: 0, y: 0, z: 0 },
    homed: true,
    zZeroedAt: 1,
    ...(native && {
      camSnapshot: {
        jobId: 'original',
        sourceKey: 'original:cad:1',
        designRevision: 1,
        active: 'board:bit:0',
        doneId: 'old-program',
        gcode,
        queue: [],
        parts: [],
        instances: [],
        nestBit: 3,
        overlay: { w: 100, h: 80, rotationDeg: 12 },
      },
    }),
  };
}
it('N3 blocks live program replacement throughout a delayed durable recovery check then restores the old native setup', async () => {
  let resolve!: (record: JobRecord) => void;
  h.load.mockReturnValue(
    new Promise(yes => {
      resolve = yes;
    })
  );
  useCamMachine.setState({ jobId: 'original', active: 'board:bit:0' });
  useStore.getState().updateToolpath('G21\nG1 X2 F300', 'Last view');
  dispose.push(watchJobRecovery(h.api));
  expect(recoveryPending.value).toBe(true);
  expect(isManufacturingLocked()).toBe(true);
  useCamMachine.getState().setActive('new-board:bit:0');
  loadIntoMachineView({ gcode: 'G21\nG1 X90 F300', size: [90, 90, 18], bits: [3] }, 'Live queue');
  expect(useStore.getState().toolpath?.gcode).toBe('G21\nG1 X2 F300');
  const saved = record(true);
  resolve(saved);
  await waitFor(() => expect(interruptedJob.value?.record).toEqual(saved));
  expect(useCamMachine.getState().runSnapshot).toEqual(saved.camSnapshot);
  expect(useCamMachine.getState().active).toBe(saved.camSnapshot!.active);
  expect(isManufacturingLocked()).toBe(true);
});
it('N3 does not reserve or replace an unrelated imported interrupted file after the recovery check', async () => {
  const saved = record(false);
  h.load.mockResolvedValue(saved);
  useCamMachine.setState({ jobId: 'unrelated', active: 'new-board:bit:0' });
  dispose.push(watchJobRecovery(h.api));
  await waitFor(() => expect(interruptedJob.value?.record).toEqual(saved));
  await waitFor(() => expect(recoveryPending.value).toBe(false));
  expect(useCamMachine.getState().jobId).toBe('unrelated');
  expect(useCamMachine.getState().runSnapshot).toBeNull();
  expect(isManufacturingLocked()).toBe(false);
});

it('N3 reserves a durable native setup during socket connection, before controller status can let the live queue auto-load', async () => {
  let resolve!: (record: JobRecord) => void;
  h.load.mockReturnValue(
    new Promise(yes => {
      resolve = yes;
    })
  );
  Object.assign(h.api, { isConnected: signal(false) });
  useCamMachine.setState({ jobId: 'original', active: 'board:bit:0' });
  dispose.push(watchJobRecovery(h.api));
  expect(recoveryPending.value).toBe(true);
  expect(isManufacturingLocked()).toBe(true);
  const saved = record(true);
  resolve(saved);
  await waitFor(() => expect(useCamMachine.getState().runSnapshot).toEqual(saved.camSnapshot));
  expect(isManufacturingLocked()).toBe(true);
  useCamMachine.getState().setActive('new-board:bit:0');
  expect(useCamMachine.getState().active).toBe(saved.camSnapshot!.active);
});

it('N3 restores a durably finished receipt as finished review even if its last periodic progress was only40percent', async () => {
  const saved = { ...record(true), execution: 'finished' as const };
  h.load.mockResolvedValue(saved);
  dispose.push(watchJobRecovery(h.api));
  await waitFor(() => expect(recoveryPending.value).toBe(false));
  expect(useCamMachine.getState().runReview).toBe('finished');
  expect(interruptedJob.value).toBeNull();
});

it('N3 a known stopped native run remains resumable even if the whole SD file was already read', async () => {
  const saved = { ...record(true), execution: 'stopped' as const };
  h.load.mockResolvedValue(saved);
  h.percent = 100;
  dispose.push(watchJobRecovery(h.api));
  await waitFor(() => expect(recoveryPending.value).toBe(false));
  expect(interruptedJob.value?.record).toEqual(saved);
  expect(useCamMachine.getState().runReview).toBe('stopped');
});

it('P7 an idle imported execution reference from another host does not suppress this controller recovery offer', async () => {
  const saved = record(false);
  h.load.mockResolvedValue(saved);
  useCamMachine.setState({ runRecord: { host: 'earlier-imported-controller.test', startedAt: 1, executionId: 'imported-a' } });
  dispose.push(watchJobRecovery(h.api));
  await waitFor(() => expect(recoveryPending.value).toBe(false));
  await waitFor(() => expect(interruptedJob.value?.record).toEqual(saved));
  expect(useCamMachine.getState().runRecord).toBeNull();
});
