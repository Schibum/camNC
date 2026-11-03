import { PageHeader } from '@/components/page-header';
import { CamPage } from '@/cam/CamPage';
import { NoPartsToMill } from '@/cam/NoPartsToMill';
import { useBoardPlans, useCamJob, useCamModel, useSaveCamJob } from '@/cam/camQueries';
import type { BoardRequest, CamPartInfo, OpSummary, PlanResult, ReleaseProgram } from '@/cam/camTypes';
import type { FlipRegistration } from '@wbcnc/cam';
import { missingParts, useJobBoards, type MissingPart } from '@/cam/useJobBoards';
import { layoutBlock, loose, planBlock, releaseProblems, unstable } from '@/cam/boardBlock';
import { edgeNote, freezeSpacing, spacingProblem } from '@/cam/boards';
import { orderBoardQueue } from '@wbcnc/cam/board';
import { CamJobBar } from '@/cam/model/CamJobBar';
import { Hint } from '@/cam/Hint';
import { PlanSettingsPanel } from '@/cam/plan/PlanSettingsPanel';
import { PlanOperations, type EditProps } from '@/cam/plan/PlanOperations';
import { usePlanLayout, type PlanTab } from '@/cam/plan/planLayoutStore';
import { PlanView3D } from '@/cam/plan3d/PlanView3D';
import { usePlanPlayback } from '@/cam/plan3d/planPlayback';
import { jobCutting, kDefaultPlan, type PlanSettingsV1 } from '@/cam/planSettings';
import { BitChip } from '@/cam/plan/BitPicker';
import { clearMachineView, loadIntoMachineView } from '@/cam/showOnMachine';
import { useCamMachine } from '@/cam/machine/camMachine';
import { selectMachineBounds, useStore } from '@/store/store';
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
import { AlertTriangle, Download, Factory, MoreHorizontal, Play, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';

export const Route = createFileRoute('/cam/$jobId/plan')({
  component: PlanStep,
  validateSearch: zodValidator(z.object({ board: z.string().optional() })),
});

const fmtMin = (m: number) => `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`;

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
  const [side, setSide] = useState<'a' | 'b'>('a');
  const save = useSaveCamJob(job);
  const { boards, instances } = useJobBoards(job, model.data);
  const active = boards.filter(b => b.request.parts.length);
  const plans = useBoardPlans(
    job,
    active.map(b => ({ request: b.request, material: b.board.material })),
    !!model.data,
    { keepShown: true }
  );

  if (isPending) return <Shell />;
  if (!job) return <Shell message="This job doesn't exist (any more)." />;
  const bar = <CamJobBar jobId={job.id} fileName={job.fileName} step="Plan" />;
  if (model.isError) return <Shell bar={bar} message={model.error.message} />;
  if (!model.data) return <Shell bar={bar} loading={`Reading ${job.fileName}…`} />;
  if (!active.length)
    return (
      <Shell bar={bar}>
        <NoPartsToMill jobId={job.id} />
      </Shell>
    );

  const settings = job.plan ?? kDefaultPlan;
  // Parts that don't fit their board are not cut: the job is blocked until they fit or are left out on purpose.
  const missing = missingParts(boards, instances);
  const unresolved = missing.filter(m => !settings.leaveOut?.includes(m.id));
  const tight = boards.flatMap(b => spacingProblem(b.board, b.nest, settings.bit.diameter) ?? []);
  const edges = boards.flatMap(b => edgeNote(b.board, b.nest, settings.bit.diameter) ?? []);
  const blocked = boards.some(b => layoutBlock(b, { bit: settings.bit.diameter, missing: unresolved }));
  // The last programs stay shown while settings change, but only fresh ones go to the machine or a file.
  const ready = plans.every(p => p.data && !p.isPlaceholderData);
  // Queue: start with the main bit, then boards that start with the bit the last one ended with.
  const entries = active.map((b, i) => ({
    ...b,
    plan: plans[i].data,
    fetching: plans[i].isFetching,
    error: plans[i].error,
    stale: plans[i].isPlaceholderData,
    bits: plans[i].data?.bits ?? [],
  }));
  // Ordered by the programs shown (the last ones while they're planned again): the board on screen stays put.
  const queue = plans.every(p => p.data) ? orderBoardQueue(entries, Math.min(...entries.flatMap(e => e.bits.slice(0, 1)))) : entries;
  const current = queue.find(e => e.board.id === boardParam) ?? queue[0];
  const sideA = current.plan;
  // The board's second side (turned over), when its parts have features underneath.
  const result = side === 'b' && sideA?.sideB ? sideA.sideB : sideA;
  const onSideB = result !== sideA;
  const empty = !!result && result.ops.length === 0;
  // What the guided programs after the cutting broke counts for the whole board, shown on either side.
  const releaseSafety = releaseProblems(sideA);
  // The same reasons block the board in the machine queue.
  const safe = !!result && !!sideA && !current.stale && !planBlock(sideA) && !blocked;
  // They come last: on side B, with the board turned over, when there is one.
  const shownRelease = onSideB || !sideA?.sideB ? sideA?.release : undefined;
  const allReady = ready && !blocked && queue.every(e => !planBlock(e.plan!));
  const totalMin = queue.reduce((t, e) => t + jobMinutes(e.plan), 0);
  const swaps = queue.reduce(
    (n, e, i) => n + Math.max(0, e.bits.length - 1) + (i > 0 && queue[i - 1].bits.at(-1) !== e.bits[0] ? 1 : 0),
    0
  );
  // One program per bit: "<job> board A.gcode", or "<job> board A T1.gcode", "… T2.gcode" with several bits.
  const programName = (p: PlanResult['programs'][number]) =>
    `${job.name} board ${current.board.name}${onSideB ? ' side B' : ''}${result && result.programs.length > 1 ? ` T${p.tool}` : ''}.gcode`;

  const savePlan = (plan: PlanSettingsV1) =>
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
    });
  const showOnMachine = () => {
    if (!result || !safe) return;
    const first = result.programs[0];
    loadIntoMachineView({ ...result, gcode: first.gcode, bits: [first.diameter] }, programName(first));
    toMachineView();
  };
  // Without a bed (no machine connected, no size picked) the machine view can't show the program: pick one first.
  const toMachineView = () =>
    void navigate(selectMachineBounds(useStore.getState()) ? { to: '/visualize/2DView' } : { to: '/start', search: { for: 'cam' } });
  // All boards, in queue order, in the machine panel: place, align, zero, cut, swap bits, remove tabs.
  const takeToMachine = () => {
    if (!allReady) return;
    useCamMachine.getState().start(job.id);
    // Whatever was loaded before isn't part of this: the queue loads each program in its turn.
    clearMachineView();
    useStore.getState().setMachinePanelOpen(true);
    toMachineView();
  };
  const download = (p: PlanResult['programs'][number]) => {
    if (!safe) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([p.gcode], { type: 'text/plain' }));
    a.download = programName(p);
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const name = `board ${current.board.name}`;
  const editFor = (op: OpSummary): EditProps => {
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
  };
  const openSettings = () => {
    usePlanLayout.getState().setTab('settings');
    // On a phone the sidebar is below the view: focusing its tab brings it up.
    document.getElementById(tabId('settings'))?.focus();
  };

  return (
    <Shell bar={bar}>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
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
        <BitChip value={settings} onChange={savePlan} onOpen={openSettings} />
        <Hint
          wrap
          text={
            allReady
              ? 'Opens the machine view with every board in cutting order: place, align, zero and cut each one, with the bit swaps in between.'
              : 'Opens the machine view with every board in cutting order, once every board has toolpaths that pass the checks.'
          }>
          <Button disabled={!allReady} onClick={takeToMachine}>
            <Factory /> Take the job to the machine
          </Button>
        </Hint>
        <DropdownMenu>
          <Hint text={`More actions for board ${current.board.name}: show it on the machine on its own, download its G-code.`}>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent align="end" className="max-w-80">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Board {current.board.name}</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={!safe}
              onSelect={showOnMachine}
              aria-label={`Show board ${current.board.name} on machine`}
              aria-describedby="plan-show-on-machine-hint"
              className="items-start">
              <Play className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span>Show board {current.board.name} on machine</span>
                <span id="plan-show-on-machine-hint" className="text-xs text-muted-foreground">
                  Loads only board {current.board.name}’s {result && result.programs.length > 1 ? 'first program' : 'program'} into the
                  machine view, to check or run it on its own.
                </span>
              </span>
            </DropdownMenuItem>
            {result?.programs.map(p => (
              <DropdownMenuItem key={p.tool} disabled={!safe} onSelect={() => download(p)}>
                <Download /> Download G-code{result.programs.length > 1 ? ` · T${p.tool} ⌀${p.diameter}` : ''}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <PlanWorkspace
        plan={result && !empty ? result : undefined}
        release={shownRelease}
        board={current.request}
        parts={model.data.parts}
        fetching={current.fetching}
        name={name}
        editFor={editFor}
        mark={
          !result
            ? null
            : result.safety.length > 0 || releaseSafety.length > 0 || loose(sideA).length > 0 || unstable(sideA) || !!sideA?.flip?.problem
              ? 'problem'
              : hasWarnings(result)
                ? 'warning'
                : null
        }
        above={
          <>
            {sideA?.flip && <SideSwitch plan={sideA} side={onSideB ? 'b' : 'a'} onSide={setSide} />}
            <MissingBanner
              jobId={job.id}
              missing={unresolved}
              tight={tight}
              edges={edges}
              onLeaveOut={() => save.mutate({ ...job, plan: { ...settings, leaveOut: missing.map(m => m.id) } })}
            />
          </>
        }
        status={
          current.error && !result ? (
            <p role="alert" className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3.5 text-[13px]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              Board {current.board.name} couldn’t be planned: {current.error.message}
            </p>
          ) : !result ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
              <LoadingSpinner className="size-4" /> Computing toolpaths…
            </div>
          ) : (
            <div role="status" className="flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-[13px]">
              <p className="font-medium">Nothing to cut on board {current.board.name}</p>
              <p className="text-muted-foreground">
                Its parts have no outline, hole or pocket this bit can cut (a 3D part milled anyway may have no flat features). Check the
                parts in the Model step.
              </p>
            </div>
          )
        }
        checks={
          result && (
            <>
              <Checks plan={result} checked={!empty && !blocked} releaseSafety={releaseSafety} />
              <p className="text-xs text-muted-foreground">
                {result.programs.length > 1
                  ? 'One program per bit: run them in order, swap the bit and zero Z in between; the board stays put.'
                  : 'One program per board.'}{' '}
                Z0 at the bottom of the board, XY zero at its lower left corner.
              </p>
            </>
          )
        }
        settings={<PlanSettingsPanel value={settings} material={current.board.material} onChange={savePlan} />}
      />
    </Shell>
  );
}

const tabId = (t: PlanTab) => `plan-tab-${t}`;
const panelId = (t: PlanTab) => `plan-panel-${t}`;
const kTabs: [PlanTab, string][] = [
  ['operations', 'Operations'],
  ['settings', 'Settings'],
];

/**
 * Below the header: the 3D view at full height, and one sidebar with the board's operations and the job's settings
 * (below the view on a phone). The view, its timeline and the op list share one playback: selecting an op in one
 * selects it in all.
 */
function PlanWorkspace({
  plan,
  release,
  board,
  parts,
  fetching,
  name,
  editFor,
  mark,
  above,
  status,
  checks,
  settings,
}: {
  /** The program shown, if it has operations. */
  plan: PlanResult | undefined;
  /** The guided programs that follow it. */
  release: ReleaseProgram[] | undefined;
  board: BoardRequest;
  parts: CamPartInfo[];
  fetching: boolean;
  /** e.g. "board A". */
  name: string;
  editFor: (op: OpSummary) => EditProps;
  /** A check failed, or a warning: flagged on the Operations tab, so it shows from the Settings tab too. */
  mark: 'problem' | 'warning' | null;
  /** Banners above the view. */
  above: React.ReactNode;
  /** Instead of the view while there is no program with operations. */
  status: React.ReactNode;
  /** The checks and notes, under the operations. */
  checks: React.ReactNode;
  settings: React.ReactNode;
}) {
  const playback = usePlanPlayback(plan, release);
  const { tab, opsView, setTab } = usePlanLayout();
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = kTabs[(kTabs.findIndex(([t]) => t === tab) + 1) % kTabs.length][0];
    setTab(next);
    document.getElementById(tabId(next))?.focus();
  };
  return (
    <div className="flex flex-1 flex-col md:min-h-0 md:flex-row">
      <main className="flex min-w-0 flex-col gap-3 p-3 md:min-h-0 md:flex-1 md:p-4">
        {above}
        {plan && playback ? (
          <PlanView3D
            plan={plan}
            board={board}
            parts={parts}
            playback={playback}
            className={cn('transition-opacity md:min-h-0 md:flex-1', fetching && 'opacity-60')}
          />
        ) : (
          status
        )}
      </main>
      <aside
        aria-label="Operations and settings"
        className={cn(
          'flex flex-col border-t md:min-h-0 md:shrink-0 md:border-t-0 md:border-l',
          tab === 'operations' && opsView === 'table' && playback ? 'md:w-[760px]' : 'md:w-[360px]'
        )}>
        <div role="tablist" aria-label="Operations and settings" className="flex gap-1 border-b px-3" onKeyDown={onKeyDown}>
          {kTabs.map(([t, text]) => (
            <button
              key={t}
              id={tabId(t)}
              role="tab"
              aria-selected={tab === t}
              aria-controls={panelId(t)}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => setTab(t)}
              className={cn(
                '-mb-px flex items-center gap-1.5 border-b-2 px-3 pt-3 pb-2 text-sm',
                tab === t ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
              )}>
              {text}
              {t === 'operations' && mark && (
                <>
                  <AlertTriangle
                    aria-hidden
                    data-mark={mark}
                    className={cn('size-3.5', mark === 'problem' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400')}
                  />
                  <span className="sr-only">{mark === 'problem' ? '(a check failed)' : '(warnings)'}</span>
                </>
              )}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={panelId(tab)}
          aria-labelledby={tabId(tab)}
          className="flex flex-col gap-4 p-4 md:min-h-0 md:flex-1 md:overflow-y-auto">
          {tab === 'settings' ? (
            settings
          ) : plan && playback ? (
            <PlanOperations name={name} plan={plan} playback={playback} editFor={editFor}>
              {checks}
            </PlanOperations>
          ) : (
            checks
          )}
        </div>
      </aside>
    </div>
  );
}

const kFlipSteps: Record<FlipRegistration, string> = {
  camera: 'Turn the board over top to bottom, then drag its outline onto it in the camera view again.',
  dowels: 'Turn the board over top to bottom onto the dowel pins in the holes side A drilled.',
  fence: 'Turn the board over top to bottom and push it against the fence and the stop again.',
};

/** Side A (as placed) or side B (the parts' undersides, the board turned over), and how side B lines up. */
function SideSwitch({ plan, side, onSide }: { plan: PlanResult; side: 'a' | 'b'; onSide: (s: 'a' | 'b') => void }) {
  const flip = plan.flip!;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 px-3.5 py-2.5 text-[13px]">
      <div role="group" aria-label="Board side" className="flex rounded-md border bg-background p-0.5 text-xs">
        {(['a', 'b'] as const).map(s => (
          <button
            key={s}
            aria-pressed={side === s}
            disabled={s === 'b' && !plan.sideB}
            onClick={() => onSide(s)}
            className={cn(
              'rounded px-2.5 py-1',
              side === s ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60 disabled:opacity-50'
            )}>
            {s === 'a' ? 'Side A' : 'Side B (turned over)'}
          </button>
        ))}
      </div>
      <span className="text-muted-foreground">
        {plan.sideB
          ? `After side A: ${kFlipSteps[flip.registration]} Don’t re-zero XY; zero Z on the spoilboard.`
          : 'No part on this board has features underneath.'}
        {flip.dowels &&
          ` Pins ⌀${flip.dowelDiameter} at ${flip.dowels.map(p => `X${Math.round(p.x)} Y${Math.round(p.y)}`).join(' and ')} (and their mirrors).`}
      </span>
      {flip.problem && <span className="text-destructive">{flip.problem}</span>}
    </div>
  );
}

/** All of a board's programs: side A, side B, and the guided ones after them. */
const jobMinutes = (plan: PlanResult | undefined) =>
  (plan?.timeMin ?? 0) + (plan?.sideB?.timeMin ?? 0) + (plan?.release ?? []).reduce((t, r) => t + r.timeMin, 0);

/** What `Checks` shows in amber. */
const hasWarnings = (plan: PlanResult) =>
  plan.warnings.length > 0 ||
  (plan.timeline ?? []).some(e => !e.block) ||
  (plan.hold ?? []).some(h => !h.ok && plan.holding?.find(x => x.name === h.part)?.how === 'tabs');

/** Parts the job would silently not cut, and spacing too tight for the bit: fix on Boards or leave them out. */
function MissingBanner({
  jobId,
  missing,
  tight,
  edges,
  onLeaveOut,
}: {
  jobId: string;
  missing: MissingPart[];
  tight: string[];
  /** Notes, not blockers: outline cuts that run past the board's edge. */
  edges: string[];
  onLeaveOut: () => void;
}) {
  const fix = (
    <Button size="sm" variant="outline" asChild>
      <Link to="/cam/$jobId/boards" params={{ jobId }}>
        Fix on Boards
      </Link>
    </Button>
  );
  if (!missing.length && !tight.length)
    return edges.length ? (
      <div role="status" className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3.5 text-[13px]">
        {edges.map(t => (
          <p key={t} className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" /> {t}
          </p>
        ))}
        <div className="pl-6">{fix}</div>
      </div>
    ) : null;
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
      {edges.map(t => (
        <p key={t} className="flex gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" /> {t}
        </p>
      ))}
      <div className="flex flex-wrap items-center gap-2 pl-6">
        {fix}
        {missing.length > 0 && !tight.length && (
          <Hint
            text={`The job goes ahead without ${missing.length === 1 ? 'this part' : 'these parts'}: ${missing.length === 1 ? 'it isn’t' : 'they aren’t'} cut. Fit ${missing.length === 1 ? 'it' : 'them'} on Boards to cut ${missing.length === 1 ? 'it' : 'them'} after all.`}>
            <Button size="sm" variant="ghost" onClick={onLeaveOut}>
              Leave {missing.length === 1 ? 'it' : 'them'} out
            </Button>
          </Hint>
        )}
      </div>
    </div>
  );
}

/** `checked`: false while the job is blocked (missing parts, nothing to cut): no "passed" for an incomplete job. */
function Checks({ plan, checked, releaseSafety }: { plan: PlanResult; checked: boolean; releaseSafety: string[] }) {
  const failed = [...plan.safety, ...releaseSafety];
  const how = (part: string) => plan.holding?.find(h => h.name === part)?.how;
  const skins = (plan.holding ?? []).filter(h => h.how === 'skin');
  return (
    <div className="flex flex-col gap-1.5 text-[13px]">
      {loose(plan).map(h => (
        <p key={h.part} className="flex gap-2 text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {h.part}: {h.anchored === 0 ? 'none' : `only ${h.anchored}`} of its {h.tabs.length} tabs would hold it, so it would come loose. On
          the Boards step, give it a bottom skin (its ⋯ menu), or more room around it.
        </p>
      ))}
      {(plan.holdClash ?? []).length > 0 && (
        <p className="flex gap-2 text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {plan.holdClash!.length === 1 ? 'A screw or clamp is' : `${plan.holdClash!.length} screws or clamps are`} in the bit’s way (red on
          the board). On the Boards step, drag {plan.holdClash!.length === 1 ? 'it' : 'them'} into the waste.
        </p>
      )}
      {(plan.timeline ?? [])
        // A part whose tabs don't hold is already listed above.
        .filter(e => !(e.kind === 'loose' && loose(plan).some(h => h.part === e.what)))
        .map(e => (
          <p
            key={`${e.kind}-${e.what}-${e.step}`}
            className={cn('flex gap-2', e.block ? 'text-destructive' : 'text-amber-700 dark:text-amber-400')}>
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {e.message}
          </p>
        ))}
      {(plan.hold ?? [])
        .filter(h => !h.ok && how(h.part) === 'tabs')
        .map(h => (
          <p key={h.part} className="flex gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {h.part}: tabs anyway, as you chose: {h.anchored} of {h.tabs.length} hold. Keep an eye on it on the last pass.
          </p>
        ))}
      {(plan.holding ?? [])
        .filter(h => h.how === 'self')
        .map(h => (
          <p key={h.name} className="flex gap-2 text-muted-foreground">
            {h.name}: no tabs, cut free: hold it down yourself (tape, clamps), as you chose.
          </p>
        ))}
      {skins.length > 0 && plan.taped && (
        <p className="text-muted-foreground">
          Every outline stops {plan.skin ?? 0.5} mm above the bottom, so the parts stay on the tape while the board is cut. The last
          program, “Cut free”, cuts that layer for all parts together, smallest first.
        </p>
      )}
      {skins.length > 0 && !plan.taped && (
        <p className="text-muted-foreground">
          {/* Without a hold check, the board is held by skins (its hold-down), not tabs. */}
          {plan.hold
            ? `${skins.map(h => h.name).join(', ')}: no edge where tabs would hold, so ${skins.length === 1 ? 'it keeps' : 'they keep'} a ${plan.skin ?? 1} mm bottom skin.`
            : `Every part keeps a ${plan.skin ?? 1} mm bottom skin, so nothing comes loose while the board is cut.`}{' '}
          At the machine, “Free parts” cuts {skins.length === 1 ? 'it' : 'them'} free one at a time.
        </p>
      )}
      {!checked ? null : failed.length === 0 ? (
        <p className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="size-4" /> Safety checks passed: no rapid moves in the stock, stays on the board, never deeper than the
          cut-through depth.
        </p>
      ) : (
        failed.map(s => (
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
  if (corners)
    return `Inside corners stay rounded to the bit radius (${+(+corners[1] / 2).toFixed(2)} mm). A second, smaller bit doesn’t clean them up yet.`;
  if (w.includes('no tool fits')) return `${w.split(':')[0]}: narrower than the bit, choose a smaller bit.`;
  if (w.includes('flipped')) return 'Features on the bottom face are not cut: they need a second, flipped setup.';
  if (w.includes('sloped')) return 'Small sloped faces (chamfers, fillets) come out square.';
  const flutes = w.match(/bit D=([\d.]+) cuts ([\d.]+) mm deep from the stock top, its flutes are ([\d.]+) mm long/);
  if (flutes)
    return `The ⌀${flutes[1]} bit cuts ${flutes[2]} mm deep but its flutes are only ${flutes[3]} mm long: the shank would rub. Use a longer bit or thinner stock.`;
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
    <CamPage className="min-h-dvh md:h-dvh">
      <PageHeader title="CAM (beta)" />
      {bar}
      {message && <p className="m-8 text-muted-foreground">{message}</p>}
      {loading && (
        <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
          <LoadingSpinner className="size-4" /> {loading}
        </div>
      )}
      {children}
    </CamPage>
  );
}
