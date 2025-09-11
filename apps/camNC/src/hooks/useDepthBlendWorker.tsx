import { DepthBlendManager } from '@/depth/depthBlendManager';
import { RemapStepParams } from '@/depth/remapPipeline';
import {
  useCalibrationData,
  useCamResolution,
  useCamSource,
  useCameraExtrinsics,
  useDepthBlendEnabled,
  useSetDepthBlendEnabled,
  useDepthSettings,
  useSetBgTexture,
  useSetDepthBlendInitializing,
  useSetMaskTexture,
  useVideoUrl,
} from '@/store/store';
import { useVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { toast } from '@wbcnc/ui/components/sonner';
import { Suspense, useEffect, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

function DepthBlendWorkerSuspending() {
  useDepthBlendWorker();
  return null;
}

// Adds useDepthBlendWorker no-op instead of suspending while video is loading.
export function DepthBlendWorker() {
  return (
    <Suspense fallback={null}>
      <ErrorBoundary
        fallback={null}
        onError={() => {
          console.error('Error loading depth blend worker');
          toast.error('Error loading depth blend worker', { duration: Infinity, closeButton: true });
        }}>
        <DepthBlendWorkerSuspending />
      </ErrorBoundary>
    </Suspense>
  );
}

// Connect React state with DepthBlendManager
// eslint-disable-next-line react-refresh/only-export-components
export function useDepthBlendWorker() {
  const depthBlendManager = DepthBlendManager.getInstance();

  const enabled = useDepthBlendEnabled();
  const setEnabled = useSetDepthBlendEnabled();
  const setInitializing = useSetDepthBlendInitializing();
  const setMaskTex = useSetMaskTexture();
  const setBgTex = useSetBgTexture();

  const videoUrl = useVideoUrl();
  const { src: vidSource } = useVideoSource(videoUrl);

  const calibration = useCalibrationData();
  const camRes = useCamResolution();
  const { R, t } = useCameraExtrinsics();
  const camSource = useCamSource();
  if (!camSource || !camSource.machineBounds) {
    throw new Error('No camera source found');
  }
  const bounds = camSource.machineBounds!;

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
      // First textures arrived: mark initialized
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
      depthBlendManager.start().catch(err => {
        if (cancelled) return;
        console.error(err);
        toast.error('Failed to start Hide‑Machine', { closeButton: true });
        setInitializing(false);
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
