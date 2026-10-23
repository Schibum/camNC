import { afterEach, describe, expect, it } from 'vitest';
import { readMachineBounds } from './config';
import { listSdFiles, runSdFile, uploadSdFile } from './files';
import { FluidncAbortError, FluidncError, FluidncProtocol, MachineStatus, Realtime } from './protocol';
import { FluidncSocket } from './socket';
import { FakeFluidnc } from './testing';

const until = async (predicate: () => boolean, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

let protocols: FluidncProtocol[] = [];
afterEach(() => {
  protocols.forEach(p => p.stop());
  protocols = [];
});

async function connect(fake: FakeFluidnc, options: { variant?: 'v4' | 'v3-81' } = {}) {
  const socket = new FluidncSocket({
    host: fake.host,
    variant: options.variant,
    WebSocketImpl: fake.WebSocket,
    backoffMs: [10, 20],
    pingIntervalMs: 50,
  });
  const protocol = new FluidncProtocol(socket);
  protocols.push(protocol);
  const connected = new Promise<{ variant: string }>(resolve => protocol.on('connected', resolve));
  protocol.start();
  await connected;
  return protocol;
}

describe.each(['v3-81', 'v4'] as const)('FluidncProtocol on %s', variant => {
  it('detects the variant and initialises auto-reporting', async () => {
    const fake = new FakeFluidnc(variant);
    const protocol = await connect(fake);
    expect(protocol.variant).toBe(variant);
    expect(protocol.buildInfo?.major).toBe(variant === 'v4' ? 4 : 3);
    expect(fake.received.slice(0, 4)).toEqual(['$Report/Interval=200', '$I', '$G', '$#']);
  });

  it('uses a remembered variant without probing the other one first', async () => {
    const fake = new FakeFluidnc(variant);
    const protocol = await connect(fake, { variant });
    expect(protocol.variant).toBe(variant);
  });

  it('resolves commands with the lines before ok and rejects error:N with a readable message', async () => {
    const fake = new FakeFluidnc(variant);
    const protocol = await connect(fake);
    expect(await protocol.send('$G')).toEqual(['[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]']);
    fake.state = 'Alarm';
    const err = await protocol.send('G0 X10').catch(e => e);
    expect(err).toBeInstanceOf(FluidncError);
    expect((err as FluidncError).code).toBe(9);
    expect((err as Error).message).toContain('lock or alarm');
  });

  it('merges status reports and computes WPos from WCO', async () => {
    const fake = new FakeFluidnc(variant);
    const protocol = await connect(fake);
    const statuses: MachineStatus[] = [];
    protocol.on('status', s => statuses.push(s));
    await protocol.send('G10 L20 P0 X0 Y0 Z0');
    await protocol.send('$J=G91 G21 X10 F1000');
    fake.pushStatus();
    await until(() => statuses.some(s => s.mpos.x === 13));
    const last = statuses.at(-1)!;
    expect(last.wpos).toEqual({ x: 10, y: 0, z: 0 });
    expect(last.overrides).toEqual({ feed: 100, rapid: 100, spindle: 100 });
  });

  it('sends realtime bytes outside the queue', async () => {
    const fake = new FakeFluidnc(variant);
    const protocol = await connect(fake);
    fake.respond = line => (line === 'G4 P10' ? [] : undefined); // never answers
    const slow = protocol.send('G4 P10').catch(e => e);
    protocol.feedHold();
    protocol.jogCancel();
    protocol.realtime(Realtime.feedOvrPlus10);
    await until(() => fake.realtime.includes(Realtime.feedOvrPlus10));
    expect(fake.realtime).toEqual(expect.arrayContaining([0x21, 0x85, 0x91]));
    protocol.softReset();
    expect(await slow).toBeInstanceOf(FluidncAbortError);
  });

  it('flushes pending commands on ALARM and never replays them after a reconnect', async () => {
    const fake = new FakeFluidnc(variant);
    const protocol = await connect(fake);
    fake.probeContactZ = null;
    const probe = protocol.send('G38.2 Z-50 F100', { timeoutMs: 0 }).catch(e => e);
    const queued = protocol.send('G0 X100').catch(e => e);
    expect(await probe).toBeInstanceOf(FluidncAbortError);
    expect(await queued).toBeInstanceOf(FluidncAbortError);
    expect(fake.received).not.toContain('G0 X100');

    fake.respond = line => (line === 'G0 X200' ? [] : undefined);
    const inFlight = protocol.send('G0 X200').catch(e => e);
    await until(() => fake.received.includes('G0 X200'));
    const reconnected = new Promise(resolve => protocol.on('connected', resolve));
    fake.kill();
    expect(await inFlight).toBeInstanceOf(FluidncAbortError);
    await expect(protocol.send('G0 X1')).rejects.toThrow('not connected');
    await reconnected;
    expect(fake.received.filter(l => l === 'G0 X200')).toHaveLength(1);
  });

  it('rejects everything on a reset banner', async () => {
    const fake = new FakeFluidnc(variant);
    const protocol = await connect(fake);
    fake.respond = line => (line === 'G0 X5' ? [`Grbl 3.9 [FluidNC v3.9.9 (wifi) '$' for help]`] : undefined);
    await expect(protocol.send('G0 X5')).rejects.toThrow('controller reset');
  });

  it('reads axis bounds from $Config/Dump (JP2 LowRider)', async () => {
    const fake = new FakeFluidnc(variant);
    const protocol = await connect(fake);
    expect(await readMachineBounds(protocol)).toEqual({ xmin: 3, xmax: 1223, ymin: 3, ymax: 2443, zmin: -297, zmax: 3 });
  });

  it.each(['http', 'xmodem'] as const)('uploads over %s, verifies with ListJSON and runs the file', async method => {
    const fake = new FakeFluidnc(variant);
    const protocol = await connect(fake);
    const gcode = 'G21\nG90\n' + 'G1 X10 Y10 F1000\n'.repeat(200);
    await uploadSdFile(protocol, fake.host, 'camnc.gcode', gcode, { method, fetchImpl: fake.fetch });
    expect((await listSdFiles(protocol)).files).toEqual([{ name: 'camnc.gcode', size: gcode.length, isDirectory: false, datetime: '' }]);
    await runSdFile(protocol, 'camnc.gcode');
    fake.progressJob(42.5);
    await until(() => protocol.status?.job?.percent === 42.5);
    expect(protocol.status?.job?.file).toBe('/sd/camnc.gcode');
    fake.progressJob(100);
    await until(() => protocol.status?.job === undefined && protocol.status?.state === 'Idle');
  });

  it('resolves $SD/Run once the job runs, although 4.x only acknowledges it at the end', async () => {
    const fake = new FakeFluidnc(variant);
    const protocol = await connect(fake);
    fake.files.set('job.nc', new TextEncoder().encode('G0 X1\n'));
    await runSdFile(protocol, 'job.nc');
    await until(() => protocol.status?.state === 'Run');
    protocol.realtime(Realtime.feedOvrPlus10);
    fake.progressJob(100);
    await until(() => protocol.status?.state === 'Idle');
    // The queue is free again once the deferred ok arrived.
    expect(await protocol.send('$G')).toHaveLength(1);
  });

  it('fails the upload when the file does not show up', async () => {
    const fake = new FakeFluidnc(variant);
    const protocol = await connect(fake);
    const dropAll: typeof fetch = async () => new Response(null);
    await expect(uploadSdFile(protocol, fake.host, 'x.gcode', 'G0', { fetchImpl: dropAll, verifyTimeoutMs: 50 })).rejects.toThrow(
      'not on the SD card'
    );
  });
});

describe('keepalive', () => {
  it('pings 4.x but never sends PING: to 3.9.9', async () => {
    const v4 = new FakeFluidnc('v4');
    const v3 = new FakeFluidnc('v3-81');
    await connect(v4);
    await connect(v3);
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(v3.received.some(l => l.startsWith('PING'))).toBe(false);
    expect(v4.received.some(l => l.startsWith('PING'))).toBe(false); // answered by the transport, not fed as G-code
  });
});

describe('FluidncSocket', () => {
  it('reports unreachable hosts and keeps retrying', async () => {
    const fake = new FakeFluidnc('v4');
    fake.reachable = false;
    const socket = new FluidncSocket({ host: fake.host, WebSocketImpl: fake.WebSocket, backoffMs: [5, 5] });
    const failures: string[] = [];
    socket.on('close', e => failures.push(e.reason));
    socket.start();
    await until(() => failures.length >= 2);
    fake.reachable = true;
    await until(() => socket.isOpen());
    socket.stop();
  });
});
