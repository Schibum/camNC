import { CameraNameInput, DeleteCameraButton } from '@/components/camera/CameraControls';
import { CameraStatusDot } from '@/components/CamSourceSelector';
import { PageHeader } from '@/components/page-header';
import { checkSetupAgainstPicture, SetupCheck } from '@/lib/camera/check-setup';
import { cameraSourceLabel } from '@/lib/camera/source-label';
import { VideoPreview } from '@/setup/video-source-selection/VideoPreview';
import { hasSetup } from '@/store/cam-import';
import { ICamSource, isCameraReady, useStore } from '@/store/store';
import { formatReprojectionError, kExpectedMarkerCount } from '@/store/store-p3p';
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { Check, Circle, Copy, Import, Loader2 } from 'lucide-react';
import { useState } from 'react';

export const Route = createFileRoute('/setup/cameras/$camId')({
  component: CameraPage,
});

type SetupRoute =
  | '/setup/url-entry'
  | '/setup/camera-calibration'
  | '/setup/marker-positions'
  | '/setup/point-selection'
  | '/setup/import-setup';

function checkMessage(check: SetupCheck) {
  switch (check.state) {
    case 'good':
      return `The setup fits the live picture. ${formatReprojectionError(check.error)}`;
    case 'off':
      return `The setup doesn't quite fit the live picture (${formatReprojectionError(check.error)}). Point out the markers again, or recalibrate the lens if that doesn't help.`;
    case 'missing':
      return `Only ${check.found} of ${kExpectedMarkerCount} markers are visible, so the setup could not be checked.`;
    case 'failed':
      return `The setup could not be checked: ${check.message}`;
  }
}

function StepRow({
  done,
  label,
  action,
  disabled,
  onClick,
}: {
  done: boolean;
  label: string;
  action: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <li className="flex flex-row items-center gap-2 py-1 text-sm">
      {done ? <Check className="size-4 text-green-600" /> : <Circle className="size-4 text-muted-foreground" />}
      <span className={done ? undefined : 'text-muted-foreground'}>{label}</span>
      <Button variant="link" size="sm" className="ml-auto h-auto p-0" disabled={disabled} onClick={onClick}>
        {action}
      </Button>
    </li>
  );
}

function SetupChecklist({ camId, camera, open }: { camId: string; camera: ICamSource; open: (to: SetupRoute) => void }) {
  const setActiveCam = useStore(state => state.setActiveCam);
  const [check, setCheck] = useState<SetupCheck | 'checking' | null>(null);
  const lens = !!camera.calibration;
  const machineMarkers = !!camera.markerPositions?.length;
  const pictureMarkers = !!camera.markerPosInCam?.length && !!camera.extrinsics;

  async function runCheck() {
    setCheck('checking');
    setCheck(await checkSetupAgainstPicture());
  }

  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle className="text-base">Setup</CardTitle>
      </CardHeader>
      <CardContent>
        <ul>
          <StepRow
            done={lens}
            label="Lens calibration"
            action={lens ? 'Redo' : 'Start'}
            onClick={() => open('/setup/camera-calibration')}
          />
          <StepRow
            done={machineMarkers}
            label="Markers on the machine"
            action={machineMarkers ? 'Edit' : 'Start'}
            disabled={!lens}
            onClick={() => open('/setup/marker-positions')}
          />
          <StepRow
            done={pictureMarkers}
            label="Markers in the picture"
            action={pictureMarkers ? 'Redo' : 'Start'}
            disabled={!lens || !machineMarkers}
            onClick={() => open('/setup/point-selection')}
          />
          <StepRow
            done={check !== null && check !== 'checking' && check.state === 'good'}
            label="Check against the live picture"
            action={check === 'checking' ? 'Checking…' : 'Run'}
            disabled={!lens || !machineMarkers || check === 'checking'}
            onClick={() => {
              // The check works on the camera in use.
              setActiveCam(camId);
              void runCheck();
            }}
          />
        </ul>
        {check === 'checking' && (
          <p className="mt-2 flex flex-row items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Looking for the markers…
          </p>
        )}
        {check && check !== 'checking' && <p className="mt-2 text-sm text-muted-foreground">{checkMessage(check)}</p>}
      </CardContent>
    </Card>
  );
}

function CameraPage() {
  const { camId } = Route.useParams();
  const navigate = useNavigate();
  const camera = useStore(state => state.camSources[camId]);
  const activeCamId = useStore(state => state.activeCamId);
  const setActiveCam = useStore(state => state.setActiveCam);
  const addCamSource = useStore(state => state.addCamSource);
  const canCopySetup = useStore(state => Object.entries(state.camSources).some(([id, other]) => id !== camId && hasSetup(other)));
  if (!camera) return <Navigate to="/setup/cameras" replace />;

  /** Setup screens work on the camera in use, so this camera is put in use first. */
  function open(to: SetupRoute) {
    setActiveCam(camId);
    navigate({ to });
  }

  function duplicate() {
    addCamSource(`${camera.name} (copy)`, camera);
    const copyId = useStore.getState().activeCamId;
    if (copyId) navigate({ to: '/setup/cameras/$camId', params: { camId: copyId } });
  }

  return (
    <div className="w-full h-full">
      <PageHeader title="Camera" />
      <div className="flex justify-center p-1 flex-row">
        <div className="max-w-2xl gap-4 flex flex-1 flex-col pb-8">
          <div className="flex flex-row flex-wrap items-center gap-2">
            <CameraStatusDot ready={isCameraReady(camera)} className="size-2.5" />
            <div className="min-w-48 flex-1">
              <CameraNameInput key={camera.name} id={camId} name={camera.name} />
            </div>
            {camId === activeCamId ? (
              <span className="flex flex-row items-center gap-1 px-2 text-sm text-muted-foreground">
                <Check className="size-4" /> In use
              </span>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setActiveCam(camId)}>
                Use this camera
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={duplicate}>
              <Copy /> Duplicate
            </Button>
            <DeleteCameraButton id={camId} name={camera.name} onDeleted={() => navigate({ to: '/setup/cameras' })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <div className="aspect-video overflow-hidden rounded-md border bg-muted">
                <VideoPreview key={camera.url} connectionUrl={camera.url} className="h-full w-full object-contain" />
              </div>
              {canCopySetup && (
                <Button variant="outline" size="sm" onClick={() => open('/setup/import-setup')}>
                  <Import /> Copy setup from another camera…
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-4">
              <Card className="gap-2">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Source</CardTitle>
                  <Button variant="link" size="sm" className="h-auto p-0" onClick={() => open('/setup/url-entry')}>
                    Change
                  </Button>
                </CardHeader>
                <CardContent className="text-sm">
                  <p className="first-letter:uppercase">{cameraSourceLabel(camera.url)}</p>
                  <p className="text-muted-foreground">
                    {camera.maxResolution[0]}×{camera.maxResolution[1]}
                  </p>
                </CardContent>
              </Card>
              <SetupChecklist camId={camId} camera={camera} open={open} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
