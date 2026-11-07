import { signal } from '@preact/signals-react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCamMachine } from '@/cam/machine/camMachine';
import { setDemoModeForTest } from '../demo/demo-mode';
import type { CncApi } from '../fluidnc/cnc-api';
import { cleanupRetiredExecutionFiles, retireExecutionFiles } from './executionFiles';
import { clearJobRecord, saveJobRecord, type JobRecord } from './jobRecord';

const h = vi.hoisted(() => ({ api: null as unknown as CncApi }));
vi.mock('../fluidnc/machine', () => ({ getExistingCncApi: () => h.api, getCncApi: () => h.api }));
let host: string;
const file = () => `camnc-${crypto.randomUUID()}.gcode`;
function record(sdFile: string): JobRecord {
  return {
    host,
    sdFile,
    executionId: crypto.randomUUID(),
    startedAt: 1,
    gcode: 'G21\nM30',
    toolpathName: null,
    toolpathOffset: { x: 0, y: 0, z: 0 },
    stockHeight: 18,
    toolDiameter: 3,
    wco: { x: 0, y: 0, z: 0 },
    homed: true,
    zZeroedAt: 1,
  };
}
beforeEach(() => {
  setDemoModeForTest(false);
  host = `execution-files-${crypto.randomUUID()}.test`;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  h.api = {
    host: signal(host),
    isConnected: signal(true),
    status: signal({ state: 'Idle', wco: { x: 0, y: 0, z: 0 } }),
    jobProgress: signal(null),
    jobStartedAt: signal(null),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as CncApi;
});
afterEach(async () => {
  await clearJobRecord(host, false);
  await clearJobRecord(host, true);
  setDemoModeForTest(false);
  for (const key of Object.keys(localStorage)) if (key.includes(encodeURIComponent(host))) localStorage.removeItem(key);
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});

it('deletes only explicitly retired UUID files, preserving current receipt and every user/legacy name', async () => {
  const old = file(),
    current = file();
  await saveJobRecord(record(current));
  retireExecutionFiles(host, [old, current, 'my-part.gcode', 'camnc.gcode', 'camnc-resume.gcode', '../' + file(), 'folder/' + file()]);
  expect(await cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [old], pending: 1 });
  expect(h.api.deleteFile).toHaveBeenCalledExactlyOnceWith(old);
});

it('preserves both a raw preparation and its prior resumable file', async () => {
  const prior = record(file()),
    prepared = { ...record(file()), execution: 'prepared' as const, previousRecord: prior };
  await saveJobRecord(prepared);
  retireExecutionFiles(host, [prior.sdFile, prepared.sdFile]);
  expect((await cleanupRetiredExecutionFiles(h.api)).removed).toEqual([]);
  expect(h.api.deleteFile).not.toHaveBeenCalled();
  await clearJobRecord(host);
  expect((await cleanupRetiredExecutionFiles(h.api)).removed.sort()).toEqual([prior.sdFile, prepared.sdFile].sort());
});

it.each(['Run', 'Hold', 'Alarm', 'Jog'])('never deletes while the controller is %s', async state => {
  retireExecutionFiles(host, [file()]);
  h.api.status.value = { ...h.api.status.value!, state };
  expect((await cleanupRetiredExecutionFiles(h.api)).removed).toEqual([]);
  expect(h.api.deleteFile).not.toHaveBeenCalled();
});

it('retains pending cleanup across module reload, then removes the marker after successful deletion', async () => {
  const old = file();
  retireExecutionFiles(host, [old]);
  vi.resetModules();
  const reloaded = await import('./executionFiles');
  expect((await reloaded.cleanupRetiredExecutionFiles(h.api)).removed).toEqual([old]);
  expect((await reloaded.cleanupRetiredExecutionFiles(h.api)).pending).toBe(0);
});

it('stops before the next delete if another program starts or preparation takes ownership', async () => {
  const first = file(),
    second = file();
  retireExecutionFiles(host, [first, second]);
  vi.mocked(h.api.deleteFile).mockImplementation(async () => {
    useCamMachine.setState({ preparingRun: true });
    return [];
  });
  const result = await cleanupRetiredExecutionFiles(h.api);
  expect(result.removed).toHaveLength(1);
  expect([first, second]).toContain(result.removed[0]);
  expect(h.api.deleteFile).toHaveBeenCalledWith(result.removed[0]);
  expect(result.pending).toBe(1);
  expect(h.api.deleteFile).toHaveBeenCalledTimes(1);
});

