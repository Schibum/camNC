import { CheckIcon, ClipboardIcon } from 'lucide-react';
import * as React from 'react';

import { Button, ButtonProps } from '@wbcnc/ui/components/button';

export async function copyToClipboardWithMeta(value: string) {
  navigator.clipboard.writeText(value);
}

interface CopyButtonProps extends ButtonProps {
  value: string;
}
export function CopyButton({ value, variant = 'ghost', ...props }: CopyButtonProps) {
  const [hasCopied, setHasCopied] = React.useState(false);

  React.useEffect(() => {
    setTimeout(() => {
      setHasCopied(false);
    }, 2000);
  }, [hasCopied]);

  return (
    <Button
      size="icon"
      variant={variant}
      onClick={() => {
        copyToClipboardWithMeta(value);
        setHasCopied(true);
      }}
      {...props}>
      <span className="sr-only">Copy</span>
      {hasCopied ? <CheckIcon /> : <ClipboardIcon />}
    </Button>
  );
}
