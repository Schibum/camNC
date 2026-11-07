import { expect, it } from 'vitest';
import type { BoardV1 } from './boards';
import type { CamJobV1 } from './jobDb';
import { rebaseJob } from './rebaseJob';

const original = (): BoardV1 =>
  ({
    id: 'logical-board',
    physicalSheetId: 'sheet-one',
    name: 'A',
    thickness: 18,
    material: 'oak',
    size: { fit: true },
    retention: 'tabs',
    tabs: { width: 5, height: 2, minCount: 3 },
    items: ['part#0'],
    layout: { w: 120, h: 100, at: { 'part#0': { x: 5, y: 5, rotated: false } } },
    cut: { at: 100, keys: [], startedKeys: ['first-run'], sourceKey: 'first-source' },
  }) as BoardV1;
const job = (boards: BoardV1[]): CamJobV1 => ({
  v: 1,
  id: 'native-job',
  name: 'Native',
  fileName: 'Native',
  parts: [],
  createdAt: 0,
  updatedAt: 0,
  boards,
});

it.each(['completion', 'deletion', 'reset', 'layout'] as const)(
  'keeps the replacement physical sheet when an old %s patch arrives',
  action => {
    const before = original();
    const current = {
      ...original(),
      physicalSheetId: 'sheet-two',
      name: 'Replacement',
      layout: { w: 120, h: 100, at: { 'part#0': { x: 30, y: 20, rotated: false } } },
      cut: { at: 200, keys: [], startedKeys: ['second-run'], sourceKey: 'second-source' },
    } as BoardV1;
    let changed: BoardV1[];
    if (action === 'deletion') changed = [];
    else if (action === 'reset') changed = [{ ...before, physicalSheetId: 'stale-reset', cut: undefined } as BoardV1];
    else if (action === 'layout') changed = [{ ...before, layout: { ...before.layout!, w: 300 } }];
    else changed = [{ ...before, cut: { ...before.cut!, keys: ['first-run'], all: true } }];
    expect(rebaseJob(job([before]), job(changed), job([current])).boards).toEqual([current]);
  }
);

it('allows an explicit replacement from the current generation without clearing concurrent nonphysical metadata', () => {
  const before = original();
  const current = { ...before, name: 'Named meanwhile', cut: { ...before.cut!, keys: ['first-run'] } };
  const reset = { ...before, physicalSheetId: 'new-sheet', cut: undefined } as BoardV1;
  expect(rebaseJob(job([before]), job([reset]), job([current])).boards![0]).toEqual({
    ...reset,
    name: 'Named meanwhile',
  });
});
