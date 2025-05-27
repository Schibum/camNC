import * as Comlink from "comlink";
import { api } from "../workers/calibrate.worker";
import { CalibrationResult } from "./calibrationTypes";

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
    ...opts: Parameters<typeof api.calibrate>
  ): Promise<CalibrationResult> {
    if (!this.isInitialized) {
      await this.workerProxy.init();
      this.isInitialized = true;
    }
    return this.workerProxy.calibrate(...opts);
  }

  async terminate() {
    this.worker.terminate();
  }
}
