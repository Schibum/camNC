import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { Matrix3, Vector2, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IOnChangeArgs } from './video-source-selection/VideoSourceSelection';
import type { ICamSource } from '../store/store';
import { Route } from '../routes/setup/url-entry';

const router = vi.hoisted(() => ({ navigate: vi.fn(), search: {} as { new?: boolean } }));
const store = vi.hoisted(() => ({
  camSources: {} as Record<string, ICamSource>,
  activeCamId: null as string | null,
  addCamSource: vi.fn(),
  updateCamSource: vi.fn(),
  deleteCamSource: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options, useSearch: () => router.search }),
  useNavigate: () => router.navigate,
}));

vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('../store/store', () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
  useCamSource: () => (store.activeCamId ? store.camSources[store.activeCamId] : null),
}));
vi.mock('./video-source-selection/VideoSourceSelection', () => ({
  VideoSourceSelection: ({ onChange }: { onChange: (source: IOnChangeArgs) => void }) => (
    <button
      type="button"
      onClick={() => onChange({ name: 'Phone camera', url: 'webrtc://phone', maxResolution: { width: 1920, height: 1080 } })}>
      Confirm Video Source
    </button>
  ),
}));

function configuredCamera(): ICamSource {
  return {
    name: 'Existing camera',
    url: 'webrtc://existing',
    maxResolution: [1920, 1080],
    calibration: {
      calibration_matrix: new Matrix3(),
      new_camera_matrix: new Matrix3(),
      distortion_coefficients: [0, 0, 0, 0, 0],
    },
    extrinsics: { R: new Matrix3(), t: new Vector3() },
    markerPosInCam: [new Vector2(100, 100)],
  };
}

function confirmSource() {
  const Component = Route.options.component as ComponentType;
  render(<Component />);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Video Source' }));
}

describe('camera source confirmation', () => {
  beforeEach(() => {
    store.camSources = {};
    store.activeCamId = null;
    store.addCamSource.mockClear();
    store.updateCamSource.mockClear();
    router.search = {};
    router.navigate.mockClear();
  });

  afterEach(cleanup);

  it.each([null, 'missing-camera'])('creates the first camera with activeCamId %s and no new flag', activeCamId => {
    store.activeCamId = activeCamId;

    confirmSource();

    expect(store.addCamSource).toHaveBeenCalledExactlyOnceWith('Phone camera', {
      name: 'Phone camera',
      url: 'webrtc://phone',
      maxResolution: [1920, 1080],
    });
    expect(store.updateCamSource).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith({ to: '/setup/camera-calibration' });
    expect(store.addCamSource.mock.invocationCallOrder[0]).toBeLessThan(router.navigate.mock.invocationCallOrder[0]!);
  });

  it('updates an existing camera and keeps calibration when the resolution is unchanged', () => {
    const camera = configuredCamera();
    store.camSources = { existing: camera };
    store.activeCamId = 'existing';

    confirmSource();

    expect(store.addCamSource).not.toHaveBeenCalled();
    expect(store.updateCamSource).toHaveBeenCalledExactlyOnceWith('existing', {
      name: 'Phone camera',
      url: 'webrtc://phone',
      maxResolution: [1920, 1080],
    });
    // Calibration and markers still hold, so setup is not repeated.
    expect(router.navigate).toHaveBeenCalledWith({ to: '/' });
  });

  it('rescales the calibration when the new source has the same aspect ratio', () => {
    store.camSources = { existing: { ...configuredCamera(), maxResolution: [1280, 720] } };
    store.activeCamId = 'existing';

    confirmSource();

    const changes = store.updateCamSource.mock.calls[0]![1] as Partial<ICamSource>;
    expect(changes.maxResolution).toEqual([1920, 1080]);
    expect(changes.markerPosInCam!.map(p => p.toArray())).toEqual([[150, 150]]);
    expect(changes.calibration).toBeDefined();
    expect(router.navigate).toHaveBeenCalledWith({ to: '/' });
  });

  it('clears resolution-dependent calibration when updating an existing camera at a new resolution', () => {
    store.camSources = { existing: { ...configuredCamera(), maxResolution: [640, 480] } };
    store.activeCamId = 'existing';

    confirmSource();

    expect(store.updateCamSource).toHaveBeenCalledExactlyOnceWith('existing', {
      name: 'Phone camera',
      url: 'webrtc://phone',
      maxResolution: [1920, 1080],
      calibration: undefined,
      extrinsics: undefined,
      markerPosInCam: undefined,
    });
    expect(router.navigate).toHaveBeenCalledWith({ to: '/setup/camera-calibration' });
  });

  it('creates a separate camera when explicitly adding a new source', () => {
    const camera = configuredCamera();
    store.camSources = { existing: camera };
    store.activeCamId = 'existing';
    router.search = { new: true };

    confirmSource();

    expect(store.updateCamSource).not.toHaveBeenCalled();
    expect(store.addCamSource).toHaveBeenCalledExactlyOnceWith('Phone camera', {
      name: 'Phone camera',
      url: 'webrtc://phone',
      maxResolution: [1920, 1080],
    });
  });
});
