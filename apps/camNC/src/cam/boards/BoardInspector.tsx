import type { FlipRegistration } from '@wbcnc/cam';
import { MATERIALS } from '@wbcnc/cam/settings';
import { Button } from '@wbcnc/ui/components/button';
import { Label } from '@wbcnc/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { kColletClearance } from '@wbcnc/cam/holdPoints';
import { fixtureCount, kRetentionLabels, stockTopOf, type BoardNest, type BoardV1, type Retention, type StockBoardV1 } from '../boards';
import { useHoldHardware } from '../holdHardware';
import type { MaterialKey } from '../planSettings';
import { Hint } from '../Hint';
import { NumberInput } from '../NumberInput';

const fmt = (v: number) => `${+v.toFixed(1)}`;

function NumberField({
  id,
  label,
  value,
  onCommit,
  min = 0,
  integer,
  empty,
  hint,
  side,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  integer?: boolean;
  /** Nothing to show yet: the field shows "–". */
  empty?: boolean;
  /** What the value does: tooltip and the input's accessible description. */
  hint?: string;
  /** Where the tooltip opens: beside the field where one above or below would cover what's next to it. */
  side?: 'top' | 'left';
}) {
  const field = (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <NumberInput
        id={id}
        value={value}
        digits={1}
        min={min}
        integer={integer}
        unit={integer ? undefined : 'mm'}
        empty={empty}
        placeholder={empty ? '–' : undefined}
        className="h-8"
        onCommit={onCommit}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
    </div>
  );
  return hint ? (
    <Hint text={hint} id={`${id}-hint`} side={side}>
      {field}
    </Hint>
  ) : (
    field
  );
}

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

/**
 * The selected board's settings. Nothing here changes height with what's chosen and nothing is said in between, so no
 * control moves: fixtures are placed on the drawing, what needs attention is said under it.
 */
