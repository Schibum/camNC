import type { FlipRegistration } from '@wbcnc/cam';
import { Button } from '@wbcnc/ui/components/button';
import { Label } from '@wbcnc/ui/components/label';
import { Input } from '@wbcnc/ui/components/input';
import { useEffect, useState } from 'react';
import { cn } from '@wbcnc/ui/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { boardLabel, fixtureCount, kRetentionLabels, type BoardNest, type BoardV1, type Retention, type StockBoardV1 } from '../boards';
import { Hint } from '../Hint';
import { NumberField } from './NumberField';

const fmt = (v: number) => `${+v.toFixed(1)}`;

const kRetentionNotes: Record<Retention, string> = {
  tabs: 'Small bridges hold each part. A part where tabs can’t hold turns red and blocks the job until you move it or switch to bottom skin.',
  skin: 'Every outline stops a thin skin above the board’s bottom. At the machine, a last program cuts the parts free. On tape, it cuts them all together.',
  none: 'Each part is free once its outline is cut through. Fine for big, heavy parts; small ones can be thrown.',
};

const kFlipLabels: Record<FlipRegistration | 'off', string> = {
  off: 'No second side',
  camera: 'Turn over, re-align with the camera',
  dowels: 'Turn over onto dowel pins',
  fence: 'Turn over against a fence and stop',
};

const kFlipHints: Record<FlipRegistration | 'off', string> = {
  off: 'Features on the parts’ undersides are not cut.',
  camera:
    'After side A, turn the board over top to bottom and drag its outline onto it in the camera view again, as for side A. Good for most jobs.',
  dowels:
    'Side A drills pin holes through the board into the spoilboard. Turn the board over onto the pins: side B lines up exactly. Best for precise two-sided parts.',
  fence:
    'Push the board against a fence on the left and a stop at the front, for both sides. Side B is mirrored about the board’s height: measure it, and enter it as the board’s size.',
};

