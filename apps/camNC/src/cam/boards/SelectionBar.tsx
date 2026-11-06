import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@wbcnc/ui/components/dropdown-menu';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { NumberInput } from '../NumberInput';

export interface SelectionField<K extends string> {
  key: K;
  label: string;
  value: number;
}

/**
 * What can be done to the one thing selected on the drawing, floating beside it: its sizes, delete, and a menu with the rest.
 * After a size is changed, a row offers the same for the others (`scopes`), so an edit never reaches further than asked.
 */
export function SelectionBar<K extends string>({
  id,
  title,
  note,
  fields,
  at,
  onField,
  scopes,
  onApply,
  onDelete,
  deleteLabel,
  menu,
}: {
  /** Tells the fields of one selected thing from another's. */
  id: string;
  title: string;
  /** Beside the title, what its fields reach. */
  note?: string;
  fields: SelectionField<K>[];
  /** Where it is in the drawing, px. */
  at: { x: number; y: number };
  /** False: the value wasn't taken. */
  onField: (key: K, value: number) => boolean | void;
  scopes: { id: string; label: string }[];
  onApply: (scope: string, key: K, value: number) => void;
  onDelete?: () => void;
  deleteLabel: string;
  menu: { label: string; icon?: ReactNode; onSelect: () => void }[];
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [offer, setOffer] = useState<{ key: K; label: string; value: number } | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  // A size being typed counts when the pointer goes elsewhere: that may take this bar away before the field is left.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && bar.current?.contains(active) && !bar.current.contains(e.target as Node)) active.blur();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, []);
  // Above it, or below when there's no room there, and always within the drawing.
  useLayoutEffect(() => {
    const el = bar.current,
      parent = el?.parentElement;
    if (!el || !parent) return;
    const [w, h] = [el.offsetWidth, el.offsetHeight];
    const gap = 16;
    setPlace({
      left: Math.max(0, Math.min(parent.clientWidth - w, at.x - w / 2)),
      top: at.y - h - gap >= 0 ? at.y - h - gap : at.y + gap,
    });
  }, [at.x, at.y, offer, title]);
  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label={title}
      data-selection-bar
      style={{ left: place?.left ?? at.x, top: place?.top ?? at.y, visibility: place ? 'visible' : 'hidden' }}
      className="absolute z-20 flex w-max max-w-full flex-col gap-1.5 rounded-lg border bg-background px-2 py-1.5 shadow-lg">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-semibold whitespace-nowrap">{title}</span>
        {note && <span className="text-[11px] whitespace-nowrap text-muted-foreground">{note}</span>}
        {fields.map(f => (
          <label key={f.key} className="flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
            {f.label}
            <NumberInput
              id={`${id}-${f.key}`}
              value={f.value}
              digits={1}
              min={0.1}
              unit="mm"
              className="h-6 w-14 px-1 text-right font-mono text-xs"
              onCommit={value => {
                if (onField(f.key, value) !== false) setOffer({ key: f.key, label: f.label, value });
              }}
            />
            mm
          </label>
        ))}
        {onDelete && (
          <button
            type="button"
            aria-label={deleteLabel}
            title={`${deleteLabel} (⌫)`}
            onClick={onDelete}
            className="flex size-7 items-center justify-center rounded-md hover:bg-destructive/20 hover:text-destructive">
            <Trash2 className="size-4" />
          </button>
        )}
        {menu.length > 0 && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="More" className="flex size-7 items-center justify-center rounded-md hover:bg-muted">
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {menu.map(m => (
                <DropdownMenuItem key={m.label} onSelect={m.onSelect}>
                  {m.icon} {m.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {offer && scopes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-1.5 text-xs text-muted-foreground">
          <span className="whitespace-nowrap">
            {offer.label} {offer.value} mm for
          </span>
          {scopes.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onApply(s.id, offer.key, offer.value);
                setOffer(null);
              }}
              className="rounded border bg-muted/40 px-1.5 py-0.5 whitespace-nowrap text-primary hover:border-primary">
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
