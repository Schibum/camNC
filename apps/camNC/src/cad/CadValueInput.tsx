import { useState, type ComponentPropsWithoutRef, type Ref } from 'react';
import { cadValueHasUnit } from './valueExpressions';

type Props = ComponentPropsWithoutRef<'input'> & {
  inputRef?: Ref<HTMLInputElement>;
  unit?: 'mm' | 'deg';
  unitClassName?: string;
};

export function CadUnitSuffix({ text, unit = 'mm', className }: { text: string; unit?: 'mm' | 'deg'; className?: string }) {
  return cadValueHasUnit(text) ? null : (
    <span aria-hidden="true" className={className}>
      {unit === 'deg' ? '°' : 'mm'}
    </span>
  );
}

/** Keep native input/ref behavior; an uncontrolled draft only updates its adjacent unit hint. */
export function CadValueInput({ inputRef, unit = 'mm', unitClassName, value, defaultValue, onChange, ...props }: Props) {
  const [draft, setDraft] = useState(() => String(defaultValue ?? ''));
  return (
    <>
      <input
        {...props}
        ref={inputRef}
        value={value}
        defaultValue={defaultValue}
        onChange={event => {
          setDraft(event.currentTarget.value);
          onChange?.(event);
        }}
      />
      <CadUnitSuffix text={value === undefined ? draft : String(value)} unit={unit} className={unitClassName} />
    </>
  );
}
