import { Label } from './label';
import { NumberInput, NumberInputProps } from './NumberInput';

interface InputWithLabelProps {
  label: string;
}

export function NumberInputWithLabel({ label, ...props }: InputWithLabelProps & Omit<NumberInputProps, 'label'>) {
  return (
    <div className="grid w-full items-center gap-1.5">
      <Label htmlFor={label}>{label}</Label>
      <NumberInput {...props} id={label} />
    </div>
  );
}
