import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DepthBlendWorker } from './useDepthBlendWorker';

const mocks = vi.hoisted(() => ({
  connected: Promise.resolve({ src: 'video' }) as Promise<{ src: string }>,
  camSource: { url: 'video' } as object | null,
  toast: { error: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: mocks.toast }));
vi.mock('@wbcnc/go2webrtc/use-video-source', async () => {
  const { use } = await import('react');
  return { useVideoSource: () => use(mocks.connected) };
});
vi.mock('@/depth/depthBlendManager', () => {
  const manager = {
    setVideoSource: vi.fn(async () => {}),
    setParams: vi.fn(async () => {}),
    onTextures: vi.fn(() => () => {}),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    setProcessingSettings: vi.fn(),
  };
  return { DepthBlendManager: { getInstance: () => manager } };
});
vi.mock('@/store/store', () => ({
  useVideoUrl: () => 'video',
  useCamSource: () => mocks.camSource,
  useMachineBoundsOrNull: () => ({ min: { x: 0, y: 0 }, max: { x: 1, y: 1 } }),
  useCalibrationData: () => ({}),
  useCamResolution: () => [1, 1],
  useCameraExtrinsics: () => ({ R: null, t: null }),
  useDepthBlendEnabled: () => false,
  useSetDepthBlendEnabled: () => vi.fn(),
  useSetDepthBlendInitializing: () => vi.fn(),
  useSetMaskTexture: () => vi.fn(),
  useSetBgTexture: () => vi.fn(),
  useDepthSettings: () => ({}),
}));

describe('DepthBlendWorker error reporting', () => {
  beforeEach(() => {
    mocks.toast.error.mockReset();
    mocks.toast.dismiss.mockReset();
    mocks.camSource = { url: 'video' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('reports a failing video source as a video source error', async () => {
    mocks.connected = Promise.reject(new Error('connection refused'));
    mocks.connected.catch(() => {});
    await act(async () => {
      render(<DepthBlendWorker />);
    });
    await vi.waitFor(() => expect(mocks.toast.error).toHaveBeenCalledTimes(1));
    expect(mocks.toast.error.mock.calls[0][0]).toBe('Video source failed: connection refused');
  });

  it('reports a worker setup error as a worker error', async () => {
    mocks.connected = Promise.resolve({ src: 'video' });
    mocks.camSource = null;
    await act(async () => {
      render(<DepthBlendWorker />);
    });
    await vi.waitFor(() => expect(mocks.toast.error).toHaveBeenCalledTimes(1));
    expect(mocks.toast.error.mock.calls[0][0]).toBe('Error loading depth blend worker: No camera source found');
  });
});
