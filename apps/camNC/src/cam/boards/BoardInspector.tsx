import type { FlipRegistration, TabFallback } from '@wbcnc/cam';
import type { HoldDown } from '@wbcnc/cam';
import { MATERIALS } from '@wbcnc/cam/settings';
import { Button } from '@wbcnc/ui/components/button';
import { Label } from '@wbcnc/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { boardGap, defaultMargin, kStockAllowance, stockTopOf, type BoardNest, type BoardV1, type StockBoardV1 } from '../boards';
import type { MaterialKey } from '../planSettings';
import { kHoldDownLabels } from '../boards';
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
    <Hint text={hint} id={`${id}-hint`}>
      {field}
    </Hint>
  ) : (
    field
  );
}

const kHoldDownHints: Record<HoldDown, string> = {
  'fixture-tape': 'The board sits in a fixture or on double-sided tape: no tabs, the parts stay put by themselves.',
  tabs: 'Small bridges hold each part in the board; cut them with a knife or chisel afterwards.',
  'tabs-guided': 'Tabs, and at the machine a follow-up step stops at each tab so you can cut it off cleanly.',
  skin: 'No tabs: every outline stops a thin skin above the board’s bottom, so all parts stay in the board while it’s cut. At the machine, a last step cuts them free one at a time and pauses so you can take each one out. Clean edges, no tabs to cut off.',
  clamps: 'Clamps on two corners: parts are kept out of those areas. No tabs, so parts can move on the last pass.',
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
  onChange: (b: BoardV1) => void;
  /** Nest this board's parts afresh: unpins them and forgets where they were put by hand. */
  onRelayout?: () => void;
  onDelete?: () => void;
}) {
  const matching = stock.filter(s => +s.thickness.toFixed(1) === board.thickness);
  const sizeValue = board.size.fit
    ? 'fit'
    : (matching.find(s => !board.size.fit && s.w === board.size.w && s.h === board.size.h)?.id ?? 'custom');
  const tabs = board.holdDown === 'tabs' || board.holdDown === 'tabs-guided';
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
        {board.holdDown === 'clamps' && ' The clamp corners are kept free on top of the margin.'}
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
        <legend className="mb-2 text-[13px] font-semibold">Hold-down</legend>
        {(Object.keys(kHoldDownLabels) as HoldDown[]).map(h => (
          <Hint key={h} text={kHoldDownHints[h]} id={`hold-down-${h}-hint`} side="left">
            <label className="flex items-center gap-2 self-start text-[13px]">
              <input
                type="radio"
                name="hold-down"
                checked={board.holdDown === h}
                onChange={() => onChange({ ...board, holdDown: h })}
                aria-describedby={`hold-down-${h}-hint`}
                className="accent-primary"
              />
              {kHoldDownLabels[h]}
            </label>
          </Hint>
        ))}
        <p className="text-xs leading-relaxed text-muted-foreground">{kHoldDownHints[board.holdDown]}</p>
        {onHoldDownAll && (
          <Button size="sm" variant="outline" className="self-start" onClick={onHoldDownAll}>
            Use for all boards
          </Button>
        )}
      </fieldset>

      {board.holdDown === 'skin' && tabHold && onTabHold && (
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
            Tabs go only on straight edges facing stock that holds them. A part with no such edge gets (for the whole job; each part can
            choose its own in its ⋯ menu):
          </p>
          <div className="grid grid-cols-[1fr_88px] items-end gap-2">
            <Select value={tabHold.fallback ?? 'skin'} onValueChange={v => onTabHold({ ...tabHold, fallback: v as TabFallback })}>
              <SelectTrigger aria-label="Parts whose tabs can't hold get" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skin">Bottom skin (freed at the machine)</SelectItem>
                <SelectItem value="tabs">Tabs anyway (may not hold)</SelectItem>
                <SelectItem value="self">No tabs: I hold it down</SelectItem>
              </SelectContent>
            </Select>
            {(tabHold.fallback ?? 'skin') === 'skin' && (
              <NumberField
                id="skin"
                label="Skin (mm)"
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
          Tabs sit on straight edges where the stock beyond them holds. Moving them by hand comes later.
        </p>
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
              Turning the board over needs its parts still in it: choose Tabs as hold-down, or the cut-out parts fall out.
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
