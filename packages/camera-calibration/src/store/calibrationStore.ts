import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { CapturedFrame, CalibrationResult, Corner, CornerMetrics, PatternSize } from '../lib/calibrationTypes';
import { calculateCornerMetrics, calculateMovement, calculateSimilarityScore, calibrateCamera } from '../lib/calibrationCore';
import { createImageBlob } from '../lib/imageUtils';

// Smoothing factor for FPS calculation (lower value = smoother)
const FPS_SMOOTHING_FACTOR = 0.8;
// Default stability duration threshold in seconds
const DEFAULT_STABILITY_DURATION_THRESHOLD = 1.0;
// Default max relative movement threshold (fraction of image diagonal)
const DEFAULT_MAX_RELATIVE_MOVEMENT_THRESHOLD = 0.003; // 0.3% of diagonal

interface CalibrationSettings {
  patternSize?: PatternSize;
  squareSize?: number;
  stabilityDurationThreshold?: number;
  maxRelativeMovementForStability?: number;
  similarityThreshold?: number;
  autoCapture?: boolean;
}

interface CalibrationState {
  // Camera state
  stream: MediaStream | null;
  videoElement: HTMLVideoElement | null;
  frameWidth: number;
  frameHeight: number;
  isStreaming: boolean;

  // Processing state
  currentCorners: Corner[] | null;
  currentFrameImageData: ImageData | null;
  movementHistory: number[];
  previousCornerMetrics: CornerMetrics | null;
  stabilityPercentage: number;
  uniquenessPercentage: number;
  detectionFps: number;
  lastFrameProcessedTime: number;
  lastUpdateTime: number;

  // Capture state
  capturedFrames: CapturedFrame[];
  selectedFrameId: string | null;
  showGallery: boolean;

  // Calibration settings and results
  patternSize: PatternSize;
  squareSize: number;
  stabilityDurationThreshold: number;
  maxRelativeMovementForStability: number;
  currentStableDuration: number;
  similarityThreshold: number;
  isAutoCaptureEnabled: boolean;
  wasStableAndUnique: boolean;
  isCapturePending: boolean;
  calibrationResult: CalibrationResult | null;

  // Actions
  initializeSettings: (settings: CalibrationSettings) => void;
  startCamera: (source: MediaStream | string) => Promise<void>;
  stopCamera: () => void;
  captureFrame: (forceCapture?: boolean) => Promise<string | undefined>;
  deleteFrame: (id: string) => void;
  runCalibration: () => void;
  setShowGallery: (show: boolean) => void;
  setSelectedFrame: (id: string | null) => void;
  updateCorners: (corners: Corner[], imageData: ImageData) => void;
  clearCorners: () => void;
  resetCalibration: () => void;
  setFrameDimensions: (width: number, height: number) => void;
  resetDetectionFps: () => void;
  updateDetectionFps: () => void;
  // Helper to calculate stability and uniqueness metrics and update state
  calculateFrameMetrics: (corners: Corner[], now: number) => void;
}

// Helper to promisify canvas.toBlob
// Export this helper so it can be used externally
export function getCanvasBlob(canvas: HTMLCanvasElement, type?: string, quality?: any): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

