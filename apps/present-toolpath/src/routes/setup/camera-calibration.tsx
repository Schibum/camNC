import { AlreadyCalibratedDialog } from '@/setup/already-calibrated-dialog';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { CalibrationResult, CameraCalibration } from '@wbcnc/camera-calibration';
import { useVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { use } from 'react';
import { Matrix3 } from 'three';
import { useStore } from '../../store';

export const Route = createFileRoute('/setup/camera-calibration')({
  component: RouteComponent,
  loader: async () => {
    const camSource = useStore.getState().camSource;
    if (!camSource) {
      throw redirect({ to: '/setup/url-entry' });
    }
    return camSource;
  },
});

function RouteComponent() {
  use(ensureOpenCvIsLoaded());
  const { url, maxResolution } = Route.useLoaderData();
  const resolution = { width: maxResolution[0], height: maxResolution[1] };
  const { src } = useVideoSource(url);
  const setCalibrationData = useStore(state => state.camSourceSetters.setCalibration);
  const navigate = useNavigate();
  const handleCalibrationComplete = (data: CalibrationResult) => {
    console.log('Calibration complete', data);
    const nc = data.newCameraMatrix;
    console.log('updating calibration data', data);
    setCalibrationData({
      calibration_matrix: data.cameraMatrix,
      new_camera_matrix: new Matrix3().set(nc[0][0], nc[0][1], nc[0][2], nc[1][0], nc[1][1], nc[1][2], nc[2][0], nc[2][1], nc[2][2]),
      distortion_coefficients: [data.distCoeffs],
    });

    navigate({ to: '/setup/point-selection' });
  };
  return (
    <div className="w-full h-dvh flex flex-col gap-1 overflow-hidden">
      <PageHeader title="Camera Calibration" className="absolute" />
      <CameraCalibration
        src={src}
        resolution={resolution}
        onCalibrationConfirmed={handleCalibrationComplete}
        autoCapture={true}
        patternSize={{ width: 9, height: 6 }}
        // stabilityThreshold={10}
        similarityThreshold={5}
      />
      <AlreadyCalibratedDialog />
    </div>
  );
}
