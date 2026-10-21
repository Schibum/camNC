import type * as cv from '@techstark/opencv-js';

const win = globalThis as any;
async function loadOpenCv() {
  const _cv = (await (await import(/* @vite-ignore */ location.origin + '/opencv_js.js')).default()) as typeof cv;
  win.cv = _cv;
}

let _ensureOpenCvIsLoadedPromise: Promise<void> | null = null;

// Always return the same promise object to allow passing it to react use()
export function ensureOpenCvIsLoaded() {
  if (_ensureOpenCvIsLoadedPromise) {
    return _ensureOpenCvIsLoadedPromise;
  }
  const promise = _ensureOpenCvIsLoaded().catch(err => {
    // Allow retrying after e.g. a network error instead of caching the failure forever.
    if (_ensureOpenCvIsLoadedPromise === promise) _ensureOpenCvIsLoadedPromise = null;
    throw err;
  });
  _ensureOpenCvIsLoadedPromise = promise;
  return promise;
}

// Npm import does not work well with vite, so load it globally and just use types
async function _ensureOpenCvIsLoaded() {
  if (win.cv) return;
  await loadOpenCv();
}

// Hack until we've a better way to re-export namespace.
export namespace cv2 {
  export type AdaptiveThresholdTypes = cv.AdaptiveThresholdTypes;
  export type Mat = cv.Mat;
  export type Point = cv.Point;
  export type Size = cv.Size;
  export type Rect = cv.Rect;
  export type Scalar = cv.Scalar;
  // ... add other commonly used types as needed

  // export type * from '@techstark/opencv-js'
}

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
