import { cn } from '@wbcnc/ui/lib/utils';
import { PageHeader } from '@/components/page-header';
import { CamPage } from '@/cam/CamPage';
import { NoPartsToMill } from '@/cam/NoPartsToMill';
import {
  autoFillFromStock,
  boardLabel,
  boardNameProblem,
  changesCutBoard,
  cutLabel,
  dropPart,
  flipOf,
  freezeSpacing,
  holdSettingsOf,
  holdVerdict,
  cutBoardWith,
  isCut,
  layoutSummary,
  nestBoard,
  newBoard,
  notAside,
  relayoutBoard,
  resizedBoard,
  respaceBoard,
  setAsidePart,
  stockTopOf,
  type BoardV1,
  type PartDrop,
  type PartInstance,
  type PartPosition,
} from '@/cam/boards';
import { BoardDrawings } from '@/cam/boards/BoardDrawings';
import { BoardInspector } from '@/cam/boards/BoardInspector';
import { HoldSizesDialog } from '@/cam/boards/HoldSizesDialog';
import { HoldTools } from '@/cam/boards/HoldTools';
import { useHoldEditing } from '@/cam/boards/useHoldEditing';
import type { PartMenuProps } from '@/cam/boards/PartMenu';
import { StockList } from '@/cam/boards/StockList';
import type { JobBoard } from '@/cam/useJobBoards';
import type { ModelImport, PlanResult } from '@/cam/camTypes';
import { useHoldHardware } from '@/cam/holdHardware';
import { BitChip } from '@/cam/plan/BitPicker';
import { camKeys, useBoardPlans, useCamJob, useCamModel, useSaveCamJob } from '@/cam/camQueries';
import type { CamJobV1 } from '@/cam/jobDb';
import { CamJobBar } from '@/cam/model/CamJobBar';
import { forgetCut } from '@/cam/machine/camMachine';
import { Hint } from '@/cam/Hint';
import { bitKey } from '@/cam/cuttingData';
import { kDefaultPlan, withHoleChoice } from '@/cam/planSettings';
import { useToolLibrary } from '@/cam/toolLibrary';
import { useJobBoards, useMachineArea } from '@/cam/useJobBoards';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useParams, useSearch } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import { z } from 'zod';
import { Button } from '@wbcnc/ui/components/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@wbcnc/ui/components/dropdown-menu';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { ChevronDown, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export const Route = createFileRoute('/cam/$jobId/boards')({
  component: BoardsStep,
  // The board to show first (from the machine's top view: "Layout in CAM").
  validateSearch: zodValidator(z.object({ board: z.string().optional() })),
});

/** Step 2: which parts go on which board, how they are nested and held down: the job, as far as it's there. */
function BoardsStep() {
  const { jobId } = useParams({ from: '/cam/$jobId/boards' });
  const { data: job, isPending } = useCamJob(jobId);
  const model = useCamModel(job);
  const save = useSaveCamJob(job);
  const { instances, boards, changed } = useJobBoards(job, model.data);
  // While a board is planned again (a part moved, Min # changed), its tabs stay drawn as they were, dimmed.
  const plans = useBoardPlans(
    job,
    boards.map(b => ({ request: b.request, material: b.board.material })),
    !!model.data,
    { keepShown: true }
  );
  const { board: boardParam } = useSearch({ from: '/cam/$jobId/boards' });

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
      origin={job.origin}
      step="Boards"
      actions={
        <>
          {instances.length > 0 && boards.length > 0 && (
            <p role="status" aria-label="Layout result" className="text-xs text-muted-foreground">
              {layoutSummary(boards)}
            </p>
          )}
          {/* The bit sets the margin and gap between parts: choose it before nesting. */}
          <BitChip
            value={job.plan ?? kDefaultPlan}
            onChange={plan => {
              // A cut board keeps its spacing: its parts are where they were cut.
              const was = (job.plan ?? kDefaultPlan).bit.diameter;
              const frozen = job.boards?.map(b => (isCut(b) ? freezeSpacing([b], was)[0] : b));
              save.mutate({ ...job, plan, ...(frozen && plan.bit.diameter !== was && { boards: frozen }) });
            }}
          />
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

  return (
    <Shell bar={bar}>
      <BoardsEditor
        job={job}
        parts={model.data.parts}
        instances={instances}
        boards={boards}
        plans={plans}
        firstBoard={boardParam}
        save={save.mutate}
      />
    </Shell>
  );
}

/** The boards of a job with parts to mill, on one table: the sidebar is about the board selected, or about all of them. */
function BoardsEditor({
  job,
  parts,
  instances,
  boards,
  plans,
  firstBoard,
  save,
}: {
  job: CamJobV1;
  parts: ModelImport['parts'];
  instances: PartInstance[];
  boards: JobBoard[];
  plans: { data?: PlanResult; isFetching: boolean }[];
  /** The board to show first, if any. */
  firstBoard?: string;
  save: (job: CamJobV1) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(firstBoard ?? null);
  // What the sidebar is about.
  const [panel, setPanel] = useState<'board' | 'all'>('board');
  const [holdSizes, setHoldSizes] = useState(false);
  const hardware = useHoldHardware(s => s.hardware);
  // The machine's work area, when it is set up: no board comes out bigger (stock cut down, fitted boards and borders).
  const machine = useMachineArea();
  // What just happened on the drawing, and the boards before each change, to go back to.
  // Everything this step has to say goes in its one status box, each message replacing the last.
  const [notice, setNotice] = useState<{ text: string; undo?: () => void }>({ text: '' });
  const note = notice.text;
  const setNote = (text: string, undo?: () => void) => setNotice({ text, undo });
  const history = useRef<BoardV1[][]>([]);
  const future = useRef<BoardV1[][]>([]);
  const plan = job.plan ?? kDefaultPlan;
  const selected = boards.find(b => b.board.id === selectedId) ?? boards[0];
  // A cut board stays as it was cut: a change to its layout or holds is refused, until "Start over".
  const saveBoards = (next: BoardV1[]) => {
    const byNewId = new Map(next.map(b => [b.id, b]));
    const cut = boards.find(b => changesCutBoard(b.board, byNewId.get(b.board.id)));
    if (cut) {
      setNote(
        `Board ${cut.board.name} is ${cutLabel(cut.board).toLowerCase()}: its parts and holds stay as they are. Start over to change them.`
      );
      return false;
    }
    history.current = [...history.current.slice(-49), boards.map(b => b.board)];
    future.current = [];
    save({ ...job, boards: next });
    return true;
  };
  const nestOptions = { stickout: plan.bit.stickout, hardware, machine };
  const startOver = (board: BoardV1) => {
    const { cut, ...rest } = board;
    void cut;
    save({ ...job, boards: boards.map(b => (b.board.id === board.id ? rest : b.board)) });
    forgetCut(job.id, board.id);
    setNote(
      `Board ${board.name} can be changed again. What was cut on it is forgotten: at the machine, all its programs are to cut again.`,
      () => {
        const latest = queryClient.getQueryData<CamJobV1>(camKeys.job(job.id)) ?? job;
        save({ ...latest, boards: (latest.boards ?? []).map(b => (b.id === board.id ? { ...b, cut } : b)) });
      }
    );
  };
  const updateBoard = (b: BoardV1) => saveBoards(boards.map(x => (x.board.id === b.id ? b : x.board)));
  const open = (id: string) => {
    setSelectedId(id);
    setPanel('board');
  };
  /** The selected board at this size, laid out for it. A fitted board with nothing on it is only its margins: one side set sets both. */
  const resizedTo = (w: number, h: number) => {
    const { board, nest } = selected;
    const empty = board.size.fit && !nest.placements.length;
    const size = empty && h === nest.board.h ? { w, h: w } : empty && w === nest.board.w ? { w: h, h } : { w, h };
    return resizedBoard(board, nest, size, instances, plan.bit.diameter, nestOptions);
  };
  /** A new size, however it's given: the board is laid out for it, and says what no longer fits. */
  const resize = (w: number, h: number) => {
    const before = boards.map(b => b.board);
    const next = resizedTo(w, h);
    if (!updateBoard(next)) return;
    const nested = nestBoard(next, instances, plan.bit.diameter, nestOptions);
    const off = nested.unplaced.filter(id => !next.setAside?.[id]).map(id => byId.get(id)?.name ?? id);
    setNote(
      `${boardLabel(next)} is fixed at ${nested.board.w} × ${nested.board.h} mm.${
        off.length ? ` ${off.join(', ')} ${off.length === 1 ? 'doesn’t' : 'don’t'} fit and moved off it.` : ''
      }`,
      undoTo(before)
    );
  };
  /** Changed where it's drawn or in its settings: the parts make room for what that takes. */
  const respaced = (next: BoardV1) => {
    const now = selected.nest.board;
    if (!next.size.fit && (next.size.w !== now.w || next.size.h !== now.h)) return resize(next.size.w, next.size.h);
    return updateBoard(respaceBoard(selected.board, next, instances, plan.bit.diameter, nestOptions));
  };
  const rename = (name: string) => {
    const problem = boardNameProblem(
      name,
      boards.map(b => b.board),
      selected.board.id
    );
    if (problem) setNote(problem);
    else updateBoard({ ...selected.board, name });
    return !problem;
  };
  const holds = useHoldEditing({
    boards,
    selectedId: selected.board.id,
    instances,
    bit: plan.bit.diameter,
    nestOptions,
    machine,
    onNote: setNote,
    active: true,
    onBoardEdit: (b, text) => {
      setNote(text);
      updateBoard(b);
    },
    onBoardsEdit: (next, text) => {
      setNote(text);
      saveBoards(next);
    },
  });
  const undo = history.current.length
    ? () => {
        const before = history.current.at(-1)!;
        history.current = history.current.slice(0, -1);
        future.current = [...future.current, boards.map(b => b.board)];
        setNote('Undone.');
        const latest = queryClient.getQueryData<CamJobV1>(camKeys.job(job.id)) ?? job;
        save({ ...latest, boards: before });
      }
    : undefined;
  const redo = future.current.length
    ? () => {
        const after = future.current.at(-1)!;
        future.current = future.current.slice(0, -1);
        history.current = [...history.current, boards.map(b => b.board)];
        setNote('Redone.');
        const latest = queryClient.getQueryData<CamJobV1>(camKeys.job(job.id)) ?? job;
        save({ ...latest, boards: after });
      }
    : undefined;
  const undoKeys = useRef({ undo, redo });
  undoKeys.current = { undo, redo };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      e.preventDefault();
      (k === 'y' || e.shiftKey ? undoKeys.current.redo : undoKeys.current.undo)?.();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  // A message goes once it's had time to be read; with a tool in hand it says what's under the pointer, so it stays.
  useEffect(() => {
    if (!note || holds.tool) return;
    const t = setTimeout(() => setNote(''), 6000 + 50 * note.length);
    return () => clearTimeout(t);
  }, [note, holds.tool]);
  const byId = new Map(instances.map(i => [i.id, i]));

  const move = (itemId: string, boardId: string) => {
    const target = boards.find(b => b.board.id === boardId)?.board;
    const inst = byId.get(itemId);
    if (!target || !inst) return false;
    if (+inst.thickness.toFixed(1) !== target.thickness) {
      setNote(`${inst.name} is ${+inst.thickness.toFixed(1)} mm thick, board ${target.name} is ${target.thickness} mm.`);
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

  // Dropped on the table: it stays on its board's list, off the board.
  const setAside = (itemId: string, at: PartPosition) => {
    const from = boards.find(b => b.board.items.includes(itemId))?.board;
    if (from && updateBoard(setAsidePart(from, itemId, at)))
      setNote(`${byId.get(itemId)?.name ?? itemId} is off the board and won’t be cut.`);
  };

  /** Every part off a board that isn't cut: onto a board of its thickness with room, or else a new one. */
  const placeOffBoard = () => {
    const bit = plan.bit.diameter;
    const before = boards.map(b => b.board);
    let next = before;
    // No spot it could take: the nest decides.
    const anywhere = { x: -1e6, y: -1e6, rotated: false };
    for (const { board, nest } of boards) {
      if (isCut(board)) continue;
      for (const id of nest.unplaced) {
        const home = notAside(next.find(b => b.id === board.id)!, id);
        const others = next.filter(b => b.id !== board.id && !isCut(b) && b.thickness === board.thickness);
        const drop = [home, ...others].map(t => dropPart(t, instances, bit, id, anywhere, 0, nestOptions)).find(d => d.at);
        const taker = drop?.board ?? {
          ...newBoard(next, board.thickness, board.material, [id]),
          ...holdSettingsOf(board),
          pinned: [id],
        };
        const gone = next.map(b => (b.id === taker.id ? taker : without(b, id)));
        next = gone.some(b => b.id === taker.id) ? gone : [...gone, taker];
      }
    }
    if (saveBoards(next)) setNote('Parts off the boards placed.', undoTo(before));
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
    saveBoards(boards.map(({ board }) => (board.pinned?.includes(itemId) ? { ...board, pinned: unpinned(board, itemId) } : board)));

  // The body on the target board as `dropPart` laid it out (positioned there, or in the nest), off every other board.
  const place = (itemId: string, target: BoardV1) =>
    saveBoards(boards.map(({ board }) => (board.id === target.id ? target : without(board, itemId))));

  // Dragged onto a board's drawing, or onto it in the rail (the board being edited stays open).
  const dropOn = (itemId: string, boardId: string, drop: PartDrop | null, fromRail?: boolean) => {
    const target = boards.find(b => b.board.id === boardId)?.board;
    const inst = byId.get(itemId);
    if (!target || !inst) return;
    if (+inst.thickness.toFixed(1) !== target.thickness) {
      setNote(`${inst.name} is ${+inst.thickness.toFixed(1)} mm thick, board ${target.name} is ${target.thickness} mm.`);
      return;
    }
    if (!drop) {
      setNote(`${inst.name} doesn’t fit on board ${target.name}.`);
      return;
    }
    place(itemId, drop.board);
    if (!fromRail) setSelectedId(boardId);
  };

  // Arrow keys: only to a free spot.
  const nudge = (itemId: string, boardId: string, at: PartPosition) => {
    const target = boards.find(b => b.board.id === boardId)?.board;
    if (!target) return;
    const drop = dropPart(target, instances, plan.bit.diameter, itemId, at, 0, nestOptions);
    if (drop.exact) place(itemId, drop.board);
  };

  // Auto-fill and re-layout replace the user's grouping: offer the way back. Undo restores the boards on the latest
  // job (the stock list may have changed since).
  const undoTo = (before: BoardV1[]) => () => {
    const latest = queryClient.getQueryData<CamJobV1>(camKeys.job(job.id)) ?? job;
    save({ ...latest, boards: before });
  };
  /** One board's parts nested afresh, around its fixtures: they stay on it, unpinned. */
  const relayout = (board: BoardV1) => {
    const before = boards.map(b => b.board);
    if (!saveBoards(before.map(b => (b.id === board.id ? relayoutBoard(b, instances, plan.bit.diameter, nestOptions) : b)))) return;
    setNote(`Board ${board.name} laid out again.`, undoTo(before));
  };
  /** Everything unpinned, then nested from scratch: from the stock list when there is one. */
  const relayoutAll = () => {
    const before = boards.map(b => b.board);
    const free = before.map(b => (isCut(b) ? b : relayoutBoard(b, instances, plan.bit.diameter, nestOptions)));
    if (!(job.stock ?? []).length) {
      saveBoards(free);
      return setNote('All boards laid out again.', undoTo(before));
    }
    autoFill(free, before);
  };
  const autoFill = (start = boards.map(b => b.board), before = start) => {
    const stock = job.stock ?? [];
    if (!stock.length) return setNote('Add the boards you have to the stock list first.');
    // Cut boards stay as they are, with their parts: the rest is filled around them.
    const kept = start.filter(isCut);
    const onKept = new Set(kept.flatMap(b => b.items));
    const res = autoFillFromStock(
      start.filter(b => !isCut(b)),
      instances.filter(i => !onKept.has(i.id)),
      stock,
      plan.bit.diameter,
      plan.material,
      job.nestObjective ?? 'boards',
      machine,
      kept.map(b => b.name)
    );
    res.boards = [...kept, ...res.boards];
    saveBoards(res.boards);
    const names = (ids: string[]) => ids.map(id => byId.get(id)?.name ?? id).join(', ');
    const problems = [
      res.tooBig.length && `${names(res.tooBig)}: too big for every stock board${machine ? ' and the machine' : ''}, even turned.`,
      res.short.length && `${names(res.short)}: not enough stock left, put on more boards of the stock's sizes.`,
    ].filter(Boolean);
    const stockBoards = res.boards.filter(b => !b.size.fit && stock.some(s => +s.thickness.toFixed(1) === b.thickness)).length;
    setNote(
      problems.length ? problems.join(' ') : `Parts placed on ${stockBoards} ${stockBoards === 1 ? 'board' : 'boards'} from stock.`,
      undoTo(before)
    );
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

  const planOf = (board: BoardV1) => plans[boards.findIndex(b => b.board.id === board.id)]?.data;
  /** A body's menu on the drawings: move it, unpin it. */
  const partMenu = ({ board }: JobBoard, id: string): PartMenuProps => {
    const name = byId.get(id)?.name ?? id;
    return {
      name,
      // Set aside: back onto its own board is a move too.
      targets: boards
        .filter(b => (b.board.id !== board.id || board.setAside?.[id]) && b.board.thickness === board.thickness)
        .map(b => b.board),
      onMoveTo: target => (target === 'new' ? toNewBoard(id) : void move(id, target)),
      pinned: !!board.pinned?.includes(id),
      onUnpin: () => unpin(id),
      onTabsReset: board.tabsAt?.[id]
        ? () => {
            const rest = { ...board.tabsAt };
            delete rest[id];
            updateBoard({ ...board, tabsAt: Object.keys(rest).length ? rest : undefined });
          }
        : undefined,
    };
  };
  // What needs attention: on any board for what's off them, else on the selected board.
  const sel = selected.board,
    selNest = selected.nest;
  const unplacedNames = boards.flatMap(b => b.nest.unplaced.map(id => byId.get(id)?.name ?? id));
  const cantHold = sel.retention === 'tabs' ? (planOf(sel)?.holding ?? []).filter(h => h.how === 'unheld').map(h => h.name) : [];
  const verdict = holdVerdict(sel, selNest, hardware, instances);
  const alerts = (
    <>
      {unplacedNames.length > 0 && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
          {`${unplacedNames.join(', ')} ${unplacedNames.length === 1 ? 'is' : 'are'} off the boards and won’t be cut.`}
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={placeOffBoard}>
            Place on boards
          </Button>
        </p>
      )}
      {selNest.nutAbove < 0 && (
        <p role="alert" className="text-xs text-destructive">
          {`The bit's stick-out (${selNest.stickout} mm) is shorter than the deepest cut (${+(stockTopOf(sel) + 0.3).toFixed(1)} mm): the collet nut would hit the board. Check it with the bit, or here:`}{' '}
          <button type="button" className="pointer-events-auto underline" onClick={() => setHoldSizes(true)}>
            Clamp and screw sizes…
          </button>
        </p>
      )}
      {cantHold.length > 0 && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
          {`${cantHold.join(', ')}: no edge where tabs would hold, so the job waits. Move ${cantHold.length === 1 ? 'it' : 'them'}, or`}
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={() => updateBoard(respaceBoard(sel, { ...sel, retention: 'skin' }, instances, plan.bit.diameter, nestOptions))}>
            Use a bottom skin
          </Button>
        </p>
      )}
    </>
  );

  const issue = verdict.tone === 'warn' || unplacedNames.length > 0 || selNest.nutAbove < 0 || cantHold.length > 0;

  const status = (
    <div
      aria-label={`${boardLabel(sel)} status`}
      className={cn(
        // Always this tall, empty or not: a message coming or going never rescales the drawing, and it covers none of it.
        'flex h-20 shrink-0 items-start gap-2 overflow-y-auto border-t bg-background px-4 py-1.5 pr-44 text-[13px]',
        issue && 'border-t-amber-500/70'
      )}>
      <div className="flex min-w-0 flex-col gap-1">
        {alerts}
        {note && (
          <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
            {note}
            {notice.undo && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  notice.undo!();
                  setNote('Undone.');
                }}>
                Undo that
              </Button>
            )}
          </p>
        )}
        {verdict.tone === 'warn' && (
          <p role="status" className="flex gap-2">
            <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-500" />
            {verdict.text}
          </p>
        )}
      </div>
      {note && (
        <button
          type="button"
          aria-label="Dismiss this message"
          className="mt-0.5 text-muted-foreground hover:text-foreground"
          onClick={() => setNote('')}>
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <div className="grid flex-1 grid-cols-1 md:min-h-0 md:grid-cols-[1fr_300px]">
      {/* A height of its own when stacked: the drawing scales to it, so it can't follow the drawing's content. */}
      <main className="flex h-[70dvh] min-h-[320px] min-w-0 flex-col bg-muted/30 md:h-auto">
        {isCut(sel) && (
          <div
            role="note"
            aria-label={`${boardLabel(sel)} is cut`}
            className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            <span className="font-medium">
              {boardLabel(sel)}: {cutLabel(sel).toLowerCase()}
            </span>
            <span className="text-muted-foreground">
              {sel.cut!.keys.length} {sel.cut!.keys.length === 1 ? 'program' : 'programs'} ran at the machine, since{' '}
              {new Date(sel.cut!.at).toLocaleString()}. Its parts and holds stay as they were cut.
            </span>
            <span className="grow" />
            <Hint text="Unlocks the board's layout and holds, and forgets what was cut: for a new sheet of the same parts.">
              <Button size="sm" variant="outline" onClick={() => startOver(sel)}>
                Start over
              </Button>
            </Hint>
          </div>
        )}
        <BoardDrawings
          holds={holds}
          status={status}
          onOpen={open}
          allShown={panel === 'all'}
          onAll={() => setPanel('all')}
          tools={<HoldTools holds={holds} onUndo={undo} onRedo={redo} />}
          onTabSize={(key, value) => holds.setTabSize(key, value, false)}
          onBoardChange={respaced}
          resizedTo={resizedTo}
          onResize={resize}
          onSetAside={setAside}
          startOnBoard={!!firstBoard}
          onHoldSizes={() => setHoldSizes(true)}
          nestOptions={nestOptions}
          machine={machine}
          onNote={setNote}
          onBoardEdit={(b, text) => {
            setNote(text);
            updateBoard(b);
          }}
          boards={boards}
          instances={instances}
          parts={parts}
          plans={plans.map(p => p.data)}
          fetching={plans.map(p => p.isFetching)}
          bit={plan.bit.diameter}
          onHoleChoice={(partId, hole, choice) => {
            const cut = cutBoardWith(
              boards.map(b => b.board),
              instances,
              partId
            );
            if (cut) setNote(`Not changed: a copy of this part is on ${boardLabel(cut)}, already cut. Start it over to change this hole.`);
            else save({ ...job, plan: withHoleChoice(plan, partId, hole, choice) });
          }}
          selectedId={selected.board.id}
          onSelect={setSelectedId}
          onDrop={dropOn}
          partMenu={partMenu}
          onNewBoard={toNewBoard}
          onNudge={nudge}
          onTabsMove={(id, item, tabs) => {
            const b = boards.find(x => x.board.id === id);
            if (b) updateBoard({ ...b.board, tabsAt: { ...b.board.tabsAt, [item]: tabs } });
          }}
        />
      </main>
      <aside className="flex min-h-0 flex-col border-l">
        <div className="flex min-h-0 flex-1 flex-col">
          {panel === 'board' ? (
            <BoardInspector
              board={sel}
              nest={selNest}
              stock={job.stock ?? []}
              onChange={respaced}
              onRelayout={() => relayout(sel)}
              // Its name is in its programs: renamed, they'd count as not cut yet at the machine.
              onRename={isCut(sel) ? undefined : rename}
              gap={selNest.placements.length < 2 ? { min: plan.bit.diameter } : undefined}
              verdict={verdict}
              holeMiddles={planOf(sel)?.holeMiddles}
              skin={plan.skin}
              onSkin={skin => save({ ...job, plan: { ...plan, skin } })}
              flip={sel.flip || instances.some(i => sel.items.includes(i.id) && i.needsFlip) ? flipOf(sel, instances) : undefined}
              onDelete={
                !sel.items.length && boards.some(b => b !== selected && b.board.thickness === sel.thickness)
                  ? () => saveBoards(boards.filter(b => b !== selected).map(b => b.board))
                  : undefined
              }
            />
          ) : (
            <LayoutPanel
              newBoardLabel={`New ${sel.thickness} mm board`}
              stock={job.stock ?? []}
              objective={job.nestObjective ?? 'boards'}
              onStock={stock => save({ ...job, stock })}
              onObjective={nestObjective => save({ ...job, nestObjective })}
              onAutoFill={() => autoFill()}
              onRelayoutAll={relayoutAll}
              onNewBoard={addBoard}
              onUndo={undo}
            />
          )}
        </div>
      </aside>
      <HoldSizesDialog
        open={holdSizes}
        onOpenChange={setHoldSizes}
        bit={plan.bit.diameter}
        stockTop={stockTopOf(sel)}
        nutAbove={selNest.nutAbove}
        stickout={selNest.stickout}
        onStickout={stickout => {
          // Kept with the bit: this job's copy and the library's, so the next job with it starts from it.
          const lib = useToolLibrary.getState();
          const own = lib.bits.find(b => bitKey(b) === bitKey(plan.bit));
          if (own) lib.updateBit(own.id, { stickout });
          save({ ...job, plan: { ...plan, bit: { ...plan.bit, stickout } } });
        }}
      />
    </div>
  );
}

/** What's about all the boards: what you have to cut them from, and nesting the parts onto them. */
function LayoutPanel({
  newBoardLabel,
  stock,
  objective,
  onStock,
  onObjective,
  onAutoFill,
  onRelayoutAll,
  onNewBoard,
  onUndo,
}: {
  newBoardLabel: string;
  stock: CamJobV1['stock'] & {};
  objective: (typeof kObjectives)[number][0];
  onStock: (stock: CamJobV1['stock'] & {}) => void;
  onObjective: (objective: (typeof kObjectives)[number][0]) => void;
  onAutoFill: () => void;
  onRelayoutAll: () => void;
  onNewBoard: () => void;
  onUndo?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
      <h2 className="text-[15px] font-semibold">All boards</h2>
      <StockList stock={stock} onChange={onStock} />
      <section aria-label="Auto-fill" className="flex flex-col gap-2">
        <div className="flex">
          <Hint text="Puts the parts on boards from your stock list. Parts you moved by hand stay where they are.">
            <Button size="sm" variant="outline" className="flex-1 rounded-r-none" onClick={onAutoFill}>
              Auto-fill from stock
            </Button>
          </Hint>
          <DropdownMenu modal={false}>
            <Hint text="More layout actions: re-lay out everything from scratch.">
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="rounded-l-none border-l-0 px-1.5" aria-label="More layout actions">
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onRelayoutAll}>Re-lay out everything (unpin all)</DropdownMenuItem>
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
          className="flex self-start rounded-md border p-0.5 text-xs">
          {kObjectives.map(([value, label, hint]) => (
            <Hint key={value} text={hint}>
              <button
                aria-pressed={objective === value}
                onClick={() => onObjective(value)}
                className={cn(
                  'rounded px-2 py-1',
                  objective === value ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60'
                )}>
                {label}
              </button>
            </Hint>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Rectangle nesting for now. True-shape nesting is planned.</p>
      </section>
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" onClick={onNewBoard}>
          <Plus /> {newBoardLabel}
        </Button>
        <Button size="sm" variant="outline" disabled={!onUndo} onClick={onUndo}>
          Undo
        </Button>
      </div>
    </div>
  );
}

/** Auto-fill's objective: value, label, what it costs. */
const kObjectives = [
  ['boards', 'Fewest boards', 'Fewer setups at the machine, may waste a bit more wood.'],
  ['wood', 'Least wood', 'Least board area, may need more boards.'],
] as const;

const unpinned = (board: BoardV1, itemId: string) => (board.pinned ?? []).filter(i => i !== itemId);
/** The board's layout without this body. */
const unpositioned = (board: BoardV1, itemId: string) =>
  board.layout && { layout: { ...board.layout, at: Object.fromEntries(Object.entries(board.layout.at).filter(([id]) => id !== itemId)) } };
/** The board without this body (nor its pin and spot). */
const without = (board: BoardV1, itemId: string): BoardV1 => ({
  ...notAside(board, itemId),
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
