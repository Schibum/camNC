/**
 * Runs against a real FluidNC: `pnpm sim` (4.x) or `pnpm sim --v3` (3.9.9 personality proxy), then
 *
 *   FLUIDNC_SIM_HOST=127.0.0.1:8848 pnpm vitest run sim.integration   # v4
 *   FLUIDNC_SIM_HOST=127.0.0.1:8850 pnpm vitest run sim.integration   # v3 personality
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readMachineBounds, readMaxRateXY } from './config';
import { deleteSdFile, listSdFiles, runSdFile, uploadSdFile } from './files';
import { FluidncAbortError, FluidncProtocol, MachineStatus } from './protocol';
import { FluidncSocket } from './socket';

const host = process.env.FLUIDNC_SIM_HOST;
const expectedVariant = process.env.FLUIDNC_SIM_VARIANT;

const until = async (predicate: () => boolean, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

describe.skipIf(!host)('FluidNC simulator', () => {
  let protocol: FluidncProtocol;
  const statuses: MachineStatus[] = [];

  beforeAll(async () => {
    protocol = new FluidncProtocol(new FluidncSocket({ host: host!, backoffMs: [100, 500] }));
    protocol.on('status', s => statuses.push(s));
    const connected = new Promise(resolve => protocol.on('connected', resolve));
    protocol.start();
    await connected;
    await protocol.send('$X').catch(() => {});
  });

  afterAll(() => protocol?.stop());

  it('detects the variant and the firmware version', () => {
    if (expectedVariant) expect(protocol.variant).toBe(expectedVariant);
    expect(protocol.buildInfo?.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('auto-reports status while jogging and cancels jogs', async () => {
    await protocol.send('G10 L20 P0 X0 Y0 Z0');
    const start = protocol.status!.mpos.x;
    await protocol.send('$J=G91 G21 X200 F3000');
    await until(() => protocol.status?.state === 'Jog');
    protocol.jogCancel();
    await until(() => protocol.status?.state === 'Idle');
    const moved = protocol.status!.mpos.x - start;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(200);
  });

  it('reads the XY max rate', async () => {
    expect(await readMaxRateXY(protocol)).toBeGreaterThan(0);
  });

  it('sets work offsets with G10', async () => {
    await protocol.send('G10 L20 P0 X0 Y0 Z0');
    protocol.realtime(0x3f);
    await until(() => Math.abs(protocol.status!.wpos.x) < 0.001);
  });

  it('reads bounds from $CD', async () => {
    const bounds = await readMachineBounds(protocol);
    expect(bounds.xmax - bounds.xmin).toBeCloseTo(1220, 0);
    expect(bounds.ymax - bounds.ymin).toBeCloseTo(2440, 0);
  });

  it('uploads with no-cors, verifies via ListJSON, runs and reports SD progress', async () => {
    const gcode = 'G21\nG90\nG0 X0 Y0\n' + Array.from({ length: 12 }, (_, i) => `G1 X${(i % 2) * 20} Y${i} F6000`).join('\n') + '\n';
    await uploadSdFile(protocol, host!, 'camnc-it.gcode', gcode);
    const listing = await listSdFiles(protocol);
    expect(listing.files.find(f => f.name.endsWith('camnc-it.gcode'))?.size).toBe(gcode.length);
    statuses.length = 0;
    await runSdFile(protocol, 'camnc-it.gcode');
    await until(() => statuses.some(s => s.job !== undefined && s.state === 'Run'));
    protocol.feedHold();
    // FluidNC ignores cycle start while the hold is still decelerating (Hold:1).
    await until(() => protocol.status?.state === 'Hold' && protocol.status.subState === 0);
    protocol.cycleStart();
    await until(() => protocol.status?.state === 'Idle' && protocol.status.job === undefined, 60_000).catch(e => {
      throw new Error(e.message + ' ' + JSON.stringify(statuses.slice(-3).map(s => [s.state, s.job])));
    });
    await deleteSdFile(protocol, 'camnc-it.gcode');
  }, 90_000);

  it('rejects in-flight commands on soft reset', async () => {
    const dwell = protocol.send('G4 P3', { timeoutMs: 0 }).catch(e => e);
    await new Promise(resolve => setTimeout(resolve, 100));
    protocol.softReset();
    expect(await dwell).toBeInstanceOf(FluidncAbortError);
    await until(() => protocol.isConnected());
    await protocol.send('$X').catch(() => {});
  });
});
