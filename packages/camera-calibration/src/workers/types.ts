import { Corner } from '../lib/calibrationTypes';

export interface CornerFinderWorkerInput {
  type: 'processFrame';
  messageId: string;
  width: number;
  height: number;
  imageData: ArrayBuffer;
  patternWidth: number;
  patternHeight: number;
}

export interface CornerFinderWorkerOutputSuccess {
  type: 'cornersFound';
  messageId: string;
  corners: Corner[] | null;
}

export interface CornerFinderWorkerOutputError {
  type: 'error';
  messageId: string;
  message: string;
}

export type CornerFinderWorkerOutput = CornerFinderWorkerOutputSuccess | CornerFinderWorkerOutputError;