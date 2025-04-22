import { Corner } from "../lib/calibrationTypes";

export interface CornerFinderWorkerInput {
  type: "processFrame";
  messageId: string;
  width: number;
  height: number;
  imageData: ArrayBuffer;
  patternWidth: number;
  patternHeight: number;
}

export interface CornerFinderWorkerOutput {
  type: "cornersFound";
  messageId: string;
  corners: Corner[] | null;
}

// Note: With Comlink, errors are thrown directly rather than returned as part of the response
// This interface is kept for backward compatibility with existing code that might expect it
export interface CornerFinderWorkerOutputError {
  type: "error";
  messageId: string;
  message: string;
}

// This type is kept for backward compatibility
export type CornerFinderWorkerOutputLegacy =
  | CornerFinderWorkerOutput
  | CornerFinderWorkerOutputError;
