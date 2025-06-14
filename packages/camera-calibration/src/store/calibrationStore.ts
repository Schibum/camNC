import { toast } from '@wbcnc/ui/components/sonner';
import * as Comlink from 'comlink';
import { v4 as uuidv4 } from 'uuid';
import { create, StateCreator } from 'zustand';
import { GridHeatmapTracker } from '../components/CoverageHeatmap';
import { CalibrateInWorker } from '../lib/calibrateInWorker';
import { CalibrationResult, CapturedFrame, Corner, PatternSize } from '../lib/calibrationTypes';
import { createImageBlob } from '../lib/imageUtils';
import { attachMediaStreamTrackReplacer, createVideoStreamProcessor } from '../utils/videoStreamUtils';
import type { FrameEvent, StreamCornerFinderWorkerAPI } from '../workers/streamCornerFinder.worker';

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
  // Optional, externally provided max resolution of the stream.
  maxResolution: Resolution | null;
  workerCleanup: (() => void) | null;
  // Promise for an in-flight startCamera call
  startPromise: Promise<void> | null;
  // Flag to indicate a stop was requested during start
  stopRequested: boolean;

  startCamera: (source: MediaStream | string, resolution?: Resolution) => Promise<void>;
  stopCamera: () => void;
  pauseProcessing: () => Promise<void>;
  resumeProcessing: () => Promise<void>;
  setFrameDimensions: (width: number, height: number) => void;
  resetCalibration: () => void;
  onLoadedMetadata: (el: HTMLVideoElement, maxResolution?: Resolution) => void;
}

type RejectedReason = 'blurry' | 'not_unique';

interface ProcessingSlice {
  currentCorners: Corner[] | null;
  currentFrameImageData: ImageData | null;
  heatmapTracker: GridHeatmapTracker | null;
  heatmapTick: number;
  rejectedReason: RejectedReason | null;
  // FPS from worker
  detectionFps: number;
  onFrameProcessed: (data: FrameEvent) => void;
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

type CalibrationState = CameraSlice & ProcessingSlice & CaptureSlice & SettingsSlice & CalibrationResultSlice;

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

const createCameraSlice: StateCreator<CalibrationState, [], [], CameraSlice> = (set, get) => ({
  stream: null,
  videoElement: null,
  frameWidth: 0,
  frameHeight: 0,
  isStreaming: false,
  cornerWorker: null,
  workerCleanup: null,
  maxResolution: null,
  startPromise: null,
  stopRequested: false,

  onLoadedMetadata: (el: HTMLVideoElement, maxResolution?: Resolution) => {
    if (get().stopRequested) return;

    const vidRes = { width: el.videoWidth, height: el.videoHeight };
    if (maxResolution && getAspectRatio(maxResolution) !== getAspectRatio(vidRes)) {
      toast.error('Aspect‑ratio mismatch', {
        description: `Expected ${getAspectRatio(maxResolution)}, got ${getAspectRatio(vidRes)}. Make sure to lock device in portrait mode.`,
        duration: Infinity,
        closeButton: true,
      });
      throw new Error('Aspect‑ratio mismatch between provided and video element');
    }
    const frameRes = maxResolution ?? vidRes;
    set({
      frameWidth: frameRes.width,
      frameHeight: frameRes.height,
      heatmapTracker: new GridHeatmapTracker(10, 10, frameRes.width, frameRes.height),
    });
  },

  startCamera: async (source, resolution) => {
    // Wait for any in-flight startCamera to complete
    const prev = get().startPromise;
    if (prev) await prev;

    // Stop any active camera (resets state)
    get().stopCamera();

    // Create new startPromise and reset stopRequested
    let resolveStart!: () => void;
    const startPromise = new Promise<void>(res => {
      resolveStart = res;
    });
    set({ startPromise, stopRequested: false });

    const el = document.createElement('video');
    el.autoplay = true;
    el.playsInline = true;
    el.muted = true;

    el.addEventListener(
      'loadedmetadata',
      () => {
        get().onLoadedMetadata(el, resolution);
      },
      { once: true }
    );

    if (typeof source === 'string') {
      el.src = source;
      el.crossOrigin = 'anonymous';
    } else {
      if (!source.active || source.getVideoTracks().length === 0) {
        throw new Error('Invalid MediaStream provided to startCamera');
      }
      el.srcObject = source;
    }

    await el.play();

    try {
      const { patternSize } = get();
      const frameSize = resolution || {
        width: el.videoWidth,
        height: el.videoHeight,
      };

      const videoStream = await createVideoStreamProcessor(source);

      const worker = new Worker(new URL('../workers/streamCornerFinder.worker.ts', import.meta.url), { type: 'module' });
      const workerProxy = Comlink.wrap<StreamCornerFinderWorkerAPI>(worker);

      await workerProxy.init(
        Comlink.transfer(videoStream as any, [videoStream as any]),
        // Comlink.transfer(videoStream, []),
        patternSize,
        frameSize,
        Comlink.proxy(get().onFrameProcessed)
      );

      await workerProxy.start();

      // Attach automatic track-replacement if the source is a live MediaStream
      let replacerCleanup: (() => void) | null = null;
      if (source instanceof MediaStream) {
        replacerCleanup = attachMediaStreamTrackReplacer(source, workerProxy);
      }

      const cleanup = () => {
        console.log('[CalibrationStore] Cleaning up corner worker');
        workerProxy.stop().catch(console.error);
        worker.terminate();
        replacerCleanup?.();
        // if (source instanceof MediaStream)
        //   source.getVideoTracks().forEach((t) => t.stop());
      };

      if (!get().stopRequested) {
        set({
          stream: source instanceof MediaStream ? source : null,
          videoElement: el,
          maxResolution: resolution,
          isStreaming: true,
          capturedFrames: [],
          selectedFrameId: null,
          currentCorners: null,
          currentFrameImageData: null,
          rejectedReason: null,
          detectionFps: 0,
          cornerWorker: workerProxy,
          workerCleanup: cleanup,
        });
      } else {
        cleanup();
      }
    } catch (error) {
      console.error('[CalibrationStore] Failed to initialize corner worker:', error);
    } finally {
      resolveStart();
      set({ startPromise: null });
    }
  },

  stopCamera: () => {
    const { videoElement, workerCleanup } = get();
    // Signal any in-flight startCamera to abort
    set({ stopRequested: true });

    // Clean up active worker if any
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
      rejectedReason: null,
      currentCorners: null,
      currentFrameImageData: null,
      selectedFrameId: null,
      detectionFps: 0,
      cornerWorker: null,
      workerCleanup: null,
    });
  },

