import { RehearsalButton } from '@/lib/rehearsal/RehearsalButton';
import { freezeRehearsalBoard } from '@/lib/rehearsal/boardSnapshot';
import { PageHeader } from '@/components/page-header';
import { CamPage } from '@/cam/CamPage';
import { NoPartsToMill } from '@/cam/NoPartsToMill';
import { useBoardPlans, useCamJob, useCamModel, useSaveCamJob } from '@/cam/camQueries';
import type { BoardRequest, CamPartInfo, OpSummary, PlanResult, ReleaseProgram } from '@/cam/camTypes';
import type { FlipRegistration } from '@wbcnc/cam';
import { missingParts, useJobBoards, type MissingPart } from '@/cam/useJobBoards';
import { boardSizeProblem, layoutBlock, loose, planBlock, releaseProblems, unstable } from '@/cam/boardBlock';
import { boardGeometryKey } from '@/cam/cadDesign';
import { cutBoardWith, edgeNote, freezeSpacing, isCut, spacingProblem } from '@/cam/boards';
import { CutBadge } from '@/cam/boards/CutBadge';
import { orderBoardQueue } from '@wbcnc/cam/board';
import { CamJobBar } from '@/cam/CamJobBar';
import { Hint } from '@/cam/Hint';
import { PlanSettingsPanel } from '@/cam/plan/PlanSettingsPanel';
import { ProgramDownloads } from '@/cam/plan/ProgramDownloads';
import { PlanOperations, type EditProps } from '@/cam/plan/PlanOperations';
import { usePlanLayout, type PlanTab } from '@/cam/plan/planLayoutStore';
import { PlanView3D } from '@/cam/plan3d/PlanView3D';
import { usePlanPlayback } from '@/cam/plan3d/planPlayback';
import { formatDuration } from '@/visualize/stockSim/jobTimeline';
import { jobCutting, kDefaultPlan, withHoleChoice, type PlanSettingsV1 } from '@/cam/planSettings';
import { holeChoiceKey } from '@/cam/holeChoices';
import { BitChip } from '@/cam/plan/BitPicker';
import { clearMachineView, loadIntoMachineView } from '@/cam/showOnMachine';
import { isManufacturingLocked, useCamMachine } from '@/cam/machine/camMachine';
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
import { AlertTriangle, Factory, MoreHorizontal, Play, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';

export const Route = createFileRoute('/cam/$jobId/plan')({
  component: PlanStep,
  validateSearch: zodValidator(z.object({ board: z.string().optional(), rehearsed: z.literal(1).optional() })),
});

/**
 * Step 3: one program per board, in a queue that reuses the bit in the collet. Shows each board's operations (by bit,
 * inner features first), hands the program to the machine view or downloads it.
 */
function PlanStep() {
  const { jobId } = useParams({ from: '/cam/$jobId/plan' });
  const { board: boardParam, rehearsed } = useSearch({ from: '/cam/$jobId/plan' });
  const navigate = useNavigate();
  const { data: job, isPending } = useCamJob(jobId);
  const model = useCamModel(job);
  const [side, setSide] = useState<'a' | 'b'>('a');
  const save = useSaveCamJob(job);
  const { boards, instances } = useJobBoards(job, model.data);
  const executable = boards.filter(b => b.request.parts.length);
  // Keep repair/include actions reachable when no part is currently executable.
  const active = executable.length ? executable : boards.filter(b => b.board.items.length);
  const plans = useBoardPlans(
    job,
    active.map(b => ({ request: b.request, material: b.board.material })),
    !!model.data,
    { keepShown: true }
  );

  useEffect(() => {
    if (rehearsed && !isPending && !job) void navigate({ to: '/cam' });
  }, [rehearsed, isPending, job, navigate]);

  if (isPending) return <Shell />;
  if (!job) return <Shell message="This job doesn't exist (any more)." />;
  const emptyBar = <CamJobBar job={job} />;
  if (model.isError) return <Shell bar={emptyBar} message={model.error.message} />;
  if (!model.data) return <Shell bar={emptyBar} loading={`Reading ${job.fileName}…`} />;
  if (!active.length)
    return (
      <Shell bar={emptyBar}>
        <NoPartsToMill jobId={job.id} />
      </Shell>
    );

  const settings = job.plan ?? kDefaultPlan;
  // Parts that don't fit their board are not cut: the job is blocked until they fit or are left out on purpose.
  const missing = missingParts(boards, instances);
  const unresolved = missing.filter(m => !settings.leaveOut?.includes(m.id));
  const tight = boards.flatMap(b =>
    [spacingProblem(b.board, b.nest, settings.bit.diameter), boardSizeProblem(b)].filter((s): s is string => !!s)
  );
  const edges = boards.flatMap(b => edgeNote(b.board, b.nest, settings.bit.diameter) ?? []);
  const layoutProblems = boards.flatMap(
    b =>
      layoutBlock(b, {
        bit: settings.bit.diameter,
        missing: unresolved,
        sourceKey: boardGeometryKey(
          job,
          b.request.parts.map(p => p.partId)
        ),
      }) ?? []
  );
  const blocked = layoutProblems.length > 0;
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
  const programName = (p: PlanResult['programs'][number]) => {
    const repeated = result && result.programs.filter(program => program.tool === p.tool).length > 1;
    const number = repeated ? ` P${result!.programs.indexOf(p) + 1}` : '';
    return `${job.name} board ${current.board.name}${onSideB ? ' side B' : ''}${number}${result && result.programs.length > 1 ? ` T${p.tool}` : ''}.gcode`;
  };

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
    if (isManufacturingLocked()) return;
    if (!result || !safe) return;
    useCamMachine.getState().start(job.id);
    useCamMachine.getState().setActive(`${current.board.id}${onSideB ? ':b' : ''}:bit:0`);
    const first = result.programs[0];
    loadIntoMachineView({ ...result, gcode: first.gcode, bits: [first.diameter] }, programName(first));
    toMachineView(current.board.id);
  };
  // Without a bed (no machine connected, no size picked) the machine view can't show the program: pick one first.
  const toMachineView = (boardId?: string) =>
    void navigate(
      selectMachineBounds(useStore.getState())
        ? { to: '/visualize/2DView' }
        : { to: '/start', search: { for: 'cam', job: job.id, board: boardId } }
    );
  // All boards, in queue order, in the machine panel: place, align, zero, cut, swap bits, remove tabs.
  const takeToMachine = () => {
    if (!allReady) return;
    useCamMachine.getState().start(job.id);
    // Whatever was loaded before isn't part of this: the queue loads each program in its turn.
    clearMachineView();
    useStore.getState().setMachinePanelOpen(true);
    toMachineView();
  };
  const download = (p: PlanResult['programs'][number], setup = false) => {
    if (!safe) return;
    const text = setup ? p.setupSheet : p.gcode;
    if (text === undefined) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = setup ? programName(p).replace(/\.[^.]+$/, '.setup.md') : programName(p);
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

  // Settings here are the job's: a change plans cut boards again too, which no longer match what's cut.
  const cut = queue.filter(e => isCut(e.board));
  const bar = (
    <CamJobBar
      job={job}
      tools={
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
              <CutBadge board={e.board} />
            </button>
          ))}
        </div>
      }
      actions={
        <>
          <Hint
            text={`${queue.length} ${queue.length === 1 ? 'board' : 'boards'}, ${swaps} bit ${swaps === 1 ? 'swap' : 'swaps'}. Estimated automatic motion and dwell time using reference machine limits. Add setup, tool changes, and operator pauses; unknown initial and parking distances are excluded.`}>
            <span className="text-xs text-muted-foreground">
              {/* Only the time on a narrower window, for the bar to stay one row; the rest is in its hint there too. */}
              <span className="hidden min-[1680px]:inline">
                Job: {queue.length} {queue.length === 1 ? 'board' : 'boards'} · {swaps} bit {swaps === 1 ? 'swap' : 'swaps'} ·{' '}
              </span>
              ≈ {formatDuration(totalMin * 60)} <span className="hidden min-[1680px]:inline">automatic</span>
            </span>
          </Hint>
          <RehearsalButton job={job} boards={boards.map(b => freezeRehearsalBoard(b.board, b.nest))} ready={allReady} inBar />
          <BitChip value={settings} onChange={savePlan} onOpen={openSettings} />
          <DropdownMenu>
            <Hint text={`More actions for board ${current.board.name}: show it on the machine on its own, download its G-code.`}>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="size-8" aria-label="More actions">
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
              {result && (
                <ProgramDownloads
                  programs={result.programs}
                  disabled={!safe}
                  onDownload={(program, kind) => download(program, kind === 'setup')}
                />
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Hint
            wrap
            text={
              allReady
                ? 'Opens the machine view with every board in cutting order: place, align, zero and cut each one, with the bit swaps in between.'
                : 'Opens the machine view with every board in cutting order, once every board has toolpaths that pass the checks.'
            }>
            <Button size="sm" disabled={!allReady} onClick={takeToMachine}>
              <Factory /> Take the job to the machine
            </Button>
          </Hint>
        </>
      }
    />
  );
  return (
    <Shell bar={bar}>
      {layoutProblems.some(problem => problem.includes('earlier design')) && (
        <p role="alert" className="border-b border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          A board was cut from an earlier design. Start over on Boards with a new physical sheet before using the changed design.
        </p>
      )}
      {rehearsed && (
        <p role="status" className="border-b bg-primary/5 px-4 py-2 text-sm">
          Back in your saved project. Rehearsal progress was discarded; your cut history is unchanged.
        </p>
      )}
      {cut.length > 0 && (
        <p role="note" className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm">
          {cut.length === 1 ? `Board ${cut[0].board.name} is` : `Boards ${cut.map(e => e.board.name).join(', ')} are`} already cut at the
          machine. The bit, material and tab settings here are for the whole job: a change plans {cut.length === 1 ? 'it' : 'them'} again,
          and the new programs no longer match what’s cut. Start over in Boards for a new sheet.
        </p>
      )}
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
              onLeaveOut={() =>
                savePlan({ ...settings, leaveOut: [...new Set([...(settings.leaveOut ?? []), ...unresolved.map(m => m.id)])] })
              }
            />
          </>
        }
        status={
          current.error && !result ? (
            <p role="alert" className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3.5 text-[13px]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              Board {current.board.name} couldn’t be planned: {current.error.message}
            </p>
          ) : !current.request.parts.length ? (
            <p role="status" className="rounded-lg border bg-muted/30 p-4 text-sm">
              No executable parts on this board. Include excluded parts again or repair their placement on Boards.
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
          result &&
          sideA && (
            <>
              <Checks
                plan={result}
                board={sideA}
                checked={!empty && !blocked}
                releaseSafety={releaseSafety}
                partOf={instance => current.request.parts.find(p => p.id === instance)}
                canClearHole={partId =>
                  !current.stale &&
                  !current.fetching &&
                  !cutBoardWith(
                    boards.map(b => b.board),
                    instances,
                    partId
                  )
                }
                onClearHole={(partId, hole) => {
                  if (current.stale || current.fetching) return;
                  const part = model.data.parts.find(part => part.id === partId);
                  const key = part && holeChoiceKey(part, hole);
                  if (key !== undefined) savePlan(withHoleChoice(settings, partId, key, 'clear'));
                }}
              />
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
          ? `After side A: ${kFlipSteps[flip.registration]} Fasten it in the same spots on the wood. Don’t re-zero XY; zero Z on the spoilboard.`
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
const hasWarnings = (plan: PlanResult) => plan.warnings.length > 0 || (plan.timeline ?? []).some(e => !e.block);

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
            text={`The job goes ahead without ${missing.length === 1 ? 'this part' : 'these parts'}: ${missing.length === 1 ? 'it isn’t' : 'they aren’t'} cut. The exclusion stays until you choose Include again, even after fitting ${missing.length === 1 ? 'it' : 'them'} on Boards.`}>
            <Button size="sm" variant="ghost" onClick={onLeaveOut}>
              Leave {missing.length === 1 ? 'it' : 'them'} out
            </Button>
          </Hint>
        )}
      </div>
    </div>
  );
}

