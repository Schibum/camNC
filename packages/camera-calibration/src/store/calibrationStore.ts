import { toast } from "@wbcnc/ui/components/sonner";
import { v4 as uuidv4 } from "uuid";
import { create, StateCreator } from "zustand";
import {
  calculateCornerMetrics,
  calculateMovement,
  calculateSimilarityScore,
  calibrateCamera,
} from "../lib/calibrationCore";
import {
  CalibrationResult,
  CapturedFrame,
  Corner,
  CornerMetrics,
  PatternSize,
} from "../lib/calibrationTypes";
import { createImageBlob } from "../lib/imageUtils";

// TODO(manu): refactor this generated code.

// Smoothing factor for FPS calculation (lower value = smoother)
const FPS_SMOOTHING_FACTOR = 0.8;
// Default stability duration threshold in seconds
const DEFAULT_STABILITY_DURATION_THRESHOLD = 0.5;
// Default max relative movement threshold (fraction of image diagonal)
const DEFAULT_MAX_RELATIVE_MOVEMENT_THRESHOLD = 0.005; // 0.05% of diagonal

// --- Slice Interfaces ---

// Input type for initialization
interface CalibrationSettings {
  patternSize?: PatternSize;
  squareSize?: number;
  stabilityDurationThreshold?: number;
  maxRelativeMovementForStability?: number;
  similarityThreshold?: number;
  autoCapture?: boolean;
}

export interface Resolution {
  width: number;
  height: number;
}

interface CameraSlice {
  stream: MediaStream | null;
  videoElement: HTMLVideoElement | null;
  frameWidth: number;
  frameHeight: number;
  isStreaming: boolean;
  startCamera: (
    source: MediaStream | string,
    resolution?: Resolution
  ) => Promise<void>;
  stopCamera: () => void;
  setFrameDimensions: (width: number, height: number) => void;
  resetCalibration: () => void; // This action resets state across multiple slices
}

interface ProcessingSlice {
  currentCorners: Corner[] | null;
  currentFrameImageData: ImageData | null;
  movementHistory: number[];
  previousCornerMetrics: CornerMetrics | null;
  stabilityPercentage: number;
  uniquenessPercentage: number;
  detectionFps: number;
  lastFrameProcessedTime: number;
  lastUpdateTime: number;
  currentStableDuration: number; // Moved here as it's calculated during processing
  wasStableAndUnique: boolean; // Moved here as it's determined during processing
  isCapturePending: boolean; // Needed here to prevent re-triggering auto-capture
  updateCorners: (corners: Corner[], imageData: ImageData) => void;
  clearCorners: () => void;
  resetDetectionFps: () => void;
  updateDetectionFps: () => void;
  calculateFrameMetrics: (corners: Corner[], now: number) => void;
}

interface CaptureSlice {
  capturedFrames: CapturedFrame[];
  selectedFrameId: string | null;
  showGallery: boolean;
  // isCapturePending moved to ProcessingSlice as it's set there
  captureFrame: (forceCapture?: boolean) => Promise<string | undefined>;
  deleteFrame: (id: string) => void;
  setShowGallery: (show: boolean) => void;
  setSelectedFrame: (id: string | null) => void;
}

interface SettingsSlice {
  patternSize: PatternSize;
  squareSize: number;
  stabilityDurationThreshold: number;
  maxRelativeMovementForStability: number;
  similarityThreshold: number;
  isAutoCaptureEnabled: boolean;
  initializeSettings: (settings: CalibrationSettings) => void;
}

interface CalibrationResultSlice {
  calibrationResult: CalibrationResult | null;
  runCalibration: () => void;
  resetCalibration: () => void; // This action resets state across multiple slices
}

// Combined state type
type CalibrationState = CameraSlice &
  ProcessingSlice &
  CaptureSlice &
  SettingsSlice &
  CalibrationResultSlice;

