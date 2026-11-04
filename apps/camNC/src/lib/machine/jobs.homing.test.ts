import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadAndRun } from './jobs';
import { kHomeFirst } from './workflow';

const h = vi.hoisted(() => ({
  api: {
    homed: { value: false },
    uploadGcode: vi.fn(async () => {}),
    runFile: vi.fn(async () => {}),
    status: { value: null },
    host: { value: null },
  },
  state: { toolpath: { gcode: '' } as { gcode: string }, toolpathName: 'Board A' },
  toastError: vi.fn(),
}));

vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.api }));
vi.mock('@/store/store', () => ({ useStore: { getState: () => h.state }, getMachineBounds: () => null }));
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: { error: h.toastError, promise: vi.fn() } }));

describe('uploadAndRun and homing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.api.homed.value = false;
    h.state.toolpath = { gcode: 'G1 X10 F100\nM5\nG53 G0 Z-5\nM30' };
  });

  it('refuses a program with moves in machine coordinates on a machine not homed: nothing goes to the controller', async () => {
    await expect(uploadAndRun()).rejects.toThrow(kHomeFirst);
    expect(h.toastError).toHaveBeenCalledWith(kHomeFirst);
    expect(h.api.uploadGcode).not.toHaveBeenCalled();
    expect(h.api.runFile).not.toHaveBeenCalled();
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
