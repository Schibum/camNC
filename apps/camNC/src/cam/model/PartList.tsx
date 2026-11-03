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
}: {
  parts: CamPartInfo[];
  selectedId: string | null;
  milled: (id: string) => boolean;
  onSelect: (id: string) => void;
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
            <PartCard key={p.id} part={p} selected={p.id === selectedId} onClick={() => onSelect(p.id)} />
          ))}
        </section>
      ))}
      <section className="flex flex-col gap-1.5" aria-label="Not milled">
        <GroupLabel>Not milled</GroupLabel>
        {notMilled.map(p => (
          <PartCard key={p.id} part={p} selected={p.id === selectedId} onClick={() => onSelect(p.id)} />
        ))}
        {!notMilled.length && (
          <p className="rounded-lg border border-dashed p-3 text-[13px] leading-relaxed text-muted-foreground">
            Mark 3D-printed or bought parts as not milled and they stay out of the boards.
          </p>
        )}
      </section>
    </aside>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{children}</div>;
}

function PartCard({ part, selected, onClick }: { part: CamPartInfo; selected: boolean; onClick: () => void }) {
  const { summary } = part;
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex flex-col gap-1.5 rounded-lg border border-transparent bg-muted/40 px-3 py-2.5 text-left hover:bg-muted',
        selected && 'border-primary bg-muted'
      )}>
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
        {summary.notFlat && <Chip warn>not a flat board</Chip>}
        {summary.needsFlip && (
          <Chip warn>
            <FlipVertical2 className="size-3" /> both sides
          </Chip>
        )}
        {!summary.notFlat && summary.chips.map(c => <Chip key={c.label}>{c.label}</Chip>)}
        {part.names.length > 1 && <Chip>identical, grouped</Chip>}
      </span>
    </button>
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
