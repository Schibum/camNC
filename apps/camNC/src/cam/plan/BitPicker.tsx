import type { LibraryTool } from '@wbcnc/cam';
import { Link } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { Input } from '@wbcnc/ui/components/input';
import { Label } from '@wbcnc/ui/components/label';
import { Popover, PopoverContent, PopoverTrigger } from '@wbcnc/ui/components/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { bitKey } from '../cuttingData';
import { Hint } from '../Hint';
import { type PlanSettingsV1 } from '../planSettings';
import { useBits, useToolLibrary, type StoredBit } from '../toolLibrary';
import { ImportToolLibrary } from './ImportToolLibrary';

const bitLabel = (b: LibraryTool) => `⌀ ${b.diameter} · ${b.name}`;
const sourceOf = (b: LibraryTool) => {
  const s = b as Partial<StoredBit>;
  return s.source === 'custom' ? 'added by hand' : s.library ? `library: ${s.library}` : 'built in';
};

/** A bit that's in no library: diameter, flutes and a name. */
function CustomBitForm({ onAdd }: { onAdd: (bit: StoredBit) => void }) {
  const [d, setD] = useState('');
  const [flutes, setFlutes] = useState('2');
  const [name, setName] = useState('');
  const diameter = parseFloat(d);
  const ok = Number.isFinite(diameter) && diameter > 0 && diameter <= 25;
  const add = () => {
    useToolLibrary.getState().addCustom({ diameter, flutes: parseInt(flutes) || undefined, name: name.trim() || `${diameter} mm flat` });
    onAdd(useToolLibrary.getState().bits.at(-1)!);
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border p-2.5" role="group" aria-label="Custom bit">
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="custom-bit-d" className="text-xs font-normal text-muted-foreground">
            Diameter (mm)
          </Label>
          <Input
            id="custom-bit-d"
            type="number"
            min={0.1}
            step={0.1}
            className="h-8 font-mono"
            value={d}
            onChange={e => setD(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="custom-bit-flutes" className="text-xs font-normal text-muted-foreground">
            Flutes
          </Label>
          <Input
            id="custom-bit-flutes"
            type="number"
            min={1}
            step={1}
            className="h-8 font-mono"
            value={flutes}
            onChange={e => setFlutes(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="custom-bit-name" className="text-xs font-normal text-muted-foreground">
          Name
        </Label>
        <Input
          id="custom-bit-name"
          className="h-8"
          placeholder={ok ? `${diameter} mm flat` : 'e.g. 6 mm 2-flute'}
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>
      <Button size="sm" disabled={!ok} onClick={add} className="self-start">
        Add bit
      </Button>
    </div>
  );
}

/** Main bit, optional second smaller bit, and where bits come from: the job's bit choices. */
export function BitSettings({ value, onChange }: { value: PlanSettingsV1; onChange: (v: PlanSettingsV1) => void }) {
  const bits = useBits([value.bit, ...(value.smallBit ? [value.smallBit] : [])]);
  const importLibrary = useToolLibrary(s => s.importLibrary);
  const [custom, setCustom] = useState(false);
  const set = (patch: Partial<PlanSettingsV1>) => onChange({ ...value, ...patch });
  const smaller = bits.filter(b => b.diameter < value.bit.diameter);
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1.5">
        <Label htmlFor="plan-bit">Bit</Label>
        <Select value={bitKey(value.bit)} onValueChange={k => set({ bit: bits.find(b => bitKey(b) === k)! })}>
          <SelectTrigger id="plan-bit" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {bits.map(b => (
              <SelectItem key={bitKey(b)} value={bitKey(b)}>
                {bitLabel(b)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Flat end mill{value.bit.flutes ? `, ${value.bit.flutes} flutes` : ''} · {sourceOf(value.bit)}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ImportToolLibrary onImport={importLibrary} />
          <Button size="sm" variant="outline" aria-expanded={custom} onClick={() => setCustom(c => !c)}>
            Custom bit…
          </Button>
          <Button size="sm" variant="link" className="px-1" asChild>
            <Link to="/settings/bits">Manage bits…</Link>
          </Button>
        </div>
        {custom && (
          <CustomBitForm
            onAdd={bit => {
              setCustom(false);
              set({ bit });
            }}
          />
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <Label htmlFor="plan-small-bit">Second, smaller bit (optional)</Label>
        <Select
          value={value.smallBit ? bitKey(value.smallBit) : 'none'}
          onValueChange={k => set({ smallBit: k === 'none' ? undefined : bits.find(b => bitKey(b) === k) })}>
          <SelectTrigger id="plan-small-bit" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {smaller.map(b => (
              <SelectItem key={bitKey(b)} value={bitKey(b)}>
                {bitLabel(b)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {value.smallBit
            ? 'Cuts what the main bit can’t reach. Boards that need it get a second program: swap the bit and zero Z in between.'
            : 'For slots or corners narrower than the main bit.'}
        </p>
      </section>
    </div>
  );
}

/** "Bit: ⌀3.175 · 1/8″ flat ▾" at the top of a step: the job's bit, and the picker for it. */
export function BitChip({ value, onChange }: { value: PlanSettingsV1; onChange: (v: PlanSettingsV1) => void }) {
  return (
    <Popover>
      <Hint text="The bit for the whole job. It sets the margin and gap between parts on the boards, and every toolpath.">
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" aria-label={`Bit: ⌀${value.bit.diameter} ${value.bit.name}. Change the bit`}>
            <span className="text-muted-foreground">Bit:</span> ⌀{value.bit.diameter} · {value.bit.name}
            {value.smallBit && <span className="text-muted-foreground">+ ⌀{value.smallBit.diameter}</span>}
            <ChevronDown />
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent className="w-96" align="end">
        <BitSettings value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
