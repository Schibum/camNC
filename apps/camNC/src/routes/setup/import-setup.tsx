import { EnsureHasCamSource } from '@/components/EnsureHasCamSource';
import { PageHeader } from '@/components/page-header';
import { cameraSourceLabel } from '@/lib/camera/source-label';
import { hasSetup, importSetup, ImportScope, setupStatus, suggestImportSource } from '@/store/cam-import';
import { adaptCamToResolution, isCamCalibrated } from '@/store/cam-resolution';
import { ICamSource, useCamSource, useStore } from '@/store/store';
import {
  detectMarkersInStillFrame,
  formatReprojectionError,
  getValidMarkers,
  kExpectedMarkerCount,
  setMarkersAndRecompute,
} from '@/store/store-p3p';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Alert, AlertDescription } from '@wbcnc/ui/components/alert';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { Label } from '@wbcnc/ui/components/label';
import { toast } from '@wbcnc/ui/components/sonner';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

export const Route = createFileRoute('/setup/import-setup')({
  component: () => (
    <EnsureHasCamSource to="/setup/url-entry">
      <ImportSetupComponent />
    </EnsureHasCamSource>
  ),
});

/** Below this, an imported setup matches the live picture well enough to skip the setup steps. */
const kGoodReprojectionErrorPx = 3;

const kScopes: { value: ImportScope; label: string; description: string }[] = [
  {
    value: 'same-spot',
    label: 'Same camera, same spot',
    description:
      'Only the way the video reaches camNC changed, e.g. a direct network camera instead of go2rtc. Copies everything and checks it against the live picture.',
  },
  {
    value: 'moved',
    label: 'Same camera, moved',
    description: 'Copies the lens calibration and where the markers are on the machine. You point out the markers in the picture again.',
  },
  {
    value: 'other-camera',
    label: 'A different camera',
    description: 'Copies where the markers are on the machine. You calibrate the lens and point out the markers.',
  },
];

type Check =
  | { state: 'idle' }
  | { state: 'checking' }
  /** All markers found, but the copied setup doesn't fit the picture well. */
  | { state: 'off'; error: number }
  | { state: 'missing'; found: number }
  | { state: 'failed'; message: string };

