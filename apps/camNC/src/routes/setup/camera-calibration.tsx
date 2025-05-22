import { LoadingVideoOverlay } from '@/components/LoadingVideoOverlay';
import { AlreadyCalibratedDialog } from '@/setup/already-calibrated-dialog';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { CalibrationResult, CameraCalibration } from '@wbcnc/camera-calibration';
import { useVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { Suspense, use } from 'react';
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

function toMatrix3(d: number[][]) {
  return new Matrix3().set(d[0][0], d[0][1], d[0][2], d[1][0], d[1][1], d[1][2], d[2][0], d[2][1], d[2][2]);
}

function ConfiguredCameraCalibration() {
  use(ensureOpenCvIsLoaded());
  const { url, maxResolution } = Route.useLoaderData();
  const resolution = { width: maxResolution[0], height: maxResolution[1] };
  const { src } = useVideoSource(url);
  const setCalibrationData = useStore(state => state.camSourceSetters.setCalibration);
  const navigate = useNavigate();
  const handleCalibrationComplete = (data: CalibrationResult) => {
    console.log('Calibration complete', data);
    console.log('updating calibration data', data);
    setCalibrationData({
      calibration_matrix: toMatrix3(data.cameraMatrix),
      new_camera_matrix: toMatrix3(data.newCameraMatrix),
      distortion_coefficients: data.distCoeffs,
    });

    navigate({ to: '/setup/point-selection' });
  };

  return (
    <CameraCalibration
      src={src}
      resolution={resolution}
      onCalibrationConfirmed={handleCalibrationComplete}
      autoCapture={true}
      patternSize={{ width: 9, height: 6 }}
      // stabilityThreshold={10}
      similarityThreshold={5}
    />
  );
}

function RouteComponent() {
  return (
    <div className="w-full h-dvh flex flex-col gap-1 overflow-hidden">
      <PageHeader title="Camera Calibration" className="absolute" />
      <Suspense fallback={<LoadingVideoOverlay />}>
        <ConfiguredCameraCalibration />
      </Suspense>
      <AlreadyCalibratedDialog />
    </div>
  );
}
