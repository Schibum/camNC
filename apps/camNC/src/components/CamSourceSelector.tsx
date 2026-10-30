import { isCameraReady, useActiveCamId, useAllCamSources, useSetActiveCam } from '@/store/store';
import { Link } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@wbcnc/ui/components/dropdown-menu';
import { cn } from '@wbcnc/ui/lib/utils';
import { Check, ChevronsUpDown, List, Plus, Settings2 } from 'lucide-react';

/** Green when the camera is set up far enough to show the machine, amber while its setup is unfinished. */
export function CameraStatusDot({ ready, className }: { ready: boolean; className?: string }) {
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', ready ? 'bg-green-500' : 'bg-amber-500', className)}
      title={ready ? 'Ready' : 'Setup unfinished'}
    />
  );
}

/** The camera in use, and the way to switch, open, add and manage cameras. */
export function CamSourceSelector() {
  const camSources = useAllCamSources();
  const activeCamId = useActiveCamId();
  const setActiveCam = useSetActiveCam();
  const cameras = Object.entries(camSources);
  const active = activeCamId ? camSources[activeCamId] : undefined;

  if (cameras.length === 0) {
    return (
      <div className="p-2">
        <Button size="sm" variant="outline" className="w-full" asChild>
          <Link to="/setup/url-entry" search={{ new: true }}>
            <Plus /> Add camera
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="p-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full justify-start gap-2 font-normal" aria-label="Camera">
            {active && <CameraStatusDot ready={isCameraReady(active)} />}
            <span className="truncate">{active?.name ?? 'Select camera'}</span>
            <ChevronsUpDown className="ml-auto size-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56" align="start">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Cameras</DropdownMenuLabel>
          {cameras.map(([id, camera]) => (
            <DropdownMenuItem key={id} onSelect={() => setActiveCam(id)}>
              <CameraStatusDot ready={isCameraReady(camera)} />
              <span className="truncate">{camera.name}</span>
              {id === activeCamId && <Check className="ml-auto" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {activeCamId && (
            <DropdownMenuItem asChild>
              <Link to="/setup/cameras/$camId" params={{ camId: activeCamId }}>
                <Settings2 /> Camera settings
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link to="/setup/url-entry" search={{ new: true }}>
              <Plus /> Add camera…
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/setup/cameras">
              <List /> Manage cameras
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
