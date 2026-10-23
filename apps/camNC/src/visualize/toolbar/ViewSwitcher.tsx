import { Button } from '@heroui/react';
import { Kbd } from '@wbcnc/ui/components/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@wbcnc/ui/components/tooltip';
import { cn } from '@wbcnc/ui/lib/utils';
import { useHotkeys } from 'react-hotkeys-hook';
import { kViews, ViewMode, kViewModes } from '../viewModes';

function ViewButton({
  view,
  active,
  disabled,
  onSelect,
}: {
  view: ViewMode;
  active: boolean;
  disabled: boolean;
  onSelect: (view: ViewMode) => void;
}) {
  const { label, name, shortcut } = kViews[view];
  useHotkeys(shortcut, () => onSelect(view), { enabled: !disabled, preventDefault: true });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Disabled buttons don't receive pointer events, the wrapper keeps the tooltip working. */}
        <span className="inline-flex">
          <Button
            size="sm"
            variant="light"
            aria-label={name}
            aria-pressed={active}
            isDisabled={disabled}
            onPress={() => onSelect(view)}
            className={cn('h-7 min-w-0 rounded-md px-2.5 text-xs', active && 'bg-white font-semibold shadow-sm')}>
            {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex items-center gap-2">
          {disabled ? `${name}: open a gcode file first` : name} <Kbd shortcut={shortcut} />
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/** Segmented control switching between the camera top view and the 3D depth views of the same canvas. */
export function ViewSwitcher({
  view,
  hasToolpath,
  onSelect,
}: {
  view: ViewMode;
  hasToolpath: boolean;
  onSelect: (view: ViewMode) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-black/5 p-0.5" role="group" aria-label="View">
      {kViewModes.map(v => (
        <ViewButton key={v} view={v} active={view === v} disabled={v !== 'top' && !hasToolpath} onSelect={onSelect} />
      ))}
    </div>
  );
}
