import { DepthBlendManager } from '@/depth/depthBlendManager';
import { RemapStepParams } from '@/depth/remapPipeline';
import {
  useCalibrationData,
  useCamResolution,
  useCamSource,
  useCameraExtrinsics,
  useDepthBlendEnabled,
  useDepthSettings,
  useSetBgTexture,
  useSetDepthBlendEnabled,
  useSetDepthBlendInitializing,
  useSetMaskTexture,
  useVideoUrl,
  useMachineBoundsOrNull,
} from '@/store/store';
import { useVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { toast } from '@wbcnc/ui/components/sonner';
import { Suspense, useEffect, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

type VideoSourceSrc = ReturnType<typeof useVideoSource>['src'];

const kVideoErrorToastId = 'depth-blend-video-source-error';

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'unknown error';
}

function DepthBlendWorkerInner({ vidSource }: { vidSource: VideoSourceSrc }) {
  useDepthBlendWorker(vidSource);
  return null;
}

// Suspends until the video source is connected, then starts the worker in its own boundary so a failing
// video source is not reported as a worker failure.
function DepthBlendVideoSource({ videoUrl }: { videoUrl: string }) {
  const { src } = useVideoSource(videoUrl);
  useEffect(() => {
    // The source (re)connected: a previous connection error no longer applies.
    toast.dismiss(kVideoErrorToastId);
  }, [src]);
  return (
    <ErrorBoundary
      fallback={null}
      onError={error => {
        console.error('Error loading depth blend worker', error);
        toast.error(`Error loading depth blend worker: ${errorMessage(error)}`, { duration: Infinity, closeButton: true });
      }}>
      <DepthBlendWorkerInner vidSource={src} />
    </ErrorBoundary>
  );
}

// Adds useDepthBlendWorker no-op instead of suspending while video is loading.
export function DepthBlendWorker() {
  const videoUrl = useVideoUrl();
  return (
    <ErrorBoundary
      fallback={null}
      // Retry when the user picks another video source.
      resetKeys={[videoUrl]}
      onError={error => {
        console.error('Error connecting to video source', error);
        toast.error(`Video source failed: ${errorMessage(error)}`, {
          id: kVideoErrorToastId,
          duration: Infinity,
          closeButton: true,
        });
      }}>
      <Suspense fallback={null}>
        <DepthBlendVideoSource videoUrl={videoUrl} />
      </Suspense>
    </ErrorBoundary>
  );
}

// Connect React state with DepthBlendManager
// eslint-disable-next-line react-refresh/only-export-components
export function useDepthBlendWorker(vidSource: VideoSourceSrc) {
  const depthBlendManager = DepthBlendManager.getInstance();

  const enabled = useDepthBlendEnabled();
  const setEnabled = useSetDepthBlendEnabled();
  const setInitializing = useSetDepthBlendInitializing();
  const setMaskTex = useSetMaskTexture();
  const setBgTex = useSetBgTexture();

  const calibration = useCalibrationData();
  const camRes = useCamResolution();
  const { R, t } = useCameraExtrinsics();
  const camSource = useCamSource();
  const bounds = useMachineBoundsOrNull();
  if (!camSource || !bounds) {
    throw new Error('No camera source found');
  }

  const depthSettings = useDepthSettings();

  // Memoise parameters
  const params: RemapStepParams = useMemo(() => {
    const margin = 20;
    return {
      outputSize: camRes,
      machineBounds: [bounds.min.x - margin, bounds.min.y - margin, bounds.max.x + margin, bounds.max.y + margin],
      cameraMatrix: calibration.calibration_matrix,
      newCameraMatrix: calibration.new_camera_matrix,
      distCoeffs: calibration.distortion_coefficients,
      R,
      t,
    } satisfies RemapStepParams;
  }, [camRes, bounds, calibration, R, t]);

  useEffect(() => {
    depthBlendManager.setVideoSource(vidSource).catch(console.error);
  }, [depthBlendManager, vidSource]);

  useEffect(() => {
    depthBlendManager.setParams(params).catch(console.error);
  }, [depthBlendManager, params]);

  useEffect(() => {
    const unsubscribe = depthBlendManager.onTextures(textures => {
      // Ignore late frames from old sessions when disabled
      if (!enabled) return;
      setMaskTex(textures.mask);
      setBgTex(textures.bg);
      setInitializing(false);
    });
    return () => {
      unsubscribe?.();
    };
  }, [depthBlendManager, setMaskTex, setBgTex, setInitializing, enabled]);

  useEffect(() => {
    let cancelled = false;
    if (enabled) {
      // Starting worker may trigger model download on first use
      setInitializing(true);
      depthBlendManager
        .start()
        .then(() => setInitializing(false))
        .catch(err => {
          if (cancelled) return;
          console.error(err);
          toast.error('Failed to start Hide‑Machine', { closeButton: true });
          // Reset toggle to reflect failure
          setEnabled(false);
        });
    } else {
      depthBlendManager.stop().catch(console.error);
      setInitializing(false);
    }
    return () => {
      cancelled = true;
    };
  }, [depthBlendManager, enabled, setInitializing, setEnabled]);

  // Push runtime settings to worker whenever they change.
  useEffect(() => {
    depthBlendManager.setProcessingSettings({
      frameRateLimit: depthSettings.frameRateLimit,
      bgMargin: depthSettings.bgMargin,
      renderMargin: depthSettings.renderMargin,
      thresholdOffset: depthSettings.thresholdOffset,
    });
  }, [depthBlendManager, depthSettings]);
}
