import { MachineConnectionForm } from '@/components/machine/MachineConnectionForm';
import { ConnectionBadge } from '@/components/machine/MachineStatusBar';
import { getCncApi } from '@/lib/fluidnc/machine';
import type { MachineBoundsValues } from '@/setup/MachineBoundsForm';
import { Button } from '@wbcnc/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@wbcnc/ui/components/dialog';
import { useState } from 'react';
import { BedFromMachine } from './BedFromMachine';

/** Connecting takes a dialog of its own, with the bed read from the controller redrawn behind it while it is open. */
export function ConnectMachineButton({
  openAtStart,
  onBedRead,
  onBedConfirmed,
  onClosed,
}: {
  /** Connected, but the bed size is still unknown: reading it is the next step. */
  openAtStart: boolean;
  onBedRead: (bounds: MachineBoundsValues) => void;
  onBedConfirmed: () => void;
  onClosed: () => void;
}) {
  'use no memo';
  const connected = getCncApi().isConnected.value;
  const [open, setOpen] = useState(openAtStart && connected);
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) onClosed();
      }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ConnectionBadge /> {connected ? 'Machine' : 'Connect'}
        </Button>
      </DialogTrigger>
      <DialogContent className="dark max-h-[90dvh] overflow-auto text-foreground">
        <DialogHeader>
          <DialogTitle>Connect your FluidNC</DialogTitle>
          <DialogDescription>camNC reads the bed size from the controller over your local network.</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-4">
          <MachineConnectionForm />
          <BedFromMachine onRead={onBedRead} onConfirmed={onBedConfirmed} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
