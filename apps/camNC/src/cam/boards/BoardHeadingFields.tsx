import { MATERIALS } from '@wbcnc/cam/settings';
import { cn } from '@wbcnc/ui/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { stockTopOf, type BoardNest, type BoardV1 } from '../boards';
import { Hint } from '../Hint';
import { NumberInput } from '../NumberInput';
import type { MaterialKey } from '../planSettings';

const fmt = (v: number) => `${+v.toFixed(1)}`;
const kInline =
  'h-6 w-14 rounded-none border-0 border-b border-dashed border-muted-foreground/60 bg-transparent px-0.5 text-center text-xs shadow-none focus-visible:border-solid focus-visible:border-primary focus-visible:ring-0 dark:bg-transparent';

/** The board's material, thickness and size where they are read: on the drawing's heading. A size typed in makes the board fixed at it. */
export function BoardHeadingFields({ board, nest, onChange }: { board: BoardV1; nest: BoardNest; onChange: (b: BoardV1) => void }) {
  // A fitted board with nothing on it has no size yet (only its margins): "–", and a size typed in sets both sides.
  const emptyFit = board.size.fit && !nest.placements.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 text-muted-foreground">
      <Select value={board.material} onValueChange={m => onChange({ ...board, material: m as MaterialKey })}>
        <SelectTrigger
          id="board-material"
          aria-label="Material"
          size="sm"
          className="h-6 gap-1 rounded-none border-0 border-b border-dashed border-muted-foreground/60 bg-transparent px-0.5 text-sm shadow-none dark:bg-transparent">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(MATERIALS).map(([k, m]) => (
            <SelectItem key={k} value={k}>
              {m.name[0].toUpperCase() + m.name.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Hint
        text={`Measure the board with a caliper: cutting starts at this height. The parts are ${fmt(board.thickness)} mm. Too high cuts air at first, too low makes the first pass deeper.`}
        id="board-thickness-hint">
        <span className="inline-flex items-center gap-1">
          <NumberInput
            id="board-thickness"
            aria-label="Stock thickness"
            aria-describedby="board-thickness-hint"
            value={stockTopOf(board)}
            digits={1}
            min={board.thickness}
            unit="mm"
            className={kInline}
            onCommit={t => onChange({ ...board, measuredThickness: t })}
          />
          mm ·
        </span>
      </Hint>
      <NumberInput
        id="board-w"
        aria-label="Width"
        value={nest.board.w}
        digits={1}
        min={10}
        unit="mm"
        empty={emptyFit}
        placeholder={emptyFit ? '–' : undefined}
        className={kInline}
        onCommit={w => onChange({ ...board, size: { fit: false, w, h: emptyFit ? w : nest.board.h } })}
      />
      ×
      <NumberInput
        id="board-h"
        aria-label="Height"
        value={nest.board.h}
        digits={1}
        min={10}
        unit="mm"
        empty={emptyFit}
        placeholder={emptyFit ? '–' : undefined}
        className={kInline}
        onCommit={h => onChange({ ...board, size: { fit: false, w: emptyFit ? h : nest.board.w, h } })}
      />
      <Hint
        text={
          board.size.fit
            ? 'The board grows to fit its parts and holds. Off: it stays at this size.'
            : `Fixed at this size: parts and holds that have no room are refused. On: the board grows to fit them.`
        }
        id="board-fit-hint">
        <button
          type="button"
          aria-pressed={board.size.fit}
          aria-label="Grow to fit"
          aria-describedby="board-fit-hint"
          className={cn(
            'ml-1 h-6 rounded border px-1.5 text-xs',
            board.size.fit ? 'border-primary bg-primary/15 text-foreground' : 'border-muted-foreground/40 text-muted-foreground'
          )}
          onClick={() => onChange({ ...board, size: board.size.fit ? { fit: false, w: nest.board.w, h: nest.board.h } : { fit: true } })}>
          Fit
        </button>
      </Hint>
    </span>
  );
}
