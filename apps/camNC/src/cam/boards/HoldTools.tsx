import { Button } from '@wbcnc/ui/components/button';
import { cn } from '@wbcnc/ui/lib/utils';
import { Hint } from '../Hint';
import type { HoldEditing } from './useHoldEditing';

/**
 * Placing holds on the selected board: the tools, Suggest holds, one clamp fewer or more, and Undo. `row`: one row above
 * the drawing, where the sidebar is out of reach under it on a small screen.
 */
export function HoldTools({ holds, onUndo, row }: { holds: HoldEditing; onUndo?: () => void; row?: boolean }) {
  const { tool, setTool, setEdit, canPlace, holdCount, suggest, nudgeHolds } = holds;
  return (
    <div
      role="toolbar"
      aria-label="Fixtures"
      className={cn(row ? 'flex flex-wrap items-center gap-1.5 px-4 py-2' : 'grid grid-cols-6 gap-1.5')}>
      {(['clamp', 'screw'] as const).map(kind => (
        <Hint
          key={kind}
          text={
            kind === 'clamp'
              ? 'Click near an edge of the board: only the parts in the way move aside. Esc puts it down.'
              : 'Click in the waste: it lands on the most forgiving spot nearby. Esc puts it down.'
          }>
          <Button
            size="sm"
            className={cn(!row && 'col-span-3')}
            variant={tool === kind ? 'default' : 'outline'}
            aria-pressed={tool === kind}
            disabled={!canPlace}
            onClick={() => {
              setTool(tool === kind ? null : kind);
              setEdit(null);
            }}>
            {kind === 'clamp' ? 'Clamp' : 'Screw'}
          </Button>
        </Hint>
      ))}
      <Hint text="Compares whole clamp patterns around the work and adds the best, moving parts only where no spot is clear. Holds already on the board stay. A board fitted to its parts gets a small border if no edge has room. Drag or remove any of them.">
        <Button size="sm" variant="outline" className={cn(!row && 'col-span-6')} disabled={!canPlace} onClick={suggest}>
          Suggest holds
        </Button>
      </Hint>
      <Hint text="Takes one clamp away, the one the rest do best without, and leaves everything else. None goes if that would leave the work not surrounded, and never below 3 holds.">
        <Button
          size="sm"
          variant="outline"
          className={cn(!row && 'col-span-2')}
          disabled={!canPlace || holdCount <= 3}
          onClick={() => nudgeHolds(false)}>
          Fewer
        </Button>
      </Hint>
      <Hint text="Adds one clamp where it helps most and leaves everything else where it is.">
        <Button
          size="sm"
          variant="outline"
          className={cn(!row && 'col-span-2')}
          disabled={!canPlace || !holdCount}
          onClick={() => nudgeHolds(true)}>
          More
        </Button>
      </Hint>
      <Button size="sm" variant="outline" className={cn(!row && 'col-span-2')} disabled={!onUndo} onClick={onUndo}>
        Undo
      </Button>
    </div>
  );
}
