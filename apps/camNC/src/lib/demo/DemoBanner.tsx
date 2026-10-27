import { useStore } from '@/store/store';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { cn } from '@wbcnc/ui/lib/utils';
import { CircleHelp, FlaskConical, LogOut, Wrench } from 'lucide-react';
import { useState } from 'react';
import { exitDemo, isDemoMode } from './demo-mode';
import { getDemoMachine } from './demo-machine';
import { DemoTour } from './DemoTour';
import { openDemoTour } from './tour-events';

const kSpeeds = [1, 4, 16];

function SpeedControl() {
  const [speed, setSpeed] = useState(() => getDemoMachine()?.speed ?? 4);
  return (
    <div className="flex flex-row items-center gap-1 text-xs" role="group" aria-label="Simulation speed">
      <span className="text-muted-foreground">Speed</span>
      {kSpeeds.map(value => (
        <button
          key={value}
          type="button"
          aria-pressed={speed === value}
          className={cn('rounded px-1.5 py-0.5', speed === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
          onClick={() => {
            const demo = getDemoMachine();
            if (demo) demo.speed = value;
            setSpeed(value);
          }}>
          {value}×
        </button>
      ))}
    </div>
  );
}

/** Marks the page as the demo, with the way out and the way into the real setup. Renders nothing outside demo mode. */
export function DemoBanner() {
  const navigate = useNavigate();
  const hasToolpath = useStore(s => !!s.toolpath);
  if (!isDemoMode()) return null;
  return (
    <>
      <DemoTour />
      <div
        role="region"
        aria-label="Demo mode"
        className="fixed bottom-3 left-3 z-50 flex max-w-[calc(100vw-1.5rem)] flex-row flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background/95 px-3 py-2 text-sm shadow-lg backdrop-blur">
        <span className="flex flex-row items-center gap-1.5 font-medium">
          <FlaskConical className="size-4" /> Demo machine
        </span>
        <SpeedControl />
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={openDemoTour}>
          <CircleHelp /> Tour
        </Button>
        <Button size="sm" className="h-7 px-2" onClick={() => exitDemo('/start')}>
          <Wrench /> Set up my machine
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => exitDemo('/')}>
          <LogOut /> Exit
        </Button>
        {!hasToolpath && (
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => navigate({ to: '/demo' })}>
            Reload demo job
          </Button>
        )}
      </div>
    </>
  );
}