it('retains failed deletes for retry and keeps demo retirement separate', async () => {
  let now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const normal = file(),
    demo = file();
  try {
    retireExecutionFiles(host, [normal], false);
    retireExecutionFiles(host, [demo], true);
    vi.mocked(h.api.deleteFile).mockRejectedValueOnce(new Error('SD unavailable'));
    await expect(cleanupRetiredExecutionFiles(h.api)).rejects.toThrow('SD unavailable');
    now += 1000;
    expect((await cleanupRetiredExecutionFiles(h.api)).removed).toEqual([normal]);
    setDemoModeForTest(true);
    expect((await cleanupRetiredExecutionFiles(h.api)).removed).toEqual([demo]);
  } finally {
    clock.mockRestore();
  }
});

it('persists retry timing through module reload and caps exponential failure delays at one minute', async () => {
  let now = 2_000_000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const old = file();
  vi.mocked(h.api.deleteFile).mockRejectedValue(new Error('SD unavailable'));
  try {
    retireExecutionFiles(host, [old]);
    await expect(cleanupRetiredExecutionFiles(h.api)).rejects.toThrow('SD unavailable');
    vi.resetModules();
    const reloaded = await import('./executionFiles');
    expect(await reloaded.cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [], pending: 1 });
    expect(h.api.deleteFile).toHaveBeenCalledTimes(1);
    for (const delay of [1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000]) {
      now += delay - 1;
      const calls = vi.mocked(h.api.deleteFile).mock.calls.length;
      expect((await reloaded.cleanupRetiredExecutionFiles(h.api)).removed).toEqual([]);
      expect(h.api.deleteFile).toHaveBeenCalledTimes(calls);
      now++;
      await expect(reloaded.cleanupRetiredExecutionFiles(h.api)).rejects.toThrow('SD unavailable');
      expect(h.api.deleteFile).toHaveBeenCalledTimes(calls + 1);
    }
  } finally {
    clock.mockRestore();
  }
});

it('rechecks the receipt after listing a pending upload and preserves a file that became current', async () => {
  const pending = file();
  retireExecutionFiles(host, [pending], false, { pendingUpload: true });
  h.api.listFiles = vi.fn(async () => {
    await saveJobRecord(record(pending));
    return { path: '/', files: [{ name: pending, size: 100, isDirectory: false }] };
  });
  expect(await cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [], pending: 1 });
  expect(h.api.deleteFile).not.toHaveBeenCalled();
});

it('does not delete a pending upload if a different API takes ownership during its listing', async () => {
  const pending = file();
  const originalApi = h.api;
  retireExecutionFiles(host, [pending], false, { pendingUpload: true });
  originalApi.listFiles = vi.fn(async () => {
    h.api = { ...originalApi } as CncApi;
    return { path: '/', files: [{ name: pending, size: 100, isDirectory: false }] };
  });
  expect(await cleanupRetiredExecutionFiles(originalApi)).toEqual({ removed: [], pending: 1 });
  expect(originalApi.deleteFile).not.toHaveBeenCalled();
});

it('keeps an absent pending upload across module reload without downgrading it through ordinary retirement', async () => {
  let now = 3_000_000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const pending = file();
  let arrived = false;
  h.api.listFiles = vi.fn(async () => ({ path: '/', files: arrived ? [{ name: pending, size: 100, isDirectory: false }] : [] }));
  try {
    retireExecutionFiles(host, [pending], false, { pendingUpload: true });
    expect(await cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [], pending: 1 });
    expect(h.api.deleteFile).not.toHaveBeenCalled();
    vi.resetModules();
    const reloaded = await import('./executionFiles');
    reloaded.retireExecutionFiles(host, [pending]);
    arrived = true;
    expect(await reloaded.cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [], pending: 1 });
    expect(h.api.deleteFile).not.toHaveBeenCalled();
    now += 30_000;
    expect(await reloaded.cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [pending], pending: 0 });
  } finally {
    clock.mockRestore();
  }
});

it('backs off failed cleanup across frequent idle updates without delaying another retired file', async () => {
  let now = 1_000_000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const failing = file(),
    ordinary = file();
  vi.mocked(h.api.deleteFile).mockImplementation(async name => {
    if (name === failing) throw new Error('SD unavailable');
    return [];
  });
  h.api.listFiles = vi.fn().mockResolvedValue({ path: '/', files: [{ name: failing, size: 100, isDirectory: false }] });
  try {
    retireExecutionFiles(host, [failing]);
    await expect(cleanupRetiredExecutionFiles(h.api)).rejects.toThrow('SD unavailable');
    for (let update = 0; update < 20; update++) {
      now += 10;
      h.api.status.value = { ...h.api.status.value!, state: 'Idle' };
      expect(await cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [], pending: 1 });
    }
    expect(h.api.deleteFile).toHaveBeenCalledTimes(1);
    retireExecutionFiles(host, [ordinary]);
    expect(await cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [ordinary], pending: 1 });
    expect(h.api.deleteFile).toHaveBeenCalledTimes(2);
    now += 60_000;
    await expect(cleanupRetiredExecutionFiles(h.api)).rejects.toThrow('SD unavailable');
    expect(vi.mocked(h.api.deleteFile).mock.calls.filter(([name]) => name === failing)).toHaveLength(2);
  } finally {
    clock.mockRestore();
  }
});

