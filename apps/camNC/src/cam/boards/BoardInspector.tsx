import { HoldDiagram } from './HoldDiagram';
import type { FlipRegistration, TabFallback } from '@wbcnc/cam';
import { MATERIALS } from '@wbcnc/cam/settings';
import { Button } from '@wbcnc/ui/components/button';
import { Label } from '@wbcnc/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { kClampWidth, kColletClearance, kHoldDefaults, kHoldHeights, type HoldKind } from '@wbcnc/cam/holdPoints';
import {
  boardGap,
  boardHoldOf,
  defaultMargin,
  holdsOf,
  kBoardHoldLabels,
  kHoldDownLabels,
  kStockAllowance,
  partsHoldOf,
  stockTopOf,
  type BoardHold,
  type BoardNest,
  type BoardV1,
  type StockBoardV1,
} from '../boards';
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

const kBoardHoldHints: Record<BoardHold, string> = {
  points:
    'Screw the board to the spoilboard, or clamp it, at the spots shown on the board (suggested clear of every cut; drag one to move it). Each piece of the board that stays after the cuts needs 3 around it, so it can’t turn or lift.',
  tape: 'The board sits in a fixture or on double-sided tape. Every outline stops a thin bottom skin above the bottom; the last program cuts the skin for all parts together, smallest first, once everything else is done.',
};