function getAspectRatio(resolution: Resolution) {
  const { width, height } = resolution;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

const createCameraSlice: StateCreator<CalibrationState, [], [], CameraSlice> = (
  set,
  get
) => ({
  stream: null,
  videoElement: null,
  frameWidth: 0,
  frameHeight: 0,
  isStreaming: false,
  startCamera: async (
    source: MediaStream | string,
    resolution?: Resolution
  ) => {
    // Ensure cleanup of previous state first
    get().stopCamera(); // Calls stopCamera from this slice

    const element = document.createElement("video");
    element.autoplay = true;
    element.playsInline = true;
    element.muted = true;

    const handleMetadataLoaded = () => {
      const vidRes = { width: element.videoWidth, height: element.videoHeight };
      if (resolution) {
        if (getAspectRatio(resolution) !== getAspectRatio(vidRes)) {
          toast.error(
            "Aspect ratio mismatch between provided and video element",
            {
              description: `Expected: ${getAspectRatio(resolution)}, actual: ${getAspectRatio(vidRes)}`,
              duration: Infinity,
              closeButton: true,
            }
          );
          throw new Error(
            "Aspect ratio mismatch between provided and video element"
          );
        }
        console.log("Using externally provided resolution", resolution);
      }
      const { width, height } = vidRes;
      if (width > 0 && height > 0) {
        element.width = width;
        element.height = height;
        set({
          frameWidth: width,
          frameHeight: height,
        });
      } else {
        throw new Error("Invalid video dimensions");
      }
    };

    element.addEventListener("loadedmetadata", handleMetadataLoaded, {
      once: true,
    });

    if (typeof source === "string") {
      element.src = source;
      element.crossOrigin = "anonymous";
    } else if (source instanceof MediaStream) {
      if (!source.active || source.getVideoTracks().length === 0) {
        set({ stream: null, videoElement: null, isStreaming: false });
        throw new Error("Invalid MediaStream provided to startCamera");
      }
      element.srcObject = source;
    } else {
      set({ stream: null, videoElement: null, isStreaming: false });
      throw new Error("Invalid source type provided to startCamera");
    }

    await element.play();

    console.log("[Store:Camera] Video element is playing.");
    // Reset states in other slices via direct set calls
    set({
      stream: source instanceof MediaStream ? source : null,
      videoElement: element,
      isStreaming: true,
      // Reset capture state
      capturedFrames: [],
      selectedFrameId: null,
      // Reset calibration state
      calibrationResult: null,
      // Reset processing state
      currentStableDuration: 0,
      lastUpdateTime: 0,
      isCapturePending: false,
      wasStableAndUnique: false,
      previousCornerMetrics: null,
      movementHistory: [],
      currentCorners: null,
      currentFrameImageData: null,
    });
    get().resetDetectionFps(); // Calls action from Processing slice
  },
  stopCamera: () => {
    const { videoElement } = get(); // Use get() to access state within the same slice action
    console.log("[Store:Camera] Stopping camera element management...");

    if (videoElement) {
      console.log("[Store:Camera] Cleaning up detached video element.");
      videoElement.pause();
      videoElement.srcObject = null;
      // Remove listeners if needed (add specific removal logic here if applicable)
    }

    // Reset states across multiple slices
    set({
      stream: null,
      videoElement: null,
      isStreaming: false,
      frameWidth: 0,
      frameHeight: 0,
      // Reset processing state
      currentCorners: null,
      currentFrameImageData: null,
      previousCornerMetrics: null,
      movementHistory: [],
      currentStableDuration: 0,
      lastUpdateTime: 0,
      wasStableAndUnique: false,
      isCapturePending: false,
      // Reset capture state
      selectedFrameId: null, // Keep captured frames? No, reset on stop.
      // capturedFrames: [], // Resetting frames on stop might be disruptive, comment out for now
    });
    get().resetDetectionFps(); // Calls action from Processing slice
  },
  setFrameDimensions: (width: number, height: number) => {
    set({ frameWidth: width, frameHeight: height });
  },
  resetCalibration: () => {
    // Reset state across multiple slices
    set({
      // Capture slice
      capturedFrames: [],
      selectedFrameId: null,
      // Calibration slice
      calibrationResult: null,
      // Processing slice
      currentFrameImageData: null, // Clear last processed image
      currentStableDuration: 0,
      lastUpdateTime: 0,
      wasStableAndUnique: false,
      isCapturePending: false,
      previousCornerMetrics: null,
      movementHistory: [],
    });
  },
});

const createProcessingSlice: StateCreator<
  CalibrationState,
  [],
  [],
  ProcessingSlice
> = (set, get) => ({
  currentCorners: null,
  currentFrameImageData: null,
  movementHistory: [],
  previousCornerMetrics: null,
  stabilityPercentage: 0,
  uniquenessPercentage: 100, // Default to 100 when no frames captured yet
  detectionFps: 0,
  lastFrameProcessedTime: 0,
  lastUpdateTime: 0,
  currentStableDuration: 0,
  wasStableAndUnique: false,
  isCapturePending: false,

  updateCorners: (corners: Corner[], imageData: ImageData) => {
    get().updateDetectionFps(); // Call FPS update action *before* set
    const now = performance.now();
    const wasStableAndUniqueBeforeUpdate = get().wasStableAndUnique;

    set({ currentCorners: corners, currentFrameImageData: imageData });
    get().calculateFrameMetrics(corners, now); // Calls helper within the same slice

    // Read updated state after metrics calculation
    const {
      isAutoCaptureEnabled, // From SettingsSlice
      wasStableAndUnique, // From this slice
      isCapturePending, // From this slice
      currentStableDuration, // From this slice
      stabilityDurationThreshold, // From SettingsSlice
      uniquenessPercentage, // From this slice
      similarityThreshold, // From SettingsSlice
    } = get();

    // Auto-Capture Logic
    if (
      isAutoCaptureEnabled &&
      wasStableAndUnique &&
      !wasStableAndUniqueBeforeUpdate &&
      !isCapturePending
    ) {
      console.log(
        `[Store:Processing] Auto-capture triggered (Stable Duration: ${currentStableDuration.toFixed(2)}s >= ${stabilityDurationThreshold}s, Unique: ${uniquenessPercentage.toFixed(1)}% >= ${similarityThreshold}%).`
      );
      set({ isCapturePending: true }); // Set pending flag immediately
      // Call captureFrame from CaptureSlice asynchronously
      get()
        .captureFrame() // Calls action from Capture slice
        .catch((error) => {
          console.error("[Store:Processing] Auto-capture failed:", error);
          // Reset pending flag and duration on failure
          set({ isCapturePending: false, currentStableDuration: 0 });
        });
    }
  },

  clearCorners: () => {
    get().updateDetectionFps(); // Call FPS update action *before* set
    const { capturedFrames } = get(); // Access capturedFrames from CaptureSlice

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
      lastUpdateTime: 0, // Reset update time as metrics are cleared
    });
  },

  resetDetectionFps: () => {
    set({ detectionFps: 0, lastFrameProcessedTime: 0 });
  },

  updateDetectionFps: () => {
    const { lastFrameProcessedTime, detectionFps } = get(); // Access state from this slice
    const now = performance.now();
    const deltaTime = now - lastFrameProcessedTime;
    let smoothedFps = detectionFps;

    if (lastFrameProcessedTime > 0 && deltaTime > 0) {
      const currentRawFps = 1000 / deltaTime;
      smoothedFps =
        FPS_SMOOTHING_FACTOR * currentRawFps +
        (1 - FPS_SMOOTHING_FACTOR) * smoothedFps;
    }
    set({ detectionFps: smoothedFps, lastFrameProcessedTime: now });
  },

  calculateFrameMetrics: (corners: Corner[], now: number) => {
    // Access state from multiple slices using get()
    const {
      movementHistory, // Processing
      previousCornerMetrics, // Processing
      maxRelativeMovementForStability, // Settings
      capturedFrames, // Capture
      frameWidth, // Camera
      frameHeight, // Camera
      stabilityDurationThreshold, // Settings
      currentStableDuration, // Processing
      lastUpdateTime, // Processing
      similarityThreshold, // Settings
    } = get();

    const metrics = calculateCornerMetrics(corners);

    let movement = Infinity;
    if (previousCornerMetrics) {
      movement = calculateMovement(metrics, previousCornerMetrics);
    }

    const deltaTime = lastUpdateTime > 0 ? now - lastUpdateTime : 0;
    const deltaTimeSeconds = deltaTime / 1000;

    const newHistory = [...movementHistory, movement];
    if (newHistory.length > 10) newHistory.shift();

    const avgMovement =
      newHistory.length > 0
        ? newHistory.reduce((sum, val) => sum + val, 0) / newHistory.length
        : Infinity;

    let normalizedAvgMovement = Infinity;
    let stabilityPct = 0;
    let isInstantaneouslyStable = false;

    if (frameWidth > 0 && frameHeight > 0) {
      const imageDiagonal = Math.sqrt(
        frameWidth * frameWidth + frameHeight * frameHeight
      );
      if (imageDiagonal > 0) {
        normalizedAvgMovement = avgMovement / imageDiagonal;
        isInstantaneouslyStable =
          normalizedAvgMovement <= maxRelativeMovementForStability;
        stabilityPct = Math.min(
          100,
          Math.max(
            0,
            (1 - normalizedAvgMovement / maxRelativeMovementForStability) * 100
          )
        );
      }
    } else {
      stabilityPct = 0;
      isInstantaneouslyStable = false;
    }

    let newStableDuration = currentStableDuration;
    if (isInstantaneouslyStable) {
      newStableDuration += deltaTimeSeconds;
    } else {
      newStableDuration = 0;
    }

    const isStable = newStableDuration >= stabilityDurationThreshold;

    const uniqueness = calculateSimilarityScore(
      corners,
      capturedFrames,
      frameWidth,
      frameHeight
    );
    const uniquenessPct = uniqueness * 100;
    const isUnique = uniquenessPct >= similarityThreshold;

    const currentlyStableAndUnique = isStable && isUnique;

    // Update state within the Processing slice
    set({
      previousCornerMetrics: metrics,
      movementHistory: newHistory,
      stabilityPercentage: stabilityPct,
      uniquenessPercentage: uniquenessPct,
      wasStableAndUnique: currentlyStableAndUnique,
      currentStableDuration: newStableDuration,
      lastUpdateTime: now,
      // isCapturePending is NOT reset here, only by captureFrame or clearCorners/updateCorners
    });
  },
});

