import type { LibraryTool } from '@wbcnc/cam';
import { Button } from '@wbcnc/ui/components/button';
import { Input } from '@wbcnc/ui/components/input';
import { cn } from '@wbcnc/ui/lib/utils';
import { RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import {
  cuttingKey,
  kCuttingFields,
  kCuttingLabels,
  kSourceLabels,
  without,
  resolveCutting,
  useCuttingData,
  type CuttingData,
  type CuttingField,
} from '../cuttingData';
import type { MaterialKey } from '../planSettings';

const bitName = (bit: LibraryTool) => `⌀${bit.diameter} ${bit.name}`;

/**
 * Cutting data of one bit in one material, each value with where it comes from. A changed value is saved for the
 * bit + material (every job), or with `onJobChange` for this job only.
 */
export function CuttingDataEditor({
  bit,
  material,
  job,
  onJobChange,
  fields = kCuttingFields,
  className,
}: {
  bit: LibraryTool;
  material: MaterialKey;
  /** This job's overrides; only the job's main bit has them. */
  job?: Partial<CuttingData>;
  onJobChange?: (job: Partial<CuttingData>) => void;
  fields?: CuttingField[];
  className?: string;
}) {
  const key = cuttingKey(bit, material);
  const uid = useId();
  const saved = useCuttingData(s => s.saved[key]);
  const { save, reset } = useCuttingData.getState();
  const { values, source } = resolveCutting(bit, material, saved, job);
  const [draft, setDraft] = useState<Partial<Record<CuttingField, string>>>({});
  const parsed = Object.fromEntries(
    Object.entries(draft).flatMap(([f, v]) => {
      const n = parseFloat(v!);
      const min = kCuttingLabels[f as CuttingField].min;
      return Number.isFinite(n) && (min !== undefined ? n >= min : n > 0) && n !== values[f as CuttingField] ? [[f, n]] : [];
    })
  ) as Partial<CuttingData>;
  const changed = Object.keys(parsed).length > 0;
  const done = () => setDraft({});
  const undo = (field: CuttingField) => {
    if (source[field] === 'job' && onJobChange) {
      onJobChange(without(job ?? {}, field));
    } else reset(key, field);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {fields.map(field => {
        const { label, unit, step } = kCuttingLabels[field];
        const id = `${uid}-${field}`;
        return (
          <div key={field} className="grid grid-cols-[1fr_96px_auto] items-center gap-x-2 text-[13px]">
            <label htmlFor={id} className="flex flex-col">
              <span>{label}</span>
              <span className="text-[11px] text-muted-foreground">
                {unit} · {kSourceLabels[source[field]]}
              </span>
            </label>
            <Input
              id={id}
              type="number"
              min={0}
              step={step}
              className="h-8 font-mono"
              value={draft[field] ?? String(values[field])}
              onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))}
            />
            {(source[field] === 'job' || source[field] === 'saved') && !(field in draft) ? (
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`${label}: back to the ${saved?.[field] !== undefined && source[field] === 'job' ? 'saved' : 'library or default'} value`}
                onClick={() => undo(field)}>
                <RotateCcw className="size-3.5" />
              </Button>
            ) : (
              <span className="w-7" />
            )}
          </div>
        );
      })}
      {changed && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            onClick={() => {
              save(key, parsed);
              // A saved value replaces this job's override of it.
              if (onJobChange && job) onJobChange(Object.fromEntries(Object.entries(job).filter(([f]) => !(f in parsed))));
              done();
            }}>
            Save for {bitName(bit)} + {material}
          </Button>
          {onJobChange && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onJobChange({ ...job, ...parsed });
                done();
              }}>
              Only this job
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={done}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
