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
import { numberProblem, parseDecimal } from '../numberFormat';
import { type PlanSettingsV1 } from '../planSettings';
import { useBits, useToolLibrary, type StoredBit } from '../toolLibrary';
import { ImportToolLibrary } from './ImportToolLibrary';

const bitLabel = (b: LibraryTool) => `⌀ ${b.diameter} · ${b.name}`;
const sourceOf = (b: LibraryTool) => {
  const s = b as Partial<StoredBit>;
  return s.source === 'custom' ? 'added by hand' : s.library ? `library: ${s.library}` : 'built in';
};
/** Flutes and flute length, as far as known: "2 flutes · 22 mm flute length", or "". */
const bitSpecs = (b: LibraryTool) =>
  [b.flutes && `${b.flutes} ${b.flutes === 1 ? 'flute' : 'flutes'}`, b.fluteLength && `${+b.fluteLength.toFixed(1)} mm flute length`]
    .filter(Boolean)
    .join(' · ');

/**
 * A bit in a select: its name on as many lines as it takes (long library names like "VHM-Schaftfräser Z2 Ø 6 mm HB"
 * would be cut off), flutes and flute length below. The select itself shows only the first line.
 */
function BitOption({ bit }: { bit: LibraryTool }) {
  return (
    <SelectItem value={bitKey(bit)} className="py-2">
      <span className="flex min-w-0 flex-col items-start gap-0.5">
        <span className="whitespace-normal break-words">{bitLabel(bit)}</span>
        <span className="text-xs text-muted-foreground">{bitSpecs(bit) || 'Flat end mill'}</span>
      </span>
    </SelectItem>
  );
}

/** The select's own line for the chosen bit: one line, cut off with "…" (the full name is in the list and the title). */
function BitValue({ bit }: { bit: LibraryTool | undefined }) {
  return (
    <SelectValue>
      {bit && (
        <span className="truncate" title={bitLabel(bit)}>
          {bitLabel(bit)}
        </span>
      )}
    </SelectValue>
  );
}

/** A bit that's in no library: diameter, flutes and a name. */
function CustomBitForm({ onAdd }: { onAdd: (bit: StoredBit) => void }) {
  const [d, setD] = useState('');
  const [flutes, setFlutes] = useState('2');
  const [name, setName] = useState('');
  const diameter = parseDecimal(d);
  const dProblem = d.trim() ? numberProblem(d, { min: 0, minExclusive: true, max: 25, unit: 'mm' }) : null;
  const flutesProblem = flutes.trim() ? numberProblem(flutes, { min: 1, max: 12, integer: true }) : null;
  const ok = !!d.trim() && !dProblem && !flutesProblem;
  const add = () => {
    useToolLibrary
      .getState()
      .addCustom({ diameter, flutes: parseDecimal(flutes) || undefined, name: name.trim() || `${diameter} mm flat` });
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
            inputMode="decimal"
            autoComplete="off"
            className="h-8 font-mono"
            value={d}
            aria-invalid={dProblem ? true : undefined}
            aria-describedby={dProblem ? 'custom-bit-d-error' : undefined}
            onChange={e => setD(e.target.value)}
          />
          {dProblem && (
            <p id="custom-bit-d-error" className="text-xs text-destructive">
              {dProblem}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="custom-bit-flutes" className="text-xs font-normal text-muted-foreground">
            Flutes
          </Label>
          <Input
            id="custom-bit-flutes"
            inputMode="numeric"
            autoComplete="off"
            className="h-8 font-mono"
            value={flutes}
            aria-invalid={flutesProblem ? true : undefined}
            aria-describedby={flutesProblem ? 'custom-bit-flutes-error' : undefined}
            onChange={e => setFlutes(e.target.value)}
          />
          {flutesProblem && (
            <p id="custom-bit-flutes-error" className="text-xs text-destructive">
              {flutesProblem}
            </p>
          )}
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
  const [howOpen, setHowOpen] = useState(false);
  const set = (patch: Partial<PlanSettingsV1>) => onChange({ ...value, ...patch });
  const smaller = bits.filter(b => b.diameter < value.bit.diameter);
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1.5">
        <Label htmlFor="plan-bit">Bit</Label>
        <Select value={bitKey(value.bit)} onValueChange={k => set({ bit: bits.find(b => bitKey(b) === k)! })}>
          <SelectTrigger id="plan-bit" className="w-full">
            <BitValue bit={value.bit} />
          </SelectTrigger>
          <SelectContent className="max-w-[min(26rem,calc(100vw-2rem))]">
            {bits.map(b => (
              <BitOption key={bitKey(b)} bit={b} />
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Flat end mill{bitSpecs(value.bit) && ` · ${bitSpecs(value.bit)}`} · {sourceOf(value.bit)}
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
            {value.smallBit ? <BitValue bit={value.smallBit} /> : <SelectValue />}
          </SelectTrigger>
          <SelectContent className="max-w-[min(26rem,calc(100vw-2rem))]">
            <SelectItem value="none">None</SelectItem>
            {smaller.map(b => (
              <BitOption key={bitKey(b)} bit={b} />
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {value.smallBit
            ? 'Cuts what the main bit can’t reach. Boards that need it get a second program: swap the bit and zero Z in between.'
            : 'For slots or corners narrower than the main bit.'}{' '}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            aria-expanded={howOpen}
            aria-controls="small-bit-how"
            onClick={() => setHowOpen(o => !o)}>
            How it works
          </button>
        </p>
        {howOpen && (
          <ul id="small-bit-how" className="flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed text-muted-foreground">
            <li>One setting for the whole job, not per part or per operation.</li>
            <li>
              Each pocket or hole gets the largest bit that fits it. Where a pocket narrows to a slot that bit can’t enter, the smaller bit
              cuts the slot. Outlines always use the main bit.
            </li>
            <li>
              A board that needs both bits gets two programs, the smaller bit first. The machine queue stops in between to swap the bit and
              zero Z; XY stays.
            </li>
            <li>For now you can’t pick the bit for one pocket or part.</li>
            <li>Inside corners the main bit can’t reach are only flagged, not cleaned up with the smaller bit afterwards.</li>
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * "Bit: ⌀3.175 · 1/8″ flat ▾" at the top of a step: the job's bit, and the picker for it. With `onOpen` it opens the
 * step's own bit settings (the Plan step's Settings tab) instead of a popover.
 */
export function BitChip({
  value,
  onChange,
  onOpen,
}: {
  value: PlanSettingsV1;
  onChange: (v: PlanSettingsV1) => void;
  onOpen?: () => void;
}) {
  const chip = (
    <Button size="sm" variant="outline" aria-label={`Bit: ⌀${value.bit.diameter} ${value.bit.name}. Change the bit`} onClick={onOpen}>
      <span className="text-muted-foreground">Bit:</span> ⌀{value.bit.diameter} · {value.bit.name}
      {value.smallBit && <span className="text-muted-foreground">+ ⌀{value.smallBit.diameter}</span>}
      {!onOpen && <ChevronDown />}
    </Button>
  );
  const hint = 'The bit for the whole job. It sets the margin and gap between parts on the boards, and every toolpath.';
  if (onOpen) return <Hint text={hint}>{chip}</Hint>;
  return (
    <Popover>
      <Hint text={hint}>
        <PopoverTrigger asChild>{chip}</PopoverTrigger>
      </Hint>
      <PopoverContent className="w-96" align="end">
        <BitSettings value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
