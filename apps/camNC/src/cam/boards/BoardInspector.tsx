import type { HoldDown } from '@wbcnc/cam';
import { MATERIALS } from '@wbcnc/cam/settings';
import { Button } from '@wbcnc/ui/components/button';
import { Input } from '@wbcnc/ui/components/input';
import { Label } from '@wbcnc/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { kBoardMargin, type BoardNest, type BoardV1, type StockBoardV1 } from '../boards';
import type { MaterialKey } from '../planSettings';
import { kHoldDownLabels } from '../boards';

const fmt = (v: number) => `${+v.toFixed(1)}`;

function NumberField({
  id,
  label,
  value,
  onCommit,
  min = 0,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        key={value}
        defaultValue={fmt(value)}
        inputMode="decimal"
        className="h-8 font-mono"
        onBlur={e => {
          const v = parseFloat(e.target.value.replace(',', '.'));
          if (Number.isFinite(v) && v >= min && v !== value) onCommit(v);
        }}
        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

const kHoldDownHints: Record<HoldDown, string> = {
  'fixture-tape': 'The board sits in a fixture or on double-sided tape: no tabs, the parts stay put by themselves.',
  tabs: 'Small bridges hold each part in the board; cut them with a knife or chisel afterwards.',
  'tabs-guided': 'Tabs, and at the machine a follow-up step stops at each tab so you can cut it off cleanly.',
  clamps: 'Clamps on two corners: parts are kept out of those areas. No tabs, so parts can move on the last pass.',
};

/** Size, material and hold-down of the selected board. */
export function BoardInspector({
  board,
  nest,
  stock,
  bit,
  onChange,
  onDelete,
}: {
  board: BoardV1;
  nest: BoardNest;
  stock: StockBoardV1[];
  bit: number;
  onChange: (b: BoardV1) => void;
  onDelete?: () => void;
}) {
  const matching = stock.filter(s => +s.thickness.toFixed(1) === board.thickness);
  const sizeValue = board.size.fit
    ? 'fit'
    : (matching.find(s => !board.size.fit && s.w === board.size.w && s.h === board.size.h)?.id ?? 'custom');
  const tabs = board.holdDown === 'tabs' || board.holdDown === 'tabs-guided';
  return (
    <aside className="flex min-h-0 flex-col gap-3.5 overflow-y-auto border-l p-4">
      <h2 className="text-[15px] font-semibold">Board {board.name}</h2>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          id="board-w"
          label="Width"
          value={nest.board.w}
          onCommit={w => onChange({ ...board, size: { fit: false, w, h: nest.board.h } })}
          min={10}
        />
        <NumberField
          id="board-h"
          label="Height"
          value={nest.board.h}
          onCommit={h => onChange({ ...board, size: { fit: false, w: nest.board.w, h } })}
          min={10}
        />
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Thickness</span>
          <span className="flex h-8 items-center font-mono text-sm">{fmt(board.thickness)} mm</span>
        </div>
        <div className="flex flex-col gap-1">
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
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Gap between parts {nest.gap} mm = bit {fmt(bit)} + 4, {kBoardMargin} mm free along the edges. Thickness comes from the model; Z0 is
        the bottom of the board.
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
          <label key={h} className="flex items-center gap-2 text-[13px]">
            <input
              type="radio"
              name="hold-down"
              checked={board.holdDown === h}
              onChange={() => onChange({ ...board, holdDown: h })}
              className="accent-primary"
            />
            {kHoldDownLabels[h]}
          </label>
        ))}
        <p className="text-xs leading-relaxed text-muted-foreground">{kHoldDownHints[board.holdDown]}</p>
      </fieldset>

      {tabs && (
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            id="tab-w"
            label="Tab W"
            value={board.tabs.width}
            onCommit={width => onChange({ ...board, tabs: { ...board.tabs, width } })}
            min={1}
          />
          <NumberField
            id="tab-h"
            label="Tab H"
            value={board.tabs.height}
            onCommit={height => onChange({ ...board, tabs: { ...board.tabs, height } })}
            min={0.5}
          />
          <NumberField
            id="tab-n"
            label="Min #"
            value={board.tabs.minCount}
            onCommit={minCount => onChange({ ...board, tabs: { ...board.tabs, minCount: Math.round(minCount) } })}
            min={1}
          />
        </div>
      )}
      {tabs && <p className="text-xs text-muted-foreground">Tabs sit on the long straight edges; moving them by hand comes later.</p>}

      <span className="grow" />
      {onDelete && (
        <Button variant="outline" size="sm" onClick={onDelete}>
          Delete empty board
        </Button>
      )}
    </aside>
  );
}
