import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOpenFile } from './useOpenFile';

const mocks = vi.hoisted(() => ({
  locked: vi.fn(() => false),
  updateToolpath: vi.fn(),
  createJobFromFile: vi.fn(async () => ({ id: 'job' })),
  navigate: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@/cam/machine/camMachine', () => ({ isManufacturingLocked: mocks.locked }));
vi.mock('@/cam/openModelFile', () => ({ createJobFromFile: mocks.createJobFromFile }));
vi.mock('@/cam/camQueries', () => ({ camKeys: { jobs: ['jobs'] } }));
vi.mock('./dropMessages', () => ({ wrongFileMessage: () => 'wrong file' }));
vi.mock('@/store/store', () => ({ useStore: { getState: () => ({ updateToolpath: mocks.updateToolpath }) } }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: { info: mocks.info, error: vi.fn(), success: vi.fn() } }));

describe('useOpenFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locked.mockReturnValue(false);
  });

  const open = (file: File) => renderHook(() => useOpenFile()).result.current(file);

  it('loads G-code as the toolpath', async () => {
    await open(new File(['G0 X1'], 'a.gcode'));
    expect(mocks.updateToolpath).toHaveBeenCalledWith('G0 X1', 'a.gcode');
  });

  it.each(['a.gcode', 'a.step'])('refuses %s while a machine job is protected', async name => {
    mocks.locked.mockReturnValue(true);
    await open(new File(['x'], name));
    expect(mocks.info).toHaveBeenCalledOnce();
    expect(mocks.updateToolpath).not.toHaveBeenCalled();
    expect(mocks.createJobFromFile).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('does not replace the toolpath if a run locks while the file is being read', async () => {
    const file = new File(['G0 X1'], 'a.gcode');
    const read = file.text.bind(file);
    file.text = async () => {
      const text = await read();
      mocks.locked.mockReturnValue(true);
      return text;
    };
    await open(file);
    expect(mocks.updateToolpath).not.toHaveBeenCalled();
  });
});
