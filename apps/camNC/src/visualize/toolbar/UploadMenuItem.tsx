import { getCncApi } from '@/lib/fluidnc/fluidnc-singleton';
import { useStore } from '@/store';
import { DropdownMenuItem } from '@wbcnc/ui/components/dropdown-menu';
import { toast } from '@wbcnc/ui/components/sonner';
import { CirclePlay } from 'lucide-react';
import { ComponentProps } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@wbcnc/ui/components/alert-dialog';

function NoProbeAlertDialog() {
  return ( <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button variant="outline">Show Dialog</Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
        <AlertDialogDescription>
          This action cannot be undone. This will permanently delete your
          account and remove your data from our servers.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction>Continue</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>)
  )
}

export function UploadMenuItem(props: ComponentProps<typeof DropdownMenuItem>) {
  const fileName = 'camnc.gcode';
  const toastId = 'upload-gcode';
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
    <DropdownMenuItem {...props} onClick={uploadGcodeAndRun}>
      <CirclePlay /> Zero, move to gcode position and run gcode
    </DropdownMenuItem>
  );
}
