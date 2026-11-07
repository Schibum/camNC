import { expect, it } from 'vitest';
import { newBoard, type BoardV1 } from './boards';
import type { CamJobV1 } from './jobDb';
import { rebaseJob } from './rebaseJob';

const board = { ...newBoard([], 18, 'oak', ['part#0'], 'board'), physicalSheetId: 'one-physical-sheet' };
const job = (stock: BoardV1): CamJobV1 => ({
  v: 1,
  id: 'job',
  name: 'Native',
  fileName: 'Native',
  parts: [],
  createdAt: 0,
  updatedAt: 0,
  boards: [stock],
});

it.each(['start', 'completion'] as const)(
  'preserves the current physical cut source when a different-source %s wins the read/write race',
  action => {
    const base = job(board);
    const current = job({ ...board, cut: { at: 10, sourceKey: 'source-a', keys: ['a-done'], startedKeys: ['a-done'] } });
    const next = job({
      ...board,
      cut: { at: 20, sourceKey: 'source-b', keys: action === 'completion' ? ['b-program'] : [], startedKeys: ['b-program'] },
    });
    expect(rebaseJob(base, next, current).boards![0].cut).toEqual(current.boards![0].cut);
  }
);

it('still unions physical starts and completions belonging to the same scoped source', () => {
  const base = job(board);
  const current = job({ ...board, cut: { at: 10, sourceKey: 'source-a', keys: ['a-done'], startedKeys: ['a-done'] } });
  const next = job({ ...board, cut: { at: 20, sourceKey: 'source-a', keys: ['b-done'], startedKeys: ['b-done'] } });
  expect(rebaseJob(base, next, current).boards![0].cut).toMatchObject({
    at: 10,
    sourceKey: 'source-a',
    keys: ['a-done', 'b-done'],
    startedKeys: ['a-done', 'b-done'],
  });
});
