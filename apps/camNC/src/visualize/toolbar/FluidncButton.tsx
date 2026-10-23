import { getCncApi } from '@/lib/fluidnc/machine';
import { machineSupport } from '@/lib/fluidnc/machine-support';
import { setXYZeroFromToolpath } from '@/lib/machine/jobs';
import {
  useHasToolpath,
  useSetShowMachinePosMarker,
  useSetShowMachineZero,
  useSetSnapToToolpath,
  useShowMachinePosMarker,
  useShowMachineZero,
  useSnapToToolpath,
  useStore,
} from '@/store/store';
import { Link } from '@tanstack/react-router';
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
import { CircleArrowRight, CircleOff, ClipboardCopy, Crosshair, Download, Eye, EyeOff, Gamepad2, Joystick, Puzzle } from 'lucide-react';
import { useHotkeys } from 'react-hotkeys-hook';
import { Vector3 } from 'three';
import { TooltipIconButton } from './TooltipIconButton';

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

  const zero = await cncApi.getCurrentZero().catch(() => null);
  console.log('zero from machine', zero);
  if (zero) {
    setToolpathOffset(new Vector3(zero.x, zero.y, zero.z));
    toast.success('Toolpath zero synced from machine', {
      description: `${zero?.x.toFixed(2)}, ${zero?.y.toFixed(2)}`,
    });
  } else {
    toast.error('Unable to read machine zero');
  }
}

export function FluidncButton() {
  'use no memo';
  const cncApi = getCncApi();
  const hasToolpath = useHasToolpath();
  const isIdle = cncApi.isConnected.value && cncApi.state.value === 'Idle';
  const isFluidAvailable = hasToolpath && isIdle;
  const status =
    '(' +
    [cncApi.isConnected.value ? (cncApi.state.value ?? 'connected') : 'not connected', ...(hasToolpath ? [] : ['no toolpath loaded'])].join(
      ', '
    ) +
    ')';
  const panelOpen = useStore(s => s.machinePanelOpen);
  const setPanelOpen = useStore(s => s.setMachinePanelOpen);

  const showMachinePosMarker = useShowMachinePosMarker();
  const setShowMachinePosMarker = useSetShowMachinePosMarker();
  const showMachineZero = useShowMachineZero();
  const setShowMachineZero = useSetShowMachineZero();
  const snapToToolpath = useSnapToToolpath();
  const setSnapToToolpath = useSetSnapToToolpath();

  if (!machineSupport().supported) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TooltipIconButton label="Machine/FluidNC" icon={<Joystick />} onClick={() => {}} />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>
            Machine <span className="text-xs text-muted-foreground">{status}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setPanelOpen(!panelOpen)}>
            <Gamepad2 /> {panelOpen ? 'Hide' : 'Show'} machine panel
            <DropdownMenuShortcut>J</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!cncApi.isConnected.value} onClick={syncToolpathZeroWithMachine}>
            <Download /> Read machine zero → move toolpath
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!hasToolpath} onClick={copyZeroGcodePosition}>
            <ClipboardCopy /> Copy zeroing gcode
            {/* <DropdownMenuShortcut>
            <Kbd shortcut="meta+c" />
          </DropdownMenuShortcut> */}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!isFluidAvailable} onClick={() => setXYZeroFromToolpath(false)}>
            <CircleOff /> Set machine XY zero
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!isFluidAvailable} onClick={() => setXYZeroFromToolpath(true)}>
            <CircleArrowRight /> Set XY zero and move to it.
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowMachinePosMarker(!showMachinePosMarker)}>
            {showMachinePosMarker ? <EyeOff /> : <Eye />} {showMachinePosMarker ? 'Hide' : 'Show'} machine position marker
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowMachineZero(!showMachineZero)}>
            {showMachineZero ? <EyeOff /> : <Eye />} {showMachineZero ? 'Hide' : 'Show'} zero axes
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setSnapToToolpath(!snapToToolpath)}>
            <Crosshair /> {snapToToolpath ? 'Disable' : 'Enable'} snap to toolpath
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/setup/fluidnc">
              <Puzzle /> Connection settings
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <MachinePanelHotkey onToggle={() => setPanelOpen(!useStore.getState().machinePanelOpen)} />
    </>
  );
}

function MachinePanelHotkey({ onToggle }: { onToggle: () => void }) {
  useHotkeys('j', onToggle, { preventDefault: true });
  return null;
}
