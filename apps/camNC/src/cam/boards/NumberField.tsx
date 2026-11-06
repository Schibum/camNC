import { Label } from '@wbcnc/ui/components/label';
import { Hint } from '../Hint';
import { NumberInput } from '../NumberInput';

/** A labelled number field of the Boards step, with what its value does as a tooltip and description. */
export function NumberField({
  id,
  label,
  value,
  onCommit,
  min = 0,
  integer,
  empty,
  hint,
  side,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  integer?: boolean;
  /** Nothing to show yet: the field shows "–". */
  empty?: boolean;
  /** What the value does: tooltip and the input's accessible description. */
  hint?: string;
  /** Where the tooltip opens: beside the field where one above or below would cover what's next to it. */
  side?: 'top' | 'left';
}) {
  const field = (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <NumberInput
        id={id}
        value={value}
        digits={1}
        min={min}
        integer={integer}
        unit={integer ? undefined : 'mm'}
        empty={empty}
        placeholder={empty ? '–' : undefined}
        className="h-8"
        onCommit={onCommit}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
    </div>
  );
  return hint ? (
    <Hint text={hint} id={`${id}-hint`} side={side}>
      {field}
    </Hint>
  ) : (
    field
  );
}
