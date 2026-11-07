import { FakeFluidnc } from '@wbcnc/fluidnc/testing';
import { CncApi } from '../fluidnc/cnc-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCamMachine } from '@/cam/machine/camMachine';
import { setXYZeroFromToolpath, uploadAndRun, zeroAndRun, zeroXYAtBit } from './jobs';

const h = vi.hoisted(() => ({
  realApi: null as import('../fluidnc/cnc-api').CncApi | null,
  api: {
    async getCurrentZero() {
      return this.currentZero.value ?? this.status.value?.wco ?? null;
    },
    homed: { value: false },
    currentZero: { value: null as null | { x: number; y: number; z: number } },
    setWorkspaceXYZero: vi.fn<(x: number, y: number) => Promise<void>>().mockResolvedValue(undefined),
    uploadGcode: vi.fn(async () => {}),
    runFile: vi.fn(async () => {}),
    status: {
      value: null as null | { state?: 'Idle'; mpos: { x: number; y: number; z: number }; wco?: { x: number; y: number; z: number } },
    },
    travel: { value: null as null | Record<'x' | 'y' | 'z', { min: number; max: number; softLimits: boolean }> },
    host: { value: 'homing-test' },
    jobStartedAt: { value: null },
    zZeroedAt: { value: null },
  },
  state: {
    setIsToolpathDragging: () => {},
    setToolpathOffset(value: { x: number; y: number; z: number }) {
      this.toolpathOffset = value;
    },
    toolpath: { gcode: '' } as { gcode: string },
    toolpathName: 'Board A',
    toolpathOffset: { x: 12, y: 34, z: 0 },
    stockHeight: 18,
    toolDiameter: 3,
  },
  toastError: vi.fn(),
}));

vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.realApi ?? h.api, getExistingCncApi: () => null }));
vi.mock('./jobRecord', async original => ({ ...(await original<object>()), saveJobRecord: vi.fn(async () => {}) }));
vi.mock('@/store/store', () => ({ useStore: { getState: () => h.state }, getMachineBounds: () => null }));
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: { error: h.toastError, promise: vi.fn(), success: vi.fn() } }));

afterEach(async () => {
  await (await import('./jobRecord')).clearJobRecord(h.realApi?.host.value ?? h.api.host.value);
  h.realApi?.disconnect();
  h.realApi = null;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});

describe('uploadAndRun, homing and travel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.api.currentZero.value = null;
    useCamMachine.setState(useCamMachine.getInitialState(), true);
    h.api.homed.value = false;
    h.api.status.value = { state: 'Idle', mpos: { x: 10, y: 10, z: 0 }, wco: { x: 0, y: 0, z: 0 } };
    h.api.travel.value = null;
    h.state.toolpath = { gcode: 'G1 X10 F100\nM5\nG53 G0 Z-5\nM30' };
  });

  it('runs a program with moves in machine coordinates unhomed too: camNC may have connected after homing', async () => {
    await uploadAndRun();
    expect(h.api.runFile).toHaveBeenCalledOnce();
  });

  it('refuses to start while the machine sits outside its travel: nothing goes to the controller', async () => {
    h.api.homed.value = true;
    h.api.status.value = { mpos: { x: 2.99, y: 120, z: -10 } };
    h.api.travel.value = {
      x: { min: 3, max: 1223, softLimits: true },
      y: { min: 3, max: 2443, softLimits: true },
      z: { min: -297, max: 3, softLimits: true },
    };
    await expect(uploadAndRun()).rejects.toThrow('X is at 2.99, 0.01 mm below the X travel 3 to 1223');
    expect(h.toastError).toHaveBeenCalledOnce();
    expect(h.api.uploadGcode).not.toHaveBeenCalled();
  });

  it('runs it once homed', async () => {
    h.api.homed.value = true;
    await uploadAndRun();
    expect(h.api.runFile).toHaveBeenCalledOnce();
  });

  it('a program without them runs as before', async () => {
    h.state.toolpath = { gcode: 'G1 X10 F100\nM30' };
    await uploadAndRun();
    expect(h.api.runFile).toHaveBeenCalledOnce();
  });
});

