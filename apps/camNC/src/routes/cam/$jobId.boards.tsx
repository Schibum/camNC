import { cn } from '@wbcnc/ui/lib/utils';
import { PageHeader } from '@/components/page-header';
import { CamPage } from '@/cam/CamPage';
import { NoPartsToMill } from '@/cam/NoPartsToMill';
import {
  autoFillFromStock,
  dropPart,
  flipOf,
  holdLabel,
  holdSettingsOf,
  layoutSummary,
  newBoard,
  relayoutBoard,
  type BoardV1,
  type PartDrop,
  type PartPosition,
} from '@/cam/boards';
import { BoardDrawings } from '@/cam/boards/BoardDrawings';
import { BoardInspector } from '@/cam/boards/BoardInspector';
import { BoardList } from '@/cam/boards/BoardList';
import { BitChip } from '@/cam/plan/BitPicker';
import { camKeys, useBoardPlans, useCamJob, useCamModel, useSaveCamJob } from '@/cam/camQueries';
import type { CamJobV1 } from '@/cam/jobDb';
import { CamJobBar } from '@/cam/model/CamJobBar';
import { Hint } from '@/cam/Hint';
import { kDefaultPlan } from '@/cam/planSettings';
import { useJobBoards } from '@/cam/useJobBoards';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@wbcnc/ui/components/dropdown-menu';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { toast } from '@wbcnc/ui/components/sonner';
import { ChevronDown, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/cam/$jobId/boards')({
  component: BoardsStep,
});

