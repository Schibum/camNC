import { DepthBlendManager } from '@/depth/depthBlendManager';
import { immerable } from 'immer';
import { Box2, Matrix3, Texture, Vector2, Vector3 } from 'three';
import { create } from 'zustand';
import { combine, persist, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { ParsedToolpath, parseGCode } from '../visualize/gcodeParsing';
import { parseToolInfo } from '../visualize/guess-tools';
import { guessStockHeight } from '../visualize/depthInspection';
import { useMemo } from 'react';
import { createStorage } from './store-storage';
import type { FirmwareVariant } from '@wbcnc/fluidnc';
import { kDefaultMacros, Macro } from '../lib/machine/macros';
import { kSettingsVersion, migrateSettings } from './settingsMigration';

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

// Depth processing runtime settings
export interface DepthSettings {
  frameRateLimit: number; // fps, can be fractional (<1) for seconds-per-frame
  bgMargin: number; // pixels
  renderMargin: number; // pixels
  minMaskVal: number; // threshold for depth mask blending
  thresholdOffset: number; // relative 0-1 offset above table for masking
}

// Types from atoms.tsx
export type ITuple = [number, number];
export type IMachineBounds = [ITuple, ITuple, ITuple, ITuple];

// Should there be a separate type for pending/incomplete source configs?
export interface ICamSource {
  name: string;
  url: string;
  maxResolution: ITuple;
  // Technically machine is independent of source, but multiple cams per machine
  // seems rare enough that we'll store it here for now.
  /** @deprecated Machine bounds belong to the machine, see `machineBounds` in the store. Still written for older builds. */
  machineBounds?: Box2;
  // Position of markers in camera coordinates.
  markerPosInCam?: Vector2[];
  calibration?: CalibrationData;
  extrinsics?: CameraExtrinsics;
  markerPositions?: Vector3[];
  // ArUco marker configuration
  arucoTagSize?: number; // Size in mm of black border (excluding white border)
}

export interface MachineConnectionSettings {
  /** IP address or `.local` name of the controller, optionally with port */
  host: string;
  /** Detected transport, tried first on the next connect */
  variant?: FirmwareVariant;
}

export interface MachinePrefs {
  jogStepXY: number;
  jogStepZ: number;
  jogFeedXY: number;
  jogFeedZ: number;
  keyboardJog: boolean;
  probePlateThickness: number;
  probeMaxTravel: number;
  probeFeed: number;
}

export const kDefaultMachinePrefs: MachinePrefs = {
  jogStepXY: 10,
  jogStepZ: 1,
  // LowRider V4 (JP2_LR): X/Y max 9000 mm/min, Z max 1200 mm/min.
  jogFeedXY: 3000,
  jogFeedZ: 600,
  keyboardJog: false,
  probePlateThickness: 0,
  probeMaxTravel: 50,
  probeFeed: 100,
};

export interface PnPResult {
  lastPnPTime: number;
  lastReprojectionError: number;
}

(Box2 as any)[immerable] = true;
(Vector2 as any)[immerable] = true;
// Should we create slices? see https://github.com/pmndrs/zustand/discussions/2195#discussioncomment-7614103

// prettier-ignore
export const useStore = create(subscribeWithSelector(persist(immer(combine(
  {
    // new, should probably go into a backend instead at some point
    camSources: {} as Record<string, ICamSource>,
    activeCamId: null as string | null,
    /** Usable XY area of the machine in machine coordinates. Known without a camera, e.g. read from FluidNC. */
    machineBounds: null as Box2 | null,

    toolDiameter: 3.0, // Default tool diameter in mm
    toolpath: null as ParsedToolpath | null,
    toolpathName: null as string | null,
    isToolpathSelected: false,
    isToolpathHovered: false,
    isToolpathDragging: false,
    toolpathOffset: new Vector3(0, 0, 0),
    toolpathOpacity: 1,
    stockHeight: 0,
    // After loading another file, where the stock height came from until it is entered or confirmed for that file.
    stockHeightCheck: null as 'previous' | 'guessed' | null,
    // Visualisation toggles
    showMachinePosMarker: true,
    showMachineZero: true,
    showStillFrame: false,
    machine: null as MachineConnectionSettings | null,
    macros: kDefaultMacros as Macro[],
    machinePrefs: kDefaultMachinePrefs as MachinePrefs,
    machinePanelOpen: false,
    snapToToolpath: false,
    snapPosition: null as Vector3 | null,
    // Depth-based background blend feature
    depthBlendEnabled: false,
    // Indicates first-run model load / worker warmup
    depthBlendInitializing: false,
    depthMaskTexture: null as Texture | null,
    depthBgTexture: null as Texture | null,
    // Runtime depth processing settings
    depthSettings: {
      frameRateLimit: 1, // default: one frame every 1s
      bgMargin: 20,
      renderMargin: 5,
      minMaskVal: 0.1,
      thresholdOffset: 0.2,
    } as DepthSettings,
    pnpResult: null as PnPResult | null,
  },
  (set) => ({
    setToolpathOffset: (offset: Vector3) => set(state => {
      state.toolpathOffset = offset;
    }),
    /** Sets the machine bounds, also on the active camera so that builds that keep them there still find them. */
    setMachineBounds: (xmin: number, ymin: number, xmax: number, ymax: number) => set(state => {
      const bounds = new Box2(new Vector2(xmin, ymin), new Vector2(xmax, ymax));
      state.machineBounds = bounds;
      const cam = state.activeCamId ? state.camSources[state.activeCamId] : undefined;
      if (cam) cam.machineBounds = bounds.clone();
    }),
    setShowStillFrame: (show: boolean) => set(state => {
      state.showStillFrame = show;
    }),
    setCamSource: (camSource: ICamSource) => set(state => {
      if (!state.activeCamId) {
        state.activeCamId = crypto.randomUUID();
      }
      state.camSources[state.activeCamId] = camSource;
    }),
    addCamSource: (name: string, camSource: ICamSource) =>
      set(state => {
        const id = crypto.randomUUID();
        state.camSources[id] = { ...camSource, name };
        state.activeCamId = id;
      }),
    /**
     * Update an existing camera source by id. Only provided fields will be updated.
     */
    updateCamSource: (id: string, changes: Partial<ICamSource>) =>
      set(state => {
        if (!state.camSources[id]) return;
        state.camSources[id] = { ...state.camSources[id], ...changes };
      }),
    setActiveCam: (id: string) =>
      set(state => {
        if (state.camSources[id]) {
          state.activeCamId = id;
        }
      }),
    deleteCamSource: (id: string) =>
      set(state => {
        delete state.camSources[id];
        // If we deleted the active cam, set a new active cam or null
        if (state.activeCamId === id) {
          const remainingIds = Object.keys(state.camSources);
          state.activeCamId = remainingIds.length > 0 ? remainingIds[0] : null;
        }
      }),
    camSourceSetters: {
      setCalibration: (calibration: CalibrationData) =>
        set(state => {
          const cam = state.activeCamId
            ? state.camSources[state.activeCamId]
            : undefined;
          if (!cam) throw new Error('configure source first');
          cam.calibration = calibration;
        }),
      setExtrinsics: (extrinsics: CameraExtrinsics) =>
        set(state => {
          const cam = state.activeCamId
            ? state.camSources[state.activeCamId]
            : undefined;
          if (!cam) throw new Error('configure source first');
          cam.extrinsics = extrinsics;
        }),
      setMarkerPosInCam: (points: Vector2[]) =>
        set(state => {
          const cam = state.activeCamId
            ? state.camSources[state.activeCamId]
            : undefined;
          if (!cam) throw new Error('configure source first');
          cam.markerPosInCam = points;
        }),
      setMarkerPositions: (markers: Vector3[]) =>
        set(state => {
          const cam = state.activeCamId
            ? state.camSources[state.activeCamId]
            : undefined;
          if (!cam) throw new Error('configure source first');
          cam.markerPositions = markers;
        }),
      setArucoTagSize: (arucoTagSize: number) =>
        set(state => {
          const cam = state.activeCamId
            ? state.camSources[state.activeCamId]
            : undefined;
          if (!cam) throw new Error('configure source first');
          cam.arucoTagSize = arucoTagSize;
        }),
    },
    setIsToolpathSelected: (isSelected: boolean) => set(state => {
      state.isToolpathSelected = isSelected;
    }),
    setIsToolpathHovered: (isHovered: boolean) => set(state => {
      state.isToolpathHovered = isHovered;
    }),
    setIsToolpathDragging: (isDragging: boolean) => set(state => {
      state.isToolpathDragging = isDragging;
    }),
    setToolDiameter: (diameter: number) => set(state => {
      state.toolDiameter = diameter;
    }),
    setStockHeight: (height: number) => set(state => {
      state.stockHeight = height;
      state.stockHeightCheck = null;
    }),
    confirmStockHeight: () => set(state => {
      state.stockHeightCheck = null;
    }),
    setToolpathOpacity: (opacity: number) =>
      set(state => {
        state.toolpathOpacity = opacity;
      }),
    // Update Toolpath from GCode
    updateToolpath: (gcode: string, name?: string) => set(state => {
      console.log('updateToolpath');
      const toolpath = parseGCode(gcode);
      state.toolpath = toolpath;
      state.toolpathName = name ?? null;
      // The stock height was entered for the previous file: prefill a guess from this one, and have it checked.
      const guess = guessStockHeight(toolpath);
      if (guess !== null) state.stockHeight = guess;
      state.stockHeightCheck = guess !== null ? 'guessed' : 'previous';
      const tools = parseToolInfo(gcode);
      console.debug('guessed tools', tools);
      if (tools.length > 0 && tools[0].isFlat) {
        state.toolDiameter = tools[0].diameter;
      }
    }),
    setMachine: (machine: MachineConnectionSettings | null) => set(state => {
      state.machine = machine;
    }),
    setMachineVariant: (variant: FirmwareVariant) => set(state => {
      if (state.machine) state.machine.variant = variant;
    }),
    setMacros: (macros: Macro[]) => set(state => {
      state.macros = macros;
    }),
    setMachinePanelOpen: (open: boolean) => set(state => {
      state.machinePanelOpen = open;
    }),
    setMachinePrefs: (prefs: Partial<MachinePrefs>) => set(state => {
      state.machinePrefs = { ...state.machinePrefs, ...prefs };
    }),
    setSnapToToolpath: (enable: boolean) => set(state => {
      state.snapToToolpath = enable;
    }),
    setSnapPosition: (pos: Vector3 | null) => set(state => {
      state.snapPosition = pos;
    }),
    // Depth blend feature setters
    setDepthBlendEnabled: (enabled: boolean) => {
      set(state => {
        state.depthBlendEnabled = enabled;
        // When enabling, assume initializing until first textures arrive
        if (enabled) state.depthBlendInitializing = true;
        else state.depthBlendInitializing = false;
      });

      // Handle manager lifecycle
      if (!enabled) {
        DepthBlendManager.getInstance().stop();
      }
    },
    setDepthBlendInitializing: (initializing: boolean) =>
      set(state => {
        state.depthBlendInitializing = initializing;
      }),
    setDepthMaskTexture: (tex: Texture | null) => set(state => {
      state.depthMaskTexture = tex as any;
    }),
    setDepthBgTexture: (tex: Texture | null) => set(state => {
      state.depthBgTexture = tex as any;
    }),
    // Depth settings
    setDepthSettings: (settings: Partial<DepthSettings>) => set(state => {
      state.depthSettings = { ...state.depthSettings, ...settings } as DepthSettings;
    }),
    // Visualisation toggle setters
    setShowMachinePosMarker: (show: boolean) => set(state => {
      state.showMachinePosMarker = show;
    }),
    setShowMachineZero: (show: boolean) => set(state => {
      state.showMachineZero = show;
    }),
    setPnPResult: (time: number, error: number) => set(state => {
      state.pnpResult = { lastPnPTime: time, lastReprojectionError: error };
    }),
  })
)), {
  name: 'settings',
  version: kSettingsVersion,
  // skipHydration: true,
  storage: createStorage(),
  migrate: migrateSettings,
  partialize: state => ({
    toolDiameter: state.toolDiameter,
    camSources: state.camSources,
    activeCamId: state.activeCamId,
    machineBounds: state.machineBounds,
    machine: state.machine,
    macros: state.macros,
    machinePrefs: state.machinePrefs,
    machinePanelOpen: state.machinePanelOpen,
    depthBlendEnabled: state.depthBlendEnabled,
    depthSettings: state.depthSettings,
    toolpathOpacity: state.toolpathOpacity,
    pnpResult: state.pnpResult,
  }),
})));

export const useCamSource = () => useStore(state => (state.activeCamId ? state.camSources[state.activeCamId] : null));

export const useVideoUrl = () => {
  const camSource = useCamSource();
  return camSource?.url ?? '';
};

export const useCalibrationData = () => {
  const camSource = useCamSource();
  return camSource?.calibration ?? (null as unknown as CalibrationData);
};

export const useNewCameraMatrix = () => {
  const camSource = useCamSource();
  return camSource?.calibration?.new_camera_matrix ?? (null as unknown as Matrix3);
};

// Returns the resolution of the camera source. Throws if no source is configured.
export const useCamResolution = () => {
  const camSource = useCamSource();
  return camSource?.maxResolution ?? ([0, 0] as ITuple);
};

// Access tool diameter from store
export const useToolDiameter = () => useStore(state => state.toolDiameter);
export const useSetToolDiameter = () => useStore(state => state.setToolDiameter);
export const useToolpathOpacity = () => useStore(state => state.toolpathOpacity);
export const useSetToolpathOpacity = () => useStore(state => state.setToolpathOpacity);
export const useSetIsToolpathDragging = () => useStore(state => state.setIsToolpathDragging);
export const useIsToolpathHovered = () => useStore(state => state.isToolpathHovered || state.isToolpathDragging);

type StoreState = ReturnType<typeof useStore.getState>;

/**
 * The machine bounds. Settings saved before they moved to the machine only have them on a camera: the active camera's
 * are used, else any camera's, since all cameras look at the same machine.
 */
export function selectMachineBounds(state: Pick<StoreState, 'machineBounds' | 'camSources' | 'activeCamId'>): Box2 | null {
  if (state.machineBounds) return state.machineBounds;
  const active = state.activeCamId ? state.camSources[state.activeCamId]?.machineBounds : undefined;
  return active ?? Object.values(state.camSources).find(cam => cam.machineBounds)?.machineBounds ?? null;
}

export function getMachineBounds() {
  return selectMachineBounds(useStore.getState());
}

/** The machine bounds, or `null` while they are not set up. */
export const useMachineBoundsOrNull = () => useStore(selectMachineBounds);

/** Whether the active camera is set up far enough to map its video onto the machine. */
export function isCameraReady(camSource: ICamSource | null | undefined) {
  return !!camSource?.url && !!camSource.calibration && !!camSource.extrinsics;
}

export const useIsCameraReady = () => useStore(state => isCameraReady(state.activeCamId ? state.camSources[state.activeCamId] : null));

/** The usable machine area in machine coordinates (mm). Bounds may be negative, e.g. when homing in positive direction with mpos 0. */
export function useMachineBounds(): Box2 {
  const bounds = useMachineBoundsOrNull();
  if (!bounds) {
    throw new Error('Machine bounds not set');
  }
  return bounds;
}

// Returns the usable size of the machine boundary in mm [xrange, yrange].
// Computed as xmax - xmin, ymax - ymin.
export function useMachineSize() {
  const bounds = useMachineBounds();
  // Memoized so that consumers using it as an effect/memo dependency only update when the bounds change.
  return useMemo(() => bounds.getSize(new Vector2()), [bounds]);
}

/** Center of the usable machine area in machine coordinates (mm). */
export function useMachineCenter() {
  const bounds = useMachineBounds();
  return useMemo(() => bounds.getCenter(new Vector2()), [bounds]);
}

export const useCameraExtrinsics = () => {
  const camSource = useCamSource();
  return camSource?.extrinsics ?? (null as unknown as CameraExtrinsics);
};

export const useSetCameraExtrinsics = () => useStore(state => state.camSourceSetters.setExtrinsics);
export const usePnPResult = () => useStore(state => state.pnpResult);

export const useShowStillFrame = () => useStore(state => state.showStillFrame);
export const useSetShowStillFrame = () => useStore(state => state.setShowStillFrame);

// Hook to access marker positions
export const useMarkerPositions = () => {
  const camSource = useCamSource();
  return camSource?.markerPositions ?? [];
};

// Hook to set marker positions
export const useSetMarkerPositions = () => useStore(state => state.camSourceSetters.setMarkerPositions);

// Hooks for ArUco configuration
export const useArucoTagSize = () => {
  const camSource = useCamSource();
  return camSource?.arucoTagSize ?? 30;
};

export const useSetArucoTagSize = () => useStore(state => state.camSourceSetters.setArucoTagSize);

export const useToolpath = () => useStore(state => state.toolpath);
export const useHasToolpath = () => useToolpath() !== null;

// Depth blend feature hooks
export const useDepthBlendEnabled = () => useStore(state => state.depthBlendEnabled);
export const useSetDepthBlendEnabled = () => useStore(state => state.setDepthBlendEnabled);
export const useDepthBlendInitializing = () => useStore(state => state.depthBlendInitializing);
export const useSetDepthBlendInitializing = () => useStore(state => state.setDepthBlendInitializing);
export const useMaskTexture = () => useStore(state => state.depthMaskTexture as Texture | null);
export const useBgTexture = () => useStore(state => state.depthBgTexture as Texture | null);
export const useSetMaskTexture = () => useStore(state => state.setDepthMaskTexture);
export const useSetBgTexture = () => useStore(state => state.setDepthBgTexture);

// Depth runtime settings hooks
export const useDepthSettings = () => useStore(state => state.depthSettings as DepthSettings);
export const useSetDepthSettings = () => useStore(state => state.setDepthSettings);

// Visualization toggle hooks
export const useShowMachinePosMarker = () => useStore(state => state.showMachinePosMarker);
export const useSetShowMachinePosMarker = () => useStore(state => state.setShowMachinePosMarker);
export const useShowMachineZero = () => useStore(state => state.showMachineZero);
export const useSetShowMachineZero = () => useStore(state => state.setShowMachineZero);
export const useSnapToToolpath = () => useStore(state => state.snapToToolpath);
export const useSetSnapToToolpath = () => useStore(state => state.setSnapToToolpath);
export const useSnapPosition = () => useStore(state => state.snapPosition);
export const useSetSnapPosition = () => useStore(state => state.setSnapPosition);

export function getActiveCamSource(): ICamSource | null {
  const state = useStore.getState();
  if (!state.activeCamId) return null;
  return state.camSources[state.activeCamId] ?? null;
}

// Additional utility hooks for working with multiple camera sources
export const useAllCamSources = () => useStore(state => state.camSources);
export const useActiveCamId = () => useStore(state => state.activeCamId);

export const useSetActiveCam = () => useStore(state => state.setActiveCam);
