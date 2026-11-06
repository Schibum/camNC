import type { HoldKind } from '@wbcnc/cam/holdPoints';
import { edgeBands, reserved, type Fixture } from '@wbcnc/cam/settle';
import { useEffect, useState } from 'react';
import {
  fixtureAt,
  holdsSurroundWork,
  isCut,
  layoutChange,
  nestBoard,
  nudgeFixtures,
  settleBoard,
  settleInputOf,
  suggestFixtures,
  type BoardNest,
  type BoardV1,
  type NestOptions,
  type PartInstance,
} from '../boards';
import { kDefaultHardware } from '../holdHardware';
import type { JobBoard } from '../useJobBoards';

/** A fixture being placed or dragged, with its board as it would then be. */
export interface HoldEdit {
  board: string;
  i: number | null;
  fixtures: Fixture[];
  nest: BoardNest;
  settled: BoardV1 | null;
  key: string;
}

export type HoldEditing = ReturnType<typeof useHoldEditing>;

/** Placing fixtures: the tool in hand, what's previewed under the pointer or being dragged, the one selected, and the buttons' actions. */
export function useHoldEditing({
  boards,
  selectedId,
  instances,
  bit,
  nestOptions,
  machine,
  onBoardEdit,
  onNote,
}: {
  boards: JobBoard[];
  selectedId: string;
  instances: PartInstance[];
  bit: number;
  nestOptions: NestOptions;
  /** The machine's work area, when it is set up: Suggest holds grows no board past it. */
  machine?: { w: number; h: number };
  onBoardEdit: (board: BoardV1, note: string) => void;
  onNote: (note: string) => void;
}) {
  const [tool, setTool] = useState<HoldKind | null>(null);
  const [edit, setEdit] = useState<HoldEdit | null>(null);
  const [selectedHold, setSelectedHold] = useState<{ board: string; i: number } | null>(null);
  const selectedBoard = boards.find(b => b.board.id === selectedId);
  const canPlace = !!selectedBoard && !isCut(selectedBoard.board);
  const holdCount = selectedBoard?.board.fixtures?.length ?? 0;
  // Esc puts the tool down.
  useEffect(() => {
    if (!tool) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setTool(null);
      setEdit(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [tool]);

  // Nothing to place on a cut board: the tool can't stay in hand with its buttons off.
  useEffect(() => {
    if (!canPlace) {
      setTool(null);
      setEdit(null);
    }
  }, [canPlace]);

  /** The fixture at a point: previewed on its board with the parts moved aside for it, or refused. */
  const preview = ({ board, nest }: JobBoard, kind: HoldKind, p: { x: number; y: number }, i: number | null) => {
    const f = fixtureAt(kind, p, board, nest, instances, bit, { ...nestOptions, exact: i !== null });
    const key = `${board.id}:${i}:${JSON.stringify(f)}`;
    if (edit?.key === key) return;
    const current = board.fixtures ?? [];
    const fixtures = i === null ? [...current, f] : current.map((x, j) => (j === i ? f : x));
    const settled = settleBoard(board, instances, bit, fixtures, { ...nestOptions, budget: 80 });
    const shown = nestBoard(settled ?? { ...board, fixtures }, instances, bit, nestOptions);
    setEdit({ board: board.id, i, fixtures, nest: shown, settled, key });
    const input = settleInputOf(board, nest, instances, bit, nestOptions).input;
    onNote(
      settled
        ? layoutChange(nest, shown, instances)
        : reserved(f, input)
          ? 'That spot is kept clear: the XY zero corner is where you probe.'
          : `No room here on a ${nest.board.w} × ${nest.board.h} board. Slide along the edge, or use a bigger board.`
    );
  };
  /** Keep what's previewed: looked at harder than while the pointer was moving. */
  const commit = ({ board, nest }: JobBoard) => {
    const e = edit;
    setEdit(null);
    if (!e || e.board !== board.id) return;
    const settled = settleBoard(board, instances, bit, e.fixtures, nestOptions) ?? e.settled;
    if (!settled) return;
    onBoardEdit(settled, layoutChange(nest, nestBoard(settled, instances, bit, nestOptions), instances));
  };
  const suggest = () => {
    if (!selectedBoard) return;
    const { board, nest } = selectedBoard;
    const before = board.fixtures?.length ?? 0;
    const next = suggestFixtures(board, instances, bit, { ...nestOptions, machine });
    const added = (next.fixtures?.length ?? 0) - before;
    const shown = nestBoard(next, instances, bit, nestOptions);
    const grew = (shown.board.w - nest.board.w) / 2;
    const around = holdsSurroundWork(next.fixtures ?? [], shown, nestOptions.hardware ?? kDefaultHardware, instances);
    setTool(null);
    if (!added) {
      onNote(
        !before
          ? 'No clamp spot has room on this layout. Try a bigger board, tape or screws.'
          : around
            ? 'These holds already surround the work’s middle, so there’s nothing to add.'
            : 'These holds don’t surround the work’s middle, and no clamp spot here would fix that. Try a bigger board, tape or screws.'
      );
      return;
    }
    const clamps = `${added} clamp${added > 1 ? 's' : ''}`;
    const short = around
      ? ''
      : ' They don’t surround the work’s middle, so they aren’t enough on their own: try a bigger board, tape or screws.';
    onBoardEdit(
      next,
      grew > 0
        ? `No edge had room, so the board grew ${grew} mm on each side, to ${shown.board.w} × ${shown.board.h}. Suggested ${clamps}.${short} Parts and holds moved with it. Drag or remove any of them.`
        : `Suggested ${clamps}.${short} ${layoutChange(nest, shown, instances)} Drag or remove any of them.`
    );
  };
  /** Exactly one clamp more or fewer than the board has; everything else stays. */
  const nudgeHolds = (more: boolean) => {
    if (!selectedBoard) return;
    const { board } = selectedBoard;
    const next = nudgeFixtures(board, instances, bit, more, nestOptions);
    setTool(null);
    if ((next.fixtures?.length ?? 0) === (board.fixtures?.length ?? 0)) {
      onNote(
        more
          ? 'No clear spot for another clamp: none left with room to slide, a quarter of the work from the next on its edge.'
          : 'Taking any clamp away would leave the work not surrounded, so they all stay.'
      );
      return;
    }
    setSelectedHold(null);
    onBoardEdit(next, `One clamp ${more ? 'more' : 'fewer'}. Everything else stays where it is.`);
  };
  // Where clamps fit on the selected board, once its layout has settled: a moment's work, so not on every render.
  const [bands, setBands] = useState<ReturnType<typeof edgeBands> | undefined>();
  const bandsKey =
    tool === 'clamp' && selectedBoard
      ? JSON.stringify([selectedBoard.nest.board, selectedBoard.board.layout, selectedBoard.board.fixtures])
      : '';
  useEffect(() => {
    setBands(undefined);
    if (!bandsKey || !selectedBoard) return;
    const t = setTimeout(() => {
      const { input, spots } = settleInputOf(selectedBoard.board, selectedBoard.nest, instances, bit, nestOptions);
      setBands(edgeBands(input, spots, selectedBoard.board.fixtures ?? [], selectedBoard.board.size.fit));
    }, 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandsKey]);

  return { tool, setTool, edit, setEdit, selectedHold, setSelectedHold, canPlace, holdCount, bands, preview, commit, suggest, nudgeHolds };
}
