import { describe, expect, it } from 'vitest';
import type { CamJobV1 } from './jobDb';
import { rebaseJob } from './rebaseJob';

const board = (id: string, items: string[], over = {}) => ({
  id,
  name: id,
  thickness: 8,
  material: 'oak',
  size: { fit: true },
  retention: 'tabs',
  tabs: {},
  items,
  ...over,
});
const job = (boards: unknown[], over = {}) => ({ id: 'j', name: 'j', fileName: 'f', parts: [], boards, ...over }) as unknown as CamJobV1;

describe('saving on top of the job as it is now', () => {
  const base = job([board('A', ['p']), board('C', [])]);

  it('nothing else saved since the render: as asked', () => {
    const next = job([board('A', ['p'], { margin: 9 }), board('C', [])]);
    expect(rebaseJob(base, next, base)).toBe(next);
  });

  it('a drop, then a size field committed from the same render: both stay', () => {
    // The drop moved p to C.
    const dropped = job([board('A', []), board('C', ['p'], { pinned: ['p'] })]);
    // The field's blur, built from the board as rendered: C still empty.
    const sized = job([board('A', ['p']), board('C', [], { size: { fit: false, w: 600, h: 300 } })]);
    const out = rebaseJob(base, sized, dropped);
    const c = out.boards!.find(b => b.id === 'C')!;
    expect(c.items).toEqual(['p']);
    expect(c.pinned).toEqual(['p']);
    expect(c.size).toEqual({ fit: false, w: 600, h: 300 });
    expect(out.boards!.find(b => b.id === 'A')!.items).toEqual([]);
  });

  it('a change elsewhere in the job survives, and a removed field goes', () => {
    const b = job([board('A', ['p'])], { stock: [{ id: 's' }] });
    const now = job([board('A', ['p'])], { stock: [{ id: 's' }], plan: { cutting: { stepdown: 3 } } });
    const next = job([board('A', ['p'], { margin: 9 })]);
    const out = rebaseJob(b, next, now);
    expect(out.plan).toEqual({ cutting: { stepdown: 3 } });
    expect(out.boards![0].margin).toBe(9);
    expect('stock' in out).toBe(false);
  });

  it('boards added and removed apply; a board added since stays', () => {
    const now = job([board('A', ['p']), board('C', []), board('D', [])]);
    const next = job([board('A', ['p']), board('E', [])]);
    expect(rebaseJob(base, next, now).boards!.map(b => b.id)).toEqual(['A', 'D', 'E']);
  });

  it('the first save of derived boards keeps boards saved in the meantime', () => {
    const noBoards = job([], { boards: undefined });
    const now = job([board('A', ['q'])]);
    const next = job([board('A', ['p'])]);
    expect(rebaseJob(noBoards, next, now).boards![0].items).toEqual(['q']);
  });
});
