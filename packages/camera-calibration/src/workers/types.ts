import { Corner } from "../lib/calibrationTypes";

export interface CornerFinderWorkerInput {
  width: number;
  height: number;
  imageData: ArrayBuffer;
  patternWidth: number;
  patternHeight: number;
}

export interface CornerFinderWorkerOutput {
  corners: Corner[] | null;
  isBlurry: boolean;
  isUnique: boolean;
}

// Note: With Comlink, errors are thrown directly rather than returned as part of the response
// This interface is kept for backward compatibility with existing code that might expect it
export interface CornerFinderWorkerOutputError {
  type: "error";
  message: string;
}

// This type is kept for backward compatibility
export type CornerFinderWorkerOutputLegacy =
  | CornerFinderWorkerOutput
  | CornerFinderWorkerOutputError;
