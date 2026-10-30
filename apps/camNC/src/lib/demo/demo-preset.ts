import type { ICamSource } from '@/store/store';
import { useStore } from '@/store/store';
import { Box2, Matrix3, Vector2, Vector3 } from 'three';
import { demoGcode, kDemoGcodeName } from './demo-gcode';

/** Where the recorded demo camera clip is served. */
export const kDemoVideoPath = '/demo/demo-clip.mp4';
/** Hostname of the simulated controller, see DemoFluidnc. */
export const kDemoMachineHost = 'demo-machine.local';
/** Z of the stock top above the table, matching the demo job. */
const kDemoStockHeight = 12;

/**
 * Calibration of the camera that recorded the demo clip (a fixed camera above a LowRider bed with
 * four ArUco markers), solved once with camNC. The clip is the 2560 × 1920 original scaled to
 * 1280 × 960, so the pixel values are halved; the camera pose does not depend on resolution.
 */
function demoCamSource(origin: string): ICamSource {
  return {
    name: 'Demo camera',
    url: new URL(kDemoVideoPath, origin).href,
    maxResolution: [1280, 960],
    machineBounds: new Box2(new Vector2(3, 3), new Vector2(621, 1241)),
    arucoTagSize: 30,
    calibration: {
      calibration_matrix: new Matrix3().fromArray([1318.400745, 0, 0, 0, 1317.714788, 0, 702.108745, 469.165494, 1]),
      new_camera_matrix: new Matrix3().fromArray([1172.21601, 0, 0, 0, 1205.451526, 0, 712.919054, 469.68575, 1]),
      distortion_coefficients: [
        -0.36958973842879395, 0.18368290987517752, 0.001894571316303358, -0.0017792211167451026, -0.05816631578813239,
      ],
    },
    extrinsics: {
      R: new Matrix3().fromArray([
        0.05416229778339532, 0.9981897779570481, -0.02614598785438438, 0.9984604038681006, -0.053825963545188205, 0.013401028168806714,
        0.011969436343114297, -0.02683156407090167, -0.9995683067020168,
      ]),
      t: new Vector3(-717.7300199429044, -218.38845703147604, 1210.707993247312),
    },
    markerPositions: [new Vector3(23, 23, -3.2), new Vector3(23, 1203, -3.2), new Vector3(563, 1203, -3.2), new Vector3(563, 23, -3.2)],
    markerPosInCam: [
      [57.33, 258.75],
      [58.5, 287.86],
      [29.94, 289.43],
      [28.83, 260.47],
      [1188.5, 199.01],
      [1190.22, 227.63],
      [1162.23, 229.01],
      [1160.37, 200.27],
      [1221.22, 730.9],
      [1222.67, 760.54],
      [1194.5, 762.12],
      [1192.78, 732.79],
      [76.95, 798.65],
      [80.0, 829.0],
      [49.16, 830.24],
      [47.92, 800.52],
    ].map(([x, y]) => new Vector2(x, y)),
  };
}

/** Fill the store with the demo machine, camera (unless `camera` is false) and job. Nothing here is ever persisted. */
export function applyDemoPreset(origin = location.origin, { camera = true } = {}) {
  const id = 'demo-camera';
  const camSource = demoCamSource(origin);
  useStore.setState({
    camSources: camera ? { [id]: camSource } : {},
    activeCamId: camera ? id : null,
    machineBounds: camSource.machineBounds!.clone(),
    machine: { host: kDemoMachineHost, variant: 'v4' },
  });
  useStore.getState().updateToolpath(demoGcode(), kDemoGcodeName);
  useStore.setState({ toolDiameter: 6, stockHeight: kDemoStockHeight, stockHeightCheck: null });
}
