import { Label } from '@radix-ui/react-label';
import { Input } from './input';

export function InputWithLabel({ label, value, onChange }: { label: string; value: number; onChange?: (value: number) => void }) {
  return (
    <div className="grid w-full items-center gap-1.5">
      <Label htmlFor={label}>{label}</Label>
      <Input type="number" id={label} value={value} onChange={e => onChange?.(Number(e.target.value))} />
    </div>
  );
}
