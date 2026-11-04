import { Input } from '@wbcnc/ui/components/input';
import { cn } from '@wbcnc/ui/lib/utils';
import { useState } from 'react';
import { fmtDecimal, numberProblem, parseDecimal, type NumberRange } from './numberFormat';

/**
 * A number field of the CAM steps: a text field (a `type=number` field shows the locale's comma, "0,3") that always
 * shows dot decimals and takes a comma too. A value out of range or no number stays in the field with an inline
 * error until it is fixed (or Escape); valid values are passed on as they are typed (`commit="change"`) or when the
 * field is left (`commit="blur"`, also on Enter).
 */
export function NumberInput({
  id,
  value,
  onCommit,
  commit = 'blur',
  digits = 2,
  empty,
  placeholder,
  className,
  'aria-describedby': describedBy,
  'aria-label': ariaLabel,
  ...range
}: NumberRange & {
  id: string;
  value: number;
  onCommit: (v: number) => void;
  commit?: 'change' | 'blur';
  digits?: number;
  /** Show the field empty (with the placeholder) until something is typed, e.g. the size of an empty fitted board. */
  empty?: boolean;
  placeholder?: string;
  className?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const problem = draft === null ? null : numberProblem(draft, range);
  const errorId = `${id}-error`;
  const take = (text: string) => {
    const v = parseDecimal(text);
    if (!numberProblem(text, range) && v !== value) onCommit(v);
  };
  return (
    <>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn('font-mono', className)}
        value={draft ?? (empty ? '' : fmtDecimal(value, digits))}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={problem ? true : undefined}
        aria-describedby={[problem && errorId, describedBy].filter(Boolean).join(' ') || undefined}
        onChange={e => {
          setDraft(e.target.value);
          if (commit === 'change') take(e.target.value);
        }}
        onBlur={() => {
          if (draft === null) return;
          if (commit === 'blur') take(draft);
          // A valid value is shown formatted again; an invalid one stays, with its error.
          if (!numberProblem(draft, range)) setDraft(null);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
      {problem && (
        <p id={errorId} className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </>
  );
}
