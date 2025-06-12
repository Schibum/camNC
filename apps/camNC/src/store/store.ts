import { immerable } from 'immer';
import superjson from 'superjson';
import { Box2, Matrix3, Vector2, Vector3 } from 'three';
import { create, ExtractState } from 'zustand';
import { combine, devtools, persist, PersistStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/react/shallow';
import { ParsedToolpath, parseGCode } from '../visualize/gcodeParsing';
import { parseToolInfo } from '../visualize/guess-tools';

export interface CalibrationData {
  calibration_matrix: Matrix3;
  new_camera_matrix: Matrix3;
  distortion_coefficients: number[];
}

// World (machine coords) to physical camera transform
export interface CameraExtrinsics {
  R: Matrix3;
  t: Vector3;
}

// Types from atoms.tsx
export type ITuple = [number, number];
export type IMachineBounds = [ITuple, ITuple, ITuple, ITuple];

// Should there be a separate type for pending/incomplete source configs?
export interface ICamSource {
  url: string;
  maxResolution: ITuple;
  // Technically machine is independent of source, but multiple cams per machine
  // seems rare enough that we'll store it here for now.
  machineBounds?: Box2;
  // Position of markers in camera coordinates.
  markerPosInCam?: Vector2[];
  calibration?: CalibrationData;
  extrinsics?: CameraExtrinsics;
  markerPositions?: Vector3[];
  // ArUco marker configuration
  useArucoMarkers?: boolean;
  arucoTagSize?: number; // Size in mm of black border (excluding white border)
}

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
superjson.registerCustom<Matrix3, number[]>(
  {
    isApplicable: value => value instanceof Matrix3,
    serialize: value => value.toArray(),
    deserialize: value => new Matrix3().fromArray(value),
  },
  'Matrix3'
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

type TStore = ExtractState<typeof useStore>;

// prettier-ignore
export const useStore = create(devtools(persist(immer(combine(
  {
    // new, should probably go into a backend instead at some point
    camSource: null as ICamSource | null,

    toolDiameter: 3.0, // Default tool diameter in mm
    toolpath: null as ParsedToolpath | null,
    isToolpathSelected: false,
    isToolpathHovered: false,
    toolpathOffset: new Vector3(0, 0, 0),
    stockHeight: 0,
    showStillFrame: false,
    fluidncToken: crypto.randomUUID() as string,
  },
  (set, get) => ({
    setToolpathOffset: (offset: Vector3) => set(state => {
      state.toolpathOffset = offset;
    }),
    setShowStillFrame: (show: boolean) => set(state => {
      state.showStillFrame = show;
    }),
    setCamSource: (camSource: ICamSource) => set(state => {
      state.camSource = camSource;
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
      setMachineBounds: (xmin: number, ymin: number, xmax: number, ymax: number) => set(state => {
        if (!state.camSource) throw new Error('configure source first');
        state.camSource.machineBounds = new Box2(new Vector2(xmin, ymin), new Vector2(xmax, ymax));
      }),
      setMachineBoundsInCam: (points: Vector2[]) => set(state => {
        if (!state.camSource) throw new Error('configure source first');
        state.camSource.markerPosInCam = points;
      }),
      setMarkerPositions: (markers: Vector3[]) => set(state => {
        if (!state.camSource) throw new Error('configure source first');
        state.camSource.markerPositions = markers;
      }),
      setArucoConfig: (useArucoMarkers: boolean, arucoTagSize: number) => set(state => {
        if (!state.camSource) throw new Error('configure source first');
        state.camSource.useArucoMarkers = useArucoMarkers;
        state.camSource.arucoTagSize = arucoTagSize;
      }),
    },
    setIsToolpathSelected: (isSelected: boolean) => set(state => {
      state.isToolpathSelected = isSelected;
    }),
    setIsToolpathHovered: (isHovered: boolean) => set(state => {
      state.isToolpathHovered = isHovered;
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
    setFluidncToken: (token: string) => set(state => {
      state.fluidncToken = token;
    }),
  })
)), {
  name: 'settings',
  storage,
  partialize: state => ({
    toolDiameter: state.toolDiameter,
    camSource: state.camSource,
    fluidncToken: state.fluidncToken,
  }),
})));

export const useCamSource = () => useStore(state => state.camSource);
export const useVideoUrl = () => useStore(state => state.camSource!.url);
export const useCalibrationData = () => useStore(state => state.camSource!.calibration!);
export const useNewCameraMatrix = () => useStore(state => state.camSource!.calibration!.new_camera_matrix);
// Returns the resolution of the camera source. Throws if no source is configured.
export const useCamResolution = () => useStore(state => state.camSource!.maxResolution);

// Access tool diameter from store
export const useToolDiameter = () => useStore(state => state.toolDiameter);
export const useSetToolDiameter = () => useStore(state => state.setToolDiameter);

// Returns the usable size of the machine boundary in mm [xrange, yrange].
// Computed as xmax - xmin, ymax - ymin.
export function useMachineSize() {
  const bounds = useStore(state => state.camSource?.machineBounds);
  if (!bounds) {
    throw new Error('Machine bounds not set');
  }
  return bounds.max;
  // return bounds.getSize(new Vector2());
}

export const useCameraExtrinsics = () => useStore(state => state.camSource!.extrinsics!);
export const useSetCameraExtrinsics = () => useStore(state => state.camSourceSetters.setExtrinsics);

export const useShowStillFrame = () => useStore(state => state.showStillFrame);
export const useSetShowStillFrame = () => useStore(state => state.setShowStillFrame);

// Hook to access marker positions
export const useMarkerPositions = () => useStore(state => state.camSource!.markerPositions!);
// Hook to set marker positions
export const useSetMarkerPositions = () => useStore(state => state.camSourceSetters.setMarkerPositions);
// Hooks for ArUco configuration
export const useArucoConfig = () =>
  useStore(
    useShallow(state => ({
      useArucoMarkers: state.camSource?.useArucoMarkers ?? true,
      arucoTagSize: state.camSource?.arucoTagSize ?? 30,
    }))
  );
export const useSetArucoConfig = () => useStore(state => state.camSourceSetters.setArucoConfig);

export const useToolpath = () => useStore(state => state.toolpath);
export const useHasToolpath = () => useToolpath() !== null;
