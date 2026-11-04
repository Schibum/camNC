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
  kStockAllowance,
  partsHoldOf,
  retentionSettingsOf,
  resolveBoardRetention,
  stockTopOf,
  type BoardNest,
  type BoardV1,
  type StockBoardV1,
} from '../boards';
import { kDefaultRetention, type MaterialKey, type PartRetention, type RetentionSettingsV1 } from '../planSettings';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@wbcnc/ui/components/dialog';
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

const kRetentionLabels: Record<PartRetention, string> = {
  tabs: 'Tabs',
  skin: 'Bottom skin',
  none: 'None (operator holds each part)',
};
const kRetentionHints: Record<PartRetention, string> = {
  tabs: 'Small bridges hold each part in the board. Guided removal is a separate workflow choice.',
  skin: 'Every outline stops above the bottom. A last program cuts the parts free one at a time and pauses so you can take each one out.',
  none: 'No tabs and no skin: each part is free once its outline is cut through. You must hold it; the job reports when each comes loose.',
};
const kTapeHint =
  'Tape adds holding support and can ease final removal, but is less stable than mechanical fastening. It supplements the selected retention method; tab and stock stability checks still apply.';
const kGuidedHint =
  'At the machine, a follow-up program stops at each part so you can remove its tabs. This only applies to parts retained with tabs.';

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

