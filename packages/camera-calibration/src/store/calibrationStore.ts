import { toast } from "@wbcnc/ui/components/sonner";
import * as Comlink from "comlink";
import { v4 as uuidv4 } from "uuid";
import { create, StateCreator } from "zustand";
import { GridHeatmapTracker } from "../components/CoverageHeatmap";
import { CalibrateInWorker } from "../lib/calibrateInWorker";
import {
  CalibrationResult,
  CapturedFrame,
  Corner,
  PatternSize,
} from "../lib/calibrationTypes";
import { createImageBlob } from "../lib/imageUtils";
import { createVideoStreamProcessor } from "../utils/videoStreamUtils";
import type {
  CornerClearedEvent,
  CornerDetectedEvent,
  StreamCornerFinderWorkerAPI,
} from "../workers/streamCornerFinder.worker";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

// Constants section now empty, can be removed if no other constants are added

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
  zeroTangentDist?: boolean;
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
  cornerWorker: Comlink.Remote<StreamCornerFinderWorkerAPI> | null;
  workerCleanup: (() => void) | null;

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
  heatmapTracker: GridHeatmapTracker | null;
  heatmapTick: number;
  isBlurry: boolean;
  isUnique: boolean;

  // FPS from worker
  detectionFps: number;

  updateCorners: (
    corners: Corner[],
    imageData: ImageData,
    isUnique: boolean,
    fps: number
  ) => void;
  clearCorners: (isBlurry?: boolean, fps?: number) => void;
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
  isAutoCaptureEnabled: boolean;
  zeroTangentDist: boolean;
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
  cornerWorker: null,
  workerCleanup: null,

  startCamera: async (source, resolution) => {
    // Ensure previous stream is stopped first
    get().stopCamera();

    const el = document.createElement("video");
    el.autoplay = true;
    el.playsInline = true;
    el.muted = true;

    function onLoadedMetadata() {
      const vidRes = { width: el.videoWidth, height: el.videoHeight };
      if (resolution && getAspectRatio(resolution) !== getAspectRatio(vidRes)) {
        toast.error("Aspect‑ratio mismatch", {
          description: `Expected ${getAspectRatio(resolution)}, got ${getAspectRatio(vidRes)}. Make sure to lock device in portrait mode.`,
          duration: Infinity,
          closeButton: true,
        });
        throw new Error(
          "Aspect‑ratio mismatch between provided and video element"
        );
      }
      if (resolution)
        set({ frameWidth: resolution.width, frameHeight: resolution.height });
      else set({ frameWidth: vidRes.width, frameHeight: vidRes.height });
      set({
        heatmapTracker: new GridHeatmapTracker(
          10,
          10,
          vidRes.width,
          vidRes.height
        ),
      });
    }

    el.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });

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

    // Initialize the new stream-based corner finder worker
    try {
      const { patternSize } = get();
      const frameSize = resolution || {
        width: el.videoWidth,
        height: el.videoHeight,
      };

      // Create video stream processor
      const videoStream = await createVideoStreamProcessor(source);

      // Create and initialize worker
      const worker = new Worker(
        new URL("../workers/streamCornerFinder.worker.ts", import.meta.url),
        { type: "module" }
      );
      const workerProxy = Comlink.wrap<StreamCornerFinderWorkerAPI>(worker);

      // Set up event handlers (pass directly to init)
      const onCornersDetected = (data: CornerDetectedEvent) => {
        get().updateCorners(
          data.corners,
          data.imageData,
          data.isUnique,
          data.fps
        );
      };

      const onCornersCleared = (data: CornerClearedEvent) => {
        get().clearCorners(data.isBlurry, data.fps);
      };

      // Initialize worker with stream and callbacks
      await workerProxy.init(
        Comlink.transfer(videoStream as any, [videoStream as any]),
        patternSize,
        frameSize,
        Comlink.proxy(onCornersDetected),
        Comlink.proxy(onCornersCleared)
      );

      // Start processing
      await workerProxy.start();

      // Set up cleanup function
      const cleanup = () => {
        console.log("[CalibrationStore] Cleaning up corner worker");
        workerProxy.stop().catch(console.error);
        worker.terminate();
        if (typeof source !== "string" && source instanceof MediaStream) {
          // Stop video tracks if we created a MediaStream
          source.getVideoTracks().forEach((track) => track.stop());
        }
      };

      set({ cornerWorker: workerProxy, workerCleanup: cleanup });
    } catch (error) {
      console.error(
        "[CalibrationStore] Failed to initialize corner worker:",
        error
      );
      // Continue without worker for now - could fall back to old method
    }

    set({
      stream: source instanceof MediaStream ? source : null,
      videoElement: el,
      isStreaming: true,
      capturedFrames: [],
      selectedFrameId: null,
      currentCorners: null,
      currentFrameImageData: null,
      isBlurry: false,
      isUnique: false,
      detectionFps: 0,
    });
  },

  stopCamera: () => {
    const { videoElement, workerCleanup } = get();

    // Clean up worker first
    if (workerCleanup) {
      workerCleanup();
    }

    // Clean up video element
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
      isBlurry: false,
      isUnique: false,
      currentCorners: null,
      currentFrameImageData: null,
      selectedFrameId: null,
      detectionFps: 0,
      cornerWorker: null,
      workerCleanup: null,
    });
  },

  setFrameDimensions: (w, h) => set({ frameWidth: w, frameHeight: h }),

  resetCalibration: () => {
    set({ capturedFrames: [], selectedFrameId: null, calibrationResult: null });
  },
});