describe('zeroAndRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.api.currentZero.value = null;
    useCamMachine.setState(useCamMachine.getInitialState(), true);
    h.api.status.value = { state: 'Idle', mpos: { x: 12, y: 34, z: 0 }, wco: { x: 12, y: 34, z: 0 } };
    h.api.travel.value = null;
    h.state.toolpath = { gcode: 'G1 X10 F100\nM30' };
    h.api.setWorkspaceXYZero.mockResolvedValue(undefined);
  });

  it('sets XY zero where the job is placed, before anything runs', async () => {
    await zeroAndRun();
    expect(h.api.setWorkspaceXYZero).toHaveBeenCalledWith(12, 34);
    expect(h.api.setWorkspaceXYZero.mock.invocationCallOrder[0]).toBeLessThan(h.api.uploadGcode.mock.invocationCallOrder[0]!);
    expect(h.api.runFile).toHaveBeenCalledOnce();
  });

  it('starts nothing if the zero could not be set', async () => {
    h.api.setWorkspaceXYZero.mockRejectedValue(new Error('no answer'));
    await expect(zeroAndRun()).rejects.toThrow('no answer');
    expect(h.api.uploadGcode).not.toHaveBeenCalled();
    expect(h.api.runFile).not.toHaveBeenCalled();
  });

  it('leaves the zero alone while the machine sits outside its travel', async () => {
    h.api.status.value = { mpos: { x: 2.99, y: 120, z: -10 } };
    h.api.travel.value = {
      x: { min: 3, max: 1223, softLimits: true },
      y: { min: 3, max: 2443, softLimits: true },
      z: { min: -297, max: 3, softLimits: true },
    };
    await expect(zeroAndRun()).rejects.toThrow('X is at 2.99');
    expect(h.api.setWorkspaceXYZero).not.toHaveBeenCalled();
  });
  it('locks preparation before G10 and rejects another Run without another zero change', async () => {
    let finish!: () => void;
    h.api.setWorkspaceXYZero.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    );
    const running = zeroAndRun();
    await vi.waitFor(() => expect(h.api.setWorkspaceXYZero).toHaveBeenCalledOnce());
    expect(useCamMachine.getState().preparingRun).toBe(true);
    await expect(zeroAndRun()).rejects.toThrow('Review or dismiss');
    expect(h.api.setWorkspaceXYZero).toHaveBeenCalledOnce();
    finish();
    await running;
  });

  it('waits for the reported effective WCO and stores that new zero before dispatch', async () => {
    h.api.status.value!.wco = { x: 0, y: 0, z: 0 };
    const running = zeroAndRun();
    await vi.waitFor(() => expect(h.api.setWorkspaceXYZero).toHaveBeenCalledOnce());
    expect(h.api.uploadGcode).not.toHaveBeenCalled();
    h.api.status.value!.wco = { x: 12, y: 34, z: 0 };
    await running;
    const { loadJobRecord } = await import('./jobRecord');
    expect((await loadJobRecord(h.api.host.value))!.wco).toEqual({ x: 12, y: 34, z: 0 });
    expect(h.api.runFile).toHaveBeenCalledOnce();
  });

  it('does not upload or run when G10 is acknowledged but the effective zero never changes', async () => {
    h.api.status.value!.wco = { x: 0, y: 0, z: 0 };
    await expect(zeroAndRun()).rejects.toThrow('did not confirm');
    expect(h.api.uploadGcode).not.toHaveBeenCalled();
    expect(h.api.runFile).not.toHaveBeenCalled();
    expect(useCamMachine.getState().preparingRun).toBe(false);
  }, 10000);

  it('does not touch the zero of a finished native setup awaiting review', async () => {
    useCamMachine.setState({ runReview: 'finished', runSnapshot: {} as never });
    await expect(zeroAndRun()).rejects.toThrow('Review or dismiss');
    expect(h.api.setWorkspaceXYZero).not.toHaveBeenCalled();
    expect(h.api.uploadGcode).not.toHaveBeenCalled();
  });

  it('rejects a controller change during zeroing before upload or dispatch', async () => {
    h.api.setWorkspaceXYZero.mockImplementation(async () => {
      h.api.host.value = 'other-controller';
    });
    await expect(zeroAndRun()).rejects.toThrow('machine or session changed');
    expect(h.api.uploadGcode).not.toHaveBeenCalled();
    h.api.host.value = 'homing-test';
  });
});

