import { DepthBlendManager } from '@/depth/depthBlendManager';
import { RemapStepParams } from '@/depth/remapPipeline';
import {
  useCalibrationData,
  useCamResolution,
  useCameraExtrinsics,
  useDepthBlendEnabled,
  useSetBgTexture,
  useSetMaskTexture,
  useStore,
  useVideoUrl,
} from '@/store/store';
import { useVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { useEffect } from 'react';

/**
 * Hook that manages depth blend processing lifecycle.
 * When enabled, starts the global DepthBlendManager with current parameters.
 */
export function useDepthBlendWorker() {
  const enabled = useDepthBlendEnabled();
  const setMaskTex = useSetMaskTexture();
  const setBgTex = useSetBgTexture();

  const videoUrl = useVideoUrl();
  const { src: vidSource } = useVideoSource(videoUrl);
  const calibration = useCalibrationData();
  const camRes = useCamResolution();
  const { R, t } = useCameraExtrinsics();
  const bounds = useStore(state => state.camSource!.machineBounds!);

  useEffect(() => {
    if (!enabled) return;

    const depthBlendManager = DepthBlendManager.getInstance();

    const margin = 20;
    const params: RemapStepParams = {
      outputSize: camRes,
      machineBounds: [bounds.min.x - margin, bounds.min.y - margin, bounds.max.x + margin, bounds.max.y + margin],
      cameraMatrix: calibration.calibration_matrix,
      newCameraMatrix: calibration.new_camera_matrix,
      distCoeffs: calibration.distortion_coefficients,
      R,
      t,
    };

    // Start processing
    depthBlendManager.start(vidSource, params, textures => {
      setMaskTex(textures.mask);
      setBgTex(textures.bg);
    });

    // Note: cleanup is handled by setDepthBlendEnabled(false) in the store
  }, [enabled, vidSource, calibration, camRes, bounds, R, t, setMaskTex, setBgTex]);
}
