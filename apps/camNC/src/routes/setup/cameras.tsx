import { PageHeader } from '@/components/page-header';
import { cameraSourceLabel } from '@/lib/camera/source-label';
import { isCamCalibrated } from '@/store/cam-resolution';
import { ICamSource, useStore } from '@/store/store';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@wbcnc/ui/components/alert-dialog';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent } from '@wbcnc/ui/components/card';
import { Input } from '@wbcnc/ui/components/input';
import { Check, Copy, Grid3x3, Plus, Trash2, Video } from 'lucide-react';
import { useState } from 'react';

export const Route = createFileRoute('/setup/cameras')({
  component: CamerasComponent,
});

/** Renames on Enter or when the field loses focus; Escape restores the saved name. */
function CameraNameInput({ id, name }: { id: string; name: string }) {
  const updateCamSource = useStore(state => state.updateCamSource);
  const [value, setValue] = useState(name);
  function save() {
    const trimmed = value.trim();
    if (!trimmed) setValue(name);
    else if (trimmed !== name) updateCamSource(id, { name: trimmed });
  }
  return (
    <Input
      aria-label="Camera name"
      className="font-medium"
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setValue(name);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function setupStatus(camera: ICamSource) {
  if (isCamCalibrated(camera)) return 'calibrated, markers set';
  if (camera.calibration) return 'calibrated, markers not set';
  return 'not calibrated';
}

function DeleteCameraButton({ id, name }: { id: string; name: string }) {
  const deleteCamSource = useStore(state => state.deleteCamSource);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Delete ${name}`}>
          <Trash2 /> Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &quot;{name}&quot;?</AlertDialogTitle>
          <AlertDialogDescription>Its source, calibration and markers are removed. This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => deleteCamSource(id)}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CameraCard({ id, camera, active }: { id: string; camera: ICamSource; active: boolean }) {
  const navigate = useNavigate();
  const setActiveCam = useStore(state => state.setActiveCam);
  const addCamSource = useStore(state => state.addCamSource);

  function openFor(to: '/setup/url-entry' | '/setup/camera-calibration') {
    setActiveCam(id);
    navigate({ to });
  }

  return (
    <Card className={active ? 'border-primary' : undefined}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-row items-center gap-2">
          <CameraNameInput key={camera.name} id={id} name={camera.name} />
          {active ? (
            <span className="flex flex-row items-center gap-1 text-sm text-muted-foreground shrink-0 px-2">
              <Check className="size-4" /> In use
            </span>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setActiveCam(id)}>
              Use
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {cameraSourceLabel(camera.url)}, {camera.maxResolution[0]}×{camera.maxResolution[1]} · {setupStatus(camera)}
        </p>
        <div className="flex flex-row flex-wrap gap-1">
          <Button variant="secondary" size="sm" onClick={() => openFor('/setup/url-entry')}>
            <Video /> Change source
          </Button>
          <Button variant="secondary" size="sm" onClick={() => openFor('/setup/camera-calibration')}>
            <Grid3x3 /> Calibrate
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title="A copy with the same calibration, e.g. to try another source of the same camera"
            onClick={() => addCamSource(`${camera.name} (copy)`, camera)}>
            <Copy /> Duplicate
          </Button>
          <DeleteCameraButton id={id} name={camera.name} />
        </div>
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
        <div className="max-w-xl gap-4 flex flex-1 flex-col pb-8">
          <p className="text-sm text-muted-foreground px-1">
            Changing a camera&apos;s source keeps its calibration and markers, e.g. to move from an external go2rtc to a direct network
            camera.
          </p>
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
