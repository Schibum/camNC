import type { CornerFinderWorkerInput, CornerFinderWorkerOutput, CornerFinderWorkerOutputSuccess } from '../workers/types';

export class CornerFinderWorkerManager {
  private worker: Worker | null = null;
  private processingState: boolean = false;
  private pendingPromises: Map<string, {
    resolve: (value: CornerFinderWorkerOutputSuccess) => void;
    reject: (reason?: any) => void;
  }> = new Map();

  constructor() {
    // No initialization in constructor
  }

  init(): void {
    if (this.worker) {
      console.warn("[CornerFinderWorkerManager] Worker already initialized.");
      return;
    }

    // Adjust path based on build output
    this.worker = new Worker(new URL('../workers/cornerFinder.worker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = (event: MessageEvent<CornerFinderWorkerOutput>) => {
      this.processingState = false;
      const { messageId } = event.data;
      const promise = this.pendingPromises.get(messageId);
      if (promise) {
        if (event.data.type === 'error') {
          promise.reject(new Error(event.data.message));
        } else {
          promise.resolve(event.data);
        }
        this.pendingPromises.delete(messageId);
      }
    };

    this.worker.onerror = (error) => {
      console.error("[CornerFinderWorkerManager] Worker error:", error);
      this.processingState = false;
      // Reject all pending promises
      this.pendingPromises.forEach(({ reject }) => reject(error));
      this.pendingPromises.clear();
    };
    this.processingState = false;
    console.log("[CornerFinderWorkerManager] Corner finder worker initialized.");
  }

  terminate(): void {
    if (this.worker) {
      console.log("[CornerFinderWorkerManager] Terminating worker.");
      this.worker.terminate();
      this.worker = null;
      this.processingState = false;
      // Reject any pending promises
      this.pendingPromises.clear();
    }
  }

  async processFrame(imageData: ImageData, patternWidth: number, patternHeight: number): Promise<CornerFinderWorkerOutputSuccess> {
    if (!this.worker) {
      throw new Error("[CornerFinderWorkerManager] Worker not initialized. Call init() first.");
    }

    if (this.processingState) {
      throw new Error("[CornerFinderWorkerManager] Worker is busy processing another frame.");
    }

    const messageId = Math.random().toString(36).substring(7); // Generate a random ID
    return new Promise((resolve, reject) => {
      this.pendingPromises.set(messageId, { resolve, reject });

      const message: CornerFinderWorkerInput = {
        type: 'processFrame',
        messageId,
        imageData: imageData.data.buffer,
        width: imageData.width,
        height: imageData.height,
        patternWidth,
        patternHeight
      };

      // Transfer the imageData buffer
      this.worker!.postMessage(message, [message.imageData]);
      this.processingState = true;
    });
  }

  isBusy(): boolean {
    return this.processingState;
  }
}