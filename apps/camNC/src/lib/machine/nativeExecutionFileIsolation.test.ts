import { waitFor } from '@testing-library/react';
import { FakeFluidnc } from '@wbcnc/fluidnc/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { useCamMachine } from '@/cam/machine/camMachine';
import { useStore } from '@/store/store';
import { CncApi } from '../fluidnc/cnc-api';
import { clearJobRecord, loadJobRecord, readJobRecordHead, saveJobRecord, saveJobRecordAtHead, type JobRecord } from './jobRecord';
import { interruptedJob, recoveryPending } from './jobRecovery';
import { kJobFileName, uploadAndRun } from './jobs';

const h = vi.hoisted(() => ({ api: null as unknown as CncApi, history: vi.fn<() => Promise<void>>() }));
vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.api, getExistingCncApi: () => h.api }));
// Isolate controller/receipt races from the separately real-IDB-tested physical claim kernel.
vi.mock('@/cam/machine/nativeRunPreparation', async () => ({
  NativePreparationFailure: class extends Error {},
  prepareNativeRun: async (snapshot: import('@/cam/machine/manufacturingSnapshot').ManufacturingSnapshot, executionId: string) => {
    await (await import('@/cam/machine/nativeRunHistory')).recordNativeRun(snapshot);
    return { executionId };
  },
  rollbackNativePreparation: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/cam/machine/nativeRunHistory', () => ({
  recordNativeRun: h.history,
}));
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: { promise: vi.fn(), error: vi.fn() } }));

const host = 'sd-file-isolation.test';
const apis: CncApi[] = [];
afterEach(async () => {
  apis.splice(0).forEach(api => api.disconnect());
  await clearJobRecord(host);
  interruptedJob.value = null;
  recoveryPending.value = false;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
});

it('dispatches the winning receipt’s bytes even if a losing independent tab finishes a stale upload before dispatch', async () => {
  const fake = new FakeFluidnc('v3-81');
  fake.host = host;
  // Two actual clients and shared SD storage represent separate browser tabs; neither creates hardware transports.
  const winner = new CncApi(fake.WebSocket, fake.fetch, true);
  const staleTab = new CncApi(fake.WebSocket, fake.fetch, true);
  apis.push(winner, staleTab);
  h.api = winner;
  winner.connect(host);
  staleTab.connect(host);
  await waitFor(() => {
    expect(winner.connection.value).toBe('connected');
    expect(staleTab.connection.value).toBe('connected');
    expect(winner.status.value).not.toBeNull();
  });
  await clearJobRecord(host);
  const previous: JobRecord = {
    host,
    executionId: 'previous',
    startedAt: 1,
    sdFile: kJobFileName,
    gcode: 'G21\nG1 X1 F300\nM30',
    toolpathName: 'Previous',
    toolpathOffset: { x: 0, y: 0, z: 0 },
    stockHeight: 18,
    toolDiameter: 3,
    wco: { x: 0, y: 0, z: 0 },
    homed: true,
    zZeroedAt: 1,
  };
  await saveJobRecord(previous);
  // B captures the old durable head before either tab uploads. Its eventual CAS must lose to A.
  const staleHead = await readJobRecordHead(host);
  const programA = 'G21 G90\nG0 Z5\nG1 X11 F300\nM30\n';
  const programB = 'G21 G90\nG0 Z5\nG1 X99 F300\nM30\n';
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
  useStore.getState().updateToolpath(programA, 'Winner A');
  useCamMachine.setState({
    jobId: 'native-winner',
    active: 'board:bit:0',
    loadedSnapshot: {
      jobId: 'native-winner',
      sourceKey: 'native-winner:cad:1',
      designRevision: 1,
      active: 'board:bit:0',
      doneId: 'winner-program',
      gcode: programA,
      queue: [],
      parts: [],
      instances: [],
      nestBit: 3,
      overlay: null,
    },
  });
  let lostReceipt = false;
  h.history.mockImplementation(async () => {
    // A has already uploaded+verified and reserved the receipt. B's slower legacy upload now lands.
    await staleTab.uploadGcode(programB, kJobFileName);
    lostReceipt = !(await saveJobRecordAtHead(staleHead, {
      ...previous,
      executionId: 'losing-B',
      startedAt: Date.now(),
      gcode: programB,
      toolpathName: 'Loser B',
      execution: 'requested',
    }));
  });
  await uploadAndRun();
  expect(lostReceipt).toBe(true);
  const receipt = (await loadJobRecord(host))!;
  expect(receipt.gcode).toBe(programA);
  expect(fake.job).not.toBeNull();
  const runningFile = fake.job!.file.replace(/^\/sd\//, '');
  expect(new TextDecoder().decode(fake.files.get(runningFile))).toBe(receipt.gcode);
});