// Processing slice
const createProcessingSlice: StateCreator<
  CalibrationState,
  [],
  [],
  ProcessingSlice
> = (set, get) => ({
  currentCorners: null,
  currentFrameImageData: null,
  detectionFps: 0,
  heatmapTracker: null,
  heatmapTick: 0,
  isBlurry: false,
  isUnique: false,

  updateCorners: (corners, imageData, isUnique, fps) => {
    set({
      currentCorners: corners,
      currentFrameImageData: imageData,
      isUnique,
      isBlurry: false,
      detectionFps: fps,
    });

    const { isAutoCaptureEnabled } = get();
    if (isAutoCaptureEnabled && isUnique) {
      get()
        .captureFrame()
        .catch((e) => console.error("Auto‑capture failed", e));
    }
  },

  clearCorners: (isBlurry = false, fps = 0) => {
    const updates = {
      currentCorners: null,
      currentFrameImageData: null,
      isBlurry,
      isUnique: false,
      detectionFps: fps,
    };

    set(updates);
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
    const { currentCorners, currentFrameImageData, heatmapTracker } = get();
    if (!currentCorners) {
      toast.warning("No chessboard detected to capture", {
        id: "no-chessboard-detected",
      });
      return;
    }
    if (!currentFrameImageData) {
      throw new Error("No ImageData available for capture");
    }
    if (!heatmapTracker) {
      throw new Error("No heatmap tracker available for capture");
    }
    heatmapTracker.addCorners(currentCorners);
    set({ heatmapTick: get().heatmapTick + 1 });

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
    })),

  setShowGallery: (show) => set({ showGallery: show }),
  setSelectedFrame: (id) => set({ selectedFrameId: id }),
});

// Settings slice
const createSettingsSlice: StateCreator<
  CalibrationState,
  [],
  [],
  SettingsSlice
> = (set) => ({
  patternSize: { width: 9, height: 6 },
  squareSize: 1.0,
  isAutoCaptureEnabled: true,
  zeroTangentDist: false,
  initializeSettings: (s) =>
    set((st) => ({
      patternSize: s.patternSize ?? st.patternSize,
      squareSize: s.squareSize ?? st.squareSize,
      isAutoCaptureEnabled: s.autoCapture ?? st.isAutoCaptureEnabled,
      zeroTangentDist: !!s.zeroTangentDist,
    })),
});

// Calibration‑result slice
const createCalibrationResultSlice: StateCreator<
  CalibrationState,
  [],
  [],
  CalibrationResultSlice
> = (set, get) => ({
  calibrationResult: null,
  isCalibrating: false,
  runCalibration: async () => {
    const {
      capturedFrames,
      patternSize,
      frameWidth,
      frameHeight,
      squareSize,
      zeroTangentDist,
    } = get();
    const frames = capturedFrames.map((f) => ({
      ...f,
      // Blob not needed for calibration, don't sent to worker
      imageBlob: null,
    }));
    if (frames.length < 3) {
      throw new Error("At least 3 valid frames required for calibration");
    }
    set({ isCalibrating: true });
    const worker = new CalibrateInWorker();
    try {
      const result = await worker.calibrate(
        frames,
        patternSize,
        { width: frameWidth, height: frameHeight },
        squareSize,
        zeroTangentDist
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
