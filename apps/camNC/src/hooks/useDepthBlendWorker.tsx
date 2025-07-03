import { DepthBlendManager } from '@/depth/depthBlendManager';
import { RemapStepParams } from '@/depth/remapPipeline';
import {
  useCalibrationData,
  useCamResolution,
  useCameraExtrinsics,
  useDepthBlendEnabled,
  useDepthSettings,
  useSetBgTexture,
  useSetMaskTexture,
  useStore,
  useVideoUrl,
} from '@/store/store';
import { useVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { Suspense, useEffect, useMemo } from 'react';

function DepthBlendWorkerSuspending() {
  useDepthBlendWorker();
  return null;
}

// Adds useDepthBlendWorker no-op instead of suspending while video is loading.
export function DepthBlendWorker() {
  return (
    <Suspense fallback={null}>
      <DepthBlendWorkerSuspending />
    </Suspense>
  );
}

// Connect React state with DepthBlendManager
// eslint-disable-next-line react-refresh/only-export-components
export function useDepthBlendWorker() {
  const depthBlendManager = DepthBlendManager.getInstance();

  const enabled = useDepthBlendEnabled();
  const setMaskTex = useSetMaskTexture();
  const setBgTex = useSetBgTexture();

  const videoUrl = useVideoUrl();
  const { src: vidSource } = useVideoSource(videoUrl);

  const calibration = useCalibrationData();
  const camRes = useCamResolution();
  const { R, t } = useCameraExtrinsics();
  const bounds = useStore(state => state.camSource!.machineBounds!);

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
    depthBlendManager.onTextures(textures => {
      setMaskTex(textures.mask);
      setBgTex(textures.bg);
    });
  }, [depthBlendManager, setMaskTex, setBgTex]);

  useEffect(() => {
    if (enabled) {
      depthBlendManager.start().catch(console.error);
    } else {
      depthBlendManager.stop().catch(console.error);
    }
  }, [depthBlendManager, enabled]);

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
