import { signal } from '@preact/signals-react';
import { expect, it, vi } from 'vitest';
import type { CncApi } from '../fluidnc/cnc-api';
import type { JobRecord } from './jobRecord';
it('P6 a fresh page does not claim unknown SD files or give them the loaded program title; only verified running recovery proves identity', async () => {
  vi.resetModules();
  const { isJobOfToolpath, runningJobTitle } = await import('./jobs');
  const { applyRecord } = await import('./jobRecovery');
  const sdFile = 'camnc-11111111-1111-1111-1111-111111111111.gcode';
  const gcode = 'G21\nM0 (MSG Take out A)\nG1 X10 F300';
  expect(isJobOfToolpath(`/sd/${sdFile}`, 'G21\nG1 X99 F300')).toBe(false);
  expect(runningJobTitle(`/sd/${sdFile}`, 'Different loaded program')).toBe(sdFile.replace('.gcode', ''));
  const record: JobRecord = {
    host: 'reload.test',
    sdFile,
    gcode,
    toolpathName: 'Recovered A',
    startedAt: 1,
    toolpathOffset: { x: 0, y: 0, z: 0 },
    stockHeight: 18,
    toolDiameter: 3,
    wco: { x: 0, y: 0, z: 0 },
    homed: true,
    zZeroedAt: 1,
  };
  const api = { jobStartedAt: signal(null), homed: signal(false), zZeroedAt: signal(null) } as unknown as CncApi;
  applyRecord(api, record, { machineState: false });
  expect(isJobOfToolpath(`/sd/${sdFile}`, gcode)).toBe(false);
  applyRecord(api, record, { machineState: true });
  expect(isJobOfToolpath(`/sd/${sdFile}`, gcode)).toBe(true);
  expect(isJobOfToolpath(`/sd/${sdFile}`, 'G21\nG1 X99 F300')).toBe(false);
  expect(isJobOfToolpath('/sd/camnc-22222222-2222-2222-2222-222222222222.gcode', gcode)).toBe(false);
  expect(runningJobTitle(`/sd/${sdFile}`, 'Recovered A')).toBe('Recovered A');
});
