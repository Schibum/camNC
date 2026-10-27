import { FakeFluidnc } from '@wbcnc/fluidnc/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { CncApi } from '../fluidnc/cnc-api';
import { clearJobRecord, loadJobProgress, loadJobRecord, saveJobRecord } from './jobRecord';
import { interruptedJob, noteJobStopRequested, watchJobRecovery } from './jobRecovery';

const until = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

const cleanups: (() => void)[] = [];
afterEach(async () => {
  cleanups.splice(0).forEach(fn => fn());
  interruptedJob.value = null;
  await clearJobRecord('192.168.1.20');
});

/** Connected to a fake controller running camnc.gcode at 40 %, with the job recorded like uploadAndRun does. */
async function runningJob() {
  const fake = new FakeFluidnc('v3-81');
  fake.wco = { x: 100, y: 50, z: -20 };
  const api = new CncApi(fake.WebSocket);
  api.connect(fake.host);
  cleanups.push(watchJobRecovery(api), () => api.disconnect());
  await until(() => api.connection.value === 'connected');
  await saveJobRecord({
    host: fake.host,
    sdFile: 'camnc.gcode',
    gcode: 'G21 G90\nG0 X0 Y0 Z5\nG1 Z-1 F300\nG1 X20 F1200\nG1 Y10\nG1 X0\nM30\n',
    toolpathName: 'test.nc',
    toolpathOffset: { x: 100, y: 50, z: 0 },
    stockHeight: 10,
    toolDiameter: 3,
    wco: fake.wco,
    startedAt: Date.now() - 1000,
    homed: true,
    zZeroedAt: null,
  });
  fake.state = 'Run';
  fake.job = { file: '/sd/camnc.gcode', percent: 40 };
  fake.mpos = { x: 120, y: 55, z: -21 };
  fake.pushStatus();
  await until(async () => (await loadJobProgress(fake.host))?.percent === 40);
  return { fake, api };
}

describe('watchJobRecovery', () => {
  it('saves where the job is while it runs', async () => {
    const { fake } = await runningJob();
    expect(await loadJobProgress(fake.host)).toMatchObject({ file: '/sd/camnc.gcode', percent: 40, mpos: { x: 120, y: 55, z: -21 } });
  });

  it('offers to resume after the controller rebooted during the job', async () => {
    const { fake, api } = await runningJob();
    // Power cycle: the connection drops, and the controller comes back without the job and needing homing.
    fake.kill();
    fake.job = null;
    fake.state = 'Alarm';
    await until(() => api.connection.value !== 'connected');
    fake.pushStatus();
    await until(() => interruptedJob.value !== null, 10_000);
    expect(interruptedJob.value!.progress.percent).toBe(40);
    expect(interruptedJob.value!.reason).toContain('40.0%');
    expect(interruptedJob.value!.record.toolpathName).toBe('test.nc');
  }, 15_000);

  it('offers to resume after Stop, and forgets a job that finished', async () => {
    const { fake } = await runningJob();
    noteJobStopRequested();
    fake.job = null;
    fake.state = 'Idle';
    fake.pushStatus();
    await until(() => interruptedJob.value !== null);
    expect(interruptedJob.value!.reason).toBe('You stopped the job at 40.0%.');

    // A new run that reads the whole file and goes idle.
    fake.state = 'Run';
    fake.job = { file: '/sd/camnc.gcode', percent: 99 };
    fake.pushStatus();
    await until(() => interruptedJob.value === null);
    fake.progressJob(100);
    await until(async () => (await loadJobRecord(fake.host)) === null);
  });
});
