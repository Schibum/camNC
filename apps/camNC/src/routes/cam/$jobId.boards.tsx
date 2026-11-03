import { PageHeader } from '@/components/page-header';
import { autoFillFromStock, newBoard, type BoardV1 } from '@/cam/boards';
import { BoardInspector } from '@/cam/boards/BoardInspector';
import { BoardList } from '@/cam/boards/BoardList';
import { NestView } from '@/cam/boards/NestView';
import { useBoardPlans, useCamJob, useCamModel, useSaveCamJob } from '@/cam/camQueries';
import { CamJobBar } from '@/cam/model/CamJobBar';
import { kDefaultPlan } from '@/cam/planSettings';
import { useJobBoards } from '@/cam/useJobBoards';
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { toast } from '@wbcnc/ui/components/sonner';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/cam/$jobId/boards')({
  component: BoardsStep,
});

/** Step 2: which parts go on which board, how they are nested and held down. */
function BoardsStep() {
  const { jobId } = useParams({ from: '/cam/$jobId/boards' });
  const { data: job, isPending } = useCamJob(jobId);
  const model = useCamModel(job);
  const save = useSaveCamJob();
  const { instances, boards, changed } = useJobBoards(job, model.data);
  const plans = useBoardPlans(
    job,
    boards.map(b => ({ request: b.request, material: b.board.material })),
    !!model.data
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
        <Button size="sm" asChild>
          <Link to="/cam/$jobId/plan" params={{ jobId: job.id }}>
            Next: Plan
          </Link>
        </Button>
      }
    />
  );
  if (model.isError) return <Shell bar={bar} message={`Could not read ${job.fileName}: ${model.error.message}`} />;
  if (!model.data) return <Shell bar={bar} loading={`Reading ${job.fileName}…`} />;
  if (!boards.length) return <Shell bar={bar} message="No part to mill: mark parts as milled in the Model step." />;

  const plan = job.plan ?? kDefaultPlan;
  const selected = boards.find(b => b.board.id === selectedId) ?? boards[0];
  const selectedIndex = boards.indexOf(selected);
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
    saveBoards(
      boards.map(({ board }) =>
        board.id === boardId
          ? { ...board, items: [...board.items.filter(i => i !== itemId), itemId] }
          : { ...board, items: board.items.filter(i => i !== itemId) }
      )
    );
    setSelectedId(boardId);
    return true;
  };

  const autoFill = () => {
    const stock = job.stock ?? [];
    if (!stock.length) return toast.error('Add the boards you have to the stock list first.');
    const res = autoFillFromStock(
      boards.map(b => b.board),
      instances,
      stock,
      plan.bit.diameter,
      plan.material
    );
    saveBoards(res.boards);
    if (res.tooBig.length) toast.warning(`${res.tooBig.map(id => byId.get(id)?.name).join(', ')}: bigger than every stock board.`);
    else toast.success(`${res.boards.length} boards from stock`);
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

  const selectedPlan = plans[selectedIndex]?.data;
  const tabHeight =
    selected.board.holdDown === 'tabs' || selected.board.holdDown === 'tabs-guided' ? selected.board.tabs.height : undefined;
  const partArea = selected.nest.placements.length ? `Yield ${Math.round(selected.nest.yield * 100)} %` : '';

  return (
    <Shell bar={bar}>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[320px_1fr_300px]">
        <BoardList
          boards={boards}
          instances={instances}
          plans={plans.map(p => p.data)}
          selectedId={selected.board.id}
          onSelect={setSelectedId}
          onMove={move}
          stock={job.stock ?? []}
          onStockChange={stock => save.mutate({ ...job, stock })}
        />
        <main className="flex min-h-[320px] min-w-0 flex-col bg-muted/30">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <span className="font-medium">Board {selected.board.name} · nest</span>
            <Button size="sm" variant="outline" onClick={addBoard}>
              <Plus /> New {selected.board.thickness} mm board
            </Button>
            <Button size="sm" variant="outline" onClick={autoFill}>
              Auto-fill from stock
            </Button>
            <span className="grow" />
            <span className="text-xs text-muted-foreground">Rectangle nesting for now. True-shape nesting is planned.</span>
          </div>
          <div className="relative min-h-0 flex-1 p-4">
            <NestView
              nest={selected.nest}
              instances={instances}
              parts={model.data.parts}
              plan={selectedPlan}
              tabHeight={tabHeight}
              className="size-full"
            />
            {plans[selectedIndex]?.isFetching && (
              <span className="absolute right-4 top-4 flex items-center gap-2 text-xs text-muted-foreground">
                <LoadingSpinner className="size-3" /> Computing toolpaths
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-5 border-t px-4 py-2.5 text-xs text-muted-foreground">
            <span>
              <span className="text-violet-400">■</span> part outline
            </span>
            <span>
              <span className="text-violet-600">■</span> pocket
            </span>
            {tabHeight !== undefined && (
              <span>
                <span className="text-amber-500">■</span> tab
              </span>
            )}
            {selected.nest.keepOuts.length > 0 && (
              <span>
                <span className="text-red-500">■</span> clamp keep-out
              </span>
            )}
            <span className="grow" />
            <span>gap {selected.nest.gap} mm = bit + 4</span>
            <span>{partArea}</span>
          </div>
        </main>
        <BoardInspector
          board={selected.board}
          nest={selected.nest}
          stock={job.stock ?? []}
          bit={plan.bit.diameter}
          onChange={updateBoard}
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
