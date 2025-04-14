import { Input } from "./input";
import { Label } from "./label";

interface InputWithLabelProps {
  label: string;
}

export function InputWithLabel({
  label,
  ...props
}: InputWithLabelProps & Omit<React.ComponentProps<"input">, "label">) {
  return (
    <div className="grid w-full items-center gap-1.5">
      <Label htmlFor={label}>{label}</Label>
      <Input {...props} id={label} />
    </div>
  );
}