/** Job defaults first; the board's primary choices stay mounted before all conditional details. */
export function BoardInspector({
  board,
  nest,
  stock,
  bit,
  onStickout,
  onChange,
  onRelayout,
  onDelete,
  alerts,
  alertSummary,
  flip,
  tabHold,
  onTabHold,
  jobRetention,
  onJobRetention,
  onHoldDownAll,
}: {
  board: BoardV1;
  nest: BoardNest;
  stock: StockBoardV1[];
  bit: number;
  onStickout?: (stickout: number) => void;
  onChange: (b: BoardV1) => void;
  onRelayout?: () => void;
  onDelete?: () => void;
  alerts?: React.ReactNode;
  alertSummary?: string;
  flip?: FlipRegistration | 'off';
  tabHold?: { fallback?: TabFallback; skin?: number };
  onTabHold?: (h: { fallback?: TabFallback; skin?: number }) => void;
  jobRetention?: RetentionSettingsV1;
  onJobRetention?: (v: RetentionSettingsV1) => void;
  /** Compatibility action for callers that still offer an explicit bulk copy. */
  onHoldDownAll?: () => void;
}) {
  const matching = stock.filter(s => +s.thickness.toFixed(1) === board.thickness);
  const sizeValue = board.size.fit
    ? 'fit'
    : (matching.find(s => !board.size.fit && s.w === board.size.w && s.h === board.size.h)?.id ?? 'custom');
  const parts = partsHoldOf(board);
  const held = boardHoldOf(board);
  const hold = holdsOf(board, nest.stickout);
  const settings = retentionSettingsOf(board, jobRetention);
  const defaults = { ...kDefaultRetention, ...jobRetention };
  const legacyTape = held === 'tape';
  const tabs = parts === 'tabs' || parts === 'tabs-guided';
  const tabGap = boardGap(bit, 'tabs'),
    tabMargin = defaultMargin(bit, 'tabs');
  const tightForTabs = tabs && (nest.gap < tabGap || nest.margin < tabMargin);
  const emptyFit = board.size.fit && !nest.placements.length;
  // A legacy board starts with explicit equivalent values when edited; changing one field must not change the others.
  const own = board.retentionSettings ?? settings;
  const changeRetention = (patch: RetentionSettingsV1) =>
    onChange(resolveBoardRetention({ ...board, retentionSettings: { ...own, ...patch } }, jobRetention));
  const changeKind = (kind: HoldKind) =>
    onChange({
      ...board,
      holds: {
        kind,
        d: kHoldDefaults[kind],
        height: kHoldHeights[kind],
        spacing: hold.spacing,
        stickout: hold.stickout,
        ...(kind === 'clamp' && { w: kClampWidth }),
      },
    });
  const resetRetention = () => onChange(resolveBoardRetention({ ...board, retentionSettings: {} }, jobRetention));
  const inherited = board.retentionSettings !== undefined && Object.keys(board.retentionSettings).length === 0;
  return (
    <aside aria-label="Board setup" className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l">
      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            className="h-16 shrink-0 justify-between rounded-none border-b px-4 text-left"
            aria-label="Edit job settings">
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold">Job settings</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {kRetentionLabels[defaults.retention]}
                {defaults.tapeAssisted ? ' · Tape-assisted' : ''}
                {defaults.guidedRemoval ? ' · Guided removal' : ''}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">Edit</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Job settings</DialogTitle>
            <DialogDescription>Defaults for this job. Board overrides and individual part exceptions are preserved.</DialogDescription>
          </DialogHeader>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] font-semibold">Default part retention</legend>
            {(Object.keys(kRetentionLabels) as PartRetention[]).map(retention => (
              <label key={retention} className="flex items-center gap-2 text-[13px]">
                <input
                  type="radio"
                  name="job-retention"
                  checked={defaults.retention === retention}
                  onChange={() => onJobRetention?.({ ...jobRetention, retention })}
                  disabled={!onJobRetention}
                  className="accent-primary"
                />
                {kRetentionLabels[retention]}
              </label>
            ))}
          </fieldset>
          <Hint text={kTapeHint} id="job-tape-hint">
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={defaults.tapeAssisted}
                onChange={e => onJobRetention?.({ ...jobRetention, tapeAssisted: e.target.checked })}
                disabled={!onJobRetention}
                aria-describedby="job-tape-hint"
                className="accent-primary"
              />
              Tape-assisted holding by default
            </label>
          </Hint>
          <Hint text={kGuidedHint} id="job-guided-hint">
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={defaults.guidedRemoval}
                onChange={e => onJobRetention?.({ ...jobRetention, guidedRemoval: e.target.checked })}
                disabled={!onJobRetention}
                aria-describedby="job-guided-hint"
                className="accent-primary"
              />
              Guide tab removal by default
            </label>
          </Hint>
          {tabHold && onTabHold && (
            <>
              <Label htmlFor="job-fallback">When tabs cannot hold a part</Label>
              <Select
                value={tabHold.fallback ?? 'ask'}
                onValueChange={v => onTabHold({ ...tabHold, fallback: v === 'ask' ? undefined : (v as TabFallback) })}>
                <SelectTrigger id="job-fallback" aria-label="A part whose tabs can't hold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ask">Blocks the job until I choose</SelectItem>
                  <SelectItem value="skin">Gets a bottom skin (freed at the machine)</SelectItem>
                  <SelectItem value="tabs">Gets tabs anyway (may not hold)</SelectItem>
                  <SelectItem value="self">Gets no tabs: I hold it down</SelectItem>
                </SelectContent>
              </Select>
              <NumberField
                id="skin"
                label="Bottom skin (mm)"
                hint="How much of the board's bottom stays under the parts until they're cut free at the machine. This thickness applies to the job's bottom skins, including part fallbacks."
                value={tabHold.skin ?? (legacyTape ? 0.5 : 1)}
                onCommit={skin => onTabHold({ ...tabHold, skin })}
                min={0.2}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
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
      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            className="mx-4 mb-3 h-14 shrink-0 justify-between overflow-hidden text-left"
            aria-label="Review board setup">
            <span className="min-w-0">
              <span className="block text-xs font-medium">Board checks & decisions</span>
              <span className="line-clamp-2 whitespace-normal text-xs font-normal text-muted-foreground">
                {[alertSummary ?? 'Review part holding and board checks', tightForTabs ? 'Spacing warning' : undefined]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <span aria-hidden="true">↗</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Board {board.name}: checks & decisions</DialogTitle>
            <DialogDescription>
              Resolve issues here without moving the setup controls. Tape assistance does not dismiss tab or board stability checks.
            </DialogDescription>
          </DialogHeader>
          {alerts}
          {tightForTabs && (
            <section
              aria-label="Tab spacing warning"
              className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed">
              <p>
                Too tight for tabs: gap {fmt(nest.gap)} mm, margin {fmt(nest.margin)} mm. Tabs need at least {fmt(tabGap)} mm gap and{' '}
                {fmt(tabMargin)} mm margin.
              </p>
              <p>
                The layout may grow in Fit to parts; a fixed board may no longer fit every part. This does not resolve unsuitable tab
                geometry.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => onChange({ ...board, margin: Math.max(nest.margin, tabMargin), gap: Math.max(nest.gap, tabGap) })}>
                Widen for tabs
              </Button>
            </section>
          )}
        </DialogContent>
      </Dialog>
      <div
        data-testid="board-settings-scroll"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 [overflow-anchor:none]">
        {legacyTape && (
          <section aria-label="Legacy fixture setup" className="flex flex-col gap-2 rounded-md border p-2 text-xs">
            <strong>Legacy fixture / tape-only setup</strong>
            <p>
              This saved setup keeps its original tape layer, hold checks and release program. Changing to independent retention is an
              explicit conversion.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onChange(
                  resolveBoardRetention(
                    { ...board, boardHold: 'points', retentionSettings: { ...settings, retention: 'skin', tapeAssisted: true } },
                    jobRetention
                  )
                )
              }>
              Convert to independent settings
            </Button>
          </section>
        )}
        <section aria-label="Primary board choices" className="flex shrink-0 flex-col gap-3">
          <fieldset className="flex flex-col gap-2" disabled={legacyTape}>
            <legend className="mb-2 text-[13px] font-semibold">Board fastening</legend>
            {(['screw', 'clamp'] as HoldKind[]).map(kind => (
              <Hint
                key={kind}
                text="Mechanical hold points keep the board on the spoilboard. Each remaining stock piece needs 3 around it so it cannot turn or lift."
                id={`fastening-${kind}-hint`}>
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="radio"
                    name="fastening"
                    checked={hold.kind === kind && !legacyTape}
                    onChange={() => changeKind(kind)}
                    aria-describedby={`fastening-${kind}-hint`}
                    className="accent-primary"
                  />
                  {kind === 'screw' ? 'Screws' : 'Clamps'}
                </label>
              </Hint>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-2" disabled={legacyTape}>
            <legend className="mb-2 text-[13px] font-semibold">Part retention</legend>
            {(Object.keys(kRetentionLabels) as PartRetention[]).map(retention => (
              <Hint key={retention} text={kRetentionHints[retention]} id={`retention-${retention}-hint`}>
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="radio"
                    name="retention"
                    checked={settings.retention === retention && !legacyTape}
                    onChange={() => changeRetention({ retention })}
                    aria-describedby={`retention-${retention}-hint`}
                    className="accent-primary"
                  />
                  {kRetentionLabels[retention]}
                </label>
              </Hint>
            ))}
          </fieldset>
          <Hint text={kTapeHint} id="tape-assisted-hint">
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={settings.tapeAssisted}
                disabled={legacyTape}
                onChange={e => changeRetention({ tapeAssisted: e.target.checked })}
                aria-describedby="tape-assisted-hint"
                className="accent-primary"
              />
              Tape-assisted holding
            </label>
          </Hint>
          <Hint text={kGuidedHint} id="guided-removal-hint">
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={settings.guidedRemoval}
                disabled={legacyTape}
                onChange={e => changeRetention({ guidedRemoval: e.target.checked })}
                aria-describedby="guided-removal-hint"
                className="accent-primary"
              />
              Guide tab removal
            </label>
          </Hint>
          <div className="flex h-8 items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {inherited
                ? 'From job settings'
                : legacyTape
                  ? 'Legacy setup'
                  : `${Object.keys(own).length} board override${Object.keys(own).length === 1 ? '' : 's'}`}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 px-2 text-xs"
              disabled={inherited || legacyTape}
              onClick={resetRetention}>
              Use job defaults
            </Button>
          </div>
        </section>
        <details className="shrink-0 border-t pt-3">
          <summary className="text-[13px] font-medium">
            Stock & layout{' '}
            <span className="text-xs font-normal text-muted-foreground">
              {fmt(nest.board.w)} × {fmt(nest.board.h)} mm
            </span>
          </summary>
          <div className="mt-3 flex flex-col gap-3.5">
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
                ` With these ${hold.kind === 'clamp' ? 'clamps' : 'screws'}, the margin is at least ${fmt(nest.margin)} mm: a frame of stock for them (see Fastening details). Untick “Keep a frame for them” to use your own margin.`}
            </p>

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
          </div>
        </details>
        {!legacyTape && (
          <details className="shrink-0 border-t pt-3">
            <summary className="text-[13px] font-medium">Fastening details · {hold.kind === 'clamp' ? 'clamps' : 'screws'}</summary>
            <div className="mt-3 flex flex-col gap-3.5">
              <div className="grid grid-cols-3 items-end gap-2">
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
            </div>
          </details>
        )}
        <details className="shrink-0 border-t pt-3">
          <summary className="text-[13px] font-medium">Tab dimensions & placement</summary>
          <div className="mt-3 flex flex-col gap-3">
            <p className="h-8 text-xs text-muted-foreground">
              {tabs ? 'Tab settings for this board.' : 'Inactive: this board does not use tabs.'}
            </p>
            <fieldset disabled={!tabs} className="flex min-w-0 flex-col gap-3 disabled:opacity-60">
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
              <p className="text-xs text-muted-foreground">
                Tabs sit on straight edges where the stock beyond them holds. Drag one along its part’s outline in the board view to move
                it, double-click a part’s edge to add one, double-click a tab to remove it. A red ring says the stock there doesn’t hold it.
              </p>
              {Object.keys(board.tabsAt ?? {}).some(id => board.items.includes(id)) && (
                <Button size="sm" variant="outline" className="self-start" onClick={() => onChange({ ...board, tabsAt: undefined })}>
                  Place tabs automatically again
                </Button>
              )}
            </fieldset>
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
                Turning the board over needs its parts still in it: choose Tabs under Part retention, or the cut-out parts fall out.
              </p>
            )}
          </section>
        )}

        {onHoldDownAll && (
          <Button size="sm" variant="outline" onClick={onHoldDownAll}>
            Use for all boards
          </Button>
        )}
        {onDelete && (
          <Button variant="outline" size="sm" onClick={onDelete}>
            Delete empty board
          </Button>
        )}
      </div>
    </aside>
  );
}
