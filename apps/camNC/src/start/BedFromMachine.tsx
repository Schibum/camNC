import { getCncApi } from '@/lib/fluidnc/machine';
import { MachineBoundsForm, MachineBoundsValues } from '@/setup/MachineBoundsForm';
import { Alert, AlertDescription, AlertTitle } from '@wbcnc/ui/components/alert';
import { Button } from '@wbcnc/ui/components/button';
import { useStore } from '@/store/store';
import { useEffect, useState } from 'react';

type ReadState = { kind: 'reading' } | { kind: 'read'; bounds: MachineBoundsValues } | { kind: 'failed'; message: string };

/**
 * Status states in which the axis travel is read. Single `$/axes/…` items only: `$CD` and `$#` were seen to reset
 * FluidNC 3.9.1. In Hold, FluidNC defers `$` commands until resume, so the read waits for Idle (or Alarm after power up).
 */
const kReadableStates = ['Idle', 'Alarm'];

/**
 * Once connected, reads the bed size from the controller's axis travel and lets the user confirm (or correct) it.
 * The values stay editable, and entering them by hand is always possible.
 */
export function BedFromMachine({ onConfirmed }: { onConfirmed: () => void }) {
  'use no memo';
  const api = getCncApi();
  const connected = api.isConnected.value;
  const readable = connected && kReadableStates.includes(api.state.value ?? '');
  const [read, setRead] = useState<ReadState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const setMachineBounds = useStore(s => s.setMachineBounds);

  useEffect(() => {
    if (!readable) return;
    let cancelled = false;
    setRead({ kind: 'reading' });
    api
      .readMachineBounds()
      .then(({ xmin, xmax, ymin, ymax }) => !cancelled && setRead({ kind: 'read', bounds: { xmin, xmax, ymin, ymax } }))
      .catch((err: Error) => !cancelled && setRead({ kind: 'failed', message: err.message }));
    return () => {
      cancelled = true;
    };
    // Read once per connection (and on retry), not on every status change.
  }, [api, readable, attempt]);

  if (!connected) return null;
  if (!read || read.kind === 'reading') {
    return (
      <p className="text-sm text-muted-foreground" data-testid="bed-reading">
        {readable
          ? 'Reading the axis travel from the controller…'
          : `Waiting for the machine to be idle (${api.state.value ?? 'unknown'})…`}
      </p>
    );
  }
  if (read.kind === 'read' && !editing) {
    const { xmin, xmax, ymin, ymax } = read.bounds;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm" data-testid="bed-read">
          Your bed: X {xmin} to {xmax} mm, Y {ymin} to {ymax} mm ({xmax - xmin} × {ymax - ymin} mm), read from the controller.
        </p>
        <div className="flex flex-row gap-2">
          <Button
            onClick={() => {
              setMachineBounds(xmin, ymin, xmax, ymax);
              onConfirmed();
            }}>
            Open workspace
          </Button>
          <Button variant="outline" onClick={() => setEditing(true)}>
            Adjust
          </Button>
        </div>
        <HomingHint />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {read.kind === 'failed' && (
        <Alert>
          <AlertTitle>Could not read the bed size</AlertTitle>
          <AlertDescription>
            {read.message}. Enter it below, or{' '}
            <Button variant="link" className="h-auto p-0" onClick={() => setAttempt(a => a + 1)}>
              try again
            </Button>
            .
          </AlertDescription>
        </Alert>
      )}
      <MachineBoundsForm
        initial={read.kind === 'read' ? read.bounds : undefined}
        submitLabel="Open workspace"
        showReadButton={false}
        onConfirmed={onConfirmed}
      />
      <HomingHint />
    </div>
  );
}

function HomingHint() {
  return (
    <p className="text-xs text-muted-foreground">
      Machine coordinates match the controller after homing. Home the machine before you double-click to jog.
    </p>
  );
}
