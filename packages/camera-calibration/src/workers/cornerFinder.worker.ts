import { convertCorners } from '../lib/calibrationCore';
import type { CornerFinderWorkerInput, CornerFinderWorkerOutput } from './types';


// Import OpenCV.js from the same location as the main thread
// importScripts('/opencv.js');
let cv: any;

class CornerFinderWorker {
  private isOpencvInitialized: boolean = false;
  private isProcessing: boolean = false;
  private criteria: any;
  private winSize: any;
  private zeroZone: any;
  constructor() {
    // No initialization in constructor
  }

  async init(): Promise<boolean> {
    console.log('[CornerFinderWorker] Initializing...');
    if (this.isOpencvInitialized) {
      return true;
    }

    const loaded = await this.loadOpenCV();
    if (!loaded) {
      console.error("[CornerFinderWorker] Failed to load OpenCV.");
      return false;
    }
    this.isOpencvInitialized = true;
    this.criteria = new cv.TermCriteria(
      cv.TERM_CRITERIA_EPS + cv.TERM_CRITERIA_MAX_ITER,
      30,
      0.001
    );

    // Create a zero-size zone for cornerSubPix
    this.zeroZone = new cv.Size(-1, -1);

    // Define window size for cornerSubPix
    this.winSize = new cv.Size(11, 11);
    return true;
  }

  private async loadOpenCV(): Promise<boolean> {
    cv = await (await import(/* @vite-ignore */ location.origin + '/opencv_js.js')).default();
    return true;
  }

  async processFrame(input: CornerFinderWorkerInput): Promise<CornerFinderWorkerOutput> {
    if (!this.isOpencvInitialized) {
      const initialized = await this.init();
      if (!initialized) {
        return { type: 'error', messageId: input.messageId, message: 'OpenCV failed to load in worker.' };
      }
    }

    if (this.isProcessing) {
      console.warn("[CornerFinderWorker] Already processing, skipping frame.");
      return { type: 'error', messageId: input.messageId, message: 'Worker is busy.' };
    }

    this.isProcessing = true;

    const { messageId, imageData, width, height, patternWidth, patternHeight } = input;
    const imgData = new ImageData(new Uint8ClampedArray(imageData), width, height);

    let output: CornerFinderWorkerOutput = { type: 'error', messageId, message: 'Unknown error' };
    let srcMat: any = null;
    let grayMat: any = null;
    let cornersMat: any = null;

    try {
      // Create source Mat from RGBA image data
      srcMat = cv.matFromImageData(imgData);
      // srcMat= cv.matFromArray(height, width, cv.CV_8UC4, imageData);
      if (!srcMat || srcMat.empty()) {
        throw new Error("Failed to create source Mat from image data.");
      }

      // Create grayscale Mat
      grayMat = new cv.Mat();

      // Convert to grayscale
      cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);

      // Define pattern size
      const patternSizeCv = new cv.Size(patternWidth, patternHeight);

      // Allocate corners Mat
      cornersMat = new cv.Mat();

      // Find chessboard corners
      const found = cv.findChessboardCorners(grayMat, patternSizeCv, cornersMat);
      // If corners are found, refine them with cornerSubPix for better accuracy



      if (found) {


        // Refine corner locations with subpixel accuracy
        cv.cornerSubPix(grayMat, cornersMat, this.winSize, this.zeroZone, this.criteria);


        // Get corner data as Float32Array
        const corners = convertCorners(cornersMat);
        output = { type: 'cornersFound', messageId, corners };
      } else {
        output = { type: 'cornersFound', messageId, corners: null };
      }

    } catch (error: any) {
      output = {
        type: 'error',
        messageId,
        message: error.message || 'Unknown worker error during processing'
      };
    } finally {
      // Clean up OpenCV Mats
      if (srcMat) srcMat.delete();
      if (grayMat) grayMat.delete();
      if (cornersMat) cornersMat.delete();

      this.isProcessing = false;
    }
    return output;
  }
}

// Create an instance of the worker
const worker = new CornerFinderWorker();

// Handle messages from the main thread
self.onmessage = async (event: MessageEvent<CornerFinderWorkerInput>) => {
  const result = await worker.processFrame(event.data);
  // const transferList = result.type === 'cornersFound' && result.corners ? [result.corners.buffer] : [];
  self.postMessage(result); //, { transfer: transferList });
};

// Handle errors
self.onerror = (error) => {
  console.error("[CornerFinderWorker] Uncaught worker error:", error);
};