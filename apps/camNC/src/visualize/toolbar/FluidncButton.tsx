import { getCncApi, getFluidNcClient } from '@/lib/fluidnc/fluidnc-singleton';
import { useHasToolpath, useStore } from '@/store';
import { Link } from '@tanstack/react-router';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@wbcnc/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@wbcnc/ui/components/dropdown-menu';
import { toast } from '@wbcnc/ui/components/sonner';
import { CircleArrowRight, CircleOff, CirclePlay, ClipboardCopy, Joystick, Link2, Link2Off, Puzzle } from 'lucide-react';
import { ComponentProps, useState } from 'react';
import { FluidNcUrlCopyInput } from './FluidNcUrlCopyInput';
import { TooltipIconButton } from './TooltipIconButton';

export function FluidncButtonOld() {
  'use no memo';
  const client = getFluidNcClient();
  const [open, setOpen] = useState(false);
  const tooltip = 'FluidNC ' + (client.isConnected.value ? '(Connected)' : '(Not Connected)');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <TooltipIconButton label={tooltip} icon={client.isConnected.value ? <Link2 /> : <Link2Off />} onClick={() => {}} />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>FluidNC Integration</DialogTitle>
          <DialogDescription>Add under Settings → Interface → Additional Content as Panel with type Extension</DialogDescription>
        </DialogHeader>
        <FluidNcUrlCopyInput />
      </DialogContent>
    </Dialog>
  );
}

function setZeroToGcodePosition(move = false) {
  const cncApi = getCncApi();
  const toolpathOffset = useStore.getState().toolpathOffset;
  const promise = move
    ? cncApi.setWorkspaceXYZeroAndMove(toolpathOffset.x, toolpathOffset.y)
    : cncApi.setWorkspaceXYZero(toolpathOffset.x, toolpathOffset.y);
  toast.promise(promise, {
    loading: 'Setting zero...',
    success: `Zero set to ${toolpathOffset.x.toFixed(2)}, ${toolpathOffset.y.toFixed(2)}`,
    error: 'Failed to set zero',
  });
}

function copyZeroGcodePosition() {
  const { x, y } = useStore.getState().toolpathOffset;
  const zeroGcodePosition = `G10 L2 P0 X${x.toFixed(2)} Y${y.toFixed(2)}`;
  navigator.clipboard.writeText(zeroGcodePosition);
  toast.success('Zero command copied to clipboard', {
    description: zeroGcodePosition,
  });
}

function UploadMenuItem(props: ComponentProps<typeof DropdownMenuItem>) {
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

export function FluidncButton() {
  'use no memo';
  const client = getFluidNcClient();
  const hasToolpath = useHasToolpath();
  const isFluidAvailable = hasToolpath && client.isConnected.value;
  const status =
    '(' + [client.isConnected.value ? 'connected' : 'not connected', ...(hasToolpath ? [] : ['no toolpath loaded'])].join(', ') + ')';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TooltipIconButton label="Machine/FluidNC" icon={<Joystick />} onClick={() => {}} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          FluidNC <span className="text-xs text-muted-foreground">{status}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!hasToolpath} onClick={copyZeroGcodePosition}>
          <ClipboardCopy /> Copy zero gcode position
          {/* <DropdownMenuShortcut>
            <Kbd shortcut="meta+c" />
          </DropdownMenuShortcut> */}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!isFluidAvailable} onClick={() => setZeroToGcodePosition(false)}>
          <CircleOff /> Set XY zero to gcode position
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!isFluidAvailable} onClick={() => setZeroToGcodePosition(true)}>
          <CircleArrowRight /> Set and move to XY zero gcode position.
        </DropdownMenuItem>
        <UploadMenuItem disabled={!isFluidAvailable} />
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/setup/fluidnc">
            <Puzzle /> Integration settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
