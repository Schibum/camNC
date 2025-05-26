import { toast } from "@wbcnc/ui/components/sonner";
import { v4 as uuidv4 } from "uuid";
import { create, StateCreator } from "zustand";
import { CalibrateInWorker } from "../lib/calibrateInWorker";
import { calculateSimilarityScore } from "../lib/calibrationCore";
import {
  CalibrationResult,
  CapturedFrame,
  Corner,
  PatternSize,
} from "../lib/calibrationTypes";
import { createImageBlob } from "../lib/imageUtils";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

// Smoothing factor for FPS calculation (lower value = smoother)
const FPS_SMOOTHING_FACTOR = 0.8;
// Default minimum percentage difference between a new detection and all
// previously–captured frames (0‑100 scale)
const DEFAULT_SIMILARITY_THRESHOLD = 5; // «at least 5 % different»

// -----------------------------------------------------------------------------
// Calibration‑settings interface (stability fields permanently removed)
// -----------------------------------------------------------------------------

export interface Resolution {
  width: number;
  height: number;
}

export interface CalibrationSettings {
  patternSize?: PatternSize;
  squareSize?: number;
  autoCapture?: boolean;
  similarityThreshold?: number;
}

// -----------------------------------------------------------------------------
// Slice interfaces – only uniqueness retained
// -----------------------------------------------------------------------------

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
  resetCalibration: () => void;
}

interface ProcessingSlice {
  currentCorners: Corner[] | null;
  currentFrameImageData: ImageData | null;

  // FPS helpers
  detectionFps: number;
  lastFrameProcessedTime: number;

  // Uniqueness metric (0‑100 where 100 ⇒ completely novel)
  uniquenessPercentage: number;

  updateCorners: (corners: Corner[], imageData: ImageData) => void;
  clearCorners: (isBlurry?: boolean) => void;
  resetDetectionFps: () => void;
  updateDetectionFps: () => void;
}

interface CaptureSlice {
  capturedFrames: CapturedFrame[];
  selectedFrameId: string | null;
  showGallery: boolean;
  captureFrame: () => Promise<string | undefined>;
  deleteFrame: (id: string) => void;
  setShowGallery: (show: boolean) => void;
  setSelectedFrame: (id: string | null) => void;
}

interface SettingsSlice {
  patternSize: PatternSize;
  squareSize: number;
  similarityThreshold: number; // «minimum % novelty»
  isAutoCaptureEnabled: boolean;
  isBlurry: boolean;
  initializeSettings: (settings: CalibrationSettings) => void;
}

interface CalibrationResultSlice {
  isCalibrating: boolean;
  calibrationResult: CalibrationResult | null;
  runCalibration: () => void;
  resetCalibration: () => void;
}

// -----------------------------------------------------------------------------
// Combined store type
// -----------------------------------------------------------------------------

type CalibrationState = CameraSlice &
  ProcessingSlice &
  CaptureSlice &
  SettingsSlice &
  CalibrationResultSlice;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function getAspectRatio({ width, height }: Resolution) {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(width, height);
  return `${width / d}:${height / d}`;
}

// -----------------------------------------------------------------------------
// Camera slice (unchanged except for import removal)
// -----------------------------------------------------------------------------

