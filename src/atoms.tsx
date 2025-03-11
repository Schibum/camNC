import { atom } from 'jotai';
import { CalibrationData } from './calibration/undistort';
const atomWithLocalStorage = <T,>(key: string, initialValue: T) => {
  const getInitialValue = () => {
    const item = localStorage.getItem(key);
    if (item !== null) {
      return JSON.parse(item) as T;
    }
    return initialValue;
  };
  const baseAtom = atom<T>(getInitialValue());
  const derivedAtom = atom(
    get => get(baseAtom),
    (get, set, update: T | ((prev: T) => T)) => {
      const nextValue =
        typeof update === 'function' ? (update as (prev: T) => T)(get(baseAtom)) : update;
      set(baseAtom, nextValue);
      localStorage.setItem(key, JSON.stringify(nextValue));
    }
  );
  return derivedAtom;
};

export type IPoint = [number, number];
export type IBox = [IPoint, IPoint, IPoint, IPoint];

interface CameraConfig {
  // Streaming URL.
  url: string;
  // Camera resolution.
  dimensions: [number, number];
  // Machine bounds in camera coordinates.
  machineBoundsInCam: IBox;
  // Machine bounds in pixels. (xmin, ymin), (xmax, ymax)
  machineBounds: [IPoint, IPoint];
}

// Calibration data
const calibrationData = {
  calibration_matrix: [
    [2009.1973773408529, 0.0, 1390.5190016011748],
    [0.0, 2017.1223458668746, 952.7108080446899],
    [0.0, 0.0, 1.0],
  ],
  distortion_coefficients: [
    [
      -0.3921598065400269, 0.23211488659159807, 0.0023824662841748097, -0.0004288390281597757,
      -0.09431940984729748,
    ],
  ],
};
export const cameraConfigAtom = atomWithLocalStorage<CameraConfig | null>('camConfig', null);
export const calibrationDataAtom = atom<CalibrationData>(calibrationData);

export const videoSrcAtom = atom(
  get => {
    const cameraConfig = get(cameraConfigAtom);
    if (cameraConfig) {
      return cameraConfig.url;
    }
    return '';
  },
  (get, set, update: string) => {
    set(cameraConfigAtom, cfg => {
      if (!cfg) throw new Error('Camera config not set');
      return { ...cfg, url: update };
    });
  }
);
// export const camDimensions = atom<[number, number]>();
// export const machineBoundsInCam = atomWithStorage<Box|undefined>('machineBoundsInCam', undefined)
// // [xmin, ymin], [xmax, ymax]
// export const machineBounds = atom<[Point, Point]>([[0, 0], [625, 1235]]);
