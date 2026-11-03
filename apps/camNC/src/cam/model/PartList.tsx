import { Checkbox } from '@wbcnc/ui/components/checkbox';
import { cn } from '@wbcnc/ui/lib/utils';
import { FlipVertical2 } from 'lucide-react';
import type { CamPartInfo } from '../camTypes';
import { fmt, groupParts } from './partFormat';

const count = (ps: CamPartInfo[]) => ps.reduce((n, p) => n + p.names.length, 0);

export function PartList({
  parts,
  selectedId,
  milled,
  onSelect,
  onMilledChange,
}: {
  parts: CamPartInfo[];
  selectedId: string | null;
  milled: (id: string) => boolean;
  onSelect: (id: string) => void;
  onMilledChange: (id: string, milled: boolean) => void;
}) {
  const { groups, notMilled } = groupParts(parts, milled);
  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">Parts</h2>
        <span className="text-xs text-muted-foreground">
          {count(parts)} bodies · {count(parts) - count(notMilled)} milled
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

function PartCard({
  part,
  selected,
  milled,
  onClick,
  onMilledChange,
}: {
  part: CamPartInfo;
  selected: boolean;
  milled: boolean;
  onClick: () => void;
  onMilledChange: (milled: boolean) => void;
}) {
  const { summary } = part;
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border border-transparent bg-muted/40 px-3 py-2.5 hover:bg-muted',
        selected && 'border-primary bg-muted',
        !milled && 'bg-transparent'
      )}>
      <Checkbox
        checked={milled}
        onCheckedChange={v => onMilledChange(v === true)}
        aria-label={`Mill ${part.name}`}
        className="mt-0.5 size-[18px]"
      />
      <button
        onClick={onClick}
        aria-pressed={selected}
        className={cn('flex min-w-0 flex-1 flex-col gap-1.5 text-left', !milled && 'opacity-60')}>
        <span className="flex justify-between gap-2">
          <span className="truncate font-medium">
            {part.name}
            {part.names.length > 1 && <span className="text-muted-foreground"> × {part.names.length}</span>}
          </span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {fmt(part.size[0])} × {fmt(part.size[1])}
          </span>
        </span>
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
      </button>
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