describe('real coordinate-table reads and delayed effective-offset reports', () => {
  async function controller() {
    vi.clearAllMocks();
    useCamMachine.setState(useCamMachine.getInitialState(), true);
    h.state.toolpathOffset = { x: 12, y: 34, z: 0 };
    h.state.toolpath = { gcode: 'G21 G90 G94\nG1 X10 F300\nM30' };
    const fake = new FakeFluidnc('v4');
    fake.mpos = { x: 100, y: 50, z: 0 };
    fake.wco = { x: 0, y: 0, z: 0 };
    let table = { ...fake.wco };
    let releaseReport!: () => void;
    const reportGate = new Promise<void>(resolve => {
      releaseReport = resolve;
    });
    fake.respond = line => {
      if (/G10 L(?:2|20) P0/.test(line)) {
        table = line.includes('L20')
          ? { ...fake.mpos }
          : {
              ...table,
              x: Number(/ X(-?[\d.]+)/.exec(line)![1]),
              y: Number(/ Y(-?[\d.]+)/.exec(line)![1]),
            };
        const reported = { ...table };
        setTimeout(async () => {
          await reportGate;
          fake.wco = reported;
          fake.pushStatus();
        }, 100);
        return ['ok'];
      }
      if (line === '$#') return [`[G54:${table.x},${table.y},${table.z}]`, 'ok'];
    };
    const api = new CncApi(fake.WebSocket);
    h.realApi = api;
    api.connect(fake.host);
    await vi.waitFor(() => expect(api.isConnected.value).toBe(true));
    fake.pushStatus();
    await vi.waitFor(() => expect(api.status.value?.wco.x).toBe(0));
    await api.getCurrentZero();
    fake.received.length = 0;
    const upload = vi.spyOn(api, 'uploadGcode').mockResolvedValue(undefined);
    const run = vi.spyOn(api, 'runFile').mockResolvedValue(undefined);
    return { fake, api, upload, run, releaseReport };
  }

  it('waits for the delayed WCO after zeroing at the bit, then moves the drawing to it', async () => {
    const { fake, api, releaseReport } = await controller();
    const moving = zeroXYAtBit();
    await vi.waitFor(() => expect(api.currentZero.value).toMatchObject({ x: 100, y: 50 }));
    expect(api.status.value?.wco).toMatchObject({ x: 0, y: 0 });
    releaseReport();
    await moving;
    expect(h.state.toolpathOffset).toMatchObject({ x: 100, y: 50 });
    expect(h.toastError).not.toHaveBeenCalled();
    await zeroAndRun();
    expect(fake.received).toContain('G21 G10 L2 P0 X100.000 Y50.000');
  });

  it('waits for a preceding Set XY zero before a quick Run, without uploading against stale WCO', async () => {
    const { api, upload, run, releaseReport } = await controller();
    await setXYZeroFromToolpath();
    const starting = zeroAndRun();
    await vi.waitFor(() => expect(api.currentZero.value).toMatchObject({ x: 12, y: 34 }));
    expect(api.status.value?.wco).toMatchObject({ x: 0, y: 0 });
    expect(upload).not.toHaveBeenCalled();
    releaseReport();
    await starting;
    expect(api.status.value?.wco).toMatchObject({ x: 12, y: 34 });
    expect(run).toHaveBeenCalledOnce();
    const { loadJobRecord } = await import('./jobRecord');
    expect((await loadJobRecord(api.host.value!))!.wco).toMatchObject({ x: 12, y: 34 });
  });

  it.each([zeroAndRun, uploadAndRun])(
    'refuses a persistent G92-like mismatch using real getCurrentZero (%#)',
    async start => {
      const { fake, api, upload, run } = await controller();
      fake.wco = { x: 100, y: 50, z: 0 };
      fake.pushStatus();
      await vi.waitFor(() => expect(api.status.value?.wco.x).toBe(100));
      await expect(start()).rejects.toThrow(/effective.*offset/i);
      expect(fake.received).toContain('$G');
      expect(fake.received).toContain('$#');
      expect(fake.received.some(line => line.includes('G10'))).toBe(false);
      expect(upload).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
    10000
  );
});