it('expires an absent pending upload after one hour without another SD request, even after reload and repeated retirement', async () => {
  let now = 10_000_000;
  const firstRetirement = now;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const pending = file();
  h.api.listFiles = vi.fn().mockResolvedValue({ path: '/', files: [] });
  try {
    retireExecutionFiles(host, [pending], false, { pendingUpload: true });
    expect(await cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [], pending: 1 });
    now += 60 * 60_000 - 1;
    vi.resetModules();
    const reloaded = await import('./executionFiles');
    reloaded.retireExecutionFiles(host, [pending], false, { pendingUpload: true });
    expect(await reloaded.cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [], pending: 1 });
    expect(h.api.listFiles).toHaveBeenCalledTimes(2);
    now = firstRetirement + 60 * 60_000;
    expect(await reloaded.cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [], pending: 0 });
    now += 24 * 60 * 60_000;
    expect(await reloaded.cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [], pending: 0 });
    expect(h.api.listFiles).toHaveBeenCalledTimes(2);
    expect(h.api.deleteFile).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});

it('cleans a late arrival inside the retention window but leaves one arriving at expiry untouched', async () => {
  let now = 20_000_000;
  const firstRetirement = now;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const inTime = file(),
    expired = file();
  let arrived = false;
  h.api.listFiles = vi.fn(async () => ({
    path: '/',
    files: arrived ? [inTime, expired].map(name => ({ name, size: 100, isDirectory: false })) : [],
  }));
  try {
    retireExecutionFiles(host, [inTime, expired], false, { pendingUpload: true });
    expect(await cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [], pending: 2 });
    arrived = true;
    now = firstRetirement + 60 * 60_000 - 1;
    await saveJobRecord(record(expired));
    expect(await cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [inTime], pending: 1 });
    await clearJobRecord(host);
    now++;
    expect(await cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [], pending: 0 });
    expect(h.api.listFiles).toHaveBeenCalledTimes(2);
    expect(h.api.deleteFile).toHaveBeenCalledExactlyOnceWith(inTime);
  } finally {
    clock.mockRestore();
  }
});

it('does not delete when pending-upload ownership expires while its SD listing is in flight', async () => {
  let now = 30_000_000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const pending = file();
  h.api.listFiles = vi.fn(async () => {
    now += 60 * 60_000;
    return { path: '/', files: [{ name: pending, size: 100, isDirectory: false }] };
  });
  try {
    retireExecutionFiles(host, [pending], false, { pendingUpload: true });
    expect(await cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [], pending: 0 });
    expect(h.api.deleteFile).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});

it('gives an existing undated pending marker one persisted window without expiring verified retirements', async () => {
  let now = 40_000_000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const pending = file(),
    verified = file();
  const key = `camnc-retired-execution:normal:${encodeURIComponent(host)}:${pending}`;
  h.api.listFiles = vi.fn().mockResolvedValue({ path: '/', files: [] });
  try {
    localStorage.setItem(key, JSON.stringify({ pendingUpload: true, failures: 0, retryAt: 0 }));
    retireExecutionFiles(host, [verified]);
    expect(await cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [verified], pending: 1 });
    now += 59 * 60_000;
    vi.resetModules();
    const reloaded = await import('./executionFiles');
    expect(await reloaded.cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [], pending: 1 });
    now += 60_000;
    expect(await reloaded.cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [], pending: 0 });
    expect(h.api.listFiles).toHaveBeenCalledTimes(2);
    expect(h.api.deleteFile).toHaveBeenCalledExactlyOnceWith(verified);
  } finally {
    clock.mockRestore();
  }
});

it('expires only pending ownership while preserving current and prior receipts and cleaning an old verified retirement', async () => {
  let now = 50_000_000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const prior = record(file()),
    prepared = { ...record(file()), execution: 'prepared' as const, previousRecord: prior },
    verified = file();
  h.api.listFiles = vi.fn().mockResolvedValue({ path: '/', files: [] });
  try {
    await saveJobRecord(prepared);
    retireExecutionFiles(host, [prior.sdFile, prepared.sdFile], false, { pendingUpload: true });
    retireExecutionFiles(host, [verified]);
    now += 24 * 60 * 60_000;
    expect(await cleanupRetiredExecutionFiles(h.api)).toEqual({ removed: [verified], pending: 0 });
    expect(h.api.listFiles).not.toHaveBeenCalled();
    expect(h.api.deleteFile).toHaveBeenCalledExactlyOnceWith(verified);
  } finally {
    clock.mockRestore();
  }
});
