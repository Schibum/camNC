import { cn } from '@/lib/utils';
import { Button } from '@heroui/button';
import { allowCmdOnMac, Kbd } from '@wbcnc/ui/components/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@wbcnc/ui/components/tooltip';
import { useHotkeys } from 'react-hotkeys-hook';

export function TooltipIconButton({
  label,
  icon,
  shortcut,
  onClick,
  ...props
}: {
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  onClick: () => void;
} & React.ComponentProps<typeof Button>) {
  shortcut = allowCmdOnMac(shortcut ?? '');
  useHotkeys(shortcut, onClick, { preventDefault: true });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          {...(props as any)}
          onPress={onClick}
          aria-label={label}
          variant="light"
          size="sm"
          className={cn('min-w-8 h-10 [&_svg:not([class*=size-])]:size-4', props.className)}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex items-center gap-2">
          {label} <Kbd shortcut={shortcut} />
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
