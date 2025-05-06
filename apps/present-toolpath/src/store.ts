import { immerable } from 'immer';
import superjson from 'superjson';
import { Box2, Matrix3, Matrix4, Vector2, Vector3 } from 'three';
import { create } from 'zustand';
import { PersistStorage, combine, devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { buildMatrix4FromHomography, computeHomography } from './math/perspectiveTransform';
import { ParsedToolpath, parseGCode } from './visualize/gcodeParsing';
import { parseToolInfo } from './visualize/guess-tools';

export interface CalibrationData {
  calibration_matrix: number[][];
  new_camera_matrix: Matrix3;
  distortion_coefficients: number[][];
}

// World (machine coords) to physical camera transform
export interface CameraExtrinsics {
  R: Matrix3;
  t: Vector3;
}

// Types from atoms.tsx
export type ITuple = [number, number];
export type IMachineBounds = [ITuple, ITuple, ITuple, ITuple];

export interface CameraConfig {
  // Streaming URL.
  url: string;
  // Camera resolution.
  dimensions: ITuple;
  // Machine bounds in camera coordinates.
  machineBoundsInCam: IMachineBounds;
  // Machine bounds in pixels. (xmin, ymin), (xmax, ymax)
  machineBounds: Box2;
}

// Should there be a separate type for pending/incomplete source configs?
export interface ICamSource {
  url: string;
  maxResolution: ITuple;
  // Technically machine is independent of source, but multiple cams per machine
  // seems rare enough that we'll store it here for now.
  machineBounds?: Box2;
  machineBoundsInCam?: IMachineBounds;
  calibration?: CalibrationData;
  extrinsics?: CameraExtrinsics;
}

// Default calibration data
const defaultCalibrationData: CalibrationData = {
  calibration_matrix: [
    [2603.1886705430834, 0, 1379.8366938339807],
    [0, 2604.6310069784477, 1003.6132669610694],
    [0, 0, 1],
  ],
  // prettier-ignore
  new_camera_matrix: new Matrix3().set(
    2330.8340077175203,
    0,
    1403.629660654684,
    0,
    2433.357886188569,
    1007.2455961471092,
    0,
    0,
    1
  ),
  distortion_coefficients: [[-0.3829847540404848, 0.22402397713785682, -0.00102448788321063, 0.0005674913681331104, -0.09251835726272765]],
};

const defaultCameraConfig: CameraConfig = {
  url: 'http://localhost:5173/calib_vid_trimmed.mp4',
  machineBoundsInCam: [
    [775.2407626853826, 387.8188510252899],
    [
      1519.2067250840014,

      337.45285514244796,
    ],

    [2179.481105806898, 1458.6055639831977],
    [713.8957172275411, 1657.8738581807893],
  ],
  dimensions: [2560, 1920],
  machineBounds: new Box2(new Vector2(0, 0), new Vector2(625, 1235)),
};

const defaultExtrinsicParameters: CameraExtrinsics = {
  R: new Matrix3().set(-0.97566293, 0.21532301, 0.04144691, 0.11512022, 0.66386443, -0.73893934, -0.18662577, -0.71618435, -0.67249595),
  // R.copy(new Matrix3().identity());
  t: new Vector3(94.45499514, -537.61861834, 1674.35779694),
};

superjson.registerCustom<Box2, { min: number[]; max: number[] }>(
  {
    isApplicable: value => value instanceof Box2,
    serialize: value => ({ min: value.min.toArray(), max: value.max.toArray() }),
    deserialize: value => new Box2(new Vector2().fromArray(value.min), new Vector2().fromArray(value.max)),
  },
  'Box2'
);
superjson.registerCustom<Vector2, number[]>(
  {
    isApplicable: value => value instanceof Vector2,
    serialize: value => value.toArray(),
    deserialize: value => new Vector2().fromArray(value),
  },
  'Vector2'
);
superjson.registerCustom<Vector3, number[]>(
  {
    isApplicable: value => value instanceof Vector3,
    serialize: value => value.toArray(),
    deserialize: value => new Vector3().fromArray(value),
  },
  'Vector3'
);

const storage: PersistStorage<unknown> = {
  getItem: name => {
    const str = localStorage.getItem(name);
    if (!str) return null;
    return superjson.parse(str);
  },
  setItem: (name, value) => {
    localStorage.setItem(name, superjson.stringify(value));
  },
  removeItem: name => localStorage.removeItem(name),
};

(Box2 as any)[immerable] = true;
(Vector2 as any)[immerable] = true;
// Should we create slices? see https://github.com/pmndrs/zustand/discussions/2195#discussioncomment-7614103

// prettier-ignore
export const useStore = create(devtools(persist(immer(combine(
  {
    // old
    cameraConfig: defaultCameraConfig,
    calibrationData: defaultCalibrationData,
    cameraExtrinsics: defaultExtrinsicParameters,
    // new, should probably go into a backend instead at some point
    camSource: null as ICamSource | null,

    toolDiameter: 3.0, // Default tool diameter in mm
    toolpath: null as ParsedToolpath | null,
    isToolpathSelected: false,
    isToolpathHovered: false,
    toolpathOffset: new Vector3(0, 0, 0),
    stockHeight: 0,
    showStillFrame: false,
  },
  set => ({
    setCalibrationData: (data: CalibrationData) => set(state => {
      state.calibrationData = data;
    }),
    setVideoDimensions: (dimensions: ITuple) => set(state => {
      state.cameraConfig.dimensions = dimensions;
    }),
    setToolpathOffset: (offset: Vector3) => set(state => {
      state.toolpathOffset = offset;
    }),
    setMachineBounds: (bounds: Box2) => set(state => {
      state.cameraConfig.machineBounds = bounds;
    }),
    setShowStillFrame: (show: boolean) => set(state => {
      state.showStillFrame = show;
    }),
    camSourceSetters: {
      setSource: (url: string, maxResolution: ITuple) => set(state => {
        state.camSource = { ...state.camSource, url, maxResolution};
      }),
      setCalibration: (calibration: CalibrationData) => set(state => {
        if (!state.camSource) throw new Error('configure source first');
        state.camSource.calibration = calibration;
      }),
      setExtrinsics: (extrinsics: CameraExtrinsics) => set(state => {
        if (!state.camSource) throw new Error('configure source first');
        state.camSource.extrinsics = extrinsics;
      }),
      setMachineBounds: (bounds: Box2) => set(state => {
        if (!state.camSource) throw new Error('configure source first');
        state.camSource.machineBounds = bounds;
      }),
      setMachineBoundsInCam: (points: IMachineBounds) => set(state => {
        if (!state.camSource) throw new Error('configure source first');
        state.camSource.machineBoundsInCam = points;
      }),
    },
    machineBoundsSetters: {
      setXMin: (xMin: number) => set(state => {
        state.cameraConfig.machineBounds.min.x = xMin;
      }),
      setXMax: (xMax: number) => set(state => {
        state.cameraConfig.machineBounds.max.x = xMax;
      }),
      setYMin: (yMin: number) => set(state => {
        state.cameraConfig.machineBounds.min.y = yMin;
      }),
      setYMax: (yMax: number) => set(state => {
        state.cameraConfig.machineBounds.max.y = yMax;
      }),
    },
    setIsToolpathSelected: (isSelected: boolean) => set(state => {
      state.isToolpathSelected = isSelected;
    }),
    setIsToolpathHovered: (isHovered: boolean) => set(state => {
      state.isToolpathHovered = isHovered;
    }),
    setCameraExtrinsics: (extrinsics: CameraExtrinsics) => set(state => {
      state.cameraExtrinsics = extrinsics;
    }),
    setVideoSrc: (src: string) => set(state => {
      state.cameraConfig.url = src;
    }),
    setMachineBoundsInCam: (points: IMachineBounds) => set(state => {
      state.cameraConfig.machineBoundsInCam = points;
    }),
    setCameraConfig: (config: CameraConfig) => set(state => {
      state.cameraConfig = config;
    }),
    setToolDiameter: (diameter: number) => set(state => {
      state.toolDiameter = diameter;
    }),
    setStockHeight: (height: number) => set(state => {
      state.stockHeight = height;
    }),
    // Update Toolpath from GCode
    updateToolpath: (gcode: string) => set(state => {
      console.log('updateToolpath');
      state.toolpath = parseGCode(gcode);
      const tools = parseToolInfo(gcode);
      console.debug('guessed tools', tools);
      if (tools.length > 0 && tools[0].isFlat) {
        state.toolDiameter = tools[0].diameter;
      }
    }),
  })
)), {
  name: 'settings',
  storage,
  partialize: state => ({
    cameraConfig: state.cameraConfig,
    toolDiameter: state.toolDiameter,
    cameraExtrinsics: state.cameraExtrinsics,
    camSource: state.camSource,
  }),
})));

// old
export const useVideoSrc = () => useStore(state => state.cameraConfig.url);
export const useVideoDimensions = () => useStore(state => state.cameraConfig.dimensions);

export const useCameraConfig = () => useStore(state => state.cameraConfig);
export const useCalibrationData = () => useStore(state => state.calibrationData);
export const useNewCameraMatrix = () => useStore(state => state.calibrationData.new_camera_matrix);
// new
export const useCamSource = () => useStore(state => state.camSource);
// Returns the resolution of the camera source. Throws if no source is configured.
export const useCamResolution = () => useStore(state => state.camSource!.maxResolution);

// Access tool diameter from store
export const useToolDiameter = () => useStore(state => state.toolDiameter);
export const useSetToolDiameter = () => useStore(state => state.setToolDiameter);

// Returns the usable size of the machine boundary in mm [xrange, yrange].
// Computed as xmax - xmin, ymax - ymin.
export function useMachineSize() {
  const bounds = useStore(state => state.cameraConfig.machineBounds);
  return bounds.getSize(new Vector2());
}

/**
 * Returns the homography matrix that maps video coordinates to machine coordinates.
 * This is used to flatten the video to the machine plane.
 */
export function useVideoToMachineHomography() {
  const machineBoundsInCam = useStore(state => state.cameraConfig.machineBoundsInCam);
  const mp = useStore(state => state.cameraConfig.machineBounds);
  const dstPoints = [
    [mp.min.x, mp.min.y], // xmin, ymin
    [mp.min.x, mp.max.y], // xmin, ymax
    [mp.max.x, mp.max.y], // xmax, ymax
    [mp.max.x, mp.min.y], // xmax, ymin
  ] as IMachineBounds;
  const H = computeHomography(machineBoundsInCam, dstPoints);
  const M = new Matrix4().fromArray(buildMatrix4FromHomography(H));
  // return M;
  // Add min offset back, since we computed using min values.
  const translate = new Matrix4().makeTranslation(mp.min.x, mp.min.y, 0);
  return translate.multiply(M);
}

export const useCameraExtrinsics = () => useStore(state => state.cameraExtrinsics);
export const useSetCameraExtrinsics = () => useStore(state => state.setCameraExtrinsics);

export const useShowStillFrame = () => useStore(state => state.showStillFrame);
export const useSetShowStillFrame = () => useStore(state => state.setShowStillFrame);
