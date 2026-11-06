import { kColletClearance } from '@wbcnc/cam/holdPoints';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@wbcnc/ui/components/dialog';
import { useHoldHardware } from '../holdHardware';
import { HoldDiagram } from './HoldDiagram';
import { NumberField } from './NumberField';

/** The clamps' and screws' sizes, for every job, each column with a side view of what its numbers mean. */
export function HoldSizesDialog({
  open,
  onOpenChange,
  bit,
  stockTop,
  nutAbove,
  stickout,
  onStickout,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bit: number;
  /** Of the selected board: the side views show its deepest cut. */
  stockTop: number;
  nutAbove: number;
  stickout: number;
  /** The job's bit's stick-out changed, mm. */
  onStickout: (stickout: number) => void;
}) {
  const hardware = useHoldHardware(s => s.hardware);
  const setHardware = useHoldHardware(s => s.setHardware);
  const view = { bit, stockTop, nutAbove, stickout };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Clamp and screw sizes</DialogTitle>
          <DialogDescription>
            Measure yours once: these apply to all jobs, and the bit keeps clear of what you enter here.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-2">
          <section aria-label="Clamp" className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              <NumberField
                id="clamp-reach"
                label="Clamp reach"
                hint="How far the clamp’s toe reaches onto the board from its edge. The bit keeps clear of the toe."
                value={hardware.clamp.d}
                onCommit={d => setHardware({ ...hardware, clamp: { ...hardware.clamp, d } })}
                min={0.5}
              />
              <NumberField
                id="clamp-width"
                label="Clamp width"
                hint="The clamp’s toe along the edge."
                value={hardware.clamp.w}
                onCommit={w => setHardware({ ...hardware, clamp: { ...hardware.clamp, w } })}
                min={2}
              />
              <NumberField
                id="clamp-height"
                label="Clamp height"
                hint={`How far it stands above the board's top. Every rapid passes above the tallest fixture, so measure it. Where it stands higher than the collet nut gets down to, cuts also keep ${kColletClearance} mm from it for the nut.`}
                value={hardware.clamp.height}
                onCommit={height => setHardware({ ...hardware, clamp: { ...hardware.clamp, height } })}
              />
            </div>
            <HoldDiagram hold={{ kind: 'clamp', ...hardware.clamp }} {...view} />
          </section>
          <section aria-label="Screw" className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              <NumberField
                id="screw-d"
                label="Screw head ⌀"
                hint="The screw head. The bit keeps clear of it."
                value={hardware.screw.d}
                onCommit={d => setHardware({ ...hardware, screw: { ...hardware.screw, d } })}
                min={2}
              />
              <NumberField
                id="screw-height"
                label="Screw height"
                hint="How far the head stands above the board's top. Every rapid passes above the tallest fixture."
                value={hardware.screw.height}
                onCommit={height => setHardware({ ...hardware, screw: { ...hardware.screw, height } })}
              />
              <NumberField
                id="hold-stickout"
                label="Bit stick-out"
                hint="How far the job's bit sticks out below the collet nut: measure it once the bit is in. It's kept with the bit (for every board of the job, and the next job with this bit). With the deepest cut it says how low the nut gets, so whether it can hit a fixture."
                value={stickout}
                onCommit={onStickout}
                min={1}
              />
            </div>
            <HoldDiagram hold={{ kind: 'screw', ...hardware.screw }} {...view} />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
