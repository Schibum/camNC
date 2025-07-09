import { getCncApi, getFluidNcClient } from '@/lib/fluidnc/fluidnc-singleton';
import { useHasToolpath, useStore } from '@/store/store';
import { Link } from '@tanstack/react-router';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@wbcnc/ui/components/dropdown-menu';
import { toast } from '@wbcnc/ui/components/sonner';
import { CircleArrowRight, CircleOff, ClipboardCopy, Download, Joystick, Puzzle } from 'lucide-react';
import { Vector3 } from 'three';
import { TooltipIconButton } from './TooltipIconButton';
import { UploadMenuItem } from './UploadMenuItem';

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

async function syncToolpathZeroWithMachine() {
  const cncApi = getCncApi();
  const setToolpathOffset = useStore.getState().setToolpathOffset;

  const zero = await cncApi.getCurrentZero();
  console.log('zero from machine', zero);
  if (zero) {
    setToolpathOffset(new Vector3(zero.x, zero.y, zero.z));
  } else {
    toast.error('Unable to read machine zero');
  }

  toast.success('Toolpath zero synced from machine', {
    description: `${zero?.x.toFixed(2)}, ${zero?.y.toFixed(2)}`,
  });
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
        <DropdownMenuItem disabled={!isFluidAvailable} onClick={syncToolpathZeroWithMachine}>
          <Download /> Read machine zero → move toolpath
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!hasToolpath} onClick={copyZeroGcodePosition}>
          <ClipboardCopy /> Copy zeroing gcode
          {/* <DropdownMenuShortcut>
            <Kbd shortcut="meta+c" />
          </DropdownMenuShortcut> */}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!isFluidAvailable} onClick={() => setZeroToGcodePosition(false)}>
          <CircleOff /> Set machine XY zero
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!isFluidAvailable} onClick={() => setZeroToGcodePosition(true)}>
          <CircleArrowRight /> Set XY zero and move to it.
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
