import { atom, getDefaultStore } from "jotai";

const atomWithLocalStorage = <T,>(key: string, initialValue: T) => {
  const getInitialValue = () => {
    const item = localStorage.getItem(key)
    if (item !== null) {
      return JSON.parse(item) as T
    }
    return initialValue
  }
  const baseAtom = atom<T>(getInitialValue())
  const derivedAtom = atom(
    (get) => get(baseAtom),
    (get, set, update: T | ((prev: T) => T)) => {
      const nextValue =
        typeof update === 'function' ? (update as (prev: T) => T)(get(baseAtom)) : update
      set(baseAtom, nextValue)
      localStorage.setItem(key, JSON.stringify(nextValue))
    },
  )
  return derivedAtom
}


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

export const cameraConfigAtom = atomWithLocalStorage<CameraConfig|null>('camConfig', null);
// export const camDimensions = atom<[number, number]>();
// export const machineBoundsInCam = atomWithStorage<Box|undefined>('machineBoundsInCam', undefined)
// // [xmin, ymin], [xmax, ymax]
// export const machineBounds = atom<[Point, Point]>([[0, 0], [625, 1235]]);