/**
 * `plan`: the side shown. `board`: its side A, which has what holds the parts, for both sides. `checked`: false while the
 * job is blocked by its layout (missing parts, nothing to cut): no "passed" for an incomplete job, nor for a blocked board.
 */
function Checks({
  plan,
  board,
  checked,
  releaseSafety,
  partOf,
  canClearHole,
  onClearHole,
}: {
  plan: PlanResult;
  board: PlanResult;
  checked: boolean;
  releaseSafety: string[];
  /** A body on the board. */
  partOf: (instance: string) => { partId: string; name: string } | undefined;
  /** Not with a copy of the part on a board already cut. */
  canClearHole: (partId: string) => boolean;
  /** Clear the middle of this hole, for every copy of the part. */
  onClearHole: (partId: string, hole: number) => void;
}) {
  // One line per hole, however many copies of its part are on the board.
  const looseHoles = [
    ...new Map(
      (board.holeMiddles ?? [])
        .filter(m => m.state === 'loose')
        .flatMap(m => {
          const part = m.part ? partOf(m.part) : undefined;
          return part ? [[`${part.partId}/${m.hole}`, { ...m, partId: part.partId, name: part.name }] as const] : [];
        })
    ).values(),
  ];
  const failed = [...plan.safety, ...releaseSafety];
  const skins = (plan.holding ?? []).filter(h => h.how === 'skin');
  const moves = 'no rapid moves in the stock, stays on the board, never deeper than the cut-through depth.';
  return (
    <div className="flex flex-col gap-1.5 text-[13px]">
      {loose(board).map(h => (
        <p key={h.part} className="flex gap-2 text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {h.part}: {h.anchored === 0 ? 'none' : `only ${h.anchored}`} of its {h.tabs.length} tabs would hold it, so it would come loose. On
          the Boards step, switch the board to a bottom skin, or give it more room.
        </p>
      ))}
      {(board.holdClash ?? []).length > 0 && (
        <p className="flex gap-2 text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {board.holdClash!.length === 1 ? 'A screw or clamp is' : `${board.holdClash!.length} screws or clamps are`} in the bit’s way or on
          a part (red on the board). On the Boards step, drag {board.holdClash!.length === 1 ? 'it' : 'them'} into the waste.
        </p>
      )}
      {(board.timeline ?? [])
        // A part whose tabs don't hold is already listed above.
        .filter(e => !(e.kind === 'loose' && loose(board).some(h => h.part === e.what)))
        .map(e => (
          <p
            key={`${e.kind}-${e.what}-${e.step}`}
            className={cn('flex gap-2', e.block ? 'text-destructive' : 'text-amber-700 dark:text-amber-400')}>
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {e.message}
          </p>
        ))}
      {skins.length > 0 && plan.taped && (
        <p className="text-muted-foreground">
          Every outline stops {plan.skin ?? 1} mm above the bottom, so the parts stay on the tape while the board is cut. The last program,
          “Cut the parts free”, cuts the skin for all parts together, smallest first.
        </p>
      )}
      {skins.length > 0 && !plan.taped && (
        <p className="text-muted-foreground">
          Every part keeps a {plan.skin ?? 1} mm bottom skin, so nothing comes loose while the board is cut. At the machine, the “Cut the
          parts free” step cuts {skins.length === 1 ? 'it' : 'them'} free one at a time.
        </p>
      )}
      {!checked ? null : failed.length > 0 ? (
        failed.map(s => (
          <p key={s} className="flex gap-2 text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {s}
          </p>
        ))
      ) : planBlock(board) ? null : (board.timeline ?? []).some(e => e.kind === 'loose') ? (
        // Parts cut loose as the user chose: only the moves passed.
        <p className="text-muted-foreground">The moves pass the safety checks, but nothing holds the parts: {moves}</p>
      ) : (
        <p className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="size-4" /> Safety checks passed: {moves}
        </p>
      )}
      {looseHoles.map(h => (
        <div key={`${h.partId}/${h.hole}`} className="flex gap-2 text-amber-700 dark:text-amber-400" data-loose-hole>
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col items-start gap-1">
            <p>
              {h.name}: the {+h.size.toFixed(0)} mm piece in a through hole comes loose on the last pass and can catch the bit. Tape it,
              screw it down, or clear it.
            </p>
            {canClearHole(h.partId) && (
              <Button size="sm" variant="outline" onClick={() => onClearHole(h.partId, h.hole)}>
                Clear it, about +{h.addMinutes.toFixed(1)} min
              </Button>
            )}
          </div>
        </div>
      ))}
      {[...new Set(plan.warnings.filter(w => !kLooseHoleWarning.test(w)).map(friendly))].map(w => (
        <p key={w} className="flex gap-2 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {w}
        </p>
      ))}
    </div>
  );
}

/** Listed on their own, with a way to clear the hole. */
const kLooseHoleWarning = /through hole \d+: .* comes loose on the last pass/;

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
      {bar ?? <PageHeader title="CAM (beta)" />}
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
