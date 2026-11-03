import { Label } from '@wbcnc/ui/components/label';

import { jobCutting, type MaterialKey, type PlanSettingsV1 } from '../planSettings';
import { BitSettings } from './BitPicker';
import { CuttingDataEditor } from './CuttingDataEditor';
import { NumberInput } from '../NumberInput';

/**
 * Bits, their cutting data in the board's material, cut-through depth: everything the Plan step needs from the user,
 * with Fusion-like defaults. The Plan step's Settings tab.
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
    <div className="flex flex-col gap-4">
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
        <NumberInput
          id="plan-cut-below"
          min={0}
          max={2}
          unit="mm"
          commit="change"
          value={value.cutBelow}
          onCommit={cutBelow => set({ cutBelow })}
          aria-describedby="plan-cut-below-help"
        />
        <p id="plan-cut-below-help" className="text-xs text-muted-foreground">
          0–2 mm. The final pass ends at Z−{value.cutBelow}, in the spoilboard.
        </p>
      </section>

      <p className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
        Defaults: Z0 at the bottom of the board, roughing to +1 mm leaving 0.1 mm, one final pass through, climb cut.
      </p>
    </div>
  );
}
