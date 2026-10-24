import { afterEach, describe, expect, it } from 'vitest';
import { runSdFile, uploadSdFile } from '../files';
import { FluidncProtocol, MachineStatus } from '../protocol';
import { FluidncSocket } from '../socket';
import { DemoFluidnc } from './DemoFluidnc';

const until = async (predicate: () => boolean, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach(fn => fn());
});

async function connect() {
  const demo = new DemoFluidnc();
  demo.speed = 50;
  const socket = new FluidncSocket({ host: demo.host, variant: 'v4', WebSocketImpl: demo.WebSocket, pingIntervalMs: 1000 });
  const protocol = new FluidncProtocol(socket);
  let status: MachineStatus | null = null;
  protocol.on('status', s => (status = s));
  cleanup.push(
    () => protocol.stop(),
    () => demo.dispose()
  );
  const connected = new Promise(resolve => protocol.on('connected', resolve));
  protocol.start();
  await connected;
  return { demo, protocol, status: () => status };
}

describe('DemoFluidnc', () => {
  it('animates a jog and reports Jog until it arrives', async () => {
    const { demo, protocol, status } = await connect();
    const start = { ...demo.mpos };
    await protocol.send('$J=G91 G21 X20 F3000');
    await until(() => status()?.state === 'Jog');
    await until(() => status()?.state === 'Idle');
    expect(demo.mpos.x).toBeCloseTo(start.x + 20, 6);
    expect(status()?.mpos?.x).toBeCloseTo(start.x + 20, 3);
  });

  it('moves jogs at their own feed, not at rapid speed', async () => {
    const { demo, protocol } = await connect();
    demo.speed = 1;
    const start = demo.mpos.x;
    await protocol.send('$J=G91 G21 X500 F600');
    await new Promise(resolve => setTimeout(resolve, 1000));
    // 600 mm/min is 10 mm/s; at rapid speed (100 mm/s) it would be near 100 mm.
    expect(demo.mpos.x - start).toBeLessThan(25);
    expect(demo.mpos.x - start).toBeGreaterThan(3);
  });

  it('cancels a jog in place', async () => {
    const { demo, protocol, status } = await connect();
    demo.speed = 1;
    await protocol.send('$J=G91 G21 X500 F600');
    await until(() => status()?.state === 'Jog');
    protocol.jogCancel();
    await until(() => status()?.state === 'Idle');
    expect(demo.mpos.x).toBeLessThan(100);
  });

  it('runs G-code lines from macros in order', async () => {
    const { demo, protocol, status } = await connect();
    await protocol.sendLines('G53 G0 Z-5\nG90 G0 X0 Y0');
    await until(() => status()?.state === 'Idle' && demo.mpos.z === -5);
    // Work X0 Y0 is where the demo's work zero sits.
    expect(demo.mpos.x).toBeCloseTo(demo.wco.x, 6);
    expect(demo.mpos.y).toBeCloseTo(demo.wco.y, 6);
  });

  it('uploads and runs a job, reporting its progress', async () => {
    const { demo, protocol, status } = await connect();
    demo.speed = 5;
    await uploadSdFile(protocol, demo.host, 'camnc.gcode', 'G90\nG1 X0 Y0 F6000\nG1 X30 F6000\nG1 Y30\nG1 X0\nG1 Y0', {
      fetchImpl: demo.fetch,
    });
    const percents: number[] = [];
    protocol.on('status', s => s.job && percents.push(s.job.percent));
    await runSdFile(protocol, 'camnc.gcode');
    await until(() => status()?.state === 'Idle' && percents.length > 1);
    expect(percents[0]).toBeLessThan(100);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(demo.mpos.x).toBeCloseTo(demo.wco.x, 6);
  });

  it('pauses on feed hold and resumes on cycle start', async () => {
    const { demo, protocol, status } = await connect();
    demo.speed = 1;
    await uploadSdFile(protocol, demo.host, 'slow.gcode', 'G1 X0 Y0 F600\nG1 X300 F600', { fetchImpl: demo.fetch });
    await runSdFile(protocol, 'slow.gcode');
    protocol.feedHold();
    await until(() => status()?.state === 'Hold');
    const held = { ...demo.mpos };
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(demo.mpos).toEqual(held);
    protocol.cycleStart();
    await until(() => status()?.state === 'Run');
  });

  it('reports the work offset for $#', async () => {
    const { demo, protocol } = await connect();
    const lines = await protocol.send('$#');
    expect(lines).toContain(`[G54:${demo.wco.x.toFixed(3)},${demo.wco.y.toFixed(3)},${demo.wco.z.toFixed(3)}]`);
  });
});
