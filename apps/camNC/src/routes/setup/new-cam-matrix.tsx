import { cvToMatrix3, matrix3ToCV } from '@/lib/three-cv';
import { useCalibrationData, useCamResolution, useStore } from '@/store/store';
import { NumberInput } from '@heroui/react';
import { createFileRoute } from '@tanstack/react-router';
import { cv2, ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent } from '@wbcnc/ui/components/card';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { use, useState } from 'react';
import { prettyPrintThree } from '../../lib/prettyPrintThree';
import { CalibrationData } from '../../store/store';

export const Route = createFileRoute('/setup/new-cam-matrix')({
  component: RouteComponent,
});

function getNewCameraMatrix(
  { calibration_matrix, distortion_coefficients }: CalibrationData,
  { width, height }: { width: number; height: number },
  alpha: number
) {
  const cameraMatrix = matrix3ToCV(calibration_matrix);
  const distCoeffs = cv2.matFromArray(distortion_coefficients.length, 1, cv2.CV_64F, distortion_coefficients);
  // Get optimal new camera matrix
  const imageSize = new cv2.Size(width, height);
  const newCameraMatrix = cv2.getOptimalNewCameraMatrix(cameraMatrix, distCoeffs, imageSize, alpha);
  const newCamThree = cvToMatrix3(newCameraMatrix);
  cameraMatrix.delete();
  distCoeffs.delete();
  return newCamThree;
}

function AlphaUpdateComponent() {
  use(ensureOpenCvIsLoaded());
  const [alpha, setAlpha] = useState<number | undefined>(0.1);
  const calibration = useCalibrationData();
  const resolution = useCamResolution();
  const setCalibration = useStore(s => s.camSourceSetters.setCalibration);

  function handleSave() {
    if (!alpha) {
      throw new Error('Alpha is required');
    }
    console.log('alpha', alpha);
    const newCamMatrix = getNewCameraMatrix(calibration, { width: resolution[0], height: resolution[1] }, alpha);
    console.log('newCamMatrix', prettyPrintThree(newCamMatrix));
    setCalibration({
      ...calibration,
      new_camera_matrix: newCamMatrix,
    });
  }
  return (
    <div className="flex flex-col gap-2">
      <NumberInput
        label="alpha"
        value={alpha}
        onValueChange={v => setAlpha(v)}
        min={0}
        max={1}
        step={0.05}
        formatOptions={{ style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }}
      />
      <Button onClick={handleSave}>Save</Button>
    </div>
  );
}

function RouteComponent() {
  return (
    <div className="w-full h-full">
      <PageHeader title="New Cam Matrix" />
      <div className="flex justify-center p-1 flex-row">
        <Card className="w-full max-w-xl">
          <CardContent>
            <AlphaUpdateComponent />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
