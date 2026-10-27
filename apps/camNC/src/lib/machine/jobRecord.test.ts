import type { MachineStatus } from '@wbcnc/fluidnc';
import { afterEach, describe, expect, it } from 'vitest';
import { clearJobRecord, JobRecord, loadJobRecord, recoveryAction, saveJobRecord } from './jobRecord';

const record: JobRecord = {
  host: '192.168.1.20',
  sdFile: 'camnc.gcode',
  gcode: 'G21\nG1 X10\n',
  toolpathName: 'winkel v6.nc',
  toolpathOffset: { x: 307.28, y: 92.783, z: 0 },
  stockHeight: 18,
  toolDiameter: 6,
  wco: { x: 307.28, y: 92.783, z: -22.1 },
  startedAt: 1000,
  homed: true,
  zZeroedAt: 900,
};

const status = (state: string, job: MachineStatus['job'], wco = record.wco) =>
  ({ state, job, wco, mpos: { x: 0, y: 0, z: 0 }, wpos: { x: 0, y: 0, z: 0 } }) as MachineStatus;
const running = { file: '/sd/camnc.gcode', percent: 16.9 };

describe('recoveryAction', () => {
  it('restores a job still running or on hold after a reload', () => {
    expect(recoveryAction({ record, status: status('Run', running), currentGcode: null, lastAlarm: null })).toEqual({ kind: 'restore' });
    expect(recoveryAction({ record, status: status('Hold', running), currentGcode: record.gcode, lastAlarm: null })).toEqual({
      kind: 'restore',
    });
  });

  it('asks before replacing a different toolpath loaded since', () => {
    expect(recoveryAction({ record, status: status('Run', running), currentGcode: 'G0 X1', lastAlarm: null })).toEqual({ kind: 'ask' });
  });

  it('reports a job that finished or stopped while away', () => {
    expect(recoveryAction({ record, status: status('Idle', undefined), currentGcode: null, lastAlarm: null })).toEqual({ kind: 'ended' });
  });

  it('does not restore when the work offset, the file or the alarm history do not match', () => {
    const moved = { ...record.wco, z: -20 };
    expect(recoveryAction({ record, status: status('Run', running, moved), currentGcode: null, lastAlarm: null }).kind).toBe('mismatch');
    const other = { file: '/sd/other.nc', percent: 3 };
    expect(recoveryAction({ record, status: status('Run', other), currentGcode: null, lastAlarm: null }).kind).toBe('mismatch');
    const alarm = { code: 2, at: 2000, messages: [], mpos: null, job: null };
    expect(recoveryAction({ record, status: status('Run', running), currentGcode: null, lastAlarm: alarm }).kind).toBe('mismatch');
    expect(recoveryAction({ record: null, status: status('Run', running), currentGcode: null, lastAlarm: null })).toEqual({ kind: 'none' });
  });
});

describe('job record storage', () => {
  afterEach(() => clearJobRecord(record.host));

  it('keeps the last job per host in IndexedDB', async () => {
    expect(await loadJobRecord(record.host)).toBeNull();
    await saveJobRecord(record);
    expect(await loadJobRecord(record.host)).toEqual(record);
    await saveJobRecord({ ...record, startedAt: 5000 });
    expect((await loadJobRecord(record.host))?.startedAt).toBe(5000);
  });
});