/** The board's name: typed over where it stands; a name that can't be stays in the field until it's fixed (or Escape). */
function BoardName({ board, onRename }: { board: BoardV1; onRename: (name: string) => boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [board.id]);
  const take = () => {
    if (draft === null) return;
    const name = draft.trim();
    if (name === board.name || name === boardLabel(board) || onRename(name)) setDraft(null);
  };
  return (
    <Input
      id="board-name"
      aria-label="Board name"
      autoComplete="off"
      className="h-7 min-w-0 flex-1 rounded-none border-0 border-b border-dashed border-muted-foreground/60 bg-transparent px-0.5 text-[15px] font-semibold shadow-none focus-visible:border-solid focus-visible:border-primary focus-visible:ring-0 dark:bg-transparent"
      value={draft ?? boardLabel(board)}
      onFocus={e => e.target.select()}
      onChange={e => setDraft(e.target.value)}
      onBlur={take}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/**
 * The selected board's settings that have no place on the drawing; what has one (size, material, margin, gap, fixtures, tabs)
 * is edited there. Nothing here changes height with what's chosen and nothing is said in between, so no control moves: what
 * needs attention is said over the drawing.
 */
export function BoardInspector({
  board,
  nest,
  stock,
  onChange,
  onRelayout,
  onDelete,
  flip,
  skin,
  onSkin,
  onRename,
  tools,
  verdict,
  onHoldSizes,
  gap,
}: {
  /** The bottom skin of the job's boards. */
  skin?: number;
  onSkin?: (skin: number) => void;
  /** The board's second side as in effect (see `flipOf`); undefined when no part needs one and none was chosen. */
  flip?: FlipRegistration | 'off';
  board: BoardV1;
  nest: BoardNest;
  stock: StockBoardV1[];
  onChange: (b: BoardV1) => void;
  /** Nest this board's parts afresh, moving only as far as its fixtures need. */
  onRelayout?: () => void;
  onDelete?: () => void;
  /** A new name for it; false: it can't have that one (and has been told why). */
  onRename?: (name: string) => boolean;
  /** The buttons that place fixtures. */
  tools?: React.ReactNode;
  /** What holds the board, in a word, and what that means. */
  verdict?: { tone: 'ok' | 'warn' | 'none'; text: string };
  /** The clamps' and screws' sizes. */
  onHoldSizes?: () => void;
  /** The gap between parts, with no two parts on the drawing to show it between: at least this, mm. */
  gap?: { min: number };
}) {
  const matching = stock.filter(s => +s.thickness.toFixed(1) === board.thickness);
  const sizeValue = board.size.fit
    ? 'fit'
    : (matching.find(s => !board.size.fit && s.w === board.size.w && s.h === board.size.h)?.id ?? 'custom');
  const tabs = board.retention === 'tabs';
  const taped = !!board.taped;
  const held = fixtureCount(board.fixtures);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        {onRename ? (
          <BoardName board={board} onRename={onRename} />
        ) : (
          <h2 className="grow text-[15px] font-semibold">{boardLabel(board)}</h2>
        )}
        {onRelayout && board.items.length > 0 && (
          <Hint text="Back to the tight nest, moved only as far as the fixtures need. On “Fit to parts” the board gets as small as it can. Parts you placed by hand may move.">
            <Button size="sm" variant="outline" onClick={onRelayout}>
              Tighten layout
            </Button>
          </Hint>
        )}
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[13px] font-semibold">Board held by</legend>
        <Hint text={verdict?.text ?? 'Place them on the drawing. None is fine.'} id="board-verdict-hint" side="left">
          <p
            className="flex items-center gap-2 self-start font-mono text-xs text-muted-foreground"
            data-fixture-count
            aria-describedby="board-verdict-hint">
            {verdict && (
              <span
                aria-hidden
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  verdict.tone === 'ok' ? 'bg-emerald-500' : verdict.tone === 'warn' ? 'bg-amber-500' : 'bg-muted-foreground'
                )}
              />
            )}
            {held ? (taped ? `${held} and tape` : held) : taped ? 'Tape' : 'No fixtures yet'}
          </p>
        </Hint>
        {tools}
        <Hint
          text="Double-sided tape under the board: it stays put without fixtures. Use both if you like."
          id="board-tape-hint"
          side="left">
          <label className="flex items-center gap-2 self-start text-[13px]">
            <input
              type="checkbox"
              checked={taped}
              onChange={e => onChange({ ...board, taped: e.target.checked })}
              aria-describedby="board-tape-hint"
              className="accent-primary"
            />
            Tape under the board
          </label>
        </Hint>
        {onHoldSizes && (
          <Button size="sm" variant="outline" onClick={onHoldSizes}>
            Clamp and screw sizes…
          </Button>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[13px] font-semibold">Parts stay in place with</legend>
        {(Object.keys(kRetentionLabels) as Retention[]).map(r => (
          <label key={r} className="flex items-center gap-2 self-start text-[13px]">
            <input
              type="radio"
              name="retention"
              checked={board.retention === r}
              onChange={() => onChange({ ...board, retention: r })}
              aria-describedby="retention-note"
              className="accent-primary"
            />
            {kRetentionLabels[r]}
          </label>
        ))}
        <Hint text="A guided program stops at each tab at the machine so you can cut it off cleanly." id="guided-tabs-hint" side="left">
          <label className="mt-1 flex items-center gap-2 self-start text-[13px] has-disabled:opacity-50">
            <input
              type="checkbox"
              checked={tabs && !!board.guidedTabs}
              disabled={!tabs}
              onChange={e => onChange({ ...board, guidedTabs: e.target.checked })}
              aria-describedby="guided-tabs-hint"
              className="accent-primary"
            />
            Stop at each tab at the machine
          </label>
        </Hint>
        {/* Room for the longest note, so what's below stays where it is. */}
        <p id="retention-note" className="min-h-[60px] text-xs leading-relaxed text-muted-foreground">
          {kRetentionNotes[board.retention]}
        </p>
      </fieldset>

      <div className="flex flex-col gap-1">
        <Label htmlFor="board-size" className="text-xs font-normal text-muted-foreground">
          Board size
        </Label>
        <Select
          value={sizeValue}
          onValueChange={v => {
            if (v === 'fit') onChange({ ...board, size: { fit: true } });
            else if (v === 'custom') onChange({ ...board, size: { fit: false, w: nest.board.w, h: nest.board.h } });
            const s = matching.find(x => x.id === v);
            if (s) onChange({ ...board, size: { fit: false, w: s.w, h: s.h } });
          }}>
          <SelectTrigger id="board-size" className="h-8 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fit">Fit to parts (grows if needed)</SelectItem>
            <SelectItem value="custom">Fixed at this size</SelectItem>
            {matching.map(s => (
              <SelectItem key={s.id} value={s.id}>
                Stock {fmt(s.w)} × {fmt(s.h)}
                {s.quantity !== undefined && ` (${s.quantity} pcs)`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">Tabs and skin</summary>
        <div className="mt-2 flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            <NumberField
              id="tab-w"
              label="Tab W"
              side="left"
              hint="Tab width along the edge. Wider holds the part better but leaves more to cut off."
              value={board.tabs.width}
              onCommit={width => onChange({ ...board, tabs: { ...board.tabs, width } })}
              min={1}
            />
            <NumberField
              id="tab-h"
              label="Tab H"
              side="left"
              hint="Tab height above the bottom of the board. Taller holds the part better but leaves more to cut off."
              value={board.tabs.height}
              onCommit={height => onChange({ ...board, tabs: { ...board.tabs, height } })}
              min={0.5}
            />
            <NumberField
              id="tab-n"
              label="Min #"
              side="left"
              hint="Fewest tabs on each part; long outlines get more. More tabs hold small parts steadier."
              value={board.tabs.minCount}
              onCommit={minCount => onChange({ ...board, tabs: { ...board.tabs, minCount } })}
              min={1}
              integer
            />
          </div>
          {onSkin && (
            <NumberField
              id="skin"
              label="Bottom skin"
              side="left"
              hint="How much of the board's bottom stays under the parts until they're cut free. 1 mm holds well in hardwood."
              value={skin ?? 1}
              onCommit={onSkin}
              min={0.2}
            />
          )}
          {gap && (
            <NumberField
              id="board-gap"
              label="Gap between parts"
              side="left"
              hint="Space between parts, so neighbouring outline cuts never meet. At least the bit; with tabs, room for a strip of stock that holds them."
              value={nest.gap}
              onCommit={g => onChange({ ...board, gap: g })}
              min={gap.min}
            />
          )}
          <p className="text-xs text-muted-foreground">
            Drag a tab along its part’s outline to move it, double-click a part’s edge to add one, double-click a tab to remove it.
          </p>
          {Object.keys(board.tabsAt ?? {}).some(id => board.items.includes(id)) && (
            <Button size="sm" variant="outline" className="self-start" onClick={() => onChange({ ...board, tabsAt: undefined })}>
              Place tabs automatically again
            </Button>
          )}
        </div>
      </details>

      {flip && (
        <section className="flex flex-col gap-1.5" aria-label="Second side">
          <Label htmlFor="board-flip" className="text-[13px] font-semibold">
            Second side (parts’ undersides)
          </Label>
          <Select value={flip} onValueChange={v => onChange({ ...board, flip: v as FlipRegistration | 'off' })}>
            <SelectTrigger id="board-flip" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(kFlipLabels) as (FlipRegistration | 'off')[]).map(f => (
                <SelectItem key={f} value={f}>
                  {kFlipLabels[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs leading-relaxed text-muted-foreground">{kFlipHints[flip]}</p>
          {flip === 'dowels' && (
            <NumberField
              id="dowel-d"
              label="Dowel pin ⌀ (mm)"
              hint="The pins you have. The holes are cut to this size with the job’s bit."
              value={board.dowelDiameter ?? 6}
              onCommit={dowelDiameter => onChange({ ...board, dowelDiameter })}
              min={3}
            />
          )}
          {flip !== 'off' && !tabs && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Turning the board over needs its parts still in it: choose Tabs above, or the cut-out parts fall out.
            </p>
          )}
        </section>
      )}

      <span className="grow" />
      {onDelete && (
        <Button variant="outline" size="sm" onClick={onDelete}>
          Delete empty board
        </Button>
      )}
    </div>
  );
}