const createCaptureSlice: StateCreator<
  CalibrationState,
  [],
  [],
  CaptureSlice
> = (set, get) => ({
  capturedFrames: [],
  selectedFrameId: null,
  showGallery: false,

  captureFrame: async (forceCapture = false) => {
    // Access state from ProcessingSlice
    const { currentCorners, currentFrameImageData } = get();

    if (!currentCorners) {
      toast.warning("No chessboard detected to capture", {
        id: "no-chessboard-detected",
      });
      set({ isCapturePending: false, currentStableDuration: 0 }); // Reset processing state
      return;
    }

    if (!currentFrameImageData) {
      const errMsg = "[Store:Capture] No ImageData available for capture";
      console.error(errMsg);
      set({ isCapturePending: false, currentStableDuration: 0 }); // Reset processing state
      return Promise.reject(new Error(errMsg));
    }

    try {
      const imageBlob = await createImageBlob(
        currentFrameImageData,
        "image/jpeg",
        1.0
      );

      const frameId = uuidv4();
      const frame: CapturedFrame = {
        id: frameId,
        imageBlob: imageBlob,
        corners: currentCorners,
        timestamp: Date.now(),
      };

      console.log(
        `[Store:Capture] ${forceCapture ? "Forced" : "Auto"} capture successful for frame ${frameId}.`
      );

      // Update Capture slice state and reset relevant Processing slice state
      set((state) => ({
        capturedFrames: [...state.capturedFrames, frame],
        // Reset processing state after successful capture
        currentStableDuration: 0,
        isCapturePending: false,
        wasStableAndUnique: false, // Ensure rising edge logic works correctly next time
        previousCornerMetrics: null, // Reset movement detection basis
        movementHistory: [], // Clear movement history
      }));

      return frameId;
    } catch (error) {
      console.error("[Store:Capture] Error creating image blob:", error);
      // Reset processing state on error
      set({ isCapturePending: false, currentStableDuration: 0 });
      // Propagate the error
      return Promise.reject(error);
    }
  },

  deleteFrame: (id: string) => {
    set((state) => ({
      capturedFrames: state.capturedFrames.filter((frame) => frame.id !== id),
      selectedFrameId:
        state.selectedFrameId === id ? null : state.selectedFrameId,
      // Reset processing state as uniqueness might change
      currentStableDuration: 0,
      lastUpdateTime: 0, // Reset to recalculate uniqueness/stability properly
      uniquenessPercentage: 100, // Assume max uniqueness until next calculation
      wasStableAndUnique: false,
      isCapturePending: false,
    }));
    // Recalculate uniqueness after deletion? Maybe not immediately needed.
    // If currentCorners exist, could call calculateFrameMetrics?
    // const { currentCorners } = get();
    // if (currentCorners) {
    //   get().calculateFrameMetrics(currentCorners, performance.now());
    // }
  },

  setShowGallery: (show: boolean) => set({ showGallery: show }),

  setSelectedFrame: (id: string | null) => set({ selectedFrameId: id }),
});

