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

  it('parts with no fallback chosen are not switched silently: one note for all, with one click to keep a frame or choose', () => {
    const onFallback = vi.fn();
    const onFrame = vi.fn();
    const ids: Record<string, string> = { 'Part 7': 'i7', left: 'il', right: 'ir' };
    render(
      <HoldingNotes
        board={{ ...board, items: ['i7', 'il', 'ir'] }}
        itemOf={name => ids[name]}
        onFallback={onFallback}
        onFrame={onFrame}
        holding={[
          { name: 'Part 7', how: 'unheld', tabs: 0 },
          { name: 'left', how: 'unheld', tabs: 0 },
          { name: 'right', how: 'unheld', tabs: 0 },
          { name: 'top', how: 'self', tabs: 0 },
          { name: 'back', how: 'self', tabs: 0 },
        ]}
      />
    );
    const notes = within(screen.getByRole('list', { name: 'Tabs on board A' }));
    expect(notes.getAllByRole('listitem')).toHaveLength(2);
    expect(notes.getByText(/Part 7, left and right have no two opposite edges where tabs would hold them/)).toBeTruthy();
    expect(notes.getByText(/top and back: no two opposite edges where tabs hold, so each gets no tabs/)).toBeTruthy();
    expect(notes.getAllByRole('button', { name: 'Bottom skin' })).toHaveLength(1);
    fireEvent.click(notes.getByRole('button', { name: 'Keep a frame' }));
    expect(onFrame).toHaveBeenCalled();
    fireEvent.click(notes.getByRole('button', { name: 'Bottom skin' }));
    expect(onFallback).toHaveBeenCalledWith(['i7', 'il', 'ir'], 'skin');
    fireEvent.click(notes.getByRole('button', { name: 'Tabs anyway' }));
    expect(onFallback).toHaveBeenCalledWith(['i7', 'il', 'ir'], 'tabs');
    fireEvent.click(notes.getByRole('button', { name: 'I hold it down' }));
    expect(onFallback).toHaveBeenCalledWith(['i7', 'il', 'ir'], 'self');
  });

  it('one part reads as one', () => {
    render(<HoldingNotes board={board} itemOf={() => 'i7'} onFallback={() => {}} holding={[{ name: 'Part 7', how: 'unheld', tabs: 0 }]} />);
    expect(
      screen.getByText(/Part 7 has no two opposite edges where tabs would hold it, so it would come loose. The job waits until you choose:/)
    ).toBeTruthy();
  });

  it('says when the frame was left out for lack of room, and what brings it back', () => {
    render(
      <HoldingNotes
        board={board}
        itemOf={() => 'i7'}
        onFallback={() => {}}
        noFrame={{ width: 19, nut: true }}
        holding={[{ name: 'Part 7', how: 'unheld', tabs: 0 }]}
      />
    );
    expect(
      screen.getByText(/The frame for the holds \(19 mm, with room for the collet nut\) doesn't fit on this board with all the parts/)
    ).toBeTruthy();
    expect(screen.getByText(/a stick-out long enough for the nut to clear the holds/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Keep a frame' })).toBeNull();
  });
});
