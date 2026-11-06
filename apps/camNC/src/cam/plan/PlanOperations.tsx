import { Popover, PopoverContent, PopoverTrigger } from '@wbcnc/ui/components/popover';
import { cn } from '@wbcnc/ui/lib/utils';
import { ChevronRight } from 'lucide-react';
import { Checkbox } from '@wbcnc/ui/components/checkbox';
import { useState, type ComponentProps } from 'react';
import { formatDuration } from '@/visualize/stockSim/jobTimeline';
import type { OpSummary, PlanResult } from '../camTypes';
import { savedCuttingFor, kCuttingLabels, kSourceLabels, resolveCutting, useCuttingData, type CuttingField } from '../cuttingData';
import { Hint } from '../Hint';
import { OpList } from '../plan3d/OpList';
import { usePlan3dView } from '../plan3d/plan3dViewStore';
import type { PlanPlayback } from '../plan3d/planPlayback';
import { useCamMachine } from '../machine/camMachine';
import { groupOpsOf, type PlanOpGroup } from '../plan3d/planModel';
import { CuttingDataEditor } from './CuttingDataEditor';
import { usePlanLayout } from './planLayoutStore';

export type EditProps = Omit<ComponentProps<typeof CuttingDataEditor>, 'fields'>;

const fmtZ = (z: number) => `${+z.toFixed(2)}`;

const kHints = {
  depth: 'Where the operation starts and ends cutting, in mm up from the bottom of the board (Z0).',
  passes: 'How many depths the operation cuts at. More passes take longer but each one is lighter.',
  stepdown: 'How deep each pass cuts. Less is gentler on the bit and slower. Click a value to change it.',
  stepover: 'How far each pocket pass moves sideways. Less leaves a smoother floor and is slower. Click a value to change it.',
  feed: 'How fast the bit moves through the wood, in mm/min; a second value is the slower final pass. Click a value to change it.',
};

/**
 * The Operations tab: the bits in order, then the board's operations, in the 3D view's colors and selection. As a
 * list, the selected op opens with its numbers; as a table, every op's numbers side by side. Either way a cutting
 * value is clicked to change it. `children`: the checks and notes under the operations.
 */
