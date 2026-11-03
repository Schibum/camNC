import { Checkbox } from '@wbcnc/ui/components/checkbox';
import { Label } from '@wbcnc/ui/components/label';
import type { CamPartInfo } from '../camTypes';
import { fmt } from './partFormat';

function insideCorners(r: number | null) {
  if (r === null) return { value: 'none tight', hint: 'Any bit reaches every inside corner.' };
  if (r < 0.25) return { value: 'sharp', hint: 'Sharp inside corners come out rounded to the bit radius.' };
  return { value: `R ${fmt(r)}`, hint: `Bits up to ⌀ ${fmt(2 * r)} mm reach every inside corner.` };
}

/** Details of the selected part: size, how it lies, what was detected, and whether it is milled at all. */
export function PartInspector({
  part,
  milled,
  onMilledChange,
}: {
  part: CamPartInfo;
  milled: boolean;
  onMilledChange: (milled: boolean) => void;
}) {
  const { summary } = part;
  const corners = insideCorners(summary.smallestInsideRadius);
  const notes: string[] = [];
  if (summary.notFlat)
    notes.push(
      `Not a flat board: only ${Math.round(summary.prismaticRatio * 100)}% of its faces are flat or vertical. 3D-printed or turned parts stay out of the boards.`
    );
  if (summary.needsFlip)
    notes.push(
      `Features on the bottom face (${summary.bottomDepths.map(d => `${fmt(d)} mm`).join(', ')} from the bottom): this part needs a second setup, turned over.`
    );
  if (!summary.notFlat && summary.chips.some(c => c.kind === 'curved-edge'))
    notes.push('The curved edge has straight walls, so the normal outline cut makes it. No 3D toolpath needed.');
  if (!summary.notFlat && summary.slopedArea > 1)
    notes.push(`${Math.round(summary.slopedArea)} mm² of small sloped faces (chamfers, fillets) come out square.`);

  return (
    <aside className="flex min-h-0 flex-col gap-3.5 overflow-y-auto border-l p-4">
      <h2 className="text-[15px] font-semibold">
        {part.name}
        {part.names.length > 1 && <span className="font-normal text-muted-foreground"> × {part.names.length}</span>}
      </h2>
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
      {!summary.notFlat && (
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
              <span>Inside corners</span>
              <span className="font-mono text-muted-foreground">{corners.value}</span>
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
      <span className="grow" />
      <div className="flex items-center gap-2">
        <Checkbox id="mill-part" checked={milled} onCheckedChange={v => onMilledChange(v === true)} />
        <Label htmlFor="mill-part">Mill this part</Label>
      </div>
    </aside>
  );
}
