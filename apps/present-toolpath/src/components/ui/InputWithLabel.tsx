import { Label } from '@radix-ui/react-label';
import { Input } from './input';
import { InputHTMLAttributes } from 'react';

interface InputWithLabelProps {
  label: string;
  value: number;
  onChange?: (value: number) => void;
}

export function InputWithLabel({
  label,
  value,
  onChange,
  ...props
}: InputWithLabelProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'>) {
  return (
    <div className="grid w-full items-center gap-1.5">
      <Label htmlFor={label}>{label}</Label>
      <Input {...props} type="number" id={label} value={value} onChange={e => onChange?.(Number(e.target.value))} />
    </div>
  );
}
