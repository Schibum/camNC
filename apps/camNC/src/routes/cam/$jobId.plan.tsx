import { PageHeader } from '@/components/page-header';
import { useBoardPlans, useCamJob, useCamModel, useSaveCamJob } from '@/cam/camQueries';
import type { PlanResult } from '@/cam/camTypes';
import { useJobBoards } from '@/cam/useJobBoards';
import { orderBoardQueue } from '@wbcnc/cam/board';
import { CamJobBar } from '@/cam/model/CamJobBar';
import { PlanSettingsPanel } from '@/cam/plan/PlanSettingsPanel';
import { ToolpathPreview } from '@/cam/plan/ToolpathPreview';
import { kDefaultPlan } from '@/cam/planSettings';
import { loadIntoMachineView } from '@/cam/showOnMachine';
import { createFileRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import { Button } from '@wbcnc/ui/components/button';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { cn } from '@wbcnc/ui/lib/utils';
import { AlertTriangle, Download, Play, ShieldCheck } from 'lucide-react';
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
  const { boards } = useJobBoards(job, model.data);
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
  const ready = plans.every(p => p.data);
  // Queue: start with the main bit, then boards that start with the bit the last one ended with.
  const entries = active.map((b, i) => ({ ...b, plan: plans[i].data, fetching: plans[i].isFetching, bits: plans[i].data?.bits ?? [] }));
  const queue = ready ? orderBoardQueue(entries, Math.min(...entries.flatMap(e => e.bits.slice(0, 1)))) : entries;
  const current = queue.find(e => e.board.id === boardParam) ?? queue[0];
  const result = current.plan;
  const safe = !!result && result.safety.length === 0;
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
          </div>

          {!result ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
              <LoadingSpinner className="size-4" /> Computing toolpaths…
            </div>
          ) : (
            <>
              <BitsLine plan={result} />
              <div className={cn('relative rounded-lg bg-muted/30 p-3 transition-opacity', current.fetching && 'opacity-60')}>
                <ToolpathPreview plan={result} className="mx-auto block max-h-[320px] w-full" />
              </div>
              <OperationsTable name={`board ${current.board.name}`} plan={result} />
              <OrderBar plan={result} />
              <Checks plan={result} />
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={!safe} onClick={showOnMachine}>
                  <Play /> Show on machine
                </Button>
                {result.programs.map(p => (
                  <Button key={p.tool} variant="outline" disabled={!safe} onClick={() => download(p)}>
                    <Download />{' '}
                    {result.programs.length > 1
                      ? `Board ${current.board.name} · T${p.tool} ⌀${p.diameter}`
                      : `Download board ${current.board.name}`}
                  </Button>
                ))}
                <span className="text-xs text-muted-foreground">
                  {result.programs.length > 1
                    ? 'One program per bit: run them in order, swap the bit and zero Z in between; the board stays put.'
                    : 'One program per board.'}{' '}
                  Z0 at the bottom of the board, XY zero at its lower left corner.
                </span>
              </div>
            </>
          )}
        </main>
        <PlanSettingsPanel value={settings} onChange={plan => save.mutate({ ...job, plan })} />
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

function OperationsTable({ name, plan }: { name: string; plan: PlanResult }) {
  return (
    <table className="w-full border-collapse text-[13px]" aria-label={`Operations for ${name}`}>
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-2 pr-3 font-medium">#</th>
          <th className="py-2 pr-3 font-medium">Operation</th>
          <th className="py-2 pr-3 font-medium">Bit</th>
          <th className="py-2 pr-3 font-medium">Depth (Z from bottom)</th>
          <th className="py-2 pr-3 font-medium">Passes</th>
          <th className="py-2 pr-3 font-medium">Feed</th>
          <th className="py-2 font-medium">Time</th>
        </tr>
      </thead>
      <tbody>
        {plan.ops.map((op, i) => (
          <tr key={op.name} className="border-b">
            <td className="py-2 pr-3 font-mono">{i + 1}</td>
            <td className="py-2 pr-3">{op.label}</td>
            <td className="py-2 pr-3 font-mono">⌀{op.tool.diameter}</td>
            <td className="py-2 pr-3 font-mono">
              {fmtZ(op.zTop)} → {fmtZ(op.zBottom)}
            </td>
            <td className="py-2 pr-3 font-mono">{op.depthSteps}</td>
            <td className="py-2 pr-3 font-mono">{op.feeds.join(' / ')}</td>
            <td className="py-2 font-mono">{fmtMin(op.timeMin)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const kOpColors = ['bg-violet-800', 'bg-violet-600', 'bg-violet-400', 'bg-violet-300'];

/** Operations in cutting order, as wide as the time they take. */
function OrderBar({ plan }: { plan: PlanResult }) {
  const total = plan.ops.reduce((s, o) => s + o.timeMin, 0) || 1;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">Order: inner features before the outline, the board is never loose.</span>
      <div className="flex h-7 overflow-hidden rounded-md text-xs text-white">
        {plan.ops.map((op, i) => (
          <div
            key={op.name}
            title={`${op.label} · ${fmtMin(op.timeMin)}`}
            style={{ width: `${(op.timeMin / total) * 100}%` }}
            className={cn(
              'flex min-w-6 items-center truncate px-2',
              kOpColors[Math.min(i, kOpColors.length - 1)],
              i >= 2 && 'text-zinc-900'
            )}>
            {op.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function Checks({ plan }: { plan: PlanResult }) {
  return (
    <div className="flex flex-col gap-1.5 text-[13px]">
      {plan.safety.length === 0 ? (
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
