import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
        itemOf={() => undefined}
        onFallback={() => {}}
        holding={[
          { name: 'left', how: 'placed', tabs: 4 },
          { name: 'Part 3', how: 'placed', tabs: 3, wanted: 4 },
          { name: 'Part 7', how: 'skin', tabs: 0 },
        ]}
      />
    );
    const notes = screen.getByRole('list', { name: 'Tabs on board A' });
    expect(notes.textContent).toContain('Part 3: 3 of 4 tabs fit');
    expect(notes.textContent).toContain(
      'Part 7: no two opposite edges where tabs hold, so it keeps a bottom skin, freed at the machine, as you chose'
    );
    expect(notes.textContent).not.toContain('left');
    cleanup();
    render(
      <HoldingNotes board={board} itemOf={() => undefined} onFallback={() => {}} holding={[{ name: 'left', how: 'placed', tabs: 4 }]} />
    );
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('a part with no fallback chosen is not switched silently: it blocks, with one click to keep a frame or choose', () => {
    const onFallback = vi.fn();
    const onFrame = vi.fn();
    render(
      <HoldingNotes
        board={{ ...board, items: ['i7'] }}
        itemOf={name => (name === 'Part 7' ? 'i7' : undefined)}
        onFallback={onFallback}
        onFrame={onFrame}
        holding={[{ name: 'Part 7', how: 'unheld', tabs: 0 }]}
      />
    );
    const notes = within(screen.getByRole('list', { name: 'Tabs on board A' }));
    expect(notes.getByText(/Part 7: no two opposite edges where tabs would hold it, so it would come loose/)).toBeTruthy();
    fireEvent.click(notes.getByRole('button', { name: 'Keep a frame' }));
    expect(onFrame).toHaveBeenCalled();
    fireEvent.click(notes.getByRole('button', { name: 'Bottom skin' }));
    expect(onFallback).toHaveBeenCalledWith('i7', 'skin');
    fireEvent.click(notes.getByRole('button', { name: 'Tabs anyway' }));
    expect(onFallback).toHaveBeenCalledWith('i7', 'tabs');
    fireEvent.click(notes.getByRole('button', { name: 'I hold it down' }));
    expect(onFallback).toHaveBeenCalledWith('i7', 'self');
  });
});