export function BoardInspector({
  board,
  nest,
  stock,
  bit,
  onStickout,
  onChange,
  onRelayout,
  onDelete,
  flip,
  skin,
  onSkin,
}: {
  /** The bottom skin of the job's boards. */
  skin?: number;
  onSkin?: (skin: number) => void;
  /** The board's second side as in effect (see `flipOf`); undefined when no part needs one and none was chosen. */
  flip?: FlipRegistration | 'off';
  board: BoardV1;
  nest: BoardNest;
  stock: StockBoardV1[];
  bit: number;
  /** The job's bit's stick-out changed, mm. */
  onStickout?: (stickout: number) => void;
  onChange: (b: BoardV1) => void;
  /** Nest this board's parts afresh, moving only as far as its fixtures need. */
  onRelayout?: () => void;
  onDelete?: () => void;
}) {
  const hardware = useHoldHardware(s => s.hardware);
  const setHardware = useHoldHardware(s => s.setHardware);
  const matching = stock.filter(s => +s.thickness.toFixed(1) === board.thickness);
  const sizeValue = board.size.fit
    ? 'fit'
    : (matching.find(s => !board.size.fit && s.w === board.size.w && s.h === board.size.h)?.id ?? 'custom');
  const tabs = board.retention === 'tabs';
  const taped = !!board.taped;
  // A fitted board with nothing on it has no size yet (only its margins): "–", and a size typed in sets both sides.
  const emptyFit = board.size.fit && !nest.placements.length;
  return (
    <aside className="flex min-h-0 flex-col gap-3.5 overflow-y-auto border-l p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold">Board {board.name}</h2>
        <span className="grow" />
        {onRelayout && board.items.length > 0 && (
          <Hint text="Back to the tight nest, moved only as far as the fixtures need. On “Fit to parts” the board gets as small as it can. Parts you placed by hand may move.">
            <Button size="sm" variant="outline" onClick={onRelayout}>
              Tighten layout
            </Button>
          </Hint>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="board-size" className="text-xs font-normal text-muted-foreground">
          Size
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
      {/* Always there, so what's below stays put; a size typed in makes the board fixed at it. */}
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          id="board-w"
          label="Width"
          value={nest.board.w}
          empty={emptyFit}
          onCommit={w => onChange({ ...board, size: { fit: false, w, h: emptyFit ? w : nest.board.h } })}
          min={10}
        />
        <NumberField
          id="board-h"
          label="Height"
          value={nest.board.h}
          empty={emptyFit}
          onCommit={h => onChange({ ...board, size: { fit: false, w: emptyFit ? h : nest.board.w, h } })}
          min={10}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          id="board-thickness"
          label="Stock thickness"
          hint={`Measure the board with a caliper: cutting starts at this height. The parts are ${fmt(board.thickness)} mm. Too high cuts air at first, too low makes the first pass deeper.`}
          value={stockTopOf(board)}
          onCommit={t => onChange({ ...board, measuredThickness: t })}
          min={board.thickness}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="board-material" className="text-xs font-normal text-muted-foreground">
            Material
          </Label>
          <Select value={board.material} onValueChange={m => onChange({ ...board, material: m as MaterialKey })}>
            <SelectTrigger id="board-material" className="h-8 w-full">
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
        </div>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[13px] font-semibold">Board held by</legend>
        <p className="font-mono text-xs text-muted-foreground" data-fixture-count>
          {fixtureCount(board.fixtures) || 'No fixtures yet'}
        </p>
        <p className="text-xs text-muted-foreground">Place them on the drawing. None is fine.</p>
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

      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">Spacing, tabs and skin</summary>
        <div className="mt-2 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              id="board-margin"
              label="Edge margin"
              side="left"
              hint="Free border inside the board edge, so the outline cut and its lead-in stay on the board: about the bit plus 2 mm, more with tabs."
              value={nest.margin}
              onCommit={margin => onChange({ ...board, margin })}
            />
            <NumberField
              id="board-gap"
              label="Gap between parts"
              side="left"
              hint="Space between parts, so neighbouring outline cuts never meet. At least the bit; with tabs, room for a strip of stock that holds them."
              value={nest.gap}
              onCommit={gap => onChange({ ...board, gap })}
              min={bit}
            />
          </div>
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
              hint={`How much of the board's bottom stays under the parts until they're cut free. 1 mm holds well in hardwood; on tape ${fmt(0.5)} mm is enough.`}
              value={skin ?? (taped ? 0.5 : 1)}
              onCommit={onSkin}
              min={0.2}
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

      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">Clamp and screw sizes (all jobs)</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <NumberField
            id="clamp-reach"
            label="Clamp reach"
            side="left"
            hint="How far the clamp’s toe reaches onto the board from its edge. The bit keeps clear of the toe."
            value={hardware.clamp.d}
            onCommit={d => setHardware({ ...hardware, clamp: { ...hardware.clamp, d } })}
            min={0.5}
          />
          <NumberField
            id="clamp-width"
            label="Clamp width"
            side="left"
            hint="The clamp’s toe along the edge."
            value={hardware.clamp.w}
            onCommit={w => setHardware({ ...hardware, clamp: { ...hardware.clamp, w } })}
            min={2}
          />
          <NumberField
            id="clamp-height"
            label="Clamp height"
            side="left"
            hint={`How far it stands above the board's top. Every rapid passes above the tallest fixture, so measure it. Where it stands higher than the collet nut gets down to, cuts also keep ${kColletClearance} mm from it for the nut.`}
            value={hardware.clamp.height}
            onCommit={height => setHardware({ ...hardware, clamp: { ...hardware.clamp, height } })}
          />
          <NumberField
            id="screw-d"
            label="Screw head ⌀"
            side="left"
            hint="The screw head. The bit keeps clear of it."
            value={hardware.screw.d}
            onCommit={d => setHardware({ ...hardware, screw: { ...hardware.screw, d } })}
            min={2}
          />
          <NumberField
            id="screw-height"
            label="Screw height"
            side="left"
            hint="How far the head stands above the board's top. Every rapid passes above the tallest fixture."
            value={hardware.screw.height}
            onCommit={height => setHardware({ ...hardware, screw: { ...hardware.screw, height } })}
          />
          <NumberField
            id="hold-stickout"
            label="Bit stick-out"
            side="left"
            hint="How far the job's bit sticks out below the collet nut: measure it once the bit is in. It's kept with the bit (for every board of the job, and the next job with this bit). With the deepest cut it says how low the nut gets, so whether it can hit a fixture."
            value={nest.stickout}
            onCommit={v => onStickout?.(v)}
            min={1}
          />
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
    </aside>
  );
}
