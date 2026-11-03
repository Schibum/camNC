import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { kDefaultTabs, type BoardV1 } from '../boards';
import { HoldingNotes } from './BoardList';

const board: BoardV1 = {
  id: 'b',
  name: 'A',
  thickness: 8,
  material: 'oak',
  size: { fit: true },
  holdDown: 'tabs',
  tabs: kDefaultTabs,
  items: [],
};

afterEach(cleanup);

describe('tab notes per part', () => {
  it('says where fewer tabs fit than asked, and which parts get their fallback; nothing when all is well', () => {
    render(
      <HoldingNotes
        board={board}
        holding={[
          { name: 'left', how: 'placed', tabs: 4 },
          { name: 'Part 3', how: 'placed', tabs: 3, wanted: 4 },
          { name: 'Part 7', how: 'skin', tabs: 0 },
        ]}
      />
    );
    const notes = screen.getByRole('list', { name: 'Tabs on board A' });
    expect(notes.textContent).toContain('Part 3: 3 of 4 tabs fit');
    expect(notes.textContent).toContain('Part 7: no two opposite edges where tabs hold, so it keeps a bottom skin');
    expect(notes.textContent).not.toContain('left');
    cleanup();
    render(<HoldingNotes board={board} holding={[{ name: 'left', how: 'placed', tabs: 4 }]} />);
    expect(screen.queryByRole('list')).toBeNull();
  });
});