/** Step 2: which parts go on which board, how they are nested and held down. */
function BoardsStep() {
  const { jobId } = useParams({ from: '/cam/$jobId/boards' });
  const { data: job, isPending } = useCamJob(jobId);
  const model = useCamModel(job);
  const save = useSaveCamJob(job);
  const queryClient = useQueryClient();
  const { instances, boards, changed } = useJobBoards(job, model.data);
  // While a board is planned again (a part moved, Min # changed), its tabs stay drawn as they were, dimmed.
  const plans = useBoardPlans(
    job,
    boards.map(b => ({ request: b.request, material: b.board.material })),
    !!model.data,
    { keepShown: true }
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Persist the derived boards once (first visit, or parts changed in the Model step).
  useEffect(() => {
    if (job && changed) save.mutate({ ...job, boards: boards.map(b => b.board) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, changed]);

  if (isPending) return <Shell />;
  if (!job) return <Shell message="This job doesn't exist (any more)." />;
  const bar = (
    <CamJobBar
      jobId={job.id}
      fileName={job.fileName}
      step="Boards"
      actions={
        <>
          {/* The bit sets the margin and gap between parts: choose it before nesting. */}
          <BitChip value={job.plan ?? kDefaultPlan} onChange={plan => save.mutate({ ...job, plan })} />
          {model.data && !instances.length ? (
            <Hint text="No part is milled: tick parts in the Model step to plan their toolpaths." wrap>
              <Button size="sm" disabled>
                Next: Plan
              </Button>
            </Hint>
          ) : (
            <Button size="sm" asChild>
              <Link to="/cam/$jobId/plan" params={{ jobId: job.id }}>
                Next: Plan
              </Link>
            </Button>
          )}
        </>
      }
    />
  );
  if (model.isError) return <Shell bar={bar} message={model.error.message} />;
  if (!model.data) return <Shell bar={bar} loading={`Reading ${job.fileName}…`} />;
  // Every part unticked in the Model step: boards may be left over, but nothing goes on them.
  if (!boards.length || !instances.length)
    return (
      <Shell bar={bar}>
        <NoPartsToMill jobId={job.id} />
      </Shell>
    );

  const plan = job.plan ?? kDefaultPlan;
  const selected = boards.find(b => b.board.id === selectedId) ?? boards[0];
  const saveBoards = (next: BoardV1[]) => save.mutate({ ...job, boards: next });
  const updateBoard = (b: BoardV1) => saveBoards(boards.map(x => (x.board.id === b.id ? b : x.board)));
  const byId = new Map(instances.map(i => [i.id, i]));

  const move = (itemId: string, boardId: string) => {
    const target = boards.find(b => b.board.id === boardId)?.board;
    const inst = byId.get(itemId);
    if (!target || !inst) return false;
    if (+inst.thickness.toFixed(1) !== target.thickness) {
      toast.error(`${inst.name} is ${+inst.thickness.toFixed(1)} mm thick, board ${target.name} is ${target.thickness} mm.`);
      return false;
    }
    // Moved by hand: pinned to the target board, so auto-fill leaves it there.
    saveBoards(
      boards.map(({ board }) =>
        board.id === boardId
          ? {
              ...without(board, itemId),
              items: [...board.items.filter(i => i !== itemId), itemId],
              pinned: [...unpinned(board, itemId), itemId],
            }
          : without(board, itemId)
      )
    );
    setSelectedId(boardId);
    return true;
  };

  // One board per thickness to start with: a new board, with the body on it.
  const toNewBoard = (itemId: string) => {
    const inst = byId.get(itemId);
    const from = boards.find(b => b.board.items.includes(itemId))?.board;
    if (!inst || !from) return;
    const b = newBoard(
      boards.map(x => x.board),
      inst.thickness,
      from.material,
      [itemId]
    );
    saveBoards([...boards.map(({ board }) => without(board, itemId)), { ...b, ...holdSettingsOf(from), pinned: [itemId] }]);
    setSelectedId(b.id);
  };

  const unpin = (itemId: string) =>
    saveBoards(
      boards.map(({ board }) =>
        board.pinned?.includes(itemId) ? { ...board, pinned: unpinned(board, itemId), ...unpositioned(board, itemId) } : board
      )
    );

  // The body on the target board as `dropPart` laid it out (positioned there, or in the nest), off every other board.
  const place = (itemId: string, target: BoardV1) =>
    saveBoards(boards.map(({ board }) => (board.id === target.id ? target : without(board, itemId))));

  // Dragged onto a board drawing.
  const dropOn = (itemId: string, boardId: string, drop: PartDrop | null) => {
    const target = boards.find(b => b.board.id === boardId)?.board;
    const inst = byId.get(itemId);
    if (!target || !inst) return;
    if (+inst.thickness.toFixed(1) !== target.thickness) {
      toast.error(`${inst.name} is ${+inst.thickness.toFixed(1)} mm thick, board ${target.name} is ${target.thickness} mm.`);
      return;
    }
    if (!drop) {
      toast.error(`${inst.name} doesn’t fit on board ${target.name}.`);
      return;
    }
    place(itemId, drop.board);
    setSelectedId(boardId);
  };

  // Arrow keys: only to a free spot.
  const nudge = (itemId: string, boardId: string, at: PartPosition) => {
    const target = boards.find(b => b.board.id === boardId)?.board;
    if (!target) return;
    const drop = dropPart(target, instances, plan.bit.diameter, itemId, at);
    if (drop.exact) place(itemId, drop.board);
  };

  // Auto-fill and re-layout replace the user's grouping: offer the way back. Undo restores the boards on the latest
  // job (the stock list may have changed since).
  const undoTo = (before: BoardV1[]) => ({
    label: 'Undo',
    onClick: () => {
      const latest = queryClient.getQueryData<CamJobV1>(camKeys.job(job.id)) ?? job;
      save.mutate({ ...latest, boards: before });
    },
  });
  /** One board's parts nested afresh: they stay on it, unpinned. */
  const relayout = (board: BoardV1) => {
    const before = boards.map(b => b.board);
    saveBoards(before.map(b => (b.id === board.id ? relayoutBoard(b) : b)));
    toast.success(`Board ${board.name} laid out again`, { action: undoTo(before), duration: 10_000 });
  };
  /** Everything unpinned, then nested from scratch: from the stock list when there is one. */
  const relayoutAll = () => {
    const before = boards.map(b => b.board);
    const free = before.map(relayoutBoard);
    if (!(job.stock ?? []).length) {
      saveBoards(free);
      return toast.success('All boards laid out again', { action: undoTo(before), duration: 10_000 });
    }
    autoFill(free, before);
  };
  const autoFill = (start = boards.map(b => b.board), before = start) => {
    const stock = job.stock ?? [];
    if (!stock.length) return toast.error('Add the boards you have to the stock list first.');
    const res = autoFillFromStock(start, instances, stock, plan.bit.diameter, plan.material, job.nestObjective ?? 'boards');
    saveBoards(res.boards);
    const names = (ids: string[]) => ids.map(id => byId.get(id)?.name ?? id).join(', ');
    const problems = [
      res.tooBig.length && `${names(res.tooBig)}: bigger than every stock board.`,
      res.short.length && `${names(res.short)}: not enough stock left.`,
    ].filter(Boolean);
    const stockBoards = res.boards.filter(b => !b.size.fit && stock.some(s => +s.thickness.toFixed(1) === b.thickness)).length;
    const action = undoTo(before);
    if (problems.length) toast.warning(problems.join(' '), { action, duration: 10_000 });
    else toast.success(`Parts placed on ${stockBoards} ${stockBoards === 1 ? 'board' : 'boards'} from stock`, { action, duration: 10_000 });
  };

  const addBoard = () => {
    const b = newBoard(
      boards.map(x => x.board),
      selected.board.thickness,
      selected.board.material
    );
    saveBoards([...boards.map(x => x.board), b]);
    setSelectedId(b.id);
  };

  const tabs = boards.some(b => b.board.holdDown === 'tabs' || b.board.holdDown === 'tabs-guided');
  const partArea = selected.nest.placements.length ? `Yield ${Math.round(selected.nest.yield * 100)} %` : '';

  return (
    <Shell bar={bar}>
      <div className="grid flex-1 grid-cols-1 md:min-h-0 md:grid-cols-[320px_1fr_300px]">
        <BoardList
          boards={boards}
          instances={instances}
          plans={plans.map(p => p.data)}
          selectedId={selected.board.id}
          onSelect={setSelectedId}
          onMove={move}
          onNewBoard={toNewBoard}
          onUnpin={unpin}
          onTabFallback={(itemId, f) =>
            saveBoards(
              boards.map(({ board }) => {
                if (!board.items.includes(itemId)) return board;
                const own = { ...board.tabFallbacks };
                if (f) own[itemId] = f;
                else delete own[itemId];
                return { ...board, tabFallbacks: own };
              })
            )
          }
          onBoardChange={updateBoard}
          stock={job.stock ?? []}
          onStockChange={stock => save.mutate({ ...job, stock })}
        />
        <main className="flex min-h-[320px] min-w-0 flex-col bg-muted/30">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <span className="font-medium">Nest</span>
            <Button size="sm" variant="outline" onClick={addBoard}>
              <Plus /> New {selected.board.thickness} mm board
            </Button>
            <div className="flex">
              <Hint text="Puts the parts on boards from your stock list. Parts you moved by hand stay where they are.">
                <Button size="sm" variant="outline" className="rounded-r-none" onClick={() => autoFill()}>
                  Auto-fill from stock
                </Button>
              </Hint>
              <DropdownMenu>
                <Hint text="More layout actions: re-lay out everything from scratch.">
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="rounded-l-none border-l-0 px-1.5" aria-label="More layout actions">
                      <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                </Hint>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={relayoutAll}>Re-lay out everything (unpin all)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <span id="nest-objective-label" className="text-xs text-muted-foreground">
              Auto-fill prefers:
            </span>
            <div
              role="group"
              aria-label="Auto-fill optimizes for"
              aria-describedby="nest-objective-label"
              className="flex rounded-md border p-0.5 text-xs">
              {kObjectives.map(([value, label, hint]) => (
                <Hint key={value} text={hint}>
                  <button
                    aria-pressed={(job.nestObjective ?? 'boards') === value}
                    onClick={() => save.mutate({ ...job, nestObjective: value })}
                    className={cn(
                      'rounded px-2 py-1',
                      (job.nestObjective ?? 'boards') === value ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60'
                    )}>
                    {label}
                  </button>
                </Hint>
              ))}
            </div>
            <span className="grow" />
            <span className="text-xs text-muted-foreground">Rectangle nesting for now. True-shape nesting is planned.</span>
          </div>
          <p role="status" aria-label="Layout result" className="-mt-1.5 px-4 pb-2 text-xs text-muted-foreground">
            {layoutSummary(boards)}
          </p>
          <BoardDrawings
            boards={boards}
            instances={instances}
            parts={model.data.parts}
            plans={plans.map(p => p.data)}
            fetching={plans.map(p => p.isFetching)}
            bit={plan.bit.diameter}
            selectedId={selected.board.id}
            onSelect={setSelectedId}
            onDrop={dropOn}
            onMove={move}
            onNewBoard={toNewBoard}
            onNudge={nudge}
            onHoldsMove={(id, holdPoints) => {
              const b = boards.find(x => x.board.id === id);
              if (b) updateBoard({ ...b.board, holdPoints, holdPointsOn: { w: b.nest.board.w, h: b.nest.board.h } });
            }}
          />
          <div className="flex flex-wrap gap-5 border-t px-4 py-2.5 text-xs text-muted-foreground">
            <span>
              <span className="text-violet-500 dark:text-violet-400">■</span> part outline
            </span>
            <span>
              <span className="text-violet-600 dark:text-violet-500">■</span> pocket
            </span>
            {tabs && (
              <span>
                <span className="text-amber-600 dark:text-amber-500">■</span> tab
              </span>
            )}
            {boards.some(b => b.nest.holds.length > 0) && (
              <span>
                <span className="text-foreground">⊕</span> screw or clamp (drag to move)
              </span>
            )}
            <span className="grow" />
            <Hint text="Edge margin: free border inside the board edge. Gap: space between parts, so their outline cuts never meet. Change them in the board settings on the right.">
              <span tabIndex={0}>
                Board {selected.board.name}: edge margin {selected.nest.margin} mm · gap {selected.nest.gap} mm
              </span>
            </Hint>
            {partArea && (
              <Hint text="Share of this board covered by parts. The rest is offcut.">
                <span tabIndex={0}>{partArea}</span>
              </Hint>
            )}
          </div>
        </main>
        <BoardInspector
          board={selected.board}
          nest={selected.nest}
          stock={job.stock ?? []}
          bit={plan.bit.diameter}
          onChange={updateBoard}
          onRelayout={() => relayout(selected.board)}
          tabHold={{ fallback: plan.tabFallback, skin: plan.skin }}
          onTabHold={h => save.mutate({ ...job, plan: { ...plan, tabFallback: h.fallback, skin: h.skin } })}
          onHoldDownAll={
            boards.some(b => holdLabel(b.board) !== holdLabel(selected.board))
              ? () => saveBoards(boards.map(({ board }) => ({ ...board, ...holdSettingsOf(selected.board) })))
              : undefined
          }
          flip={
            selected.board.flip || instances.some(i => selected.board.items.includes(i.id) && i.needsFlip)
              ? flipOf(selected.board, instances)
              : undefined
          }
          onDelete={
            !selected.board.items.length && boards.some(b => b !== selected && b.board.thickness === selected.board.thickness)
              ? () => saveBoards(boards.filter(b => b !== selected).map(b => b.board))
              : undefined
          }
        />
      </div>
    </Shell>
  );
}

/** Auto-fill's objective: value, label, what it costs. */
const kObjectives = [
  ['boards', 'Fewest boards', 'Fewer setups at the machine, may waste a bit more wood.'],
  ['wood', 'Least wood', 'Least sheet area, may need more boards.'],
] as const;

const unpinned = (board: BoardV1, itemId: string) => (board.pinned ?? []).filter(i => i !== itemId);
/** The board's positions without this body's (when it has positions). */
const unpositioned = (board: BoardV1, itemId: string) =>
  board.positions && { positions: Object.fromEntries(Object.entries(board.positions).filter(([id]) => id !== itemId)) };
/** The board without this body (nor its pin and position). */
const without = (board: BoardV1, itemId: string): BoardV1 => ({
  ...board,
  items: board.items.filter(i => i !== itemId),
  ...(board.pinned && { pinned: unpinned(board, itemId) }),
  ...unpositioned(board, itemId),
});

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