const kHoldDownHints: Record<keyof typeof kHoldDownLabels, string> = {
  tabs: 'Small bridges hold each part in the board; cut them with a knife or chisel afterwards.',
  'tabs-guided': 'Tabs, and at the machine a follow-up step stops at each tab so you can cut it off cleanly.',
  skin: 'No tabs: every outline stops a thin skin above the board’s bottom, so all parts stay in the board while it’s cut. At the machine, a last step cuts them free one at a time and pauses so you can take each one out. Clean edges, no tabs to cut off.',
  none: 'No tabs and no skin: each part is free once its outline is cut through. Fine for big, heavy parts; small ones can be thrown. The job says when each comes loose.',
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

/** Size, material and hold-down of the selected board. */
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
  tabHold,
  onTabHold,
  onHoldDownAll,
}: {
  /** Use this board's hold-down on every board of the job; undefined when they all have it already. */
  onHoldDownAll?: () => void;
  /** The job's default for parts whose tabs can't hold, and the bottom skin. */
  tabHold?: { fallback?: TabFallback; skin?: number };
  onTabHold?: (h: { fallback?: TabFallback; skin?: number }) => void;
  /** The board's second side as in effect (see `flipOf`); undefined when no part needs one and none was chosen. */
  flip?: FlipRegistration | 'off';
  board: BoardV1;
  nest: BoardNest;
  stock: StockBoardV1[];
  bit: number;
  /** The job's bit's stick-out changed, mm. */
  onStickout?: (stickout: number) => void;
  onChange: (b: BoardV1) => void;
  /** Nest this board's parts afresh: unpins them and forgets where they were put by hand. */
  onRelayout?: () => void;
  onDelete?: () => void;
}) {
  const matching = stock.filter(s => +s.thickness.toFixed(1) === board.thickness);
  const sizeValue = board.size.fit
    ? 'fit'
    : (matching.find(s => !board.size.fit && s.w === board.size.w && s.h === board.size.h)?.id ?? 'custom');
  const parts = partsHoldOf(board);
  const held = boardHoldOf(board);
  const hold = holdsOf(board, nest.stickout);
  const tabs = parts === 'tabs' || parts === 'tabs-guided';
  // Tabs hold only on a strip of stock left between the cuts: spacing set for another hold-down (or bit) may leave none.
  const tabGap = boardGap(bit, 'tabs'),
    tabMargin = defaultMargin(bit, 'tabs');
  const tightForTabs = tabs && (nest.gap < tabGap || nest.margin < tabMargin);
  // A fitted board with nothing on it has no size yet (only its margins): "–", and a size typed in sets both sides.
  const emptyFit = board.size.fit && !nest.placements.length;
  return (
    <aside className="flex min-h-0 flex-col gap-3.5 overflow-y-auto border-l p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold">Board {board.name}</h2>
        <span className="grow" />
        {onRelayout && board.items.length > 0 && (
          <Hint
            text={
              board.pinned?.length
                ? 'Nests this board’s parts afresh. Parts you placed by hand are unpinned and may move.'
                : 'Nests this board’s parts afresh.'
            }>
            <Button size="sm" variant="outline" onClick={onRelayout}>
              Re-lay out
            </Button>
          </Hint>
        )}
      </div>
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
        <div className="col-span-2 flex flex-col gap-1">
          <Label htmlFor="board-size" className="text-xs font-normal text-muted-foreground">
            Size
          </Label>
          <Select
            value={sizeValue}
            onValueChange={v => {
              if (v === 'fit') onChange({ ...board, size: { fit: true } });
              const s = matching.find(x => x.id === v);
              if (s) onChange({ ...board, size: { fit: false, w: s.w, h: s.h } });
            }}>
            <SelectTrigger id="board-size" className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fit">Fit to parts</SelectItem>
              {sizeValue === 'custom' && <SelectItem value="custom">Custom</SelectItem>}
              {matching.map(s => (
                <SelectItem key={s.id} value={s.id}>
                  Stock {fmt(s.w)} × {fmt(s.h)}
                  {s.quantity !== undefined && ` (${s.quantity} pcs)`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          id="board-margin"
          label="Edge margin"
          hint="Free border inside the board edge, so the outline cut and its lead-in stay on the board: about the bit plus 2 mm."
          value={nest.margin}
          onCommit={margin => onChange({ ...board, margin })}
        />
        <NumberField
          id="board-gap"
          label="Gap between parts"
          hint="Space between parts, so neighbouring outline cuts never meet. At least the bit; the bit plus a few mm is safe."
          value={nest.gap}
          onCommit={gap => onChange({ ...board, gap })}
          min={bit}
        />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {tabs
          ? `Defaults with tabs: margin ${fmt(tabMargin)} mm, gap ${fmt(tabGap)} mm, so a strip of stock that holds the tabs stays between the cuts (bit ⌀ ${fmt(bit)}).`
          : `Defaults: margin bit + 2 mm, gap bit + 4 mm (bit ⌀ ${fmt(bit)}).`}
        {nest.frame === 'kept' &&
          ` With these ${hold.kind === 'clamp' ? 'clamps' : 'screws'}, the margin is at least ${fmt(nest.margin)} mm: a frame of stock for them (see the drawing below). Untick “Keep a frame for them” to use your own margin.`}
      </p>
      {tightForTabs && (
        <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs leading-relaxed">
          <p>
            Too tight for tabs: after the cuts, the stock left {nest.gap < tabGap ? 'between parts' : 'at the edge'} is too thin to hold
            them, so parts there get their fallback. Tabs need margin {fmt(tabMargin)} mm and gap {fmt(tabGap)} mm.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => onChange({ ...board, margin: Math.max(nest.margin, tabMargin), gap: Math.max(nest.gap, tabGap) })}>
            Widen for tabs
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Parts</span>
          <span className="flex h-8 items-center font-mono text-sm">{fmt(board.thickness)} mm</span>
        </div>
        <NumberField
          id="board-thickness"
          label="Stock thickness"
          hint="Measure the board with a caliper: cutting starts at this height. Too high cuts air at first, too low makes the first pass deeper."
          value={stockTopOf(board)}
          onCommit={t => onChange({ ...board, measuredThickness: t })}
          min={board.thickness}
        />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {board.measuredThickness === undefined
          ? `Parts + ${kStockAllowance} mm allowance; enter the measured thickness if you have it.`
          : 'Measured. Z0 is the bottom of the board.'}
      </p>

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

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[13px] font-semibold">Board held by</legend>
        {(Object.keys(kBoardHoldLabels) as BoardHold[]).map(h => (
          <Hint key={h} text={kBoardHoldHints[h]} id={`board-hold-${h}-hint`} side="left">
            <label className="flex items-center gap-2 self-start text-[13px]">
              <input
                type="radio"
                name="board-hold"
                checked={held === h}
                onChange={() =>
                  onChange(
                    h === 'tape'
                      ? { ...board, boardHold: 'tape', holdDown: 'fixture-tape' }
                      : { ...board, boardHold: 'points', holdDown: parts === 'fixture-tape' ? 'tabs' : parts }
                  )
                }
                aria-describedby={`board-hold-${h}-hint`}
                className="accent-primary"
              />
              {kBoardHoldLabels[h]}
            </label>
          </Hint>
        ))}
        <p className="text-xs leading-relaxed text-muted-foreground">{kBoardHoldHints[held]}</p>
        {held === 'points' && (
          <>
            <div className="grid grid-cols-3 items-end gap-2">
              <div className="col-span-3 flex flex-col gap-1">
                <Label htmlFor="hold-kind" className="text-xs font-normal text-muted-foreground">
                  With
                </Label>
                <Select
                  value={hold.kind}
                  onValueChange={v =>
                    // Each kind starts at its own size: a screw head's ⌀ and a clamp's reach are not alike.
                    onChange({
                      ...board,
                      holds: {
                        kind: v as HoldKind,
                        d: kHoldDefaults[v as HoldKind],
                        height: kHoldHeights[v as HoldKind],
                        spacing: hold.spacing,
                        stickout: hold.stickout,
                        ...(v === 'clamp' && { w: kClampWidth }),
                      },
                    })
                  }>
                  <SelectTrigger id="hold-kind" className="h-8 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="screw">Screws</SelectItem>
                    <SelectItem value="clamp">Clamps</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {hold.kind === 'clamp' ? (
                <>
                  <NumberField
                    id="hold-d"
                    side="left"
                    label="Reach in"
                    hint="How far the clamp’s toe reaches onto the board from its edge. The frame is this wide plus the bit’s cut, and room for the collet nut beside a tall clamp; the bit keeps clear of the toe."
                    value={hold.d}
                    onCommit={d => onChange({ ...board, holds: { ...hold, d } })}
                    min={0.5}
                  />
                  <NumberField
                    id="hold-w"
                    side="left"
                    label="Width"
                    hint="The clamp’s toe along the edge."
                    value={hold.w ?? kClampWidth}
                    onCommit={w => onChange({ ...board, holds: { ...hold, w } })}
                    min={2}
                  />
                </>
              ) : (
                <NumberField
                  id="hold-d"
                  side="left"
                  label="Size ⌀"
                  hint="The screw head. The bit keeps clear of it."
                  value={hold.d}
                  onCommit={d => onChange({ ...board, holds: { ...hold, d } })}
                  min={2}
                />
              )}
              <NumberField
                id="hold-height"
                side="left"
                label="Height"
                hint={`How far it stands above the board's top, mm. Every rapid and link passes above the tallest hold, so measure it: too low and the bit or the collet hits it. Where it stands higher than the collet nut gets down to (see Stick-out), cuts also keep ${kColletClearance} mm from it for the nut.`}
                value={hold.height}
                onCommit={height => onChange({ ...board, holds: { ...hold, height } })}
                min={0}
              />
              <NumberField
                id="hold-spacing"
                side="left"
                label="Spacing"
                hint="Greatest distance between holds along an edge. Closer holds keep a bowed board flatter."
                value={hold.spacing}
                onCommit={spacing => onChange({ ...board, holds: { ...hold, spacing } })}
                min={50}
              />
              <NumberField
                id="hold-stickout"
                side="left"
                label="Stick-out"
                hint="How far the job's bit sticks out below the collet nut, mm: measure it once the bit is in. It's kept with the bit (for every board of the job, and the next job with this bit). With the deepest cut it says how low the nut gets, so whether it can hit a hold."
                value={hold.stickout}
                onCommit={v => onStickout?.(v)}
                min={1}
              />
            </div>
            <HoldDiagram hold={hold} bit={bit} stockTop={stockTopOf(board)} nutAbove={nest.nutAbove} leftOut={nest.frame === 'no-room'} />
            <Hint
              text="A border of stock around all parts, wide enough for the holds: the board can never fall apart into pieces, and every tab lands in held stock. Left out on a fixed size board when the parts don't fit with it."
              id="hold-frame-hint"
              side="left">
              <label className="flex items-center gap-2 self-start text-[13px]">
                <input
                  type="checkbox"
                  checked={board.frame !== false}
                  onChange={e => onChange({ ...board, frame: e.target.checked })}
                  aria-describedby="hold-frame-hint"
                  className="accent-primary"
                />
                Keep a frame for them
              </label>
            </Hint>
            {nest.frame === 'no-room' && (
              <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                No room for a frame on this board: the parts don’t all fit with it. The holds go where there’s room; the Plan step checks
                that every piece stays held.
              </p>
            )}
            {nest.holdsMoved && (
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => onChange({ ...board, holdPoints: undefined, holdPointsOn: undefined })}>
                Back to suggested spots
              </Button>
            )}
          </>
        )}
        {held === 'tape' && tabHold && onTabHold && (
          <NumberField
            id="tape-layer"
            label="Bottom skin (mm)"
            hint="How much of the board’s bottom stays under the parts until the last program cuts it. Thin is enough: the tape holds."
            value={tabHold.skin ?? 0.5}
            onCommit={skin => onTabHold({ ...tabHold, skin })}
            min={0.2}
          />
        )}
      </fieldset>

      {held === 'points' && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-semibold">Parts held by</legend>
          {(Object.keys(kHoldDownLabels) as (keyof typeof kHoldDownLabels)[]).map(h => (
            <Hint key={h} text={kHoldDownHints[h]} id={`hold-down-${h}-hint`} side="left">
              <label className="flex items-center gap-2 self-start text-[13px]">
                <input
                  type="radio"
                  name="hold-down"
                  checked={parts === h}
                  onChange={() => onChange({ ...board, boardHold: 'points', holdDown: h })}
                  aria-describedby={`hold-down-${h}-hint`}
                  className="accent-primary"
                />
                {kHoldDownLabels[h]}
              </label>
            </Hint>
          ))}
          <p className="text-xs leading-relaxed text-muted-foreground">{kHoldDownHints[parts as keyof typeof kHoldDownLabels]}</p>
        </fieldset>
      )}
      {onHoldDownAll && (
        <Button size="sm" variant="outline" className="self-start" onClick={onHoldDownAll}>
          Use for all boards
        </Button>
      )}

      {parts === 'skin' && tabHold && onTabHold && (
        <NumberField
          id="skin"
          label="Bottom skin (mm)"
          hint="How much of the board's bottom stays under the parts until they're cut free at the machine. 1 mm holds well in hardwood; thinner breaks out easier but may let go."
          value={tabHold.skin ?? 1}
          onCommit={skin => onTabHold({ ...tabHold, skin })}
          min={0.3}
        />
      )}

      {tabs && tabHold && onTabHold && (
        <section className="flex flex-col gap-1.5" aria-label="Where tabs can't hold">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Tabs go only on straight edges facing stock that holds them. A part with no such edge (for the whole job; each part can choose
            its own in its ⋯ menu):
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)_72px] items-end gap-2">
            <Select
              value={tabHold.fallback ?? 'ask'}
              onValueChange={v => onTabHold({ ...tabHold, fallback: v === 'ask' ? undefined : (v as TabFallback) })}>
              <SelectTrigger aria-label="A part whose tabs can't hold" className="w-full min-w-0 [&>span]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ask">Blocks the job until I choose</SelectItem>
                <SelectItem value="skin">Gets a bottom skin (freed at the machine)</SelectItem>
                <SelectItem value="tabs">Gets tabs anyway (may not hold)</SelectItem>
                <SelectItem value="self">Gets no tabs: I hold it down</SelectItem>
              </SelectContent>
            </Select>
            {tabHold.fallback === 'skin' && (
              <NumberField
                id="skin"
                label="Bottom skin (mm)"
                hint="How much of the board's bottom stays under such a part until it's freed at the machine."
                value={tabHold.skin ?? 1}
                onCommit={skin => onTabHold({ ...tabHold, skin })}
                min={0.3}
              />
            )}
          </div>
        </section>
      )}

      {tabs && (
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            id="tab-w"
            label="Tab W"
            hint="Tab width along the edge. Wider holds the part better but leaves more to cut off."
            value={board.tabs.width}
            onCommit={width => onChange({ ...board, tabs: { ...board.tabs, width } })}
            min={1}
          />
          <NumberField
            id="tab-h"
            label="Tab H"
            hint="Tab height above the bottom of the board. Taller holds the part better but leaves more to cut off."
            value={board.tabs.height}
            onCommit={height => onChange({ ...board, tabs: { ...board.tabs, height } })}
            min={0.5}
          />
          <NumberField
            id="tab-n"
            label="Min #"
            hint="Fewest tabs on each part; long outlines get more. More tabs hold small parts steadier."
            value={board.tabs.minCount}
            onCommit={minCount => onChange({ ...board, tabs: { ...board.tabs, minCount } })}
            min={1}
            integer
          />
        </div>
      )}
      {tabs && (
        <p className="text-xs text-muted-foreground">
          Tabs sit on straight edges where the stock beyond them holds. Drag one along its part’s outline in the board view to move it,
          double-click a part’s edge to add one, double-click a tab to remove it. A red ring says the stock there doesn’t hold it.
        </p>
      )}
      {tabs && Object.keys(board.tabsAt ?? {}).some(id => board.items.includes(id)) && (
        <Button size="sm" variant="outline" className="self-start" onClick={() => onChange({ ...board, tabsAt: undefined })}>
          Place tabs automatically again
        </Button>
      )}

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
              Turning the board over needs its parts still in it: choose Tabs under Parts held by, or the cut-out parts fall out.
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
