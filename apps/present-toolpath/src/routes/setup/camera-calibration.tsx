import { prettyPrintThree } from '@/lib/prettyPrintThree';
import { createFileRoute } from '@tanstack/react-router';
import { CalibrationResult, CameraCalibration } from '@wbcnc/camera-calibration';
import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { Button } from '@wbcnc/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@wbcnc/ui/components/collapsible';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@wbcnc/ui/components/dialog';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { ChevronsUpDown } from 'lucide-react';
import { use } from 'react';
import { Matrix3 } from 'three';
import { useStore, useVideoSrc } from '../../store';

export const Route = createFileRoute('/setup/camera-calibration')({
  component: RouteComponent,
});

function CodeBlock({ children }: { children: React.ReactNode }) {
  return <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm whitespace-pre-wrap">{children}</code>;
}

function CodeJson({ obj }: { obj: any }) {
  return <CodeBlock>{JSON.stringify(obj, null, 2)}</CodeBlock>;
}

// TODO(manu): updates this to prettyPrint once store uses three.js types
function CalibrationDataDisplay() {
  const calibrationData = useStore(state => state.calibrationData);
  if (!calibrationData) return null;
  const cameraMatrix = calibrationData?.calibration_matrix;
  return (
    <div className="flex flex-col gap-2 flex-1 overflow-scroll">
      <div className="text-sm font-medium">Camera Matrix:</div>
      <CodeJson obj={cameraMatrix} />
      <div className="text-sm font-medium">New Camera Matrix:</div>
      <CodeBlock>{prettyPrintThree(calibrationData.new_camera_matrix)}</CodeBlock>
      <div className="text-sm font-medium">Distortion Coefficients:</div>
      <CodeJson obj={calibrationData.distortion_coefficients} />
    </div>
  );
}

export function AlreadyCalibratedDialog() {
  return (
    <Dialog defaultOpen={true}>
      <DialogContent className="max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Camera is already calibrated</DialogTitle>
          <DialogDescription>
            You can re-calibrate the camera here if needed. This will overwrite the current calibration.
          </DialogDescription>
        </DialogHeader>
        <Collapsible className="flex-1 flex flex-col overflow-hidden items-start">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2" tabIndex={-1}>
              Show Calibration Data
              <ChevronsUpDown className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent asChild>
            <CalibrationDataDisplay />
          </CollapsibleContent>
        </Collapsible>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RouteComponent() {
  use(ensureOpenCvIsLoaded());
  const src = useVideoSrc();
  const setCalibrationData = useStore(state => state.setCalibrationData);
  const handleCalibrationComplete = (data: CalibrationResult) => {
    console.log('Calibration complete', data);
    const nc = data.newCameraMatrix;
    console.log('updating calibration data', data);
    setCalibrationData({
      calibration_matrix: data.cameraMatrix,
      new_camera_matrix: new Matrix3().set(nc[0][0], nc[0][1], nc[0][2], nc[1][0], nc[1][1], nc[1][2], nc[2][0], nc[2][1], nc[2][2]),
      distortion_coefficients: [data.distCoeffs],
    });
  };
  return (
    <div className="w-full h-dvh flex flex-col gap-1 overflow-hidden">
      <PageHeader title="Camera Calibration" className="absolute" />
      <CameraCalibration
        src={src}
        onCalibrationDone={handleCalibrationComplete}
        autoCapture={true}
        patternSize={{ width: 9, height: 6 }}
        // stabilityThreshold={10}
        similarityThreshold={5}
      />
      <AlreadyCalibratedDialog />
    </div>
  );
}
