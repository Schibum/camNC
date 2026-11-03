import type { LibraryTool } from '@wbcnc/cam';
import { Input } from '@wbcnc/ui/components/input';
import { Label } from '@wbcnc/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { bitKey } from '../cuttingData';
import { jobCutting, kDefaultBit, type MaterialKey, type PlanSettingsV1 } from '../planSettings';
import { CuttingDataEditor } from './CuttingDataEditor';
import { useToolLibrary } from '../toolLibrary';
import { ImportToolLibrary } from './ImportToolLibrary';

const bitLabel = (b: LibraryTool) => `⌀ ${b.diameter} · ${b.name}`;

/**
 * Bits, their cutting data in the board's material, cut-through depth: everything the Plan step needs from the user,
 * with Fusion-like defaults.
 */
export function PlanSettingsPanel({
  value,
  material,
  onChange,
}: {
  value: PlanSettingsV1;
  /** The shown board's material: cutting data is per bit + material. */
  material: MaterialKey;
  onChange: (v: PlanSettingsV1) => void;
}) {
  const { tools, source, setTools } = useToolLibrary();
  const bits = [kDefaultBit, ...tools.filter(t => bitKey(t) !== bitKey(kDefaultBit))];
  if (!bits.some(b => bitKey(b) === bitKey(value.bit))) bits.push(value.bit);
  const set = (patch: Partial<PlanSettingsV1>) => onChange({ ...value, ...patch });
  const smaller = [...bits, ...(value.smallBit ? [value.smallBit] : [])].filter(
    (b, i, all) => b.diameter < value.bit.diameter && all.findIndex(x => bitKey(x) === bitKey(b)) === i
  );

  return (
    <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l p-4">
      <h2 className="text-[15px] font-semibold">Settings</h2>

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
          Flat end mill{value.bit.flutes ? `, ${value.bit.flutes} flutes` : ''}
          {source ? ` · library: ${source}` : ''}
        </p>
        <ImportToolLibrary onImport={setTools} />
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
            ? 'Cuts what the main bit can’t reach, first. Boards that need it pause once to swap bits.'
            : 'For slots or corners narrower than the main bit.'}
        </p>
      </section>

      <section className="flex flex-col gap-1.5" aria-label="Cutting data">
        <h3 className="text-sm font-medium">
          Cutting data · ⌀{value.bit.diameter} in {material}
        </h3>
        <CuttingDataEditor
          bit={value.bit}
          material={material}
          job={jobCutting(value)}
          onJobChange={cutting => set({ cutting, finalFeedFactor: undefined })}
        />
        {value.smallBit && value.smallBit.diameter < value.bit.diameter && (
          <>
            <h3 className="pt-2 text-sm font-medium">
              Second bit · ⌀{value.smallBit.diameter} in {material}
            </h3>
            <CuttingDataEditor bit={value.smallBit} material={material} fields={['stepdown']} />
          </>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <Label htmlFor="plan-cut-below">Cut through to (mm below the board)</Label>
        <Input
          id="plan-cut-below"
          type="number"
          min={0}
          max={2}
          step={0.1}
          className="font-mono"
          value={value.cutBelow}
          onChange={e => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v >= 0 && v <= 2) set({ cutBelow: v });
          }}
        />
        <p className="text-xs text-muted-foreground">The final pass ends at Z−{value.cutBelow}, in the spoilboard.</p>
      </section>

      <span className="grow" />
      <p className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
        Defaults follow your Fusion jobs: Z0 at the bottom of the board, roughing to +1 mm leaving 0.1 mm, one final pass through, climb
        cut.
      </p>
    </aside>
  );
}
