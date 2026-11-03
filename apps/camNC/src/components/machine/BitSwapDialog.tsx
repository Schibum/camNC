import { getCncApi } from '@/lib/fluidnc/machine';
import { bitLongName, bitSwapTitle, type BitSwap } from '@/lib/machine/bitSwap';
import { errorText, stopJob } from '@/lib/machine/jobs';
import { Button } from '@wbcnc/ui/components/button';
import { Checkbox } from '@wbcnc/ui/components/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@wbcnc/ui/components/dialog';
import { Label } from '@wbcnc/ui/components/label';
import { toast } from '@wbcnc/ui/components/sonner';
import { Play, Square } from 'lucide-react';
import { useState } from 'react';

type Step = 'off' | 'bit' | 'z' | 'on';

/**
 * Steps for a bit change the program paused for (`M0 (MSG … Change to T2 …)`): router off, new bit, Z, router on,
 * then Continue (cycle start). Continue waits until every step is ticked.
 *
 * Z is zeroed by hand here: while a job from the SD card is paused, FluidNC does not run commands from camNC
 * (jog, probe, `G10`) until the job continues, and would then run them in the middle of the job. So there is no
 * "Set Z here" or probe button; zeroing with the machine means stopping the job and resuming it from Setup.
 */
export function BitSwapDialog({
  swap,
  line,
  zOnSpoilboard,
  open,
  onOpenChange,
}: {
  swap: BitSwap;
  /** 1-based line of the pause. */
  line: number;
  /** The program has Z0 at the bottom of the stock (camNC boards). */
  zOnSpoilboard: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  'use no memo';
  const api = getCncApi();
  const [done, setDone] = useState<Record<Step, boolean>>({ off: false, bit: false, z: false, on: false });
  const [resuming, setResuming] = useState(false);
  const ready = Object.values(done).every(Boolean);
  const holdDone = api.status.value?.state === 'Hold' && api.status.value.subState === 0;

  const steps: { id: Step; label: string; detail?: string }[] = [
    { id: 'off', label: 'Switch the router off.' },
    { id: 'bit', label: `Put in the ${bitLongName(swap.to)}${swap.to.diameter !== undefined ? ` (T${swap.to.tool})` : ''}.` },
    {
      id: 'z',
      label: zOnSpoilboard ? 'Zero Z on the spoilboard.' : 'Zero Z where you zeroed the first bit.',
      detail:
        'The machine cannot jog, probe or set Z while the job is paused. To zero Z with the machine, stop the job, ' +
        'zero Z in Setup and resume the job there.',
    },
    { id: 'on', label: `Switch the router on${swap.rpm ? ` (${swap.rpm.toLocaleString('en-US')} rpm)` : ''}.` },
  ];

  async function resume() {
    setResuming(true);
    try {
      await api.resume();
    } catch (err) {
      toast.error('Continue failed', { description: errorText(err) });
    } finally {
      setResuming(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="bit-swap-dialog">
        <DialogHeader>
          <DialogTitle>{bitSwapTitle(swap)}</DialogTitle>
          <DialogDescription>The job paused for a bit change on line {line}.</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-3">
          {steps.map((step, i) => (
            <li key={step.id} className="flex flex-col gap-1">
              <Label className="flex flex-row items-start gap-2 font-normal">
                <Checkbox
                  className="mt-0.5"
                  checked={done[step.id]}
                  onCheckedChange={v => setDone(d => ({ ...d, [step.id]: v === true }))}
                />
                <span>
                  {i + 1}. {step.label}
                </span>
              </Label>
              {step.detail && <p className="text-xs text-muted-foreground pl-6">{step.detail}</p>}
            </li>
          ))}
        </ol>
        <p className="text-sm rounded-md bg-amber-100 text-amber-900 p-2">XY stays where it is. Do not move the board.</p>
        <DialogFooter>
          <Button variant="destructive" onClick={() => void stopJob()}>
            <Square /> Stop job
          </Button>
          <Button disabled={!ready || !holdDone || resuming} onClick={resume}>
            <Play /> Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
