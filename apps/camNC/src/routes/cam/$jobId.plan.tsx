import { PageHeader } from '@/components/page-header';
import { useBoardPlans, useCamJob, useCamModel, useSaveCamJob } from '@/cam/camQueries';
import type { OpSummary, PlanResult } from '@/cam/camTypes';
import { groupOps } from '@/cam/plan/groupOps';
import { missingParts, useJobBoards, type MissingPart } from '@/cam/useJobBoards';
import { freezeSpacing, spacingProblem } from '@/cam/boards';
import { orderBoardQueue } from '@wbcnc/cam/board';
import { CamJobBar } from '@/cam/model/CamJobBar';
import { PlanSettingsPanel } from '@/cam/plan/PlanSettingsPanel';
import { CuttingDataEditor } from '@/cam/plan/CuttingDataEditor';
import { cuttingKey, kCuttingLabels, kSourceLabels, resolveCutting, useCuttingData, type CuttingField } from '@/cam/cuttingData';
import { Popover, PopoverContent, PopoverTrigger } from '@wbcnc/ui/components/popover';
import type { ComponentProps } from 'react';
import { PlanView3D } from '@/cam/plan3d/PlanView3D';
import { jobCutting, kDefaultPlan } from '@/cam/planSettings';
import { loadIntoMachineView } from '@/cam/showOnMachine';
import { useCamMachine } from '@/cam/machine/camMachine';
import { useStore } from '@/store/store';
import { createFileRoute, Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import { Button } from '@wbcnc/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@wbcnc/ui/components/dropdown-menu';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { cn } from '@wbcnc/ui/lib/utils';
import { AlertTriangle, ChevronRight, Download, Factory, MoreHorizontal, Play, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';

export const Route = createFileRoute('/cam/$jobId/plan')({
  component: PlanStep,
  validateSearch: zodValidator(z.object({ board: z.string().optional() })),
});

const fmtMin = (m: number) => `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`;
const fmtZ = (z: number) => `${+z.toFixed(2)}`;

/**
 * Step 3: one program per board, in a queue that reuses the bit in the collet. Shows each board's operations (by bit,
 * inner features first), hands the program to the machine view or downloads it.
 */
function PlanStep() {
  const { jobId } = useParams({ from: '/cam/$jobId/plan' });
  const { board: boardParam } = useSearch({ from: '/cam/$jobId/plan' });
  const navigate = useNavigate();
  const { data: job, isPending } = useCamJob(jobId);
  const model = useCamModel(job);
  const save = useSaveCamJob();
  const { boards, instances } = useJobBoards(job, model.data);
  const active = boards.filter(b => b.request.parts.length);
  const plans = useBoardPlans(
    job,
    active.map(b => ({ request: b.request, material: b.board.material })),
    !!model.data
  );

  if (isPending) return <Shell />;
  if (!job) return <Shell message="This job doesn't exist (any more)." />;
  const bar = <CamJobBar jobId={job.id} fileName={job.fileName} step="Plan" />;
  if (model.isError) return <Shell bar={bar} message={`Could not read ${job.fileName}: ${model.error.message}`} />;
  if (!model.data) return <Shell bar={bar} loading={`Reading ${job.fileName}…`} />;
  if (!active.length) return <Shell bar={bar} message="No part to mill: mark parts as milled in the Model step." />;

  const settings = job.plan ?? kDefaultPlan;
  // Parts that don't fit their board are not cut: the job is blocked until they fit or are left out on purpose.
  const missing = missingParts(boards, instances);
  const unresolved = missing.filter(m => !settings.leaveOut?.includes(m.id));
  const tight = boards.flatMap(b => spacingProblem(b.board, b.nest, settings.bit.diameter) ?? []);
  const blocked = unresolved.length > 0 || tight.length > 0;
  const ready = plans.every(p => p.data);
  // Queue: start with the main bit, then boards that start with the bit the last one ended with.
  const entries = active.map((b, i) => ({ ...b, plan: plans[i].data, fetching: plans[i].isFetching, bits: plans[i].data?.bits ?? [] }));
  const queue = ready ? orderBoardQueue(entries, Math.min(...entries.flatMap(e => e.bits.slice(0, 1)))) : entries;
  const current = queue.find(e => e.board.id === boardParam) ?? queue[0];
  const result = current.plan;
  const empty = !!result && result.ops.length === 0;
  const safe = !!result && result.safety.length === 0 && !empty && !blocked;
  const allReady = ready && !blocked && queue.every(e => e.plan!.ops.length > 0 && e.plan!.safety.length === 0);
  const totalMin = queue.reduce((t, e) => t + (e.plan?.timeMin ?? 0), 0);
  const swaps = queue.reduce(
    (n, e, i) => n + Math.max(0, e.bits.length - 1) + (i > 0 && queue[i - 1].bits.at(-1) !== e.bits[0] ? 1 : 0),
    0
  );
  // One program per bit: "<job> board A.gcode", or "<job> board A T1.gcode", "… T2.gcode" with several bits.
  const programName = (p: PlanResult['programs'][number]) =>
    `${job.name} board ${current.board.name}${result && result.programs.length > 1 ? ` T${p.tool}` : ''}.gcode`;

  const showOnMachine = () => {
    if (!result || !safe) return;
    const first = result.programs[0];
    loadIntoMachineView({ ...result, gcode: first.gcode, bits: [first.diameter] }, programName(first));
    void navigate({ to: '/visualize/2DView' });
  };
  // All boards, in queue order, in the machine panel: place, align, zero, cut, swap bits, remove tabs.
  const takeToMachine = () => {
    if (!allReady) return;
    useCamMachine.getState().start(job.id);
    useStore.getState().setMachinePanelOpen(true);
    void navigate({ to: '/visualize/2DView' });
  };
  const download = (p: PlanResult['programs'][number]) => {
    if (!safe) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([p.gcode], { type: 'text/plain' }));
    a.download = programName(p);
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Shell bar={bar}>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1fr_320px]">
        <main className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Boards in cutting order" className="flex flex-wrap gap-1">
              {queue.map((e, i) => (
                <button
                  key={e.board.id}
                  role="tab"
                  aria-selected={e === current}
                  onClick={() => void navigate({ to: '.', search: { board: e.board.id }, replace: true })}
                  className={cn(
                    'h-8 rounded-md px-3 text-sm',
                    e === current ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60'
                  )}>
                  {i + 1} · {e.board.name} {e.board.thickness} mm
                </button>
              ))}
            </div>
            <span className="grow" />
            <span className="text-[13px] text-muted-foreground">
              Job: {queue.length} {queue.length === 1 ? 'board' : 'boards'} · {swaps} bit {swaps === 1 ? 'swap' : 'swaps'} · ≈{' '}
              {fmtMin(totalMin)} min cutting
            </span>
            <Button disabled={!allReady} onClick={takeToMachine}>
              <Factory /> Take the job to the machine
            </Button>
            <Button variant="outline" disabled={!safe} onClick={showOnMachine}>
              <Play /> Show board {current.board.name} on machine
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Board {current.board.name}</DropdownMenuLabel>
                {result?.programs.map(p => (
                  <DropdownMenuItem key={p.tool} disabled={!safe} onSelect={() => download(p)}>
                    <Download /> Download G-code{result.programs.length > 1 ? ` · T${p.tool} ⌀${p.diameter}` : ''}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <MissingBanner
            jobId={job.id}
            missing={unresolved}
            tight={tight}
            onLeaveOut={() => save.mutate({ ...job, plan: { ...settings, leaveOut: missing.map(m => m.id) } })}
          />

          {!result ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
              <LoadingSpinner className="size-4" /> Computing toolpaths…
            </div>
          ) : (
            <>
              {empty ? (
                <div role="status" className="flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-[13px]">
                  <p className="font-medium">Nothing to cut on board {current.board.name}</p>
                  <p className="text-muted-foreground">
                    Its parts have no outline, hole or pocket this bit can cut (a 3D part milled anyway may have no flat features). Check
                    the parts in the Model step.
                  </p>
                </div>
              ) : (
                <>
                  <BitsLine plan={result} />
                  <PlanView3D
                    plan={result}
                    board={current.request}
                    parts={model.data.parts}
                    className={cn('shrink-0 transition-opacity', current.fetching && 'opacity-60')}
                  />
                  <OperationsTable
                    name={`board ${current.board.name}`}
                    plan={result}
                    editFor={op => {
                      const main = op.tool.diameter === settings.bit.diameter || !settings.smallBit;
                      const bit = main ? settings.bit : settings.smallBit!;
                      return main
                        ? {
                            bit,
                            material: current.board.material,
                            job: jobCutting(settings),
                            onJobChange: cutting => save.mutate({ ...job, plan: { ...settings, cutting, finalFeedFactor: undefined } }),
                          }
                        : { bit, material: current.board.material };
                    }}
                  />
                </>
              )}
              <Checks plan={result} checked={!empty && !blocked} />
              <p className="text-xs text-muted-foreground">
                {result.programs.length > 1
                  ? 'One program per bit: run them in order, swap the bit and zero Z in between; the board stays put.'
                  : 'One program per board.'}{' '}
                Z0 at the bottom of the board, XY zero at its lower left corner.
              </p>
            </>
          )}
        </main>
        <PlanSettingsPanel
          value={settings}
          material={current.board.material}
          onChange={plan =>
            save.mutate({
              ...job,
              plan,
              // A different bit keeps the nest: margins and gaps stay what they were (warned about if too tight).
              ...(plan.bit.diameter !== settings.bit.diameter && {
                boards: freezeSpacing(
                  boards.map(b => b.board),
                  settings.bit.diameter
                ),
              }),
            })
          }
        />
      </div>
    </Shell>
  );
}

/** The bits this board uses, in order, and the pause between them. */
function BitsLine({ plan }: { plan: PlanResult }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-3.5 py-2.5 text-[13px]">
      {plan.bits.map((d, i) => (
        <span key={d} className="flex items-center gap-2">
          {i > 0 && <span className="text-muted-foreground">→ next program: swap bit, zero Z →</span>}
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            ⌀
          </span>
          <span className="font-medium">{d} mm flat</span>
        </span>
      ))}
      <span className="text-muted-foreground">· smallest bit first, inner features before outlines</span>
    </div>
  );
}

type EditProps = Omit<ComponentProps<typeof CuttingDataEditor>, 'fields'>;

/** A cutting value in the operations table: click to edit it, for the bit + material or for this job. */
function CuttingCell({ edit, field, children }: { edit: EditProps; field: CuttingField; children: React.ReactNode }) {
  const saved = useCuttingData(s => s.saved[cuttingKey(edit.bit, edit.material)]);
  const { source } = resolveCutting(edit.bit, edit.material, saved, edit.job);
  return (
    <td className="py-2 pr-3 font-mono">
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
    </td>
  );
}

function OperationsTable({ name, plan, editFor }: { name: string; plan: PlanResult; editFor: (op: OpSummary) => EditProps }) {
  const saved = useCuttingData(s => s.saved);
  const rows = groupOps(plan.ops);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const stepover = (op: OpSummary) => {
    const e = editFor(op);
    return resolveCutting(e.bit, e.material, saved[cuttingKey(e.bit, e.material)], e.job).values.stepover;
  };
  const toggle = (key: string) => setOpen(s => (s.has(key) ? new Set([...s].filter(k => k !== key)) : new Set([...s, key])));
  const row = (op: OpSummary, label: React.ReactNode, n: React.ReactNode, timeMin: number, key: string, sub = false) => (
    <tr key={key} className={cn('border-b', sub && 'text-muted-foreground')}>
      <td className="py-2 pr-3 font-mono">{n}</td>
      <td className={cn('py-2 pr-3', sub && 'pl-6')}>{label}</td>
      <td className="py-2 pr-3 font-mono">⌀{op.tool.diameter}</td>
      <td className="py-2 pr-3 font-mono">
        {fmtZ(op.zTop)} → {fmtZ(op.zBottom)}
      </td>
      <td className="py-2 pr-3 font-mono">{op.depthSteps}</td>
      <CuttingCell edit={editFor(op)} field="stepdown">
        {+op.stepdown.toFixed(2)} mm
      </CuttingCell>
      {op.kind === 'pocket' ? (
        <CuttingCell edit={editFor(op)} field="stepover">
          {+stepover(op).toFixed(2)} mm
        </CuttingCell>
      ) : (
        <td className="py-2 pr-3 font-mono text-muted-foreground">–</td>
      )}
      <CuttingCell edit={editFor(op)} field="feed">
        {op.feeds.join(' / ')}
      </CuttingCell>
      <td className="py-2 font-mono">{fmtMin(timeMin)}</td>
    </tr>
  );
  return (
    <table className="w-full border-collapse text-[13px]" aria-label={`Operations for ${name}`}>
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-2 pr-3 font-medium">#</th>
          <th className="py-2 pr-3 font-medium">Operation</th>
          <th className="py-2 pr-3 font-medium">Bit</th>
          <th className="py-2 pr-3 font-medium">Depth (Z from bottom)</th>
          <th className="py-2 pr-3 font-medium">Passes</th>
          <th className="py-2 pr-3 font-medium" title="The deepest single pass">
            Stepdown
          </th>
          <th className="py-2 pr-3 font-medium" title="Sideways step between pocket rings">
            Stepover
          </th>
          <th className="py-2 pr-3 font-medium">Feed</th>
          <th className="py-2 font-medium">Time</th>
        </tr>
      </thead>
      <tbody>
        {rows.flatMap((g, i) => {
          const label =
            g.count > 1 ? (
              <button
                className="inline-flex items-center gap-1 hover:underline"
                aria-expanded={open.has(g.key)}
                onClick={() => toggle(g.key)}>
                <ChevronRight className={cn('size-3.5 transition-transform', open.has(g.key) && 'rotate-90')} />
                {g.label} <span className="text-muted-foreground">×{g.count}</span>
              </button>
            ) : (
              g.label
            );
          return [
            row(g.op, label, i + 1, g.timeMin, g.key),
            ...(open.has(g.key)
              ? g.members.map((m, k) => row(plan.ops[m], `${k + 1} of ${g.count}`, '', plan.ops[m].timeMin, `${g.key}#${m}`, true))
              : []),
          ];
        })}
      </tbody>
    </table>
  );
}

/** Parts the job would silently not cut, and spacing too tight for the bit: fix on Boards or leave them out. */
function MissingBanner({
  jobId,
  missing,
  tight,
  onLeaveOut,
}: {
  jobId: string;
  missing: MissingPart[];
  tight: string[];
  onLeaveOut: () => void;
}) {
  if (!missing.length && !tight.length) return null;
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3.5 text-[13px]">
      {missing.length > 0 && (
        <p className="flex gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>
            <span className="font-medium">
              {missing.length === 1 ? '1 part doesn’t' : `${missing.length} parts don’t`} fit on{' '}
              {missing.length === 1 ? 'its board' : 'their boards'} and would not be cut:
            </span>{' '}
            {missing.map(m => `${m.name} (${m.board})`).join(', ')}.
          </span>
        </p>
      )}
      {tight.map(t => (
        <p key={t} className="flex gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" /> {t}
        </p>
      ))}
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <Button size="sm" variant="outline" asChild>
          <Link to="/cam/$jobId/boards" params={{ jobId }}>
            Fix on Boards
          </Link>
        </Button>
        {missing.length > 0 && !tight.length && (
          <Button size="sm" variant="ghost" onClick={onLeaveOut}>
            Leave {missing.length === 1 ? 'it' : 'them'} out
          </Button>
        )}
      </div>
    </div>
  );
}

