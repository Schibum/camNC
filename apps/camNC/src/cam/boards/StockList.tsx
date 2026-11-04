import { Button } from '@wbcnc/ui/components/button';
import { Input } from '@wbcnc/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@wbcnc/ui/components/popover';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { StockBoardV1 } from '../boards';
import { Hint } from '../Hint';
import { numberProblem, parseDecimal } from '../numberFormat';

const fmt = (v: number) => `${+v.toFixed(1)}`;

/** The stock list's new-board fields: id, visible label, accessible name, placeholder, range. */
const kStockFields = [
  {
    key: 'thickness',
    label: 'Thickness',
    name: 'Stock thickness',
    placeholder: 'mm',
    range: { min: 0, minExclusive: true, max: 200, unit: 'mm' },
  },
  { key: 'w', label: 'Width', name: 'Stock width', placeholder: 'mm', range: { min: 0, minExclusive: true, unit: 'mm' } },
  { key: 'h', label: 'Height', name: 'Stock height', placeholder: 'mm', range: { min: 0, minExclusive: true, unit: 'mm' } },
  { key: 'quantity', label: 'Count', name: 'Stock quantity', placeholder: 'any', range: { min: 1, integer: true } },
] as const;

export function StockList({ stock, onChange }: { stock: StockBoardV1[]; onChange: (s: StockBoardV1[]) => void }) {
  const [draft, setDraft] = useState({ thickness: '', w: '', h: '', quantity: '' });
  // Only what was typed is checked: an empty size field just isn't done yet, an empty count means "as many as needed".
  const problems = kStockFields.flatMap(f => {
    const p = draft[f.key].trim() ? numberProblem(draft[f.key], f.range) : null;
    return p ? [{ ...f, problem: p }] : [];
  });
  const quantity = draft.quantity.trim() ? parseDecimal(draft.quantity) : undefined;
  const valid = !problems.length && [draft.thickness, draft.w, draft.h].every(v => v.trim());
  return (
    <section aria-label="Stock list" className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold">Stock list</h3>
      {!stock.length && <p className="text-xs text-muted-foreground">No boards yet.</p>}
      {stock.map(s => (
        <div key={s.id} className="flex items-center justify-between font-mono text-xs">
          <span>
            {fmt(s.thickness)} mm · {fmt(s.w)} × {fmt(s.h)}
            {s.quantity !== undefined && ` · ${s.quantity} pcs`}
          </span>
          <Hint text="Remove it from the stock list. Boards already laid out stay as they are.">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="Remove stock board"
              onClick={() => onChange(stock.filter(x => x !== s))}>
              <Trash2 className="size-3" />
            </Button>
          </Hint>
        </div>
      ))}
      <form
        className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-end gap-x-1 gap-y-0.5"
        onSubmit={e => {
          e.preventDefault();
          if (!valid) return;
          onChange([
            ...stock,
            {
              id: crypto.randomUUID(),
              thickness: parseDecimal(draft.thickness),
              w: parseDecimal(draft.w),
              h: parseDecimal(draft.h),
              ...(quantity && { quantity }),
            },
          ]);
          setDraft({ thickness: '', w: '', h: '', quantity: '' });
        }}>
        {kStockFields.map(f => (
          <label key={f.key} htmlFor={`stock-${f.key}`} className="text-[11px] text-muted-foreground">
            {f.label}
          </label>
        ))}
        <span />
        {kStockFields.map(f => (
          <Input
            key={f.key}
            id={`stock-${f.key}`}
            aria-label={f.name}
            inputMode={f.key === 'quantity' ? 'numeric' : 'decimal'}
            autoComplete="off"
            placeholder={f.placeholder}
            aria-invalid={problems.some(p => p.key === f.key) ? true : undefined}
            aria-describedby={problems.some(p => p.key === f.key) ? `stock-${f.key}-error` : undefined}
            className="h-7 px-1.5 font-mono text-xs"
            value={draft[f.key]}
            onChange={e => setDraft({ ...draft, [f.key]: e.target.value })}
          />
        ))}
        <Hint text="Add this board to the stock list: thickness, width and height in mm, count optional." wrap>
          <Button type="submit" variant="outline" size="icon" className="size-7" aria-label="Add stock board" disabled={!valid}>
            <Plus className="size-3" />
          </Button>
        </Hint>
      </form>
      {problems.map(p => (
        <p key={p.key} id={`stock-${p.key}-error`} className="text-xs text-destructive">
          {p.label}: {p.problem}
        </p>
      ))}
      <p className="text-xs text-muted-foreground">
        Boards you have, in mm, and how many (empty count: as many as needed). “Auto-fill from stock” puts the parts on as little of them as
        it can and keeps parts you moved by hand where they are.
      </p>
    </section>
  );
}

/** The stock list behind a button next to "Auto-fill from stock", the only thing that uses it. */
export function StockPopover({ stock, onChange }: { stock: StockBoardV1[]; onChange: (s: StockBoardV1[]) => void }) {
  return (
    <Popover>
      <Hint text="The boards you have: auto-fill puts the parts on them.">
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline">
            Stock list{stock.length > 0 && <span className="text-muted-foreground"> · {stock.length}</span>}
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="start" className="w-80">
        <StockList stock={stock} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