const createSettingsSlice: StateCreator<
  CalibrationState,
  [],
  [],
  SettingsSlice
> = (set, get) => ({
  patternSize: { width: 9, height: 6 },
  squareSize: 1.0,
  stabilityDurationThreshold: DEFAULT_STABILITY_DURATION_THRESHOLD,
  maxRelativeMovementForStability: DEFAULT_MAX_RELATIVE_MOVEMENT_THRESHOLD,
  similarityThreshold: 5,
  isAutoCaptureEnabled: true,

  initializeSettings: (settings: CalibrationSettings) => {
    set((state) => ({
      patternSize: settings.patternSize ?? state.patternSize,
      squareSize: settings.squareSize ?? state.squareSize,
      stabilityDurationThreshold:
        settings.stabilityDurationThreshold ?? state.stabilityDurationThreshold,
      maxRelativeMovementForStability:
        settings.maxRelativeMovementForStability ??
        state.maxRelativeMovementForStability,
      similarityThreshold:
        settings.similarityThreshold ?? state.similarityThreshold,
      isAutoCaptureEnabled: settings.autoCapture ?? state.isAutoCaptureEnabled,
      // Reset processing state dependent on settings
      wasStableAndUnique: false,
      currentStableDuration: 0,
      isCapturePending: false,
    }));
  },
});

