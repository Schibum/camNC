import { getCncApi } from '@/lib/fluidnc/fluidnc-singleton';
import { useStore } from '@/store';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@wbcnc/ui/components/alert-dialog';
import { DropdownMenuItem } from '@wbcnc/ui/components/dropdown-menu';
import { toast } from '@wbcnc/ui/components/sonner';
import { CirclePlay } from 'lucide-react';
import { ComponentProps, useImperativeHandle, useRef, useState } from 'react';

interface NoProbeAlertDialogRef {
  open: () => void;
}

function NoProbeAlertDialog({ onConfirm, ref }: { onConfirm: () => void; ref: React.RefObject<NoProbeAlertDialogRef | undefined> }) {
  const [isOpen, setIsOpen] = useState(false);
  useImperativeHandle(ref, () => ({
    open: () => {
      setIsOpen(true);
    },
  }));
  const handleConfirm = () => {
    setIsOpen(false);
    onConfirm();
  };
  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>No probe command found in gcode</AlertDialogTitle>
          <AlertDialogDescription>Make sure you have zeroed Z manually. Are you sure you want to continue?</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>Continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function UploadMenuItem(props: ComponentProps<typeof DropdownMenuItem>) {
  const fileName = 'camnc.gcode';
  const toastId = 'upload-gcode';
  const noProbeAlertDialogRef = useRef<NoProbeAlertDialogRef | undefined>(undefined);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const toolpath = useStore.getState().toolpath?.gcode ?? '';
    if (!toolpath.slice(0, 10_000).includes('G10')) {
      e.preventDefault();
      e.stopPropagation();
      noProbeAlertDialogRef.current?.open();
    } else {
      uploadGcodeAndRun();
    }
  }

  async function uploadGcodeAndRun() {
    const { x, y } = useStore.getState().toolpathOffset;
    const cncApi = getCncApi();
    const toolpath = useStore.getState().toolpath?.gcode;
    if (!toolpath) {
      toast.error('No toolpath loaded');
      return;
    }
    const zeroPromise = cncApi.setWorkspaceXYZeroAndMove(x, y);
    toast.promise(zeroPromise, {
      id: toastId,
      loading: 'Setting zero...',
      success: 'Zero set',
      error: 'Failed to set zero',
    });
    await zeroPromise;

    const promise = cncApi.uploadGcode(toolpath, fileName);
    toast.promise(promise, {
      id: toastId,
      loading: 'Uploading...',
      success: 'Uploaded',
      error: 'Failed to upload',
    });
    await promise;

    const runPromise = cncApi.runFile(fileName);
    toast.promise(runPromise, {
      id: toastId,
      loading: 'Running...',
      success: 'Started file',
      error: 'Failed to run',
    });
  }
  return (
    <>
      <DropdownMenuItem {...props} onClick={handleClick}>
        <CirclePlay /> Zero, move to gcode position and run gcode
      </DropdownMenuItem>
      <NoProbeAlertDialog onConfirm={uploadGcodeAndRun} ref={noProbeAlertDialogRef} />
    </>
  );
}
