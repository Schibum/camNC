import { useStore } from '@/store/store';
import { cn } from '@wbcnc/ui/lib/utils';
import { useState } from 'react';
import { Button } from '@wbcnc/ui/components/button';
import { FlaskConical, Undo2 } from 'lucide-react';
import { getDemoMachine } from '../demo/demo-machine';
import { getActiveRehearsal, leaveRehearsal } from './rehearsal';

export function RehearsalBanner() {
  const machinePanelOpen = useStore(s => s.machinePanelOpen);
  const [speed, setSpeed] = useState(() => getDemoMachine()?.speed ?? 4);
  const [leaving, setLeaving] = useState(false);
  return (
    <div
      role="region"
      aria-label="Machine rehearsal"
      className={cn(
        'fixed bottom-3 max-md:bottom-17 left-3 md:left-[calc(var(--app-rail,0rem)+0.75rem)] z-50 flex max-w-[calc(100vw-1.5rem)] flex-col gap-2 rounded-lg border bg-background p-3 text-sm shadow-lg',
        machinePanelOpen && 'max-sm:bottom-[calc(60dvh+0.75rem)]'
      )}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 font-medium">
          <FlaskConical className="size-4" /> Demo machine · temporary rehearsal
        </span>
        <Button
          size="sm"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            void leaveRehearsal();
          }}>
          <Undo2 /> {leaving ? 'Returning…' : 'Return to CAM'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => location.reload()}>
          Restart rehearsal
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">{getActiveRehearsal()?.job.name} · your saved project is unchanged</span>
        <div className="flex items-center gap-1" role="group" aria-label="Simulation speed">
          <span className="text-xs text-muted-foreground">Speed</span>
          {[1, 4, 16].map(value => (
            <Button
              key={value}
              size="sm"
              variant={speed === value ? 'secondary' : 'ghost'}
              aria-pressed={speed === value}
              onClick={() => {
                const demo = getDemoMachine();
                if (demo) demo.speed = value;
                setSpeed(value);
              }}>
              {value}×
            </Button>
          ))}
        </div>
      </div>
      <details className="text-xs">
        <summary>How to rehearse</summary>
        <p className="mt-2 max-w-xl text-muted-foreground">
          Place and align the board in Top View. In the machine panel, home, set XY zero and probe Z, then run. Pause or stop as you would
          on your controller. Rehearsal progress is discarded when you return or reload.
        </p>
      </details>
    </div>
  );
}
