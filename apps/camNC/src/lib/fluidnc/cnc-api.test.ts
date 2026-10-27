import { Realtime } from '@wbcnc/fluidnc';
import { FakeFluidnc } from '@wbcnc/fluidnc/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { CncApi, overrideSteps } from './cnc-api';

const until = async (predicate: () => boolean, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

const apis: CncApi[] = [];
afterEach(() => apis.splice(0).forEach(api => api.disconnect()));

async function connected(fake: FakeFluidnc) {
  const api = new CncApi(fake.WebSocket);
  apis.push(api);
  api.connect(fake.host);
  await until(() => api.connection.value === 'connected');
  return api;
}

describe('CncApi', () => {
  it('exposes firmware, status and work zero as signals', async () => {
    const fake = new FakeFluidnc('v3-81');
    fake.wco = { x: 100, y: 200, z: -10 };
    const api = await connected(fake);
    expect(api.firmware.value?.version).toBe('3.9.9');
    expect(api.variant.value).toBe('v3-81');
    fake.pushStatus();
    await until(() => api.status.value !== null);
    expect(api.state.value).toBe('Idle');
    expect(api.machinePos.value).toEqual({ x: 3, y: 3, z: 3, extra: undefined });
    expect(api.canJog.value).toBe(true);
  });

  it('jogs, zeroes and probes with the expected commands', async () => {
    const fake = new FakeFluidnc('v4');
    const api = await connected(fake);
    await api.jogRelative({ x: 10, z: -1 }, 3000);
    await api.jogToMachineCoordinates(50, 60);
    await api.zeroAxes(['z']);
    await api.probeZ({ plateThickness: 0.5, maxTravel: 50, feed: 100 });
    expect(fake.received).toEqual(
      expect.arrayContaining([
        '$J=G91 G21 X10.000 Z-1.000 F3000',
        '$J=G53 G21 X50.000 Y60.000 F3000',
        'G10 L20 P0 Z0',
        'G38.2 Z-50 F100',
        'G10 L20 P0 Z0.5',
      ])
    );
    expect(fake.received.at(-1)).toBe('G90');
  });

  it('jogs to a clicked point at the XY max rate', async () => {
    const fake = new FakeFluidnc('v4');
    fake.respond = line =>
      line === '$/axes/x/max_rate_mm_per_min'
        ? ['$/axes/x/max_rate_mm_per_min=9000.000', 'ok']
        : line === '$/axes/y/max_rate_mm_per_min'
          ? ['$/axes/y/max_rate_mm_per_min=8000.000', 'ok']
          : undefined;
    const api = await connected(fake);
    await api.jogToMachineCoordinates(50, 60);
    await api.jogToMachineCoordinates(70, 80);
    expect(fake.received.filter(l => l.startsWith('$J='))).toEqual([
      '$J=G53 G21 X50.000 Y60.000 F8000',
      '$J=G53 G21 X70.000 Y80.000 F8000',
    ]);
    expect(fake.received.filter(l => l.includes('max_rate'))).toHaveLength(2);
  });

  it('reports alarms and rejects queued commands', async () => {
    const fake = new FakeFluidnc('v4');
    const api = await connected(fake);
    fake.probeContactZ = null;
    await expect(api.probeZ({ plateThickness: 0, maxTravel: 10, feed: 50 })).rejects.toThrow('ALARM:5');
    expect(api.alarm.value?.message).toContain('did not make contact');
    expect(api.consoleLines.value.some(l => l.kind === 'alarm')).toBe(true);
  });

  it('runs macros line by line', async () => {
    const fake = new FakeFluidnc('v4');
    const api = await connected(fake);
    await api.runMacro({ id: 'm', name: 'Lift', kind: 'gcode', content: 'G91\nG0 Z10 ; lift\n\nG90' });
    await api.runMacro({ id: 's', name: 'File', kind: 'sd', content: 'missing.nc' }).catch(() => {});
    expect(fake.received.slice(-4)).toEqual(['G91', 'G0 Z10', 'G90', '$SD/Run=/missing.nc']);
  });

  it('uploads, verifies and runs the job file', async () => {
    const fake = new FakeFluidnc('v3-81');
    const api = await connected(fake);
    await api.uploadGcode('G0 X1\nG1 X2 F100\n', 'camnc.gcode', { fetchImpl: fake.fetch });
    await api.runFile('camnc.gcode');
    fake.progressJob(50);
    await until(() => api.jobProgress.value?.percent === 50);
  });

  it('tracks homing, Z zeroing and job start for the pre-job checklist', async () => {
    const fake = new FakeFluidnc('v4');
    const api = await connected(fake);
    expect(api.homed.value).toBe(false);
    expect(api.zZeroedAt.value).toBeNull();
    await api.home();
    await api.zeroAxes(['x', 'y']);
    expect(api.zZeroedAt.value).toBeNull();
    await api.probeZ({ plateThickness: 0.5, maxTravel: 50, feed: 100 });
    expect(api.homed.value).toBe(true);
    expect(api.zZeroedAt.value).not.toBeNull();

    await api.uploadGcode('G1 X1 F100\n', 'camnc.gcode', { fetchImpl: fake.fetch });
    await api.runFile('camnc.gcode');
    fake.progressJob(10);
    await until(() => api.jobStartedAt.value !== null);
    const started = api.jobStartedAt.value;
    fake.progressJob(20);
    await until(() => api.jobProgress.value?.percent === 20);
    expect(api.jobStartedAt.value).toBe(started);
    fake.progressJob(100);
    await until(() => api.jobStartedAt.value === null);

    fake.probeContactZ = null;
    await api.probeZ({ plateThickness: 0, maxTravel: 5, feed: 50 }).catch(() => {});
    expect(api.homed.value).toBe(false);
  });

  it('rejects commands immediately while disconnected, instead of throwing', async () => {
    const api = new CncApi();
    await expect(api.jogRelative({ x: 1 }, 100)).rejects.toThrow('not connected');
    await expect(api.unlock()).rejects.toThrow('not connected');
  });

  it('lets only one instance hold the machine', async () => {
    const fake = new FakeFluidnc('v4');
    const first = await connected(fake);
    const second = new CncApi(fake.WebSocket);
    apis.push(second);
    second.connect(fake.host);
    await until(() => second.connection.value === 'other-tab');
    first.disconnect();
    await until(() => second.connection.value === 'connected');
  });

  it('never opens a connection for an attempt cancelled before it got the lock', async () => {
    const typo = new FakeFluidnc('v4');
    const fake = new FakeFluidnc('v4');
    (fake as { host: string }).host = '192.168.1.21';
    const sockets: string[] = [];
    // One WebSocket implementation for both controllers, routed by URL.
    const WebSocketImpl = function (url: string) {
      sockets.push(url);
      return new (url.includes(fake.host) ? fake : typo).WebSocket(url);
    } as unknown as typeof WebSocket;
    const api = new CncApi(WebSocketImpl);
    apis.push(api);
    const states: string[] = [];
    api.connection.subscribe(state => states.push(state));
    // Like correcting the host and pressing Connect: the first attempt's lock callback has not run yet.
    api.connect(typo.host);
    api.connect(fake.host);
    await until(() => api.connection.value === 'connected');
    expect(api.host.value).toBe(fake.host);
    expect(sockets.every(url => url.includes(fake.host))).toBe(true);
    expect(typo.openSockets).toHaveLength(0);
    expect(states).not.toContain('other-tab');
    // The lock is free again after disconnecting.
    api.disconnect();
    expect((await connected(fake)).connection.value).toBe('connected');
  });

  it('takes the machine over from another tab, which then stops using it', async () => {
    const fake = new FakeFluidnc('v4');
    const first = await connected(fake);
    const second = new CncApi(fake.WebSocket);
    apis.push(second);
    second.connect(fake.host);
    await until(() => second.connection.value === 'other-tab');
    second.takeOver();
    await until(() => second.connection.value === 'connected' && first.connection.value === 'taken-over');
    await expect(first.unlock()).rejects.toThrow('not connected');
    expect(fake.openSockets).toHaveLength(1);
    // And back again.
    first.takeOver();
    await until(() => first.connection.value === 'connected' && second.connection.value === 'taken-over');
  });

  it('does not make a simulated controller compete for the machine lock', async () => {
    const fake = new FakeFluidnc('v4');
    const real = await connected(fake);
    const simulated = new CncApi(fake.WebSocket, fake.fetch, true);
    apis.push(simulated);
    simulated.connect(fake.host);
    await until(() => simulated.connection.value === 'connected');
    expect(real.connection.value).toBe('connected');
  });

  it('reports an unreachable controller', async () => {
    const fake = new FakeFluidnc('v4');
    fake.reachable = false;
    const api = new CncApi(fake.WebSocket);
    apis.push(api);
    api.connect(fake.host);
    await until(() => api.connection.value === 'unreachable');
  });
});

describe('overrideSteps', () => {
  const bytes = { reset: Realtime.feedOvrReset, p10: 1, m10: 2, p1: 3, m1: 4 };
  it('resets and steps to the target', () => {
    expect(overrideSteps(123, bytes)).toEqual([Realtime.feedOvrReset, 1, 1, 3, 3, 3]);
    expect(overrideSteps(85, bytes)).toEqual([Realtime.feedOvrReset, 2, 4, 4, 4, 4, 4]);
    expect(overrideSteps(5, bytes).filter(b => b === 2)).toHaveLength(9);
  });
});
