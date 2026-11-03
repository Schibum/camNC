import { Input } from '@wbcnc/ui/components/input';
import { Label } from '@wbcnc/ui/components/label';

import { jobCutting, type MaterialKey, type PlanSettingsV1 } from '../planSettings';
import { BitSettings } from './BitPicker';
import { CuttingDataEditor } from './CuttingDataEditor';

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
  const set = (patch: Partial<PlanSettingsV1>) => onChange({ ...value, ...patch });

  return (
    <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l p-4">
      <h2 className="text-[15px] font-semibold">Settings</h2>

      <BitSettings value={value} onChange={onChange} />

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
