import { PageHeader } from '@/components/page-header';
import { useCamJob, useCamModel, useCamPlan, useSaveCamJob } from '@/cam/camQueries';
import type { CamPartInfo, PlanResult } from '@/cam/camTypes';
import { CamJobBar } from '@/cam/model/CamJobBar';
import { PlanSettingsPanel } from '@/cam/plan/PlanSettingsPanel';
import { ToolpathPreview } from '@/cam/plan/ToolpathPreview';
import { kDefaultPlan } from '@/cam/planSettings';
import { useStore } from '@/store/store';
import { createFileRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import { Button } from '@wbcnc/ui/components/button';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { cn } from '@wbcnc/ui/lib/utils';
import { AlertTriangle, Download, Play, ShieldCheck } from 'lucide-react';
import { z } from 'zod';

export const Route = createFileRoute('/cam/$jobId/plan')({
  component: PlanStep,
  validateSearch: zodValidator(z.object({ part: z.string().optional() })),
});

const fmtMin = (m: number) => `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`;
const fmtZ = (z: number) => `${+z.toFixed(2)}`;

/** Step 3 of a CAM job: operations, bit and settings for one part, its G-code, and handing it to the machine view. */
function PlanStep() {
  const { jobId } = useParams({ from: '/cam/$jobId/plan' });
  const { part: partParam } = useSearch({ from: '/cam/$jobId/plan' });
  const navigate = useNavigate();
  const { data: job, isPending } = useCamJob(jobId);
  const model = useCamModel(job);
  const save = useSaveCamJob();
  const milledParts = (model.data?.parts ?? []).filter(p => !p.summary.notFlat && (job?.parts.find(j => j.id === p.id)?.milled ?? true));
  const part = milledParts.find(p => p.id === partParam) ?? milledParts[0];
  const plan = useCamPlan(job, part?.id, !!model.data);

  if (isPending) return <Shell />;
  if (!job) return <Shell message="This job doesn't exist (any more)." />;
  const bar = <CamJobBar jobId={job.id} fileName={job.fileName} step="Plan" />;
  if (model.isError) return <Shell bar={bar} message={`Could not read ${job.fileName}: ${model.error.message}`} />;
  if (!model.data) return <Shell bar={bar} loading={`Reading ${job.fileName}…`} />;
  if (!part) return <Shell bar={bar} message="No part to mill: mark parts as milled in the Model step." />;

  const settings = job.plan ?? kDefaultPlan;
  const fileName = `${job.name} ${part.name}.gcode`;
  const result = plan.data;
  const safe = !!result && result.safety.length === 0;

  const showOnMachine = () => {
    if (!result || !safe) return;
    useStore.getState().updateToolpath(result.gcode, fileName);
    void navigate({ to: '/visualize/2DView' });
  };
  const download = () => {
    if (!result || !safe) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([result.gcode], { type: 'text/plain' }));
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Shell bar={bar}>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1fr_320px]">
        <main className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Parts" className="flex flex-wrap gap-1">
              {milledParts.map(p => (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={p.id === part.id}
                  onClick={() => void navigate({ to: '.', search: { part: p.id }, replace: true })}
                  className={cn(
                    'h-8 rounded-md px-3 text-sm',
                    p.id === part.id ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60'
                  )}>
                  {p.name}
                  {p.names.length > 1 && <span className="text-muted-foreground"> ×{p.names.length}</span>}
                </button>
              ))}
            </div>
            <span className="grow" />
            {result && (
              <span className="text-[13px] text-muted-foreground">
                {result.ops.length} operations · ⌀ {settings.bit.diameter} · ≈ {fmtMin(result.timeMin)} min per part
                {part.names.length > 1 && `, ${part.names.length} parts`}
              </span>
            )}
          </div>

          {!result ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
              <LoadingSpinner className="size-4" /> Computing toolpaths…
            </div>
          ) : (
            <>
              <div className={cn('relative rounded-lg bg-muted/30 p-3 transition-opacity', plan.isFetching && 'opacity-60')}>
                <ToolpathPreview plan={result} className="mx-auto block max-h-[340px] w-full" />
              </div>
              <OperationsTable part={part} plan={result} />
              <OrderBar plan={result} />
              <Checks plan={result} />
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={!safe} onClick={showOnMachine}>
                  <Play /> Show on machine
                </Button>
                <Button variant="outline" disabled={!safe} onClick={download}>
                  <Download /> Download .gcode
                </Button>
                <span className="text-xs text-muted-foreground">
                  Opens in the top view with the material removal preview. One file per part, Z0 at the bottom of the board.
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

function OperationsTable({ part, plan }: { part: CamPartInfo; plan: PlanResult }) {
  return (
    <table className="w-full border-collapse text-[13px]" aria-label={`Operations for ${part.name}`}>
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-2 pr-3 font-medium">#</th>
          <th className="py-2 pr-3 font-medium">Operation</th>
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
