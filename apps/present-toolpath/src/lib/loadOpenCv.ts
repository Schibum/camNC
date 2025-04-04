// eslint-disable-next-line unused-imports/no-unused-imports
import type cv from '@techstark/opencv-js';

const win = window as any;
async function loadOpenCv() {
  const _cv = await (await import(/* @vite-ignore */ location.origin + '/opencv_js.js')).default() as typeof cv;
  win.cv = _cv;
}

let _ensureOpenCvIsLoadedPromise: Promise<void>;

// Always return the same promise object to allow passing it to react use()
export function ensureOpenCvIsLoaded() {
  if (_ensureOpenCvIsLoadedPromise) {
    return _ensureOpenCvIsLoadedPromise;
  }
  _ensureOpenCvIsLoadedPromise = _ensureOpenCvIsLoaded();
  return _ensureOpenCvIsLoadedPromise;
}

// Npm import does not work well with vite, so load it globally and just use types
async function _ensureOpenCvIsLoaded(): Promise<void> {
  if (win.cv) return;
  await loadOpenCv();
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace cv2 {
  export type Mat = cv.Mat;
  export type Point = cv.Point;
  export type Size = cv.Size;
  export type Rect = cv.Rect;
  export type Scalar = cv.Scalar;
  // ... add other commonly used types as needed
}

// export const cv2 = win.cv as typeof cv;
export const cv2 = new Proxy(
  {},
  {
    get: (target, prop) => {
      if (!win.cv) {
        throw new Error('OpenCV is not loaded. Call ensureOpenCvIsLoaded() first.');
      }
      return win.cv[prop as keyof typeof cv];
    },
  }
) as typeof cv;

