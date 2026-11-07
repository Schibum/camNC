import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadAndRun, zeroAndRun } from './jobs';

const h = vi.hoisted(() => ({
  api: {
    homed: { value: false },
    setWorkspaceXYZero: vi.fn(async () => {}),
    uploadGcode: vi.fn(async () => {}),
    runFile: vi.fn(async () => {}),
    status: { value: null as null | { mpos: { x: number; y: number; z: number } } },
    travel: { value: null as null | Record<'x' | 'y' | 'z', { min: number; max: number; softLimits: boolean }> },
    host: { value: null },
  },
  state: { toolpath: { gcode: '' } as { gcode: string }, toolpathName: 'Board A', toolpathOffset: { x: 12, y: 34, z: 0 } },
  toastError: vi.fn(),
}));

vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.api }));
vi.mock('@/store/store', () => ({ useStore: { getState: () => h.state }, getMachineBounds: () => null }));
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: { error: h.toastError, promise: vi.fn() } }));

describe('uploadAndRun, homing and travel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.api.homed.value = false;
    h.api.status.value = null;
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
    h.api.status.value = null;
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
});