  pauseProcessing: async () => {
    const { cornerWorker } = get();
    if (cornerWorker) {
      try {
        await cornerWorker.pause();
        console.log('[CalibrationStore] Processing paused');
      } catch (error) {
        console.error('[CalibrationStore] Failed to pause processing:', error);
      }
    }
  },

  resumeProcessing: async () => {
    const { cornerWorker } = get();
    if (cornerWorker) {
      try {
        await cornerWorker.resume();
        console.log('[CalibrationStore] Processing resumed');
      } catch (error) {
        console.error('[CalibrationStore] Failed to resume processing:', error);
      }
    }
  },

  setFrameDimensions: (w, h) => set({ frameWidth: w, frameHeight: h }),

  resetCalibration: () => {
    set({ capturedFrames: [], selectedFrameId: null, calibrationResult: null });
  },
});

// Processing slice
const createProcessingSlice: StateCreator<CalibrationState, [], [], ProcessingSlice> = (set, get) => ({
  currentCorners: null,
  currentFrameImageData: null,
  detectionFps: 0,
  heatmapTracker: null,
  heatmapTick: 0,
  rejectedReason: null,
  onFrameProcessed: (data: FrameEvent) => {
    if (data.result === 'capture') {
      set({
        currentCorners: data.corners,
        currentFrameImageData: data.imageData,
        detectionFps: data.fps,
        rejectedReason: null,
      });
      if (get().isAutoCaptureEnabled) {
        get()
          .captureFrame()
          .catch(e => console.error('Auto‑capture failed', e));
      }
    } else {
      set({
        currentCorners: data.corners,
        currentFrameImageData: null,
        rejectedReason: data.result,
        detectionFps: data.fps,
      });
    }
  },
});

// Capture slice (unchanged except for uniqueness reset after delete)

const createCaptureSlice: StateCreator<CalibrationState, [], [], CaptureSlice> = (set, get) => ({
  capturedFrames: [],
  selectedFrameId: null,
  showGallery: false,

  captureFrame: async () => {
    const { currentCorners, currentFrameImageData, heatmapTracker } = get();
    if (!currentCorners) {
      toast.warning('No chessboard detected to capture', {
        id: 'no-chessboard-detected',
      });
      return;
    }
    if (!currentFrameImageData) {
      throw new Error('No ImageData available for capture');
    }
    if (!heatmapTracker) {
      throw new Error('No heatmap tracker available for capture');
    }
    heatmapTracker.addCorners(currentCorners);
    set({ heatmapTick: get().heatmapTick + 1 });

    try {
      const blob = await createImageBlob(currentFrameImageData, 'image/jpeg', 0.9);
      const id = uuidv4();
      const frame: CapturedFrame = {
        id,
        imageBlob: blob,
        corners: currentCorners,
        timestamp: Date.now(),
      };
      set(s => ({
        capturedFrames: [...s.capturedFrames, frame],
      }));
      return id;
    } catch (err) {
      console.error('Error creating image blob', err);
    }
  },

  deleteFrame: id =>
    set(state => ({
      capturedFrames: state.capturedFrames.filter(f => f.id !== id),
      selectedFrameId: state.selectedFrameId === id ? null : state.selectedFrameId,
    })),

  setShowGallery: show => set({ showGallery: show }),
  setSelectedFrame: id => set({ selectedFrameId: id }),
});

// Settings slice
const createSettingsSlice: StateCreator<CalibrationState, [], [], SettingsSlice> = set => ({
  patternSize: { width: 9, height: 6 },
  squareSize: 1.0,
  isAutoCaptureEnabled: true,
  zeroTangentDist: false,
  initializeSettings: s =>
    set(st => ({
      patternSize: s.patternSize ?? st.patternSize,
      squareSize: s.squareSize ?? st.squareSize,
      isAutoCaptureEnabled: s.autoCapture ?? st.isAutoCaptureEnabled,
      zeroTangentDist: !!s.zeroTangentDist,
    })),
});

// Calibration‑result slice
const createCalibrationResultSlice: StateCreator<CalibrationState, [], [], CalibrationResultSlice> = (set, get) => ({
  calibrationResult: null,
  isCalibrating: false,
  runCalibration: async () => {
    const { capturedFrames, patternSize, frameWidth, frameHeight, squareSize, zeroTangentDist } = get();
    const frames = capturedFrames.map(f => ({
      ...f,
      // Blob not needed for calibration, don't sent to worker
      imageBlob: null,
    }));
    if (frames.length < 3) {
      throw new Error('At least 3 valid frames required for calibration');
    }
    set({ isCalibrating: true });
    const worker = new CalibrateInWorker();
    try {
      const result = await worker.calibrate(frames, patternSize, { width: frameWidth, height: frameHeight }, squareSize, zeroTangentDist);
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

  resetCalibration: () => set({ capturedFrames: [], selectedFrameId: null, calibrationResult: null }),
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