export function PlanOperations({
  name,
  plan,
  playback,
  editFor,
  children,
}: {
  /** e.g. "board A": the list and table are "Operations for board A". */
  name: string;
  plan: PlanResult;
  playback: PlanPlayback;
  editFor: (op: OpSummary) => EditProps;
  children?: React.ReactNode;
}) {
  const mode = usePlan3dView(s => s.mode);
  const { opsView, setOpsView } = usePlanLayout();
  const saved = useCuttingData(s => s.saved);
  const stepover = (op: OpSummary) => {
    const e = editFor(op);
    return resolveCutting(e.bit, e.material, savedCuttingFor(saved, e.bit, e.material), e.job).values.stepover;
  };
  const label = `Operations for ${name}`;
  return (
    <div className="flex flex-col gap-3">
      <BitsLine plan={plan} />
      <div className="flex items-center gap-2">
        <div role="group" aria-label="Show operations as" className="flex rounded-md border p-0.5 text-xs">
          {(
            [
              ['list', 'List', 'One row per operation: select one to see and change its numbers.'],
              ['table', 'Table', 'Every operation’s numbers side by side.'],
            ] as const
          ).map(([v, text, hint]) => (
            <Hint key={v} text={hint}>
              <button
                aria-pressed={opsView === v}
                onClick={() => setOpsView(v)}
                className={cn('rounded px-2.5 py-1', opsView === v ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60')}>
                {text}
              </button>
            </Hint>
          ))}
        </div>
        <span className="grow" />
        {playback.selected !== null && (
          <button className="text-xs text-muted-foreground hover:underline" onClick={() => playback.select(null)}>
            Show all
          </button>
        )}
      </div>
      {opsView === 'list' ? (
        <OpList
          name={label}
          playback={playback}
          mode={mode}
          details={g => {
            // In the 3D view's own clock, like the row above it.
            const sim = groupOpsOf(playback.model, playback.model.groups.indexOf(g)).reduce((t, o) => t + o.end - o.start, 0);
            return g.note ? (
              <ProgramNumbers group={g} seconds={sim} />
            ) : (
              <OpNumbers op={g.op} seconds={sim / g.count} count={g.count} edit={editFor(g.op)} stepover={stepover(g.op)} />
            );
          }}
        />
      ) : (
        <OperationsTable label={label} playback={playback} editFor={editFor} stepover={stepover} />
      )}
      {children}
    </div>
  );
}

/** The bits this board uses, in order, and the pause between them. */
function BitsLine({ plan }: { plan: PlanResult }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-[13px]">
      {plan.bits.map((d, i) => (
        <span key={d} className="flex items-center gap-2">
          {i > 0 && <span className="text-muted-foreground">→ next program: swap bit, zero Z →</span>}
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            ⌀
          </span>
          <span className="font-medium">{d} mm flat</span>
        </span>
      ))}
      <span className="text-muted-foreground">· smallest bit first, inner features before outlines</span>
    </p>
  );
}

/** The selected op's numbers in the list: the table's columns, one per line. */
function OpNumbers({
  op,
  seconds,
  count,
  edit,
  stepover,
}: {
  op: OpSummary;
  /** Simulated, for one op of the group. */
  seconds: number;
  /** Identical ops in the group: the numbers are each one's. */
  count: number;
  edit: EditProps;
  stepover: number;
}) {
  const line = (term: string, hint: string | null, value: React.ReactNode) => (
    <div className="contents">
      <dt className="text-muted-foreground">
        {hint ? (
          <Hint text={hint}>
            <span tabIndex={0} className="cursor-help underline decoration-muted-foreground/40 decoration-dotted underline-offset-4">
              {term}
            </span>
          </Hint>
        ) : (
          term
        )}
      </dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
  return (
    <>
      {count > 1 && <p className="text-xs text-muted-foreground">Per op, for each of the {count} identical ops:</p>}
      <dl aria-label={`${op.label}: numbers`} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {line(
          'Z from bottom',
          kHints.depth,
          <>
            {fmtZ(op.zTop)} → {fmtZ(op.zBottom)}
          </>
        )}
        {line('Passes', kHints.passes, op.depthSteps)}
        {line(
          'Stepdown',
          kHints.stepdown,
          <CuttingValue edit={edit} field="stepdown">
            {+op.stepdown.toFixed(2)} mm
          </CuttingValue>
        )}
        {line(
          'Stepover',
          kHints.stepover,
          op.kind === 'pocket' ? (
            <CuttingValue edit={edit} field="stepover">
              {+stepover.toFixed(2)} mm
            </CuttingValue>
          ) : (
            <span className="text-muted-foreground">–</span>
          )
        )}
        {line(
          op.feeds.length > 1 ? 'Feed / final feed' : 'Feed',
          kHints.feed,
          <CuttingValue edit={edit} field="feed">
            {op.feeds.join(' / ')} mm/min
          </CuttingValue>
        )}
        {line('Time (sim)', null, formatDuration(seconds))}
      </dl>
    </>
  );
}

/** A guided program's row, opened: where it cuts, how fast, how long, and its pauses. */
function ProgramNumbers({ group, seconds }: { group: PlanOpGroup; seconds: number }) {
  const { op, note } = group;
  const { pauseEachTab, setPauseEachTab } = useCamMachine();
  return (
    <>
      <dl aria-label={`${group.label}: numbers`} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Z from bottom</dt>
        <dd className="font-mono">
          {fmtZ(op.zTop)} → {fmtZ(op.zBottom)}
        </dd>
        <dt className="text-muted-foreground">{op.feeds.length > 1 ? 'Feed / final feed' : 'Feed'}</dt>
        <dd className="font-mono">{op.feeds.join(' / ')} mm/min</dd>
        <dt className="text-muted-foreground">Time (sim)</dt>
        <dd className="font-mono">{formatDuration(seconds)}, without the pauses</dd>
        <dt className="text-muted-foreground">Pauses</dt>
        <dd>{note}</dd>
      </dl>
      {op.program?.kind === 'tabs' && (
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={pauseEachTab} onCheckedChange={v => setPauseEachTab(v === true)} aria-label="Pause before each tab" />
          Pause before each tab
        </label>
      )}
    </>
  );
}

/** A cutting value: click to edit it, for the bit + material or for this job. */
function CuttingValue({ edit, field, children }: { edit: EditProps; field: CuttingField; children: React.ReactNode }) {
  const saved = useCuttingData(s => savedCuttingFor(s.saved, edit.bit, edit.material));
  const { source } = resolveCutting(edit.bit, edit.material, saved, edit.job);
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="-mx-1 rounded px-1 underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:bg-muted"
          title={`${kCuttingLabels[field].label}: ${kSourceLabels[source[field]]}. Click to change.`}>
          {children}
        </button>
      </PopoverTrigger>
      {/* Its field gets the focus, and with it the field's tooltip, the top layer: Escape would only close that. */}
      <PopoverContent className="w-80 font-sans" align="start" onKeyDownCapture={e => e.key === 'Escape' && setOpen(false)}>
        <CuttingDataEditor {...edit} fields={[field]} />
      </PopoverContent>
    </Popover>
  );
}

/** Every op's numbers side by side; a row selects its op, in the 3D view too. Wide: it scrolls sideways in its box. */
function OperationsTable({
  label,
  playback,
  editFor,
  stepover,
}: {
  label: string;
  playback: PlanPlayback;
  editFor: (op: OpSummary) => EditProps;
  stepover: (op: OpSummary) => number;
}) {
  const { model, selected, select } = playback;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setOpen(s => (s.has(key) ? new Set([...s].filter(k => k !== key)) : new Set([...s, key])));
  const cell = 'py-2 pr-3 font-mono whitespace-nowrap';
  const row = (n: number, op: OpSummary, label: React.ReactNode, num: React.ReactNode, seconds: number, key: string, sub = false) => (
    <tr
      key={key}
      onClick={() => select(n)}
      className={cn('cursor-pointer border-b', sub && 'text-muted-foreground', selected === n ? 'bg-muted' : 'hover:bg-muted/40')}>
      <td className={cn(cell, 'pl-1.5')}>{num}</td>
      <td className={cn('min-w-44 py-2 pr-3', sub && 'pl-6')}>{label}</td>
      <td className={cell}>⌀{op.tool.diameter}</td>
      <td className={cell}>
        {fmtZ(op.zTop)} → {fmtZ(op.zBottom)}
      </td>
      <td className={cell}>{op.depthSteps}</td>
      <td className={cell}>
        {op.program ? (
          `${+op.stepdown.toFixed(2)} mm`
        ) : (
          <CuttingValue edit={editFor(op)} field="stepdown">
            {+op.stepdown.toFixed(2)} mm
          </CuttingValue>
        )}
      </td>
      <td className={cn(cell, op.kind !== 'pocket' && 'text-muted-foreground')}>
        {op.kind === 'pocket' ? (
          <CuttingValue edit={editFor(op)} field="stepover">
            {+stepover(op).toFixed(2)} mm
          </CuttingValue>
        ) : (
          '–'
        )}
      </td>
      <td className={cell}>
        {op.program ? (
          op.feeds.join(' / ')
        ) : (
          <CuttingValue edit={editFor(op)} field="feed">
            {op.feeds.join(' / ')}
          </CuttingValue>
        )}
      </td>
      <td className="py-2 pr-1.5 font-mono whitespace-nowrap">{formatDuration(seconds)}</td>
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[13px]" aria-label={label}>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 pl-1.5 font-medium">#</th>
            <th className="py-2 pr-3 font-medium">Operation</th>
            <th className="py-2 pr-3 font-medium">Bit</th>
            <HeaderCell hint={kHints.depth}>Z from bottom</HeaderCell>
            <HeaderCell hint={kHints.passes}>Passes</HeaderCell>
            <HeaderCell hint={kHints.stepdown}>Stepdown</HeaderCell>
            <HeaderCell hint={kHints.stepover}>Stepover</HeaderCell>
            <HeaderCell hint={kHints.feed}>Feed</HeaderCell>
            <th className="py-2 pr-1.5 font-medium whitespace-nowrap">Time (sim)</th>
          </tr>
        </thead>
        <tbody>
          {model.groups.flatMap((g, n) => {
            const label =
              g.count > 1 ? (
                <button
                  className="inline-flex items-center gap-1 text-left hover:underline"
                  aria-expanded={open.has(g.key)}
                  onClick={() => toggle(g.key)}>
                  <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open.has(g.key) && 'rotate-90')} />
                  {g.label}{' '}
                  {g.note ? (
                    <span className="text-muted-foreground">· {g.note}</span>
                  ) : (
                    <span className="text-muted-foreground">×{g.count}, per op</span>
                  )}
                </button>
              ) : g.note ? (
                <>
                  {g.label} <span className="text-muted-foreground">· {g.note}</span>
                </>
              ) : (
                g.label
              );
            const opsOf = groupOpsOf(model, n);
            const seconds = opsOf.reduce((t, o) => t + o.end - o.start, 0);
            const num = (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-sm" style={{ background: g.color }} />
                {n + 1}
              </span>
            );
            return [
              // A grouped row's numbers are per op; a guided program's time is the whole program.
              row(n, g.op, label, num, g.note ? seconds : seconds / g.count, g.key),
              ...(open.has(g.key)
                ? g.members.map((m, k) =>
                    row(
                      n,
                      model.summaries[m],
                      g.note ? model.summaries[m].label : `${k + 1} of ${g.count}`,
                      '',
                      model.ops[m] ? model.ops[m].end - model.ops[m].start : 0,
                      `${g.key}#${m}`,
                      true
                    )
                  )
                : []),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A column header with a tooltip (it takes keyboard focus to show it) and the explanation as its description. */
function HeaderCell({ hint, children }: { hint: string; children: React.ReactNode }) {
  return (
    <th className="py-2 pr-3 font-medium whitespace-nowrap">
      <Hint text={hint}>
        <span tabIndex={0} className="cursor-help underline decoration-muted-foreground/40 decoration-dotted underline-offset-4">
          {children}
        </span>
      </Hint>
    </th>
  );
}
