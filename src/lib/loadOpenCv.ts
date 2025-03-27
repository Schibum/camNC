// eslint-disable-next-line unused-imports/no-unused-imports
import type cv from '@techstark/opencv-js';

const OPENCV_JS_URL = 'https://docs.opencv.org/4.x/opencv.js';

declare global {
  interface Window {
    Module: {
      onRuntimeInitialized: () => void;
      [key: string]: any;
    };
    cv: typeof cv;
  }
}

let cvModule: typeof cv;
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
  if (cvModule) return;
  return new Promise((resolve, reject) => {
    // If OpenCV is already loaded, resolve immediately.
    if (window.cv && typeof window.cv.getBuildInformation === 'function') {
      cvModule = window.cv as unknown as typeof cv;
      resolve();
      return;
    } else if (window.cv) {
      window.cv.onRuntimeInitialized = () => {
        cvModule = window.cv as unknown as typeof cv;
        resolve();
      };
      return;
    }

    // Create or use an existing global Module object.
    // Standard Emscripten logic uses Module.onRuntimeInitialized.
    if (!window.Module) {
      window.Module = {
        onRuntimeInitialized: () => {},
      };
    }
    window.Module.onRuntimeInitialized = () => {
      (window.cv as unknown as Promise<typeof cv>).then((module: typeof cv) => {
        cvModule = module;
        // Also export globally. May not be needed
        (window as any).cv = module;
        resolve();
      }, reject);
    };

    // Check if the script tag is already present.
    const existingScript = document.querySelector('script[src*="opencv.js"]');
    if (existingScript) {
      existingScript.addEventListener('error', () => {
        reject(new Error('Failed to load opencv.js'));
      });
      // If the script is already attached, we assume Module.onRuntimeInitialized will handle resolution.
      return;
    }

    // Create and attach the script element.
    const script = document.createElement('script');
    script.async = true;
    script.src = OPENCV_JS_URL;
    script.onerror = () => reject(new Error('Failed to load opencv.js'));
    document.head.appendChild(script);
  });
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

export const cv2 = new Proxy(
  {},
  {
    get: (target, prop) => {
      if (!cvModule) {
        throw new Error('OpenCV is not loaded. Call loadOpenCV() first.');
      }
      return cvModule[prop as keyof typeof cvModule];
    },
  }
) as typeof cv;


