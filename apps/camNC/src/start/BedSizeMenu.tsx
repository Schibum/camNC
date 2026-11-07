import { MachineBoundsForm, type MachineBoundsValues } from '@/setup/MachineBoundsForm';
import { Button } from '@wbcnc/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@wbcnc/ui/components/popover';
import { ChevronDown, Ruler } from 'lucide-react';
import { useState } from 'react';
import { boundsFromSize, kBedPresets } from './bedPresets';

/** The size of the drawn bed. A preset only changes the drawing; a custom size is saved by its form, which then confirms. */
export function BedSizeMenu({
  bounds,
  onPick,
  onCustomConfirmed,
}: {
  bounds: MachineBoundsValues;
  onPick: (bounds: MachineBoundsValues) => void;
  onCustomConfirmed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Bed size: ${bounds.xmax - bounds.xmin} by ${bounds.ymax - bounds.ymin} mm`}>
          <Ruler aria-hidden /> {bounds.xmax - bounds.xmin} × {bounds.ymax - bounds.ymin} mm <ChevronDown aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-(--radix-popover-content-available-height) w-[min(22rem,calc(100vw-1rem))] flex-col gap-1 overflow-auto p-2">
        {kBedPresets.map(preset => (
          <Button
            key={preset.label}
            variant="ghost"
            className="justify-between"
            onClick={() => {
              onPick(boundsFromSize(preset.width, preset.depth));
              setOpen(false);
            }}>
            {preset.label}{' '}
            <span className="text-muted-foreground">
              {preset.width} × {preset.depth}
            </span>
          </Button>
        ))}
        <Button variant="ghost" className="justify-start" onClick={() => setCustom(v => !v)}>
          Custom size…
        </Button>
        {custom && (
          <div className="p-2">
            <MachineBoundsForm initial={bounds} submitLabel="Open workspace" onConfirmed={onCustomConfirmed} />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