export const useCalibrationStore = create<CalibrationState>((set, get) => {
  return {
    // Initial state
    stream: null,
    videoElement: null,
    frameWidth: 0,
    frameHeight: 0,
    isStreaming: false,
    currentCorners: null,
    currentFrameImageData: null,
    movementHistory: [],
    previousCornerMetrics: null,
    stabilityPercentage: 0,
    uniquenessPercentage: 100,
    detectionFps: 0,
    lastFrameProcessedTime: 0,
    lastUpdateTime: 0,
    capturedFrames: [],
    selectedFrameId: null,
    showGallery: false,
    patternSize: { width: 9, height: 6 },
    squareSize: 1.0,
    stabilityDurationThreshold: DEFAULT_STABILITY_DURATION_THRESHOLD,
    maxRelativeMovementForStability: DEFAULT_MAX_RELATIVE_MOVEMENT_THRESHOLD,
    currentStableDuration: 0,
    similarityThreshold: 5,
    isAutoCaptureEnabled: true,
    wasStableAndUnique: false,
    isCapturePending: false,
    calibrationResult: null,

    // Actions
    initializeSettings: (settings: CalibrationSettings) => {
      set((state) => ({
        patternSize: settings.patternSize ?? state.patternSize,
        squareSize: settings.squareSize ?? state.squareSize,
        stabilityDurationThreshold: settings.stabilityDurationThreshold ?? state.stabilityDurationThreshold,
        maxRelativeMovementForStability: settings.maxRelativeMovementForStability ?? state.maxRelativeMovementForStability,
        similarityThreshold: settings.similarityThreshold ?? state.similarityThreshold,
        isAutoCaptureEnabled: settings.autoCapture ?? state.isAutoCaptureEnabled,
        wasStableAndUnique: false,
        currentStableDuration: 0,
      }));
    },

    startCamera: async (source: MediaStream | string) => {
      // Ensure cleanup of previous state first
      get().stopCamera();

      try {
        const element = document.createElement('video');
        element.autoplay = true;
        element.playsInline = true;
        element.muted = true;

        const handleMetadataLoaded = () => {
          console.log('[Store] Video metadata loaded:', element.videoWidth, element.videoHeight);
          if (element.videoWidth > 0 && element.videoHeight > 0) {
            // needed by opencv VideoCapture
            element.width = element.videoWidth;
            element.height = element.videoHeight;
            set({ frameWidth: element.videoWidth, frameHeight: element.videoHeight });
          } else {
            console.warn('[Store] Metadata loaded but dimensions invalid on detached element.');
          }
          element.removeEventListener('loadedmetadata', handleMetadataLoaded);
        };

        element.addEventListener('loadedmetadata', handleMetadataLoaded);

        // Use the provided source based on its type
        if (typeof source === 'string') {
          // Handle URL string
          element.src = source;
          element.crossOrigin = 'anonymous';
          console.log('[Store] Assigned provided URL to video element:', source);
        } else if (source instanceof MediaStream) {
          // Handle MediaStream
          if (!source.active || source.getVideoTracks().length === 0) {
            console.error('[Store] startCamera received an invalid or inactive stream.');
            set({ stream: null, videoElement: null, isStreaming: false });
            return Promise.reject(new Error("Invalid MediaStream provided to startCamera"));
          }
          element.srcObject = source;
          console.log('[Store] Assigned provided stream to video element.');
        } else {
          // Handle invalid source
          console.error('[Store] startCamera received an invalid source type.');
          set({ stream: null, videoElement: null, isStreaming: false });
          return Promise.reject(new Error("Invalid source type provided to startCamera"));
        }

        await element.play();

        console.log('[Store] Video element is playing.');
        set({
          stream: source instanceof MediaStream ? source : null,
          videoElement: element,
          isStreaming: true,
          capturedFrames: [],
          calibrationResult: null,
          currentStableDuration: 0,
          lastUpdateTime: 0,
        });
        // Reset FPS timer on start
        get().resetDetectionFps();

      } catch (error) {
        console.error('[Store] Error setting up/playing video element:', error);
        // Clean up element listener if play fails
        const element = get().videoElement;
        element?.removeEventListener('loadedmetadata', (e: any) => e?.target?.removeEventListener('loadedmetadata', (e as any)?.target?._listenerRef)); // Attempt cleanup
        set({
          stream: null,
          videoElement: null,
          isStreaming: false,
          currentStableDuration: 0,
          lastUpdateTime: 0,
        });
        // Reset FPS timer on stop
        get().resetDetectionFps();
        return Promise.reject(error); // Propagate error
      }
    },

    stopCamera: () => {
      const { videoElement } = get();
      console.log('[Store] Stopping camera element management...');

      if (videoElement) {
        console.log('[Store] Cleaning up detached video element.');
        videoElement.pause();
        videoElement.srcObject = null;
        // remove listeners if needed
      }

      set({
        stream: null,
        videoElement: null,
        isStreaming: false,
        frameWidth: 0,
        frameHeight: 0,
        currentCorners: null,
        currentFrameImageData: null,
        previousCornerMetrics: null,
        movementHistory: [],
        currentStableDuration: 0,
        lastUpdateTime: 0,
      });
      // Reset FPS timer on stop
      get().resetDetectionFps();
    },

    clearCorners: () => {
      get().updateDetectionFps(); // Call FPS update action *before* set
      const { capturedFrames } = get();

      set({
        currentCorners: null,
        currentFrameImageData: null,
        stabilityPercentage: 0,
        uniquenessPercentage: capturedFrames.length > 0 ? 0 : 100,
        movementHistory: [],
        previousCornerMetrics: null,
        wasStableAndUnique: false,
        isCapturePending: false,
        currentStableDuration: 0,
        lastUpdateTime: 0,
      });
    },

    updateCorners: (corners: Corner[], imageData: ImageData) => {
      get().updateDetectionFps(); // Call FPS update action *before* set
      const now = performance.now();
      // Store previous state for rising edge detection
      const wasStableAndUniqueBeforeUpdate = get().wasStableAndUnique;

      // Update the current frame data first
      set({ currentCorners: corners, currentFrameImageData: imageData });
      // Then calculate metrics and update related state
      get().calculateFrameMetrics(corners, now);

      // Read updated state after metrics calculation
      const { isAutoCaptureEnabled, wasStableAndUnique, isCapturePending, currentStableDuration, stabilityDurationThreshold, uniquenessPercentage, similarityThreshold } = get();

      // --- Auto-Capture Logic (back in updateCorners) ---
      // Trigger capture on the *rising edge* of stable+unique AND if no capture is already pending
      if (isAutoCaptureEnabled && wasStableAndUnique && !wasStableAndUniqueBeforeUpdate && !isCapturePending) {
        console.log(`[Store:updateCorners] Auto-capture triggered (Stable Duration: ${currentStableDuration.toFixed(2)}s >= ${stabilityDurationThreshold}s, Unique: ${uniquenessPercentage.toFixed(1)}% >= ${similarityThreshold}%).`);
        set({ isCapturePending: true }); // Set pending flag immediately
        // Run capture asynchronously, don't await here to avoid blocking updates
        get().captureFrame().catch(error => {
          console.error("[Store:updateCorners] Auto-capture failed:", error);
          // Important: Reset pending flag on *any* capture failure
          set({ isCapturePending: false, currentStableDuration: 0 }); // Reset here
        });
      }
    },

    captureFrame: async (forceCapture = false) => {
      const { currentCorners, currentFrameImageData } = get();

      if (!currentCorners) {
        const errMsg = '[captureFrame] No chessboard detected for capture';
        console.warn(errMsg);
        set({ isCapturePending: false, currentStableDuration: 0 });
        return Promise.reject(new Error(errMsg));
      }

      if (!currentFrameImageData) {
        const errMsg = '[captureFrame] No ImageData available for capture';
        console.error(errMsg);
        set({ isCapturePending: false, currentStableDuration: 0 });
        return Promise.reject(new Error(errMsg));
      }

      // Removed try...catch block here. Errors from createImageBlob will propagate.
      const imageBlob = await createImageBlob(currentFrameImageData, 'image/jpeg', 1.0);

      const frameId = uuidv4();
      const frame: CapturedFrame = {
        id: frameId,
        imageBlob: imageBlob,
        corners: currentCorners,
        timestamp: Date.now(),
      };

      console.log(`[captureFrame] ${forceCapture ? 'Forced' : 'Auto'} capture successful for frame ${frameId}.`);

      // Reset state on successful capture
      set((state) => ({
        capturedFrames: [...state.capturedFrames, frame],
        currentStableDuration: 0,
        isCapturePending: false,
      }));

      return frameId; // Resolve with frameId on success
    },

    deleteFrame: (id: string) => {
      set((state) => ({
        capturedFrames: state.capturedFrames.filter((frame) => frame.id !== id),
        selectedFrameId:
          state.selectedFrameId === id ? null : state.selectedFrameId,
        currentFrameImageData: null,
        currentStableDuration: 0,
        lastUpdateTime: 0,
      }));
    },

    runCalibration: () => {
      const { capturedFrames, patternSize, frameWidth, frameHeight, squareSize } = get();

      const validFrames = capturedFrames.filter(f => f.imageBlob);
      if (validFrames.length < 3) {
        const errMsg = 'At least 3 valid frames required for calibration';
        console.error(errMsg);
        // Throw error instead of returning silently
        throw new Error(errMsg);
      }

      // Removed try...catch block. Errors from calibrateCamera will propagate.
      const result = calibrateCamera(
        validFrames,
        patternSize,
        { width: frameWidth, height: frameHeight },
        squareSize
      );

      set({ calibrationResult: result });
    },

    setShowGallery: (show: boolean) => set({ showGallery: show }),

    setSelectedFrame: (id: string | null) => set({ selectedFrameId: id }),

    resetCalibration: () =>
      set({
        capturedFrames: [],
        selectedFrameId: null,
        calibrationResult: null,
        currentFrameImageData: null,
        currentStableDuration: 0,
        lastUpdateTime: 0,
      }),

    setFrameDimensions: (width: number, height: number) => {
      set({ frameWidth: width, frameHeight: height });
    },

    resetDetectionFps: () => {
      set({ detectionFps: 0, lastFrameProcessedTime: 0 }); // Reset timestamp too
    },

    updateDetectionFps: () => {
      const { lastFrameProcessedTime, detectionFps } = get();
      const now = performance.now();
      const deltaTime = now - lastFrameProcessedTime;
      let smoothedFps = detectionFps;

      if (lastFrameProcessedTime > 0 && deltaTime > 0) {
        const currentRawFps = 1000 / deltaTime;
        smoothedFps = FPS_SMOOTHING_FACTOR * currentRawFps + (1 - FPS_SMOOTHING_FACTOR) * smoothedFps;
      }
      // Use set directly here as it's part of the store actions
      set({ detectionFps: smoothedFps, lastFrameProcessedTime: now });
    },

    // Helper to calculate stability and uniqueness metrics and update state
    calculateFrameMetrics: (corners: Corner[], now: number) => {
      const {
        movementHistory,
        previousCornerMetrics,
        maxRelativeMovementForStability,
        capturedFrames,
        frameWidth,
        frameHeight,
        stabilityDurationThreshold,
        currentStableDuration,
        lastUpdateTime,
        similarityThreshold,
      } = get();

      const metrics = calculateCornerMetrics(corners);

      let movement = Infinity; // Raw pixel movement
      if (previousCornerMetrics) {
        movement = calculateMovement(metrics, previousCornerMetrics);
      }

      // Time Delta Calculation
      const deltaTime = lastUpdateTime > 0 ? now - lastUpdateTime : 0; // in ms
      const deltaTimeSeconds = deltaTime / 1000;

      // Movement History & Average (using raw pixels)
      const newHistory = [...movementHistory, movement];
      if (newHistory.length > 10) newHistory.shift(); // Keep last 10 movements

      const avgMovement = newHistory.length > 0
        ? newHistory.reduce((sum, val) => sum + val, 0) / newHistory.length
        : Infinity;

      // Normalization & Instantaneous Stability Check
      let normalizedAvgMovement = Infinity;
      let stabilityPct = 0;
      let isInstantaneouslyStable = false;

      if (frameWidth > 0 && frameHeight > 0) {
        const imageDiagonal = Math.sqrt(frameWidth * frameWidth + frameHeight * frameHeight);
        if (imageDiagonal > 0) {
          normalizedAvgMovement = avgMovement / imageDiagonal;
          isInstantaneouslyStable = normalizedAvgMovement <= maxRelativeMovementForStability;
          stabilityPct = Math.min(100, Math.max(0, (1 - normalizedAvgMovement / maxRelativeMovementForStability) * 100));
        }
      } else {
        // Cannot calculate stability without frame dimensions
        stabilityPct = 0;
        isInstantaneouslyStable = false;
      }

      // Update Stable Duration
      let newStableDuration = currentStableDuration;
      if (isInstantaneouslyStable) {
        newStableDuration += deltaTimeSeconds; // Accumulate time if stable
      } else {
        newStableDuration = 0; // Reset duration if not stable
      }

      // Check Overall Stability (Duration Threshold)
      const isStable = newStableDuration >= stabilityDurationThreshold;

      // Uniqueness
      const uniqueness = calculateSimilarityScore(corners, capturedFrames, frameWidth, frameHeight);
      const uniquenessPct = uniqueness * 100;
      const isUnique = uniquenessPct >= similarityThreshold;

      // Determine current state based on calculated metrics
      const currentlyStableAndUnique = isStable && isUnique;

      // --- Update State (metrics only) ---
      set({
        previousCornerMetrics: metrics,
        movementHistory: newHistory,
        stabilityPercentage: stabilityPct,
        uniquenessPercentage: uniquenessPct,
        wasStableAndUnique: currentlyStableAndUnique, // Store current state for next frame's rising edge detection
        currentStableDuration: newStableDuration,
        lastUpdateTime: now,
      });
    },
  };
});