import { Button } from '@wbcnc/ui/components/button';
import { Checkbox } from '@wbcnc/ui/components/checkbox';
import { Label } from '@wbcnc/ui/components/label';
import { cn } from '@wbcnc/ui/lib/utils';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import type { CamPartInfo } from '../camTypes';
import { Hint } from '../Hint';
import { fmt } from './partFormat';
import { PartNameInput } from './PartNameInput';

function insideCorners(r: number | null) {
  if (r === null) return { label: 'No tight inside corners', value: '', hint: 'Any bit reaches every inside corner.' };
  if (r < 0.25) return { label: 'Inside corners', value: 'sharp', hint: 'Sharp inside corners come out rounded to the bit radius.' };
  return { label: 'Inside corners', value: `R ${fmt(r)}`, hint: `Bits up to ⌀ ${fmt(2 * r)} mm reach every inside corner.` };
}

/** Details of the selected part: size, how it lies, what was detected, and whether it is milled at all. */
export function PartInspector({
  part,
  milled,
  onMilledChange,
  onRename,
}: {
  part: CamPartInfo;
  milled: boolean;
  onMilledChange: (milled: boolean) => void;
  /** A new name for the part; empty goes back to the model's name. */
  onRename: (name: string) => void;
}) {
  const { summary } = part;
  const corners = insideCorners(summary.smallestInsideRadius);
  const notes: string[] = [];
  if (summary.needsFlip)
    notes.push(
      `Features on the bottom face (${summary.bottomDepths.map(d => `${fmt(d)} mm`).join(', ')} from the bottom): this part needs a second setup, turned over.`
    );
  if (!summary.notFlat && summary.chips.some(c => c.kind === 'curved-edge'))
    notes.push('The curved edge has straight walls, so the normal outline cut makes it. No 3D toolpath needed.');
  if (summary.slopedArea > 1)
    notes.push(
      `${Math.round(summary.slopedArea)} mm² of sloped or rounded faces (chamfers, fillets, edge rounds) come out square with a flat bit.`
    );

  return (
    <aside className="flex min-h-0 flex-col gap-3.5 overflow-y-auto border-l p-4">
      <PartName key={part.id} part={part} onRename={onRename} />
      <MilledControl notFlat={summary.notFlat} slopedShare={summary.slopedShare} milled={milled} onChange={onMilledChange} />
      <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-[13px]">
        <dt className="text-muted-foreground">Size</dt>
        <dd className="font-mono">
          {fmt(part.size[0])} × {fmt(part.size[1])} × {fmt(part.thickness)} mm
        </dd>
        <dt className="text-muted-foreground">Up side</dt>
        <dd>
          {summary.needsFlip
            ? 'Both sides have features'
            : summary.chips.some(c => c.kind === 'pockets' || c.kind === 'groove')
              ? 'Pocket side · auto'
              : 'Either side'}
        </dd>
        {part.names.length > 1 && (
          <>
            <dt className="text-muted-foreground">Bodies</dt>
            <dd>{part.names.join(', ')}</dd>
          </>
        )}
      </dl>
      {(!summary.notFlat || milled) && (
        <>
          <h3 className="mt-1 text-[13px] font-semibold">Detected features</h3>
          <ul className="flex flex-col gap-2 text-[13px]">
            {summary.chips
              .filter(c => c.kind !== 'outline-only' && c.kind !== 'curved-edge')
              .map(c => (
                <li key={c.label} className="flex justify-between gap-2">
                  <span>{c.label.replace(/ [\d.]+ deep$/, '')}</span>
                  {c.depth !== undefined && <span className="font-mono text-muted-foreground">{fmt(c.depth)} deep</span>}
                </li>
              ))}
            <li className="flex justify-between gap-2">
              <span>Outline (through)</span>
              <span className="font-mono text-muted-foreground">{fmt(part.thickness)}</span>
            </li>
            <li className="flex justify-between gap-2" title={corners.hint}>
              <span>{corners.label}</span>
              {corners.value && <span className="font-mono text-muted-foreground">{corners.value}</span>}
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">{corners.hint}</p>
        </>
      )}
      {notes.map(n => (
        <p key={n} className="rounded-lg bg-amber-500/10 px-3 py-2.5 text-[13px] leading-relaxed">
          {n}
        </p>
      ))}
    </aside>
  );
}

/** The part's name, renamed in place: Enter or leaving the field keeps it, Escape doesn't. */
function PartName({ part, onRename }: { part: CamPartInfo; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return <PartNameInput part={part} onRename={onRename} onDone={() => setEditing(false)} className="text-[15px] font-semibold" />;
  return (
    <div className="flex items-start gap-1">
      <h2 className="min-w-0 break-words text-[15px] font-semibold">
        {part.name}
        {part.names.length > 1 && <span className="font-normal text-muted-foreground"> × {part.names.length}</span>}
      </h2>
      <Hint text="Rename the part. The new name shows on every step and in the G-code." side="left">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Rename ${part.name}`}
          onClick={() => setEditing(true)}
          className="-my-1 ml-auto size-7 shrink-0 text-muted-foreground">
          <Pencil className="size-3.5" />
        </Button>
      </Hint>
    </div>
  );
}

/**
 * Whether the part is cut at all, right under its name: 3D parts are off by default with the reason, and can be
 * milled as flat anyway (sloped faces then come out square).
 */
function MilledControl({
  notFlat,
  slopedShare,
  milled,
  onChange,
}: {
  notFlat: boolean;
  slopedShare: number;
  milled: boolean;
  onChange: (milled: boolean) => void;
}) {
  return (
    <div
      className={cn('flex flex-col gap-2 rounded-lg border p-3', milled ? 'border-primary/50 bg-primary/5' : 'border-border bg-muted/40')}>
      <Hint
        id="mill-part-hint"
        side="left"
        text={
          notFlat
            ? 'Cuts its outline, holes and pockets from a flat board. Its sloped and curved faces come out square.'
            : 'Unticked, the part stays out of the boards: for 3D-printed or bought parts.'
        }>
        <div className="flex items-center gap-2.5">
          <Checkbox
            id="mill-part"
            checked={milled}
            onCheckedChange={v => onChange(v === true)}
            aria-describedby="mill-part-hint"
            className="size-5"
          />
          <Label htmlFor="mill-part" className="text-sm font-medium">
            {notFlat ? 'Mill as a flat board anyway' : 'Mill this part'}
          </Label>
          <span className={cn('ml-auto text-xs', milled ? 'text-primary' : 'text-muted-foreground')}>
            {milled ? 'on a board' : 'not milled'}
          </span>
        </div>
      </Hint>
      {notFlat && (
        <p className="text-[13px] leading-relaxed text-amber-700 dark:text-amber-400">
          3D part: {Math.round(slopedShare * 100)}% of its top is sloped or curved, which a flat bit can’t make. Left out of the boards
          unless you mill it anyway.
        </p>
      )}
    </div>
  );
}
