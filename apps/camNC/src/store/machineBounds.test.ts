import { Box2, Vector2 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { getMachineBounds, ICamSource, isCameraReady, selectMachineBounds, useStore } from './store';

afterEach(() => {
  useStore.setState({ camSources: {}, activeCamId: null, machineBounds: null });
});

describe('machine bounds', () => {
  it('are set without a camera', () => {
    useStore.getState().setMachineBounds(0, 0, 600, 400);
    expect(getMachineBounds()?.max.toArray()).toEqual([600, 400]);
  });

  it('are also written to the active camera, for builds that still read them there', () => {
    useStore.setState({ camSources: { a: { name: 'Cam', url: 'x', maxResolution: [1, 1] } }, activeCamId: 'a' });
    useStore.getState().setMachineBounds(3, 3, 1223, 2443);
    const cam = useStore.getState().camSources.a!;
    expect(cam.machineBounds?.min.toArray()).toEqual([3, 3]);
    expect(cam.machineBounds?.max.toArray()).toEqual([1223, 2443]);
  });

  it('fall back to the active camera when only it has them', () => {
    const bounds = new Box2(new Vector2(1, 2), new Vector2(3, 4));
    const camSources: Record<string, ICamSource> = { a: { name: 'Cam', url: 'x', maxResolution: [1, 1], machineBounds: bounds } };
    expect(selectMachineBounds({ machineBounds: null, activeCamId: 'a', camSources })).toBe(bounds);
    expect(selectMachineBounds({ machineBounds: null, activeCamId: null, camSources: {} })).toBeNull();
  });

  it("fall back to another camera's, e.g. after adding a camera to a setup from before bounds moved to the machine", () => {
    const bounds = new Box2(new Vector2(3, 3), new Vector2(621, 1241));
    const camSources: Record<string, ICamSource> = {
      old: { name: 'Reolink', url: 'x', maxResolution: [1, 1], machineBounds: bounds },
      added: { name: 'New', url: 'y', maxResolution: [1, 1] },
    };
    expect(selectMachineBounds({ machineBounds: null, activeCamId: 'added', camSources })).toBe(bounds);
  });
});

describe('isCameraReady', () => {
  it('needs a calibrated camera with a pose', () => {
    expect(isCameraReady(null)).toBe(false);
    expect(isCameraReady({ name: 'Cam', url: 'x', maxResolution: [1, 1] })).toBe(false);
  });
});
