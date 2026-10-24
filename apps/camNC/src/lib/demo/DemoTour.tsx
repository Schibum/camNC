import { useStore } from '@/store/store';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { exitDemo } from './demo-mode';
import { kOpenTourEvent } from './tour-events';

const kTourSeen = 'camnc-demo-tour-seen';

interface TourStep {
  title: string;
  body: string;
  /** Applied when the step is shown. */
  enter?: (ctx: { view: (view: 'top' | '3d') => void; machinePanel: (open: boolean) => void }) => void;
  final?: boolean;
}

const kSteps: TourStep[] = [
  {
    title: 'A live camera over a CNC router',
    body: 'This is a real camera feed above a LowRider bed. camNC straightens it into a top view and draws the toolpath where the machine will cut. Drag the toolpath to place it on the stock.',
    enter: ({ view, machinePanel }) => {
      view('top');
      machinePanel(false);
    },
  },
  {
    title: 'See the cut in 3D',
    body: 'Use the view buttons in the toolbar for 3D, Front and Side views. They show the cut depth against the stock height.',
    enter: ({ view }) => view('3d'),
  },
  {
    title: 'A simulated FluidNC',
    body: 'The machine panel is connected to a FluidNC simulator running in this tab, no hardware needed. Press Home, then jog with the arrow buttons or keys. The yellow marker follows the machine position.',
    enter: ({ view, machinePanel }) => {
      view('top');
      machinePanel(true);
    },
  },
  {
    title: 'Run the job',
    body: 'Press “Set XY zero = toolpath”, then “Run job” (the checklist also asks for Home and a Z probe, as on a real machine). camNC uploads the file to the simulated SD card and starts it, and a green line shows the progress. The speed buttons in the demo bar slow it down or speed it up.',
  },
  {
    title: 'Try your own G-code',
    body: 'Press O, use Open in the toolbar, or drop a .gcode or .nc file anywhere on the page. It is loaded in your browser and never uploaded.',
  },
  {
    title: 'Ready for your own machine?',
    body: 'Setting up takes about 15 minutes: a camera (a phone works), four printed ArUco markers and a short calibration. Nothing you did in the demo is saved.',
    final: true,
  },
];

function seen() {
  try {
    return localStorage.getItem(kTourSeen) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(kTourSeen, '1');
  } catch {
    // Not remembering that the tour was shown is fine.
  }
}

/** A short walkthrough, shown on the first demo visit and from the demo bar afterwards. */
export function DemoTour() {
  const navigate = useNavigate();
  const [step, setStep] = useState<number | null>(() => (seen() ? null : 0));
  const setMachinePanelOpen = useStore(s => s.setMachinePanelOpen);

  useEffect(() => {
    const open = () => setStep(0);
    window.addEventListener(kOpenTourEvent, open);
    return () => window.removeEventListener(kOpenTourEvent, open);
  }, []);

  useEffect(() => {
    if (step === null) return;
    kSteps[step]?.enter?.({
      view: view => navigate({ to: '/visualize/2DView', search: { view } }),
      machinePanel: setMachinePanelOpen,
    });
  }, [step, navigate, setMachinePanelOpen]);

  if (step === null) return null;
  const current = kSteps[step]!;
  const close = () => {
    markSeen();
    setStep(null);
  };
  return (
    <div
      role="dialog"
      aria-label="Demo tour"
      className="fixed bottom-16 left-3 z-50 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-2 rounded-lg border bg-background p-4 shadow-xl">
      <div className="flex flex-row items-start justify-between gap-2">
        <h2 className="font-semibold leading-tight">{current.title}</h2>
        <Button size="icon" variant="ghost" className="-mr-2 -mt-1 size-6" aria-label="Close tour" onClick={close}>
          <X className="size-4" />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{current.body}</p>
      <div className="flex flex-row items-center justify-between pt-1">
        <span className="text-xs text-muted-foreground">
          {step + 1} / {kSteps.length}
        </span>
        <div className="flex flex-row gap-1">
          {step > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {current.final ? (
            <>
              <Button size="sm" variant="outline" onClick={close}>
                Keep exploring
              </Button>
              <Button size="sm" onClick={() => exitDemo('/setup/url-entry')}>
                Set up my machine
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => setStep(step + 1)}>
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
