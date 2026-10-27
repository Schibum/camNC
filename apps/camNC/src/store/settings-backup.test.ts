import superjson from 'superjson';
import { Box2, Matrix3, Vector2, Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { backupCameras, exportSettingsBackup, parseSettingsBackup, restoreSettingsBackup } from './settings-backup';
import { ICamSource, useStore } from './store';

function camera(name: string): ICamSource {
  return {
    name,
    url: 'go2rtc://192.168.1.5:1984?src=cam',
    maxResolution: [1920, 1080],
    calibration: {
      calibration_matrix: new Matrix3().set(1500, 0, 960, 0, 1500, 540, 0, 0, 1),
      new_camera_matrix: new Matrix3().set(1400, 0, 950, 0, 1400, 530, 0, 0, 1),
      distortion_coefficients: [0.1, -0.2, 0, 0, 0.05],
    },
    extrinsics: { R: new Matrix3().identity(), t: new Vector3(1, 2, 3) },
    markerPosInCam: [new Vector2(100, 200)],
    markerPositions: [new Vector3(0, 0, 0)],
  };
}

describe('settings backup', () => {
  beforeEach(() => {
    useStore.setState({ camSources: {}, activeCamId: null, machine: null, machineBounds: null });
  });

  it('restores cameras with calibration, machine and bounds from an export', () => {
    useStore.setState({
      camSources: { a: camera('Shop cam') },
      activeCamId: 'a',
      machine: { host: 'fluidnc.local' },
      machineBounds: new Box2(new Vector2(0, 0), new Vector2(800, 600)),
    });
    const file = exportSettingsBackup();
    useStore.setState({ camSources: {}, activeCamId: null, machine: null, machineBounds: null });

    const backup = parseSettingsBackup(file);
    expect(backupCameras(backup).map(c => c.name)).toEqual(['Shop cam']);
    restoreSettingsBackup(backup);

    const state = useStore.getState();
    expect(state.activeCamId).toBe('a');
    const cam = state.camSources.a!;
    expect(cam.calibration!.calibration_matrix).toBeInstanceOf(Matrix3);
    expect(cam.calibration!.calibration_matrix.elements).toEqual(camera('x').calibration!.calibration_matrix.elements);
    expect(cam.markerPosInCam![0]).toEqual(new Vector2(100, 200));
    expect(state.machine).toEqual({ host: 'fluidnc.local' });
    expect(state.machineBounds!.max.toArray()).toEqual([800, 600]);
  });

  it('adds a single camera exported from the old Debug page', () => {
    useStore.setState({ camSources: { a: camera('Existing') }, activeCamId: 'a' });

    restoreSettingsBackup(parseSettingsBackup(superjson.stringify(camera('Old export'))));

    const state = useStore.getState();
    expect(Object.values(state.camSources).map(c => c.name)).toEqual(['Existing', 'Old export']);
    expect(state.camSources[state.activeCamId!]!.calibration).toBeDefined();
  });

  it('rejects files that are not a backup', () => {
    expect(() => parseSettingsBackup('not json')).toThrow('not a camNC settings backup');
    expect(() => parseSettingsBackup(superjson.stringify({ foo: 1 }))).toThrow('not a camNC settings backup');
  });
});
