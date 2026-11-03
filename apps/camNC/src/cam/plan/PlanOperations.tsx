import { Popover, PopoverContent, PopoverTrigger } from '@wbcnc/ui/components/popover';
import { cn } from '@wbcnc/ui/lib/utils';
import { ChevronRight } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import type { OpSummary, PlanResult } from '../camTypes';
import { cuttingKey, kCuttingLabels, kSourceLabels, resolveCutting, useCuttingData, type CuttingField } from '../cuttingData';
import { Hint } from '../Hint';
import { OpList } from '../plan3d/OpList';
import { usePlan3dView } from '../plan3d/plan3dViewStore';
import type { PlanPlayback } from '../plan3d/planPlayback';
import { CuttingDataEditor } from './CuttingDataEditor';
import { usePlanLayout } from './planLayoutStore';

export type EditProps = Omit<ComponentProps<typeof CuttingDataEditor>, 'fields'>;

const fmtMin = (m: number) => `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`;
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
    return resolveCutting(e.bit, e.material, saved[cuttingKey(e.bit, e.material)], e.job).values.stepover;
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
          details={g => <OpNumbers op={g.op} timeMin={g.timeMin} edit={editFor(g.op)} stepover={stepover(g.op)} />}
        />
      ) : (
        <OperationsTable label={label} plan={plan} playback={playback} editFor={editFor} stepover={stepover} />
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
function OpNumbers({ op, timeMin, edit, stepover }: { op: OpSummary; timeMin: number; edit: EditProps; stepover: number }) {
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
      {line('Time', null, `${fmtMin(timeMin)} min`)}
    </dl>
  );
}

/** A cutting value: click to edit it, for the bit + material or for this job. */
function CuttingValue({ edit, field, children }: { edit: EditProps; field: CuttingField; children: React.ReactNode }) {
  const saved = useCuttingData(s => s.saved[cuttingKey(edit.bit, edit.material)]);
  const { source } = resolveCutting(edit.bit, edit.material, saved, edit.job);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="-mx-1 rounded px-1 underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:bg-muted"
          title={`${kCuttingLabels[field].label}: ${kSourceLabels[source[field]]}. Click to change.`}>
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 font-sans" align="start">
        <CuttingDataEditor {...edit} fields={[field]} />
      </PopoverContent>
    </Popover>
  );
}

/** Every op's numbers side by side; a row selects its op, in the 3D view too. Wide: it scrolls sideways in its box. */
function OperationsTable({
  label,
  plan,
  playback,
  editFor,
  stepover,
}: {
  label: string;
  plan: PlanResult;
  playback: PlanPlayback;
  editFor: (op: OpSummary) => EditProps;
  stepover: (op: OpSummary) => number;
}) {
  const { model, selected, select } = playback;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setOpen(s => (s.has(key) ? new Set([...s].filter(k => k !== key)) : new Set([...s, key])));
  const cell = 'py-2 pr-3 font-mono whitespace-nowrap';
  const row = (n: number, op: OpSummary, label: React.ReactNode, num: React.ReactNode, timeMin: number, key: string, sub = false) => (
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
        <CuttingValue edit={editFor(op)} field="stepdown">
          {+op.stepdown.toFixed(2)} mm
        </CuttingValue>
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
        <CuttingValue edit={editFor(op)} field="feed">
          {op.feeds.join(' / ')}
        </CuttingValue>
      </td>
      <td className="py-2 pr-1.5 font-mono whitespace-nowrap">{fmtMin(timeMin)}</td>
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
            <th className="py-2 pr-1.5 font-medium">Time</th>
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
                  {g.label} <span className="text-muted-foreground">×{g.count}</span>
                </button>
              ) : (
                g.label
              );
            const num = (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-sm" style={{ background: g.color }} />
                {n + 1}
              </span>
            );
            return [
              row(n, g.op, label, num, g.timeMin, g.key),
              ...(open.has(g.key)
                ? g.members.map((m, k) => row(n, plan.ops[m], `${k + 1} of ${g.count}`, '', plan.ops[m].timeMin, `${g.key}#${m}`, true))
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
