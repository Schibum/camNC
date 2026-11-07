import { expect, it } from 'vitest';
import { newBoard, physicalSheetIdOf, reconcileBoards, startOverBoard } from './boards';

it('replaces only physical identity and cut history while retaining every editable stock setting and logical reference', () => {
  const board = {
    ...newBoard([], 18, 'oak', ['part#0'], 'logical-board'),
    taped: true,
    margin: 7,
    gap: 12,
    measuredThickness: 18.4,
    layout: { w: 200, h: 120, at: { 'part#0': { x: 7, y: 7, rotated: true } } },
    fixtures: [{ kind: 'clamp' as const, side: 'left' as const, at: 30 }],
    bed: { a: { x: 100, y: 200, deg: 12 } },
    cut: { at: 1, keys: ['program'], startedKeys: ['program'], sourceKey: 'source' },
  };
  expect(physicalSheetIdOf(board)).toBe(board.id);
  const replacement = startOverBoard(board);
  const { cut, ...settings } = board;
  void cut;
  expect(replacement).toEqual({ ...settings, physicalSheetId: replacement.physicalSheetId });
  expect(replacement.physicalSheetId).toBeTruthy();
  expect(physicalSheetIdOf(replacement)).not.toBe(physicalSheetIdOf(board));
  expect(physicalSheetIdOf(startOverBoard(replacement))).not.toBe(physicalSheetIdOf(replacement));
  expect(board.cut.keys).toEqual(['program']);
});

it('mints a physical generation when discarding unusable cut history without a saved layout', () => {
  const board = { ...newBoard([], 18, 'oak', [], 'logical-board'), cut: { at: 1, keys: ['program'] } };
  const reconciled = reconcileBoards([board], [], 'oak')[0];
  expect(reconciled.cut).toBeUndefined();
  expect(physicalSheetIdOf(reconciled)).not.toBe(physicalSheetIdOf(board));
  expect(reconciled.id).toBe(board.id);
  const uncut = newBoard([], 18, 'oak', [], 'uncut');
  expect(reconcileBoards([uncut], [], 'oak')[0]).toEqual(uncut);
});
