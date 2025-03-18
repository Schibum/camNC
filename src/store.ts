import { create } from 'zustand';
import { combine, persist, PersistStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { buildMatrix4FromHomography } from './math/perspectiveTransform';
import { computeHomography } from './math/perspectiveTransform';
import { Matrix4, Vector3, Box2, Vector2 } from 'three';
import { ParsedToolpath, parseGCode } from './visualize/gcodeParsing';
import { parseToolInfo } from './visualize/guess-tools';
import superjson from 'superjson';

export interface CalibrationData {
  calibration_matrix: number[][];
  distortion_coefficients: number[][];
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

// Should we create slices? see https://github.com/pmndrs/zustand/discussions/2195#discussioncomment-7614103

// prettier-ignore
export const useStore = create(persist(immer(combine(
  {
    cameraConfig: defaultCameraConfig,
    calibrationData: defaultCalibrationData,
    toolDiameter: 3.0, // Default tool diameter in mm
    toolpath: null as ParsedToolpath | null,
    isToolpathSelected: false,
    isToolpathHovered: false,
    toolpathOffset: new Vector3(0, 0, 0),
  },
  set => ({
    setVideoDimensions: (dimensions: ITuple) => set(state => {
      state.cameraConfig.dimensions = dimensions;
    }),
    setToolpathOffset: (offset: Vector3) => set(state => {
      state.toolpathOffset = offset;
    }),
    setIsToolpathSelected: (isSelected: boolean) => set(state => {
      state.isToolpathSelected = isSelected;
    }),
    setIsToolpathHovered: (isHovered: boolean) => set(state => {
      state.isToolpathHovered = isHovered;
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
    // Update Toolpath from GCode
    updateToolpath: (gcode: string) => set(state => {

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
  }),
}));

console.log('useStore', useStore.getState());

export const useVideoSrc = () => useStore(state => state.cameraConfig.url);
export const useVideoDimensions = () => useStore(state => state.cameraConfig.dimensions);

export const useCameraConfig = () => useStore(state => state.cameraConfig);
export const useCalibrationData = () => useStore(state => state.calibrationData);

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
  return M;
}

// Transformation to scale machine bounds full-size ()
function machineToViewTransform() {}