/** `checked`: false while the job is blocked (missing parts, nothing to cut): no "passed" for an incomplete job. */
function Checks({ plan, checked }: { plan: PlanResult; checked: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 text-[13px]">
      {!checked ? null : plan.safety.length === 0 ? (
        <p className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="size-4" /> Safety checks passed: no rapid moves in the stock, stays on the board, never deeper than the
          cut-through depth.
        </p>
      ) : (
        plan.safety.map(s => (
          <p key={s} className="flex gap-2 text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {s}
          </p>
        ))
      )}
      {[...new Set(plan.warnings.map(friendly))].map(w => (
        <p key={w} className="flex gap-2 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {w}
        </p>
      ))}
    </div>
  );
}

/** The CAM core's notes, in words a user can act on. */
function friendly(w: string) {
  const corners = w.match(/left in corners\/narrow spots with D=([\d.]+)/);
  if (corners) return `Inside corners stay rounded to the bit radius (${+(+corners[1] / 2).toFixed(2)} mm).`;
  if (w.includes('no tool fits')) return `${w.split(':')[0]}: narrower than the bit, choose a smaller bit.`;
  if (w.includes('flipped')) return 'Features on the bottom face are not cut: they need a second, flipped setup.';
  if (w.includes('sloped')) return 'Small sloped faces (chamfers, fillets) come out square.';
  return w;
}

function Shell({
  bar,
  message,
  loading,
  children,
}: {
  bar?: React.ReactNode;
  message?: string;
  loading?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh w-full min-w-0 flex-col">
      <PageHeader title="CAM (beta)" />
      {bar}
      {message && <p className="m-8 text-muted-foreground">{message}</p>}
      {loading && (
        <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
          <LoadingSpinner className="size-4" /> {loading}
        </div>
      )}
      {children}
    </div>
  );
}
