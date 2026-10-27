import { PageHeader } from '@/components/page-header';
import { cameraSourceLabel, isDirectNetworkCamera } from '@/lib/camera/source-label';
import { isDesktopApp } from '@/lib/desktop/is-desktop';
import { isCamCalibrated } from '@/store/cam-resolution';
import {
  backupCameras,
  backupFileName,
  exportSettingsBackup,
  parseSettingsBackup,
  restoreSettingsBackup,
  SettingsBackup,
} from '@/store/settings-backup';
import { ICamSource, useStore } from '@/store/store';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { toast } from '@wbcnc/ui/components/sonner';
import { Camera, Check, Download, Upload } from 'lucide-react';
import { useState } from 'react';

export const Route = createFileRoute('/settings/backup')({
  component: BackupComponent,
});

function downloadBackup() {
  const blob = new Blob([exportSettingsBackup()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName();
  a.click();
  // Revoke after the download has been triggered.
  setTimeout(() => URL.revokeObjectURL(url));
}

function pickFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

function CameraSummary({ camera }: { camera: ICamSource }) {
  const calibrated = isCamCalibrated(camera);
  return (
    <li className="flex flex-row items-center gap-2 text-sm">
      <Camera className="size-4 shrink-0" />
      <span className="font-medium">{camera.name}</span>
      <span className="text-muted-foreground">
        {cameraSourceLabel(camera.url)}, {camera.maxResolution[0]}×{camera.maxResolution[1]}
      </span>
      {calibrated && (
        <span className="flex flex-row items-center gap-1 text-muted-foreground">
          <Check className="size-4" /> calibrated
        </span>
      )}
    </li>
  );
}

function RestoreCard() {
  const navigate = useNavigate();
  const hasSettings = useStore(state => Object.keys(state.camSources).length > 0 || !!state.machine);
  const [backup, setBackup] = useState<SettingsBackup | null>(null);

  async function chooseFile() {
    const file = await pickFile();
    if (!file) return;
    try {
      setBackup(parseSettingsBackup(await file.text()));
    } catch (e) {
      setBackup(null);
      toast.error((e as Error).message);
    }
  }

  function restore() {
    if (!backup) return;
    restoreSettingsBackup(backup);
    setBackup(null);
    const state = useStore.getState();
    const cam = state.activeCamId ? state.camSources[state.activeCamId] : null;
    if (isDesktopApp() && cam && !isDirectNetworkCamera(cam.url)) {
      // The usual reason to restore in the app: moving from the browser, where the camera went through go2rtc.
      toast.success('Settings restored. To use the camera directly, switch it to Network camera; its calibration is kept.', {
        duration: 10_000,
      });
      navigate({ to: '/setup/url-entry' });
    } else {
      toast.success('Settings restored.');
      navigate({ to: '/' });
    }
  }

  const cameras = backup ? backupCameras(backup) : [];
  const machineHost = backup?.kind === 'settings' ? backup.settings.machine?.host : undefined;
  const replaces = backup?.kind === 'settings' && hasSettings;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Restore</CardTitle>
        <CardDescription>
          Load a backup made here, in the browser version or in the desktop app. A backup of a single camera from the old Debug page works
          too.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {backup && (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            {cameras.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {cameras.map((camera, i) => (
                  <CameraSummary key={i} camera={camera} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No cameras.</p>
            )}
            {machineHost && <p className="text-sm text-muted-foreground">Machine: {machineHost}</p>}
          </div>
        )}
        <div className="flex flex-row flex-wrap gap-2">
          <Button variant={backup ? 'outline' : 'default'} onClick={chooseFile}>
            <Upload className="size-4" /> {backup ? 'Choose another file…' : 'Choose backup file…'}
          </Button>
          {backup && !replaces && <Button onClick={restore}>{backup.kind === 'camera' ? 'Add camera' : 'Restore'}</Button>}
          {backup && replaces && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button>Restore</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Replace your settings?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your current cameras, calibration and machine settings are replaced by the backup. Download a backup first if you may
                    want them back.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={restore}>Replace</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function BackupComponent() {
  return (
    <div className="w-full h-full">
      <PageHeader title="Backup & restore" />
      <div className="flex justify-center p-1 flex-row">
        <div className="max-w-xl gap-4 flex flex-1 flex-col pb-8">
          <Card>
            <CardHeader>
              <CardTitle>Back up</CardTitle>
              <CardDescription>
                Saves your cameras with their calibration and markers, the machine connection and bounds, and macros to a file. Use it to
                move your setup between the browser and the desktop app, or to another computer.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={downloadBackup}>
                <Download className="size-4" /> Download backup
              </Button>
            </CardContent>
          </Card>
          <RestoreCard />
        </div>
      </div>
    </div>
  );
}
