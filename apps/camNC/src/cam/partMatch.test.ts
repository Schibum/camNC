import { describe, expect, it } from 'vitest';
import type { BoardV1 } from './boards';
import { carriedParts, matchReplacedParts, partPrint, remapBoards, replaceWarning, samePrint, type PartPrint } from './partMatch';

const print = (modelName: string, w: number, h: number, t = 18): PartPrint => ({
  modelName,
  size: [t, h, w].sort((a, b) => a - b) as PartPrint['size'],
  area: w * h,
  volume: w * h * t,
});
const part = (id: string, p: PartPrint, name = p.modelName) => ({ id, name, print: p });

describe('finding the parts of a replaced model', () => {
  const side = print('Side', 400, 200);
  const shelf = print('Shelf', 300, 200);
  const back = print('Back', 500, 300, 6);

  it('reordered bodies are the same parts', () => {
    const { matched, affected } = matchReplacedParts(
      [part('part-0', side), part('part-1', shelf), part('part-2', back)],
      [part('part-0', back), part('part-1', side), part('part-2', shelf)]
    );
    expect([...matched].sort()).toEqual([
      ['part-0', 'part-2'],
      ['part-1', 'part-0'],
      ['part-2', 'part-1'],
    ]);
    expect(affected).toEqual([]);
  });

  it('a body renamed in the model is found by its shape', () => {
    const { matched, affected } = matchReplacedParts([part('part-0', side)], [part('part-0', { ...side, modelName: 'Wange' })]);
    expect(matched.get('part-0')).toBe('part-0');
    expect(affected).toEqual([]);
  });

  it('a body of the same name with another shape is changed, even at the same place in the file', () => {
    const { matched, affected } = matchReplacedParts(
      [part('part-0', side), part('part-1', shelf)],
      [part('part-0', print('Side', 420, 200)), part('part-1', shelf)]
    );
    expect(matched.has('part-0')).toBe(false);
    expect(matched.get('part-1')).toBe('part-1');
    expect(affected).toEqual([{ name: 'Side', why: 'changed' }]);
  });

  it('two renamed bodies of the same shape: can’t tell which, so neither keeps anything', () => {
    const { matched, affected } = matchReplacedParts(
      [part('part-0', print('A', 300, 200)), part('part-1', print('B', 300, 200))],
      [part('part-0', print('C', 300, 200)), part('part-1', print('D', 300, 200))]
    );
    expect(matched.size).toBe(0);
    expect(affected).toEqual([
      { name: 'C', why: 'unclear' },
      { name: 'D', why: 'unclear' },
    ]);
  });

  it('turned the other way round in the model, still the same shape', () => {
    expect(samePrint(print('x', 400, 200), print('x', 200, 400))).toBe(true);
    const shape = {
      outlines: [
        [
          [0, 0],
          [10, 0],
          [10, 5],
          [0, 5],
        ],
      ],
      holes: [],
      pockets: [],
    } as never;
    const a = partPrint({ name: 'a', size: [10, 5, 18], thickness: 18, shape });
    const b = partPrint({ name: 'a', size: [18, 10, 5], thickness: 18, shape });
    expect(a).toEqual({ ...b });
    expect(a.area).toBe(50);
    expect(a.volume).toBe(900);
  });

  it('rounding in an export doesn’t change a part', () => {
    expect(samePrint(print('x', 400, 200), { ...print('x', 400.05, 200), area: 80005 })).toBe(true);
    expect(samePrint(print('x', 400, 200), print('x', 401, 200))).toBe(false);
  });

  it('new and gone parts are listed, in one warning', () => {
    const { affected } = matchReplacedParts([part('part-0', side, 'My side')], [part('part-0', shelf)]);
    expect(affected).toEqual([
      { name: 'Shelf', why: 'new' },
      { name: 'My side', why: 'gone' },
    ]);
    expect(replaceWarning(affected)).toBe(
      'Model replaced: these parts did not keep a name or milled tick, check them: Shelf (new), My side (gone).'
    );
    expect(replaceWarning([])).toBeUndefined();
  });
});

describe('what parts keep', () => {
  const info = (id: string, name: string, notFlat = false) => ({ id, name, names: [name], summary: { notFlat } }) as never;
  const side = print('Side', 400, 200);
  const shelf = print('Shelf', 300, 200);
  const jobParts = [
    { id: 'part-0', name: 'Linke Wange', quantity: 1, milled: true },
    { id: 'part-1', name: 'Shelf', quantity: 1, milled: false },
  ];
  const prints = { 'part-0': side, 'part-1': shelf };

  it('reordered bodies keep the right names and ticks', () => {
    const before = jobParts.map(p => part(p.id, prints[p.id as keyof typeof prints], p.name));
    const { matched } = matchReplacedParts(before, [part('part-0', shelf), part('part-1', side)]);
    expect(carriedParts([info('part-0', 'Shelf'), info('part-1', 'Side')], jobParts, { matched, prints })).toEqual([
      { id: 'part-0', name: 'Shelf', quantity: 1, milled: false },
      { id: 'part-1', name: 'Linke Wange', quantity: 1, milled: true },
    ]);
  });

  it('a changed body loses its name and tick and gets a warning; the unchanged one keeps them', () => {
    const before = jobParts.map(p => part(p.id, prints[p.id as keyof typeof prints], p.name));
    const changed = print('Shelf', 320, 200);
    const { matched, affected } = matchReplacedParts(before, [part('part-0', side), part('part-1', changed)]);
    expect(carriedParts([info('part-0', 'Side'), info('part-1', 'Shelf')], jobParts, { matched, prints })).toEqual([
      { id: 'part-0', name: 'Linke Wange', quantity: 1, milled: true },
      // Unticked before, and now as any new flat part.
      { id: 'part-1', name: 'Shelf', quantity: 1, milled: true },
    ]);
    expect(replaceWarning(affected)).toMatch(/Shelf \(changed\)/);
  });

  it('the same model again: everything stays by id', () => {
    expect(carriedParts([info('part-0', 'Side'), info('part-1', 'Shelf')], jobParts, null).map(p => [p.name, p.milled])).toEqual([
      ['Linke Wange', true],
      ['Shelf', false],
    ]);
  });
});

describe('boards after a replaced model', () => {
  it('bodies follow their part to its new id; what wasn’t found again is off the board and leaves nothing behind', () => {
    const board = {
      items: ['part-0#0', 'part-0#1', 'part-1#0'],
      pinned: ['part-0#1', 'part-1#0'],
      positions: { 'part-0#1': { x: 1, y: 2 }, 'part-1#0': { x: 3, y: 4 } },
      tabsAt: { 'part-1#0': [{ x: 1, y: 1 }] },
      tabFallbacks: { 'part-0#0': 'skin' },
    } as unknown as BoardV1;
    // Old part-0 is now part-1; old part-1 is not found again, though a new part took its id.
    const [next] = remapBoards([board], new Map([['part-1', 'part-0']]));
    expect(next.items).toEqual(['part-1#0', 'part-1#1']);
    expect(next.pinned).toEqual(['part-1#1']);
    expect(next.positions).toEqual({ 'part-1#1': { x: 1, y: 2 } });
    expect(next.tabsAt).toEqual({});
    expect(next.tabFallbacks).toEqual({ 'part-1#0': 'skin' });
  });
});