const createCameraSlice: StateCreator<CalibrationState, [], [], CameraSlice> = (
  set,
  get
) => ({
  stream: null,
  videoElement: null,
  frameWidth: 0,
  frameHeight: 0,
  isStreaming: false,

  startCamera: async (source, resolution) => {
    // Ensure previous stream is stopped first
    get().stopCamera();

    const el = document.createElement("video");
    el.autoplay = true;
    el.playsInline = true;
    el.muted = true;

    el.addEventListener(
      "loadedmetadata",
      () => {
        const vidRes = { width: el.videoWidth, height: el.videoHeight };
        if (
          resolution &&
          getAspectRatio(resolution) !== getAspectRatio(vidRes)
        ) {
          toast.error("Aspect‑ratio mismatch", {
            description: `Expected ${getAspectRatio(resolution)}, got ${getAspectRatio(vidRes)}`,
            duration: Infinity,
            closeButton: true,
          });
          throw new Error(
            "Aspect‑ratio mismatch between provided and video element"
          );
        }
        set({ frameWidth: vidRes.width, frameHeight: vidRes.height });
      },
      { once: true }
    );

    if (typeof source === "string") {
      el.src = source;
      el.crossOrigin = "anonymous";
    } else {
      if (!source.active || source.getVideoTracks().length === 0) {
        throw new Error("Invalid MediaStream provided to startCamera");
      }
      el.srcObject = source;
    }

    await el.play();

    set({
      stream: source instanceof MediaStream ? source : null,
      videoElement: el,
      isStreaming: true,
      capturedFrames: [],
      selectedFrameId: null,
      currentCorners: null,
      currentFrameImageData: null,
      uniquenessPercentage: 100,
    });
    get().resetDetectionFps();
  },

  stopCamera: () => {
    const { videoElement } = get();
    if (videoElement) {
      videoElement.pause();
      videoElement.srcObject = null;
    }

    set({
      stream: null,
      videoElement: null,
      isStreaming: false,
      frameWidth: 0,
      frameHeight: 0,
      currentCorners: null,
      currentFrameImageData: null,
      selectedFrameId: null,
      uniquenessPercentage: 100,
    });
    get().resetDetectionFps();
  },

  setFrameDimensions: (w, h) => set({ frameWidth: w, frameHeight: h }),

  resetCalibration: () => {
    set({ capturedFrames: [], selectedFrameId: null, calibrationResult: null });
  },
});

// -----------------------------------------------------------------------------
// Processing slice – adds uniqueness logic
// -----------------------------------------------------------------------------

const createProcessingSlice: StateCreator<
  CalibrationState,
  [],
  [],
  ProcessingSlice
> = (set, get) => ({
  currentCorners: null,
  currentFrameImageData: null,
  detectionFps: 0,
  lastFrameProcessedTime: 0,
  uniquenessPercentage: 100,

  updateCorners: (corners, imageData) => {
    // FPS first
    get().updateDetectionFps();

    set({ currentCorners: corners, currentFrameImageData: imageData });

    const {
      capturedFrames,
      frameWidth,
      frameHeight,
      similarityThreshold,
      isAutoCaptureEnabled,
    } = get();

    // 1 · How novel is this detection compared with saved frames?
    const uniqueness = calculateSimilarityScore(
      corners,
      capturedFrames,
      frameWidth,
      frameHeight
    );
    const uniquenessPct = uniqueness * 100;
    set({ uniquenessPercentage: uniquenessPct, isBlurry: false });

    // 2 · Fire capture if it clears the novelty bar
    if (isAutoCaptureEnabled && uniquenessPct >= similarityThreshold) {
      get()
        .captureFrame()
        .catch((e) => console.error("Auto‑capture failed", e));
    }
  },

  clearCorners: (isBlurry = false) =>
    set({
      currentCorners: null,
      currentFrameImageData: null,
      uniquenessPercentage: 100,
      isBlurry,
    }),

  resetDetectionFps: () => set({ detectionFps: 0, lastFrameProcessedTime: 0 }),

  updateDetectionFps: () => {
    const { lastFrameProcessedTime, detectionFps } = get();
    const now = performance.now();
    const delta = now - lastFrameProcessedTime;

    if (lastFrameProcessedTime > 0 && delta > 0) {
      const raw = 1000 / delta;
      const smoothed =
        FPS_SMOOTHING_FACTOR * raw + (1 - FPS_SMOOTHING_FACTOR) * detectionFps;
      set({ detectionFps: smoothed });
    }

    set({ lastFrameProcessedTime: now });
  },
});

// Capture slice (unchanged except for uniqueness reset after delete)

