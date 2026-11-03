import { cn } from '@wbcnc/ui/lib/utils';
import type { CamPartInfo } from '../camTypes';

/**
 * A part's name, edited in place (the inspector and the part list): Enter or leaving the field keeps it, Escape
 * doesn't. `onRename` gets the trimmed new name, only when it changed; empty goes back to the model's name.
 */
export function PartNameInput({
  part,
  label = 'Part name',
  onRename,
  onDone,
  className,
}: {
  part: CamPartInfo;
  label?: string;
  onRename: (name: string) => void;
  /** Editing ended, kept or not. */
  onDone: () => void;
  className?: string;
}) {
  const commit = (value: string) => {
    onDone();
    if (value.trim() !== part.name) onRename(value.trim());
  };
  return (
    <input
      autoFocus
      aria-label={label}
      defaultValue={part.name}
      placeholder={part.modelName}
      onFocus={e => e.currentTarget.select()}
      onBlur={e => commit(e.currentTarget.value)}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          // Not a commit: forget the edit before the blur that unmounting causes.
          e.currentTarget.value = part.name;
          onDone();
        }
      }}
      className={cn(
        'h-8 min-w-0 rounded-md border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
    />
  );
}
