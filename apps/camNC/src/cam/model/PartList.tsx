import { Checkbox } from '@wbcnc/ui/components/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@wbcnc/ui/components/dropdown-menu';
import { cn } from '@wbcnc/ui/lib/utils';
import { FlipVertical2, MoreHorizontal, Pencil } from 'lucide-react';
import { useRef, useState } from 'react';
import type { CamPartInfo } from '../camTypes';
import { Hint } from '../Hint';
import { fmt, groupParts } from './partFormat';
import { PartNameInput } from './PartNameInput';

const count = (ps: CamPartInfo[]) => ps.reduce((n, p) => n + p.names.length, 0);

export function PartList({
  parts,
  selectedId,
  milled,
  onSelect,
  onMilledChange,
  onRename,
}: {
  parts: CamPartInfo[];
  selectedId: string | null;
  milled: (id: string) => boolean;
  onSelect: (id: string) => void;
  onMilledChange: (id: string, milled: boolean) => void;
  /** A new name for the part; empty goes back to the model's name. */
  onRename: (id: string, name: string) => void;
}) {
  const { groups, notMilled } = groupParts(parts, milled);
  const bodies = count(parts);
  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">Parts</h2>
        <span className="text-xs text-muted-foreground">
          {bodies} {bodies === 1 ? 'body' : 'bodies'} · {bodies - count(notMilled)} milled
        </span>
      </div>
      {groups.map(([t, ps]) => (
        <section key={t} className="flex flex-col gap-1.5" aria-label={`${fmt(t)} mm boards`}>
          <GroupLabel>
            {fmt(t)} mm · {count(ps)} {count(ps) === 1 ? 'part' : 'parts'}
          </GroupLabel>
          {ps.map(p => (
            <PartCard
              key={p.id}
              part={p}
              selected={p.id === selectedId}
              milled={milled(p.id)}
              onClick={() => onSelect(p.id)}
              onMilledChange={m => onMilledChange(p.id, m)}
              onRename={name => onRename(p.id, name)}
            />
          ))}
        </section>
      ))}
      <section className="flex flex-col gap-1.5" aria-label="Not milled">
        <GroupLabel>Not milled</GroupLabel>
        {notMilled.map(p => (
          <PartCard
            key={p.id}
            part={p}
            selected={p.id === selectedId}
            milled={milled(p.id)}
            onClick={() => onSelect(p.id)}
            onMilledChange={m => onMilledChange(p.id, m)}
            onRename={name => onRename(p.id, name)}
          />
        ))}
        {!notMilled.length && (
          <p className="rounded-lg border border-dashed p-3 text-[13px] leading-relaxed text-muted-foreground">
            Untick 3D-printed or bought parts and they stay out of the boards.
          </p>
        )}
      </section>
    </aside>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{children}</div>;
}

/**
 * A part in the list: tick to mill it, click to inspect it. Rename it in place from its ⋯ menu or by double-clicking
 * its name: the same save as the inspector's pencil.
 */
function PartCard({
  part,
  selected,
  milled,
  onClick,
  onMilledChange,
  onRename,
}: {
  part: CamPartInfo;
  selected: boolean;
  milled: boolean;
  onClick: () => void;
  onMilledChange: (milled: boolean) => void;
  onRename: (name: string) => void;
}) {
  const { summary } = part;
  const [editing, setEditing] = useState(false);
  // The menu hands focus back to its trigger when it closes: not when it just opened the name field.
  const renaming = useRef(false);
  const size = (
    <span className="mr-6 shrink-0 font-mono text-xs text-muted-foreground">
      {fmt(part.size[0])} × {fmt(part.size[1])}
    </span>
  );
  const chips = (
    <span className="flex flex-wrap gap-1.5">
      {summary.notFlat && <Chip warn>3D part</Chip>}
      {summary.needsFlip && (
        <Chip warn>
          <FlipVertical2 className="size-3" /> both sides
        </Chip>
      )}
      {(!summary.notFlat || milled) && summary.chips.map(c => <Chip key={c.label}>{c.label}</Chip>)}
      {part.names.length > 1 && <Chip>identical, grouped</Chip>}
    </span>
  );
  return (
    <div
      className={cn(
        'relative flex items-start gap-2.5 rounded-lg border border-transparent bg-muted/40 px-3 py-2.5 hover:bg-muted',
        selected && 'border-primary bg-muted',
        !milled && 'bg-transparent'
      )}>
      <Hint text={milled ? 'Milled: it goes on a board. Untick to leave it out.' : 'Not milled: tick to put it on a board.'} side="right">
        <Checkbox
          checked={milled}
          onCheckedChange={v => onMilledChange(v === true)}
          aria-label={`Mill ${part.name}`}
          className="mt-0.5 size-[18px]"
        />
      </Hint>
      {editing ? (
        <div className={cn('flex min-w-0 flex-1 flex-col gap-1.5', !milled && 'opacity-60')}>
          <span className="flex items-center justify-between gap-2">
            <PartNameInput
              part={part}
              label={`New name for ${part.name}`}
              onRename={onRename}
              onDone={() => setEditing(false)}
              className="-my-1 h-7 flex-1 font-medium"
            />
            {size}
          </span>
          {chips}
        </div>
      ) : (
        <button
          onClick={onClick}
          onDoubleClick={() => setEditing(true)}
          aria-pressed={selected}
          className={cn('flex min-w-0 flex-1 flex-col gap-1.5 text-left', !milled && 'opacity-60')}>
          <span className="flex justify-between gap-2">
            <span className="truncate font-medium" title="Double-click to rename">
              {part.name}
              {part.names.length > 1 && <span className="text-muted-foreground"> × {part.names.length}</span>}
            </span>
            {size}
          </span>
          {chips}
        </button>
      )}
      <DropdownMenu>
        <Hint text="Rename the part. The new name shows on every step and in the G-code." side="right">
          <DropdownMenuTrigger asChild>
            <button
              aria-label={`More for ${part.name}`}
              className="absolute right-2 top-2 rounded px-1 py-0.5 text-muted-foreground hover:bg-background hover:text-foreground">
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={e => {
            if (renaming.current) e.preventDefault();
            renaming.current = false;
          }}>
          <DropdownMenuItem
            onSelect={() => {
              renaming.current = true;
              setEditing(true);
            }}>
            <Pencil className="size-3.5" /> Rename…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Chip({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-xs',
        warn ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-background text-muted-foreground ring-1 ring-border'
      )}>
      {children}
    </span>
  );
}
