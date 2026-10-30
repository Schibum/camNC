import { CameraStatusDot } from '@/components/CamSourceSelector';
import { PageHeader } from '@/components/page-header';
import { cameraSourceLabel } from '@/lib/camera/source-label';
import { setupStatus } from '@/store/cam-import';
import { ICamSource, isCameraReady, useStore } from '@/store/store';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent } from '@wbcnc/ui/components/card';
import { Check, ChevronRight, Plus } from 'lucide-react';

export const Route = createFileRoute('/setup/cameras/')({
  component: CamerasComponent,
});

function CameraCard({ id, camera, active }: { id: string; camera: ICamSource; active: boolean }) {
  const setActiveCam = useStore(state => state.setActiveCam);
  return (
    <Card className={active ? 'border-primary py-3' : 'py-3'}>
      <CardContent className="flex flex-row items-center gap-3 px-4">
        <Link to="/setup/cameras/$camId" params={{ camId: id }} className="flex min-w-0 flex-1 flex-col gap-1 hover:underline">
          <span className="flex flex-row items-center gap-2 font-medium">
            <CameraStatusDot ready={isCameraReady(camera)} />
            <span className="truncate">{camera.name}</span>
          </span>
          <span className="text-sm text-muted-foreground">
            {cameraSourceLabel(camera.url)}, {camera.maxResolution[0]}×{camera.maxResolution[1]} · {setupStatus(camera)}
          </span>
        </Link>
        {active ? (
          <span className="flex shrink-0 flex-row items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-4" /> In use
          </span>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setActiveCam(id)}>
            Use
          </Button>
        )}
        <Button variant="ghost" size="icon" asChild>
          <Link to="/setup/cameras/$camId" params={{ camId: id }} aria-label={`Open ${camera.name}`}>
            <ChevronRight />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function CamerasComponent() {
  const camSources = useStore(state => state.camSources);
  const activeCamId = useStore(state => state.activeCamId);
  const cameras = Object.entries(camSources);
  return (
    <div className="w-full h-full">
      <PageHeader title="Cameras" />
      <div className="flex justify-center p-1 flex-row">
        <div className="max-w-xl gap-3 flex flex-1 flex-col pb-8">
          {cameras.length === 0 && <p className="text-sm px-1">No cameras yet.</p>}
          {cameras.map(([id, camera]) => (
            <CameraCard key={id} id={id} camera={camera} active={id === activeCamId} />
          ))}
          <div className="flex flex-row gap-2">
            <Button asChild>
              <Link to="/setup/url-entry" search={{ new: true }}>
                <Plus /> Add camera
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/settings/backup">Restore from a backup</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