const createCalibrationResultSlice: StateCreator<
  CalibrationState,
  [],
  [],
  CalibrationResultSlice
> = (set, get) => ({
  calibrationResult: null,

  runCalibration: () => {
    // Access state from Capture, Settings, and Camera slices
    const {
      capturedFrames, // Capture
      patternSize, // Settings
      frameWidth, // Camera
      frameHeight, // Camera
      squareSize, // Settings
    } = get();

    const validFrames = capturedFrames.filter((f) => f.imageBlob);
    if (validFrames.length < 3) {
      const errMsg = "At least 3 valid frames required for calibration";
      console.error("[Store:Calibration]", errMsg);
      throw new Error(errMsg); // Propagate error
    }

    try {
      const result = calibrateCamera(
        validFrames,
        patternSize,
        { width: frameWidth, height: frameHeight },
        squareSize
      );
      set({ calibrationResult: result });
    } catch (error) {
      console.error("[Store:Calibration] Calibration failed:", error);
      set({ calibrationResult: null }); // Ensure result is null on error
      throw error; // Re-throw error
    }
  },

  resetCalibration: () => {
    // Reset state across multiple slices
    set({
      // Capture slice
      capturedFrames: [],
      selectedFrameId: null,
      // Calibration slice
      calibrationResult: null,
      // Processing slice
      currentFrameImageData: null, // Clear last processed image
      currentStableDuration: 0,
      lastUpdateTime: 0,
      wasStableAndUnique: false,
      isCapturePending: false,
      previousCornerMetrics: null,
      movementHistory: [],
    });
  },
});

export const useCalibrationStore = create<CalibrationState>()((...a) => ({
  // --- Combine Slices ---
  // Pass the arguments (`set`, `get`, `api`) using the spread operator
  ...createCameraSlice(...a),
  ...createProcessingSlice(...a),
  ...createCaptureSlice(...a),
  ...createSettingsSlice(...a),
  ...createCalibrationResultSlice(...a),
}));
