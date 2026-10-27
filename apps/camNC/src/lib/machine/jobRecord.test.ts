import type { MachineStatus } from '@wbcnc/fluidnc';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearJobRecord,
  JobProgressLog,
  jobEnding,
  JobRecord,
  loadJobProgress,
  loadJobRecord,
  recoveryAction,
  saveJobProgress,
  saveJobRecord,
} from './jobRecord';

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

  it('offers to resume a job that is gone part way through, e.g. after a power cycle', () => {
    const progress: JobProgressLog = {
      host: record.host,
      file: '/sd/camnc.gcode',
      percent: 43.2,
      mpos: record.wco,
      wco: record.wco,
      at: 3000,
    };
    const idle = status('Idle', undefined);
    expect(recoveryAction({ record, status: idle, currentGcode: null, lastAlarm: null, progress })).toEqual({
      kind: 'interrupted',
      progress,
    });
    expect(recoveryAction({ record, status: status('Alarm', undefined), currentGcode: null, lastAlarm: null, progress }).kind).toBe(
      'interrupted'
    );
    // Near the end, from another file, or from an earlier job: nothing to resume.
    for (const p of [
      { ...progress, percent: 100 },
      { ...progress, file: '/sd/other.nc' },
      { ...progress, at: 500 },
    ]) {
      expect(recoveryAction({ record, status: idle, currentGcode: null, lastAlarm: null, progress: p }).kind).toBe('ended');
    }
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

describe('jobEnding', () => {
  it('counts a job that went idle by itself as finished', () => {
    expect(jobEnding({ state: 'Idle', lastPercent: 99.2, stopRequested: false, alarmSinceStart: false })).toEqual({ finished: true });
  });

  it('keeps a stopped or alarmed job resumable', () => {
    expect(jobEnding({ state: 'Idle', lastPercent: 40, stopRequested: true, alarmSinceStart: false })).toMatchObject({
      finished: false,
      reason: 'You stopped the job at 40.0%.',
    });
    expect(jobEnding({ state: 'Alarm', lastPercent: 40, stopRequested: false, alarmSinceStart: false }).finished).toBe(false);
    expect(jobEnding({ state: 'Idle', lastPercent: 100, stopRequested: false, alarmSinceStart: true }).finished).toBe(false);
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

  it('keeps the progress apart and forgets it with the record', async () => {
    const progress: JobProgressLog = {
      host: record.host,
      file: '/sd/camnc.gcode',
      percent: 12,
      mpos: record.wco,
      wco: record.wco,
      at: 2000,
    };
    await saveJobRecord(record);
    await saveJobProgress(progress);
    expect(await loadJobProgress(record.host)).toEqual(progress);
    await clearJobRecord(record.host);
    expect(await loadJobProgress(record.host)).toBeNull();
  });
});
