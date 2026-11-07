import { CamJobRehearsal } from '@/start/CamJobRehearsal';
import { PageHeader } from '@/components/page-header';
import { useOpenSample } from '@/cam/samples/useOpenSample';
import { isDemoMode } from '@/lib/demo/demo-mode';
import type { MachineBoundsValues } from '@/setup/MachineBoundsForm';
import { BedSizeMenu } from '@/start/BedSizeMenu';
import { ConnectMachineButton } from '@/start/ConnectMachineButton';
import { DrawnBed } from '@/start/DrawnBed';
import { kDefaultBed } from '@/start/bedPresets';
import { useMachineBoundsOrNull, useStore } from '@/store/store';
import { kDepthSceneBackground } from '@/visualize/DepthInspector';
import { pickFile, useOpenFile } from '@/visualize/useOpenFile';
import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import { z } from 'zod';
import { Button } from '@wbcnc/ui/components/button';
import { DarkScope } from '@wbcnc/ui/components/dark-scope';
import { toast } from '@wbcnc/ui/components/sonner';
import { FileUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export const Route = createFileRoute('/start')({
  component: StartComponent,
  // `for=cam`: sent here from the CAM Plan step to pick a bed before seeing the program on it.
  validateSearch: zodValidator(z.object({ for: z.enum(['cam']).optional(), job: z.string().optional(), board: z.string().optional() })),
});

/**
 * Getting started on the drawn bed: drop a file on it, connect FluidNC or pick a size. The drawn size is only a preview,
 * because the machine bounds also limit jogging: it is saved once a program or the workspace opens on it.
 */
function StartComponent() {
  const navigate = useNavigate();
  const { for: purpose, job: jobId, board: boardId } = useSearch({ from: '/start' });
  const setMachineBounds = useStore(s => s.setMachineBounds);
  const toolpath = useStore(s => s.toolpath);
  const hasCamera = useStore(s => Object.keys(s.camSources).length > 0);
  const saved = useMachineBoundsOrNull();
  const [picked, setPicked] = useState<MachineBoundsValues | null>(null);
  const savedBed = saved && { xmin: saved.min.x, xmax: saved.max.x, ymin: saved.min.y, ymax: saved.max.y };
  // The controller's size while the connect dialog shows it: a suggestion until confirmed there, unless there is no other size.
  const [readBed, setReadBed] = useState<MachineBoundsValues | null>(null);
  const bedToSave = picked ?? (savedBed ? null : (readBed ?? kDefaultBed));
  const bed = readBed ?? bedToSave ?? savedBed ?? kDefaultBed;
  const openFile = useOpenFile();
  const sample = useOpenSample();
  const fromCam = purpose === 'cam';

  function openWorkspace() {
    navigate({ to: '/visualize/2DView' });
    // With a program loaded: no "open a file" hint.
    if (fromCam || toolpath) return;
    toast.info('Open a G-code file with O or drop one on the page. With a machine connected, double-click the bed to jog there.', {
      duration: 10_000,
    });
  }

  function saveBedAndOpenWorkspace() {
    if (bedToSave) setMachineBounds(bedToSave.xmin, bedToSave.ymin, bedToSave.xmax, bedToSave.ymax);
    openWorkspace();
  }

  // A G-code file was opened here, by the button or by a drop anywhere on the page: show it on this bed.
  const toolpathOnEntry = useRef(toolpath);
  useEffect(() => {
    if (!toolpath || toolpath === toolpathOnEntry.current) return;
    if (!picked && !savedBed && !readBed) {
      toast.info(
        `Showing it on a ${bed.xmax - bed.xmin} × ${bed.ymax - bed.ymin} mm bed. Change the size under Machine Bounds in the menu.`,
        {
          duration: 10_000,
        }
      );
    }
    saveBedAndOpenWorkspace();
    // Only when a new program arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolpath]);

  return (
    <DarkScope>
      <div className="dark flex h-dvh w-full flex-col text-foreground" style={{ background: kDepthSceneBackground }}>
        <PageHeader title={fromCam ? 'Pick your bed' : 'Get started'} className="dark" />
        <div className="relative min-h-0 flex-1">
          <DrawnBed bounds={bed} className="absolute inset-0 size-full p-3" />
          <div className="absolute inset-0 flex flex-col gap-2 overflow-auto p-5">
            <div className="flex flex-row flex-wrap justify-between gap-2">
              <BedSizeMenu bounds={bed} onPick={setPicked} onCustomConfirmed={openWorkspace} />
              <ConnectMachineButton
                openAtStart={!savedBed}
                onBedRead={setReadBed}
                onBedConfirmed={openWorkspace}
                onClosed={() => {
                  if (!savedBed && !picked) setPicked(readBed);
                  setReadBed(null);
                }}
              />
            </div>
            {/* On a phone the landscape bed is short: below it, so that resizing it stays visible. */}
            <div className="m-auto flex w-full max-w-sm max-sm:mb-0 flex-col items-center gap-3 rounded-lg border bg-background/90 p-5 text-center backdrop-blur-sm">
              {fromCam ? (
                <>
                  <p role="status" className="text-sm">
                    <span className="font-medium">Pick your bed first.</span> Then camNC shows your CAM program on it: connect your FluidNC,
                    or choose a bed size.
                  </p>
                  <Button onClick={saveBedAndOpenWorkspace}>Show on this bed</Button>
                  {jobId ? (
                    <div className="w-full border-t pt-3">
                      <CamJobRehearsal jobId={jobId} boardId={boardId} />
                    </div>
                  ) : (
                    <p className="text-sm">
                      To rehearse your job,{' '}
                      <Link to="/cam" className="underline">
                        open its CAM plan
                      </Link>{' '}
                      and choose “Try on demo machine”.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <h1 className="font-medium">Drop a file on your bed</h1>
                    <p className="text-sm text-muted-foreground">G-code shows on the bed. A STEP or STL model starts a cutting plan.</p>
                  </div>
                  <div className="flex flex-row flex-wrap justify-center gap-2">
                    <Button
                      onClick={async () => {
                        const file = await pickFile();
                        if (file) await openFile(file);
                      }}>
                      <FileUp aria-hidden /> Choose file
                    </Button>
                    <Button variant="outline" disabled={sample.pending} onClick={() => void sample.open()}>
                      {sample.pending ? 'Opening sample…' : 'Use a sample'}
                    </Button>
                    {(picked || savedBed || readBed) && (
                      <Button variant="ghost" onClick={saveBedAndOpenWorkspace}>
                        Open workspace
                      </Button>
                    )}
                  </div>
                  {sample.error && (
                    <p role="alert" className="text-sm text-destructive">
                      {sample.error}
                    </p>
                  )}
                </>
              )}
            </div>
            {!fromCam && (
              <div className="flex flex-row flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {/* A full page load, so that demo mode is decided before the app starts. */}
                {!isDemoMode() && !hasCamera && (
                  <a href="/demo" className="underline">
                    Try the demo
                  </a>
                )}
                <Link to="/setup/url-entry" search={hasCamera ? { new: true } : {}} className="underline">
                  Add a camera
                </Link>
                <Link to="/settings/backup" className="underline">
                  Restore a backup
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </DarkScope>
  );
}
