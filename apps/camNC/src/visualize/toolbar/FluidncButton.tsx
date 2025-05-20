import { getCncApi, getFluidNcClient } from '@/lib/fluidnc-singleton';
import { useHasToolpath, useStore } from '@/store';
import { Link } from '@tanstack/react-router';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@wbcnc/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@wbcnc/ui/components/dropdown-menu';
import { toast } from '@wbcnc/ui/components/sonner';
import { CircleOff, Joystick, Link2, Link2Off, Puzzle } from 'lucide-react';
import { useState } from 'react';
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

function setZeroToGcodePosition() {
  const cncApi = getCncApi();
  const toolpathOffset = useStore.getState().toolpathOffset;
  const promise = cncApi.setWorkspaceXYZero(toolpathOffset.x, toolpathOffset.y);
  toast.promise(promise, {
    loading: 'Setting zero...',
    success: `Zero set to ${toolpathOffset.x.toFixed(2)}, ${toolpathOffset.y.toFixed(2)}`,
    error: 'Failed to set zero',
  });
}

export function FluidncButton() {
  'use no memo';
  const client = getFluidNcClient();
  const hasToolpath = useHasToolpath();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TooltipIconButton label="Machine/FluidNC" icon={<Joystick />} onClick={() => {}} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          FluidNC <span className="text-xs text-muted-foreground">{client.isConnected.value ? '(Connected)' : '(Not Connected)'}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!hasToolpath || !client.isConnected.value} onClick={setZeroToGcodePosition}>
          <CircleOff /> Set Zero to gcode position
          <DropdownMenuShortcut>⌘z</DropdownMenuShortcut>
        </DropdownMenuItem>
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
