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

/** What can be in hand: a fixture to place, or a tab. */
export type HoldTool = HoldKind | 'tab';
export type HoldSizeKey = 'd' | 'w' | 'height';
export type HoldSizes = Partial<Record<HoldSizeKey, number>>;

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
  onBoardsEdit,
  onNote,
  active,
}: {
  boards: JobBoard[];
  selectedId: string;
  instances: PartInstance[];
  bit: number;
  nestOptions: NestOptions;
  /** The machine's work area, when it is set up: Suggest holds grows no board past it. */
  machine?: { w: number; h: number };
  onBoardEdit: (board: BoardV1, note: string) => void;
  /** Several boards changed at once: all of them as they are now. */
  onBoardsEdit: (boards: BoardV1[], note: string) => void;
  onNote: (note: string) => void;
  /** A single board is shown: the keys pick up tools. */
  active: boolean;
}) {
  const [tool, setTool] = useState<HoldTool | null>(null);
  const [edit, setEdit] = useState<HoldEdit | null>(null);
  const [selectedHold, selectHold] = useState<{ board: string; i: number } | null>(null);
  const [selectedTab, selectTab] = useState<{ board: string; part: string; i: number } | null>(null);
  // One thing is selected at a time.
  const setSelectedHold = (s: { board: string; i: number } | null) => {
    selectHold(s);
    selectTab(null);
  };
  const setSelectedTab = (s: { board: string; part: string; i: number } | null) => {
    selectTab(s);
    selectHold(null);
  };
  // What the next one placed gets, where it differs from the clamp and screw sizes.
  const [newSizes, setNewSizes] = useState<{ clamp: HoldSizes; screw: HoldSizes }>({ clamp: {}, screw: {} });
  const selectedBoard = boards.find(b => b.board.id === selectedId);
  const canPlace = !!selectedBoard && !isCut(selectedBoard.board);
  const holdCount = selectedBoard?.board.fixtures?.length ?? 0;
  const tabsOn = selectedBoard?.board.retention === 'tabs';
  // Esc puts the tool down, and the letters on the tools pick them up.
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTool(null);
        setEdit(null);
        return;
      }
      const on = e.target as HTMLElement | null;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        on?.closest?.('input,textarea,select,[contenteditable="true"],[role="menu"],[role="dialog"]')
      )
        return;
      const picked = { v: null, c: 'clamp', s: 'screw', t: 'tab' }[e.key.toLowerCase()] as HoldTool | null | undefined;
      if (picked === undefined || (picked && !canPlace) || (picked === 'tab' && !tabsOn)) return;
      setTool(picked);
      setEdit(null);
      selectHold(null);
      selectTab(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [active, canPlace, tabsOn]);

  // No tabs to place on a board without them.
  useEffect(() => {
    if (!tabsOn) {
      setTool(t => (t === 'tab' ? null : t));
      selectTab(null);
    }
  }, [tabsOn]);

  // Nothing to place on a cut board: the tool can't stay in hand with its buttons off.
  useEffect(() => {
    if (!canPlace) {
      setTool(null);
      setEdit(null);
    }
  }, [canPlace]);

  /** A clamp's width where it differs: the one being moved, or the next one placed. */
  const widthOf = (i: number | null) => {
    const moved = i === null ? undefined : selectedBoard?.board.fixtures?.[i];
    return i === null ? newSizes.clamp.w : moved?.kind === 'clamp' ? moved.w : undefined;
  };
  /** The fixture at a point: previewed on its board with the parts moved aside for it, or refused. */
  const preview = ({ board, nest }: JobBoard, kind: HoldKind, p: { x: number; y: number }, i: number | null) => {
    const f = {
      ...fixtureAt(kind, p, board, nest, instances, bit, { ...nestOptions, exact: i !== null, clampWidth: widthOf(i) }),
      ...(i === null ? newSizes[kind] : {}),
    };
    const key = `${board.id}:${i}:${JSON.stringify(f)}`;
    if (edit?.key === key) return;
    const current = board.fixtures ?? [];
    // Moved, it stays the size it is.
    const fixtures = i === null ? [...current, f] : current.map((x, j) => (j === i ? ({ ...x, ...f } as Fixture) : x));
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

  /** The board with these fixtures, parts moved aside for them. Null: there's no room. */
  const refit = ({ board }: JobBoard, fixtures: Fixture[]) => settleBoard(board, instances, bit, fixtures, nestOptions);
  /** One fixture's size: the parts make room, or it stays as it was. */
  const setHoldSize = (i: number, key: HoldSizeKey, value: number) => {
    if (!selectedBoard) return false;
    const fixtures = (selectedBoard.board.fixtures ?? []).map((f, j) => (j === i ? ({ ...f, [key]: value } as Fixture) : f));
    const settled = refit(selectedBoard, fixtures);
    if (!settled) {
      onNote(`No room for that size here. It stays as it was: move it, or make room first.`);
      return false;
    }
    onBoardEdit(settled, layoutChange(selectedBoard.nest, nestBoard(settled, instances, bit, nestOptions), instances));
    return true;
  };
  const named = (kind: HoldKind, n: number) => `${n} ${kind}${n === 1 ? '' : 's'}`;
  /** How many of them this reaches: on the selected board, or on every board that isn't cut. */
  const countOf = (kind: HoldKind, all: boolean) =>
    (all ? boards.filter(b => !isCut(b.board)) : selectedBoard ? [selectedBoard] : []).reduce(
      (n, b) => n + (b.board.fixtures ?? []).filter(f => f.kind === kind).length,
      0
    );
  /** The same size for all of a kind. A board where the parts can't make room for it keeps what it has, and that's said. */
  const applyHoldSize = (kind: HoldKind, key: HoldSizeKey, value: number, all: boolean) => {
    let [changed, full] = [0, 0];
    const next = boards.map(b => {
      const has = (b.board.fixtures ?? []).filter(f => f.kind === kind).length;
      if (!has || isCut(b.board) || (!all && b.board.id !== selectedId)) return b.board;
      const settled = refit(
        b,
        (b.board.fixtures ?? []).map(f => (f.kind === kind ? ({ ...f, [key]: value } as Fixture) : f))
      );
      if (!settled) {
        full += has;
        return b.board;
      }
      changed += has;
      return settled;
    });
    if (!changed) {
      onNote(`No room for that size: the ${kind}s stay as they are.`);
      return;
    }
    onBoardsEdit(next, `Changed ${named(kind, changed)}.${full ? ` ${named(kind, full)} kept their size: no room for it.` : ''}`);
  };
  /** Tabs are one shape on a board: this board's, or those of all boards with tabs that aren't cut. */
  const setTabSize = (key: 'width' | 'height', value: number, all: boolean) => {
    const next = boards.map(b =>
      b.board.retention !== 'tabs' || isCut(b.board) || (!all && b.board.id !== selectedId)
        ? b.board
        : { ...b.board, tabs: { ...b.board.tabs, [key]: value } }
    );
    onBoardsEdit(next, all ? 'Changed the tabs on all boards.' : 'Changed the tabs on this board.');
  };
  const removeAllHolds = (kind: HoldKind) => {
    if (!selectedBoard) return;
    setSelectedHold(null);
    onBoardEdit(
      { ...selectedBoard.board, fixtures: (selectedBoard.board.fixtures ?? []).filter(f => f.kind !== kind) },
      `All ${kind}s on this board removed. Parts stay where they are; Tighten layout closes the gaps.`
    );
  };

  return {
    tool,
    setTool,
    edit,
    setEdit,
    selectedHold,
    setSelectedHold,
    selectedTab,
    setSelectedTab,
    canPlace,
    tabsOn,
    holdCount,
    bands,
    preview,
    commit,
    suggest,
    nudgeHolds,
    newSizes,
    setNewSizes,
    setHoldSize,
    countOf,
    applyHoldSize,
    setTabSize,
    removeAllHolds,
  };
}