function CheckResult({
  check,
  onUse,
  onPickMarkers,
  onCalibrate,
}: {
  check: Check;
  onUse: () => void;
  onPickMarkers: () => void;
  onCalibrate: () => void;
}) {
  if (check.state === 'idle' || check.state === 'checking') return null;
  let message: string;
  if (check.state === 'off') {
    message = `The copied setup doesn't quite fit the picture (${formatReprojectionError(check.error)}). The camera may have moved, or its lens or zoom differs.`;
  } else if (check.state === 'missing') {
    message = `Only ${check.found} of ${kExpectedMarkerCount} markers are visible, so the setup could not be checked. If the markers are off the machine right now, you can use the copied setup anyway.`;
  } else {
    message = `The setup could not be checked: ${check.message}`;
  }
  return (
    <Alert>
      <AlertDescription className="flex flex-col gap-3">
        <p>{message}</p>
        <div className="flex flex-row flex-wrap gap-2">
          <Button size="sm" onClick={onPickMarkers}>
            Point out the markers again
          </Button>
          {check.state === 'off' && (
            <Button size="sm" variant="secondary" onClick={onCalibrate}>
              Calibrate the lens again
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onUse}>
            Use it anyway
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function SourceChoice({
  cameras,
  value,
  onChange,
}: {
  cameras: [string, ICamSource][];
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>Copy from</Label>
      {cameras.map(([id, camera]) => (
        <label key={id} className="flex flex-row items-start gap-2 rounded-md border px-3 py-2 text-sm">
          <input type="radio" name="from" className="mt-1" checked={value === id} onChange={() => onChange(id)} />
          <span className="flex flex-col">
            <span className="font-medium">{camera.name}</span>
            <span className="text-muted-foreground">
              {cameraSourceLabel(camera.url)}, {camera.maxResolution[0]}×{camera.maxResolution[1]} · {setupStatus(camera)}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

function ImportSetupComponent() {
  const navigate = useNavigate();
  const target = useCamSource()!;
  const activeCamId = useStore(state => state.activeCamId)!;
  const camSources = useStore(state => state.camSources);
  const updateCamSource = useStore(state => state.updateCamSource);
  const deleteCamSource = useStore(state => state.deleteCamSource);
  const setActiveCam = useStore(state => state.setActiveCam);
  const candidates = Object.entries(camSources).filter(([id, camera]) => id !== activeCamId && hasSetup(camera));
  const [fromId, setFromId] = useState(() => suggestImportSource(Object.entries(camSources), target));
  const [scope, setScope] = useState<ImportScope>('same-spot');
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const from = fromId ? camSources[fromId] : undefined;
  const preview = from && importSetup(target, from, scope);
  // The lens calibration only carries over to a picture of the same shape.
  const lensDropped = scope !== 'other-camera' && !!from?.calibration && !preview?.calibration;

  function finish() {
    navigate({ to: '/' });
  }

  async function apply() {
    if (!from || !preview) return;
    updateCamSource(activeCamId, preview);
    if (!preview.extrinsics) {
      // Calibration first if it is missing; point selection asks for marker positions if those are missing.
      navigate({ to: preview.calibration ? '/setup/point-selection' : '/setup/camera-calibration' });
      return;
    }
    setCheck({ state: 'checking' });
    try {
      const markers = getValidMarkers(await detectMarkersInStillFrame());
      if (markers.length < kExpectedMarkerCount) {
        setCheck({ state: 'missing', found: markers.length });
        return;
      }
      const error = setMarkersAndRecompute(markers);
      if (error > kGoodReprojectionErrorPx) {
        setCheck({ state: 'off', error });
        return;
      }
      toast.success(`Copied the setup of "${from.name}" and checked it against the picture. ${formatReprojectionError(error)}`);
      finish();
    } catch (e) {
      setCheck({ state: 'failed', message: (e as Error).message });
    }
  }

  /** Gives the existing camera this camera's source instead, so one physical camera keeps one entry. */
  function moveSourceToExisting() {
    if (!fromId || !from) return;
    const changes = { url: target.url, maxResolution: target.maxResolution, ...adaptCamToResolution(from, target.maxResolution) };
    updateCamSource(fromId, changes);
    deleteCamSource(activeCamId);
    setActiveCam(fromId);
    if (isCamCalibrated({ ...from, ...changes })) {
      toast.success(`"${from.name}" now uses the new source. Calibration and markers were kept.`);
      finish();
    } else {
      navigate({ to: '/setup/camera-calibration' });
    }
  }

  const checking = check.state === 'checking';
  return (
    <div className="w-full h-full">
      <PageHeader title="Start from an existing camera" />
      <div className="flex justify-center p-1 flex-row">
        <div className="max-w-xl gap-4 flex flex-1 flex-col pb-8">
          <Card>
            <CardHeader>
              <CardTitle>Reuse a camera&apos;s setup?</CardTitle>
              <CardDescription>
                &quot;{target.name}&quot; can start from the calibration and markers of a camera that is already set up, instead of going
                through the whole setup again.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No other camera is set up yet.</p>
              ) : (
                <>
                  <SourceChoice cameras={candidates} value={fromId} onChange={setFromId} />
                  <div className="flex flex-col gap-1">
                    <Label>This camera is</Label>
                    {kScopes.map(option => (
                      <label key={option.value} className="flex flex-row items-start gap-2 text-sm">
                        <input
                          type="radio"
                          name="scope"
                          className="mt-1"
                          checked={scope === option.value}
                          onChange={() => setScope(option.value)}
                        />
                        <span className="flex flex-col">
                          <span className="font-medium">{option.label}</span>
                          <span className="text-muted-foreground">{option.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {lensDropped && from && (
                    <p className="text-sm text-muted-foreground">
                      The picture has another shape ({target.maxResolution[0]}×{target.maxResolution[1]} instead of {from.maxResolution[0]}×
                      {from.maxResolution[1]}), so the lens has to be calibrated again. The marker positions on the machine are still
                      copied.
                    </p>
                  )}
                  <CheckResult
                    check={check}
                    onUse={finish}
                    onPickMarkers={() => navigate({ to: '/setup/point-selection' })}
                    onCalibrate={() => navigate({ to: '/setup/camera-calibration' })}
                  />
                  {check.state === 'idle' || checking ? (
                    <div className="flex flex-row flex-wrap items-center gap-2">
                      <Button onClick={apply} disabled={!from || checking}>
                        {checking && <Loader2 className="animate-spin" />} {checking ? 'Checking against the picture…' : 'Copy setup'}
                      </Button>
                      {scope === 'same-spot' && from && (
                        <Button variant="link" onClick={moveSourceToExisting} disabled={checking}>
                          Switch &quot;{from.name}&quot; to this source instead
                        </Button>
                      )}
                    </div>
                  ) : null}
                </>
              )}
              <div>
                <Button variant="outline" onClick={() => navigate({ to: '/setup/camera-calibration' })} disabled={checking}>
                  Start from scratch
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
