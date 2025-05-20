import * as Comlink from "comlink";
import { api } from "../workers/calibrate.worker";
import {
  CalibrationResult,
  CapturedFrame,
  PatternSize,
} from "./calibrationTypes";

export class CalibrateInWorker {
  readonly worker: Worker;
  private readonly workerProxy: Comlink.Remote<typeof api>;
  private isInitialized = false;

  constructor() {
    this.worker = new Worker(
      new URL("../workers/calibrate.worker.ts", import.meta.url),
      { type: "module" }
    );
    this.workerProxy = Comlink.wrap(this.worker);
  }

  async calibrate(
    capturedFrames: CapturedFrame[],
    patternSize: PatternSize,
    frameSize: { width: number; height: number },
    squareSize: number
  ): Promise<CalibrationResult> {
    if (!this.isInitialized) {
      await this.workerProxy.init();
      this.isInitialized = true;
    }
    return this.workerProxy.calibrate(
      capturedFrames,
      patternSize,
      frameSize,
      squareSize
    );
  }

  async terminate() {
    this.worker.terminate();
  }
}
