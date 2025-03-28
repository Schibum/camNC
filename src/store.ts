import { create } from 'zustand';
import { combine, persist, PersistStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { buildMatrix4FromHomography } from './math/perspectiveTransform';
import { computeHomography } from './math/perspectiveTransform';
import { Matrix4, Vector3, Box2, Vector2, Matrix3 } from 'three';
import { ParsedToolpath, parseGCode } from './visualize/gcodeParsing';
import { parseToolInfo } from './visualize/guess-tools';
import superjson from 'superjson';
import { immerable } from 'immer';
import { devtools } from 'zustand/middleware';

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
export type IBox = [ITuple, ITuple, ITuple, ITuple];

export interface CameraConfig {
  // Streaming URL.
  url: string;
  // Camera resolution.
  dimensions: ITuple;
  // Machine bounds in camera coordinates.
  machineBoundsInCam: IBox;
  // Machine bounds in pixels. (xmin, ymin), (xmax, ymax)
  machineBounds: Box2;
}

// Default calibration data
const defaultCalibrationData: CalibrationData = {
  calibration_matrix: [
    [2009.1973773408529, 0.0, 1390.5190016011748],
    [0.0, 2017.1223458668746, 952.7108080446899],
    [0.0, 0.0, 1.0],
  ],
  // prettier-ignore
  new_camera_matrix: new Matrix3().set(
    1576.70915, 0.0, 1481.05363,
    0.0, 1717.4288, 969.448282,
    0.0, 0.0, 1.0,
  ),
  distortion_coefficients: [[-0.3921598065400269, 0.23211488659159807, 0.0023824662841748097, -0.0004288390281597757, -0.09431940984729748]],
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
    cameraConfig: defaultCameraConfig,
    calibrationData: defaultCalibrationData,
    cameraExtrinsics: defaultExtrinsicParameters,
    toolDiameter: 3.0, // Default tool diameter in mm
    toolpath: null as ParsedToolpath | null,
    isToolpathSelected: false,
    isToolpathHovered: false,
    toolpathOffset: new Vector3(0, 0, 0),
    stockHeight: 0,
  },
  set => ({
    setVideoDimensions: (dimensions: ITuple) => set(state => {
      state.cameraConfig.dimensions = dimensions;
    }),
    setToolpathOffset: (offset: Vector3) => set(state => {
      state.toolpathOffset = offset;
    }),
    setMachineBounds: (bounds: Box2) => set(state => {
      state.cameraConfig.machineBounds = bounds;
    }),
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
    setMachineBoundsInCam: (points: IBox) => set(state => {
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
  }),
})));

export const useVideoSrc = () => useStore(state => state.cameraConfig.url);
export const useVideoDimensions = () => useStore(state => state.cameraConfig.dimensions);

export const useCameraConfig = () => useStore(state => state.cameraConfig);
export const useCalibrationData = () => useStore(state => state.calibrationData);
export const useNewCameraMatrix = () => useStore(state => state.calibrationData.new_camera_matrix);

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
  ] as IBox;
  const H = computeHomography(machineBoundsInCam, dstPoints);
  const M = new Matrix4().fromArray(buildMatrix4FromHomography(H));
  // return M;
  // Add min offset back, since we computed using min values.
  const translate = new Matrix4().makeTranslation(mp.min.x, mp.min.y, 0);
  return translate.multiply(M);
}

export const useCameraExtrinsics = () => useStore(state => state.cameraExtrinsics);
export const useSetCameraExtrinsics = () => useStore(state => state.setCameraExtrinsics);
