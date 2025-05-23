import { prettyPrintThree } from '@/lib/prettyPrintThree';
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
import { ChevronsUpDown } from 'lucide-react';
import { useCamSource } from '../store/store';

function CodeBlock({ children }: { children: React.ReactNode }) {
  return <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm whitespace-pre-wrap">{children}</code>;
}

function CodeJson({ obj }: { obj: any }) {
  return <CodeBlock>{JSON.stringify(obj, null, 2)}</CodeBlock>;
}

// TODO(manu): updates this to prettyPrint once store uses three.js types
function CalibrationDataDisplay() {
  const calibrationData = useCamSource()?.calibration;
  if (!calibrationData) return null;
  const cameraMatrix = calibrationData?.calibration_matrix;
  return (
    <div className="flex flex-col gap-2 flex-1 overflow-scroll">
      <div className="text-sm font-medium">Camera Matrix:</div>
      <CodeBlock>{prettyPrintThree(cameraMatrix)}</CodeBlock>
      <div className="text-sm font-medium">New Camera Matrix:</div>
      <CodeBlock>{prettyPrintThree(calibrationData.new_camera_matrix)}</CodeBlock>
      <div className="text-sm font-medium">Distortion Coefficients:</div>
      <CodeJson obj={calibrationData.distortion_coefficients} />
    </div>
  );
}

export function AlreadyCalibratedDialog() {
  if (!useCamSource()?.calibration) return null;
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
