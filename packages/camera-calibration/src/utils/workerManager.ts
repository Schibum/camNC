import * as Comlink from "comlink";
import type {
  CornerFinderWorkerInput,
  CornerFinderWorkerOutput,
} from "../workers/types";

export class CornerFinderWorkerManager {
  private worker: Worker | null = null;
  private workerProxy: Comlink.Remote<{
    init: () => Promise<boolean>;
    processFrame: (
      input: CornerFinderWorkerInput
    ) => Promise<CornerFinderWorkerOutput>;
  }> | null = null;
  private processingState: boolean = false;

  constructor() {
    // No initialization in constructor
  }

  init(): void {
    if (this.worker) {
      console.warn("[CornerFinderWorkerManager] Worker already initialized.");
      return;
    }

    // Adjust path based on build output
    this.worker = new Worker(
      new URL("../workers/cornerFinder.worker.ts", import.meta.url),
      { type: "module" }
    );

    // Create a Comlink proxy for the worker
    this.workerProxy = Comlink.wrap(this.worker);

    // Initialize the worker
    this.workerProxy
      .init()
      .then((success) => {
        if (success) {
          console.log(
            "[CornerFinderWorkerManager] Corner finder worker initialized."
          );
        } else {
          console.error(
            "[CornerFinderWorkerManager] Failed to initialize corner finder worker."
          );
        }
      })
      .catch((error) => {
        console.error(
          "[CornerFinderWorkerManager] Error initializing worker:",
          error
        );
      });

    this.processingState = false;
  }

  terminate(): void {
    if (this.worker) {
      console.log("[CornerFinderWorkerManager] Terminating worker.");
      this.worker.terminate();
      this.worker = null;
      this.workerProxy = null;
      this.processingState = false;
    }
  }

  async processFrame(
    imageData: ImageData,
    patternWidth: number,
    patternHeight: number
  ): Promise<CornerFinderWorkerOutput> {
    if (!this.workerProxy) {
      throw new Error(
        "[CornerFinderWorkerManager] Worker not initialized. Call init() first."
      );
    }

    if (this.processingState) {
      throw new Error(
        "[CornerFinderWorkerManager] Worker is busy processing another frame."
      );
    }

    const messageId = Math.random().toString(36).substring(7); // Generate a random ID

    this.processingState = true;

    try {
      const message: CornerFinderWorkerInput = {
        type: "processFrame",
        messageId,
        imageData: imageData.data.buffer,
        width: imageData.width,
        height: imageData.height,
        patternWidth,
        patternHeight,
      };

      // Transfer the imageData buffer
      const result = await this.workerProxy.processFrame(message);

      return result;
    } finally {
      this.processingState = false;
    }
  }

  isBusy(): boolean {
    return this.processingState;
  }
}
