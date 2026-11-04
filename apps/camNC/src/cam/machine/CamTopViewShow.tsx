import { Button } from '@wbcnc/ui/components/button';
import { Layers } from 'lucide-react';
import { useCamMachine } from './camMachine';
import type { ShowInTopView } from './partGhost';

const kChoices: { value: ShowInTopView; label: string; hint: string }[] = [
  { value: 'program', label: 'This program', hint: 'Only the loaded program.' },
  { value: 'parts', label: '+ Parts', hint: 'The whole parts under it, faint: something to line a slot or a few holes up against.' },
  {
    value: 'all',
    label: '+ All programs',
    hint: 'The parts and every program on this side of the board, faint. Also while a program runs.',
  },
];

/** In the top view while a CAM job is at the machine: what to show besides the loaded program. Remembered on this device. */
export function CamTopViewShow() {
  const jobId = useCamMachine(s => s.jobId);
  const hasOverlay = useCamMachine(s => !!s.overlay?.parts);
  const show = useCamMachine(s => s.showInTopView);
  const setShow = useCamMachine(s => s.setShowInTopView);
  if (!jobId || !hasOverlay) return null;
  return (
    <div
      role="radiogroup"
      aria-label="Show in the top view"
      className="dark pointer-events-auto flex flex-wrap items-center gap-1 rounded-lg border bg-background/90 p-1 text-foreground shadow-md backdrop-blur">
      <Layers className="mx-1 size-4 text-muted-foreground" aria-hidden />
      {kChoices.map(c => (
        <Button
          key={c.value}
          size="sm"
          role="radio"
          aria-checked={show === c.value}
          variant={show === c.value ? 'default' : 'ghost'}
          title={c.hint}
          onClick={() => setShow(c.value)}>
          {c.label}
        </Button>
      ))}
    </div>
  );
}