const createCaptureSlice: StateCreator<
  CalibrationState,
  [],
  [],
  CaptureSlice
> = (set, get) => ({
  capturedFrames: [],
  selectedFrameId: null,
  showGallery: false,

  captureFrame: async () => {
    const { currentCorners, currentFrameImageData } = get();
    if (!currentCorners) {
      toast.warning("No chessboard detected to capture", {
        id: "no-chessboard-detected",
      });
      return;
    }
    if (!currentFrameImageData) {
      console.error("No ImageData available for capture");
      return;
    }

    try {
      const blob = await createImageBlob(
        currentFrameImageData,
        "image/jpeg",
        0.9
      );
      const id = uuidv4();
      const frame: CapturedFrame = {
        id,
        imageBlob: blob,
        corners: currentCorners,
        timestamp: Date.now(),
      };
      set((s) => ({
        capturedFrames: [...s.capturedFrames, frame],
        uniquenessPercentage: 0,
      }));
      return id;
    } catch (err) {
      console.error("Error creating image blob", err);
    }
  },

  deleteFrame: (id) =>
    set((state) => ({
      capturedFrames: state.capturedFrames.filter((f) => f.id !== id),
      selectedFrameId:
        state.selectedFrameId === id ? null : state.selectedFrameId,
      uniquenessPercentage: 100, // reset – next detection will recalc
    })),

  setShowGallery: (show) => set({ showGallery: show }),
  setSelectedFrame: (id) => set({ selectedFrameId: id }),
});

// -----------------------------------------------------------------------------
// Settings slice – adds similarityThreshold back
// -----------------------------------------------------------------------------

const createSettingsSlice: StateCreator<
  CalibrationState,
  [],
  [],
  SettingsSlice
> = (set) => ({
  patternSize: { width: 9, height: 6 },
  squareSize: 1.0,
  similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
  isAutoCaptureEnabled: true,
  isBlurry: false,
  initializeSettings: (s) =>
    set((st) => ({
      patternSize: s.patternSize ?? st.patternSize,
      squareSize: s.squareSize ?? st.squareSize,
      similarityThreshold: s.similarityThreshold ?? st.similarityThreshold,
      isAutoCaptureEnabled: s.autoCapture ?? st.isAutoCaptureEnabled,
    })),
});

// -----------------------------------------------------------------------------
// Calibration‑result slice (unchanged)
// -----------------------------------------------------------------------------

const createCalibrationResultSlice: StateCreator<
  CalibrationState,
  [],
  [],
  CalibrationResultSlice
> = (set, get) => ({
  calibrationResult: null,
  isCalibrating: false,
  runCalibration: async () => {
    const { capturedFrames, patternSize, frameWidth, frameHeight, squareSize } =
      get();
    const valid = capturedFrames.filter((f) => f.imageBlob);
    if (valid.length < 3) {
      throw new Error("At least 3 valid frames required for calibration");
    }
    set({ isCalibrating: true });
    const worker = new CalibrateInWorker();
    try {
      const result = await worker.calibrate(
        valid,
        patternSize,
        { width: frameWidth, height: frameHeight },
        squareSize
      );
      const updatedFrames = capturedFrames.map((f, idx) => ({
        ...f,
        perViewError: result.perViewErrors[idx],
      }));
      set({ calibrationResult: result, capturedFrames: updatedFrames });
    } finally {
      set({ isCalibrating: false });
      await worker.terminate();
    }
  },

  resetCalibration: () =>
    set({ capturedFrames: [], selectedFrameId: null, calibrationResult: null }),
});

// -----------------------------------------------------------------------------
// Store factory – combine slices
// -----------------------------------------------------------------------------

export const useCalibrationStore = create<CalibrationState>()((...a) => ({
  ...createCameraSlice(...a),
  ...createProcessingSlice(...a),
  ...createCaptureSlice(...a),
  ...createSettingsSlice(...a),
  ...createCalibrationResultSlice(...a),
}));
