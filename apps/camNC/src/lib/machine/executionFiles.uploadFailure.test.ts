import { signal } from '@preact/signals-react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCamMachine } from '@/cam/machine/camMachine';
import { useStore } from '@/store/store';
import { setDemoModeForTest } from '../demo/demo-mode';
import type { CncApi } from '../fluidnc/cnc-api';
import { cleanupRetiredExecutionFiles } from './executionFiles';
import { interruptedJob, recoveryPending } from './jobRecovery';
import { clearJobRecord, loadJobRecord, saveJobRecord, type JobRecord } from './jobRecord';
import { runResume, uploadAndRun } from './jobs';

const h = vi.hoisted(() => ({ api: null as unknown as CncApi, files: new Map<string, string>() }));
vi.mock('../fluidnc/machine', () => ({ getCncApi: () => h.api, getExistingCncApi: () => h.api }));
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: Object.assign(vi.fn(), { promise: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
let host: string;
const gcode = 'G21 G90\nG0 Z5\nG1 X80 F300\nM30\n';

beforeEach(() => {
  host = `late-execution-upload-${crypto.randomUUID()}.test`;
  h.files.clear();
  setDemoModeForTest(false);
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
  interruptedJob.value = null;
  recoveryPending.value = false;
  h.api = {
    getCurrentZero: async () => structuredClone(h.api.status.value!.wco),
    host: signal(host),
    isConnected: signal(true),
    state: signal('Idle'),
    status: signal({ state: 'Idle', mpos: { x: 0, y: 0, z: 10 }, wco: { x: 0, y: 0, z: 0 } }),
    jobStartedAt: signal(null),
    jobProgress: signal(null),
    travel: signal(null),
    homed: signal(true),
    zZeroedAt: signal(1),
    uploadGcode: vi.fn().mockRejectedValue(new Error('Upload acknowledgement timed out')),
    runFile: vi.fn().mockResolvedValue(undefined),
    listFiles: vi.fn(async () => ({ path: '/', files: [...h.files.keys()].map(name => ({ name, size: 100, isDirectory: false })) })),
    deleteFile: vi.fn(async (name: string) => {
      if (!h.files.delete(name)) throw new Error('No such SD file');
      return [];
    }),
  } as unknown as CncApi;
  useStore.getState().updateToolpath(gcode, 'Unconfirmed upload');
});
afterEach(async () => {
  await clearJobRecord(host);
  vi.restoreAllMocks();
  for (const key of Object.keys(localStorage)) if (key.includes(encodeURIComponent(host))) localStorage.removeItem(key);
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  interruptedJob.value = null;
  recoveryPending.value = false;
  setDemoModeForTest(false);
});

it.each(['start', 'resume'] as const)(
  'keeps %s upload retirement when initially absent and deletes only its later-arriving UUID',
  async kind => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const priorFile = `camnc-${crypto.randomUUID()}.gcode`;
    const userFile = 'cabinet-user.gcode';
    h.files.set(priorFile, 'prior bytes');
    h.files.set(userFile, 'user bytes');
    const prior: JobRecord = {
      host,
      executionId: crypto.randomUUID(),
      sdFile: priorFile,
      gcode,
      startedAt: now - 10_000,
      execution: 'stopped',
      toolpathName: 'Original job',
      toolpathOffset: { x: 0, y: 0, z: 0 },
      stockHeight: 18,
      toolDiameter: 3,
      wco: { x: 0, y: 0, z: 0 },
      homed: true,
      zZeroedAt: 1,
    };
    await saveJobRecord(prior);
    const operation =
      kind === 'start'
        ? uploadAndRun()
        : runResume(
            {
              record: prior,
              reason: 'Interrupted original',
              progress: {
                host,
                executionId: prior.executionId,
                file: `/sd/${priorFile}`,
                percent: 20,
                at: now - 1000,
                mpos: { x: 10, y: 0, z: 5 },
                wco: prior.wco,
              },
            },
            2
          );
    await expect(operation).rejects.toThrow('Upload acknowledgement timed out');
    expect(h.api.runFile).not.toHaveBeenCalled();
    const upload = vi.mocked(h.api.uploadGcode).mock.calls[0]!;
    const abandoned = upload[1];
    expect(abandoned).toMatch(kind === 'start' ? /^camnc-[0-9a-f-]{36}\.gcode$/ : /^camnc-resume-[0-9a-f-]{36}\.gcode$/);
    expect((await cleanupRetiredExecutionFiles(h.api)).pending).toBe(1);
    expect(await loadJobRecord(host)).toEqual(prior);
    h.files.set(abandoned, upload[0]);
    now += 60_000;
    expect(await cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [abandoned], pending: 0 });
    expect(new Set(h.files.keys())).toEqual(new Set([priorFile, userFile]));
    expect(await loadJobRecord(host)).toEqual(prior);
  }
);
