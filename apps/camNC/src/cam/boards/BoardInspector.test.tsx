import '@/style.css';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kDefaultTabs, resolveBoardRetention, type BoardNest, type BoardV1 } from '../boards';
import type { RetentionSettingsV1 } from '../planSettings';
import { BoardInspector } from './BoardInspector';

const board: BoardV1 = {
  id: 'b1',
  name: 'A',
  thickness: 19,
  material: 'oak',
  size: { fit: true },
  holdDown: 'tabs',
  retentionSettings: {},
  tabs: kDefaultTabs,
  items: ['part'],
};
const nest: BoardNest = {
  board: { w: 1173, h: 1082 },
  placements: [],
  unplaced: [],
  yield: 0,
  gap: 16,
  margin: 12,
  keepOuts: [],
  holds: [],
  frame: 'kept',
  frameWidth: 12,
  stickout: 35,
  nutAbove: 15.7,
  holdsMoved: false,
};
afterEach(cleanup);

function Harness({ width = 300, height = 760, legacy = false }: { width?: number; height?: number; legacy?: boolean }) {
  const [own, setOwn] = useState<BoardV1>(
    legacy ? { ...board, retentionSettings: undefined, holdDown: 'fixture-tape', boardHold: 'tape' } : board
  );
  const [defaults, setDefaults] = useState<RetentionSettingsV1>({});
  const [alert, setAlert] = useState(true);
  const [spacing, setSpacing] = useState(10);
  return (
    <TooltipProvider>
      <div style={{ width, height, display: 'flex' }}>
        <BoardInspector
          board={resolveBoardRetention(own, defaults)}
          nest={{ ...nest, gap: spacing }}
          stock={[]}
          bit={6}
          onChange={next => {
            setOwn(next);
            if (next.gap !== undefined) setSpacing(next.gap);
          }}
          jobRetention={defaults}
          onJobRetention={setDefaults}
          tabHold={{ skin: 1 }}
          onTabHold={() => {}}
          alerts={
            alert ? (
              <div role="alert">
                Part 14a needs a holding choice.<button onClick={() => setAlert(false)}>Resolve part choice</button>
              </div>
            ) : null
          }
        />
      </div>
    </TooltipProvider>
  );
}

function positions() {
  return [...document.querySelectorAll<HTMLInputElement>('[name="fastening"], [name="retention"]')].map(input => {
    const { x, y, width, height } = input.getBoundingClientRect();
    return { name: input.parentElement?.textContent, x, y, width, height };
  });
}

function clickWithFocus(el: HTMLElement) {
  el.focus();
  fireEvent.click(el);
}

describe('BoardInspector scoped setup', () => {
  it('puts job defaults above the board and keeps tape separate from retention and fastening', () => {
    render(<Harness />);
    const job = screen.getByRole('button', { name: 'Edit job settings' });
    const boardTitle = screen.getByRole('heading', { name: 'Board A' });
    expect(job.compareDocumentPosition(boardTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Tape or fixture' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Tabs + guided removal' })).toBeNull();
    expect((screen.getByRole('radio', { name: 'Tabs' }) as HTMLInputElement).checked).toBe(true);
    clickWithFocus(screen.getByRole('checkbox', { name: 'Tape-assisted holding' }));
    expect((screen.getByRole('radio', { name: 'Tabs' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Screws' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('1 board override')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use job defaults' }));
    expect((screen.getByRole('checkbox', { name: 'Tape-assisted holding' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('From job settings')).toBeTruthy();
  });

  for (const [width, height] of [
    [300, 760],
    [280, 520],
  ])
    it(`keeps primary choices, focus and form scroll fixed at ${width} × ${height}`, () => {
      render(<Harness width={width} height={height} />);
      const scroll = screen.getByTestId('board-settings-scroll');
      scroll.scrollTop = 20;
      const startScroll = scroll.scrollTop;
      const before = positions();
      for (const [role, name] of [
        ['checkbox', 'Tape-assisted holding'],
        ['radio', 'Bottom skin'],
        ['checkbox', 'Guide tab removal'],
        ['radio', 'Clamps'],
        ['radio', 'Tabs'],
      ] as const) {
        const control = screen.getByRole(role, { name });
        clickWithFocus(control);
        expect(positions()).toEqual(before);
        expect(document.activeElement).toBe(control);
        expect(scroll.scrollTop).toBe(startScroll);
      }
      fireEvent.click(screen.getByRole('button', { name: 'Review board setup' }));
      expect(positions()).toEqual(before);
      expect(scroll.scrollTop).toBe(startScroll);
      fireEvent.click(screen.getByRole('button', { name: 'Resolve part choice' }));
      expect(positions()).toEqual(before);
      fireEvent.click(screen.getByRole('button', { name: 'Widen for tabs' }));
      expect(positions()).toEqual(before);
      expect(scroll.scrollTop).toBe(startScroll);
    });

  it('preserves an open tab disclosure and scroll extent when switching away from tabs', () => {
    render(<Harness width={280} height={520} />);
    const disclosure = screen.getByText('Tab dimensions & placement', { selector: 'summary' });
    fireEvent.click(disclosure);
    const scroll = screen.getByTestId('board-settings-scroll');
    scroll.scrollTop = scroll.scrollHeight;
    const before = positions();
    const top = scroll.scrollTop;
    const extent = scroll.scrollHeight;
    // Do not let focus scroll an off-screen test control into view: this measures the layout change itself.
    fireEvent.click(screen.getByRole('radio', { name: 'Bottom skin' }));
    expect(disclosure.parentElement?.hasAttribute('open')).toBe(true);
    expect(scroll.scrollTop).toBe(top);
    expect(scroll.scrollHeight).toBe(extent);
    expect(positions()).toEqual(before);
    expect(screen.getByLabelText('Tab W').matches(':disabled')).toBe(true);
  });

  it('edits job defaults separately and retains explicit board overrides', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tape-assisted holding' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit job settings' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('radio', { name: 'Bottom skin' }));
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Guide tab removal by default' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Only tape was overridden: primary retention still inherits the job's new bottom skin.
    expect((screen.getByRole('radio', { name: 'Bottom skin' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Tape-assisted holding' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Guide tab removal' }) as HTMLInputElement).checked).toBe(true);
  });

  it('preserves legacy fixture machining until conversion is explicitly chosen', () => {
    render(<Harness legacy />);
    expect(screen.getByRole('region', { name: 'Legacy fixture setup' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Tabs' }).matches(':disabled')).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Tape-assisted holding' }).matches(':disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Convert to independent settings' }));
    expect(screen.queryByRole('region', { name: 'Legacy fixture setup' })).toBeNull();
    expect((screen.getByRole('radio', { name: 'Bottom skin' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Tape-assisted holding' }) as HTMLInputElement).checked).toBe(true);
  });

  it('widens spacing without reducing an existing clamp margin', () => {
    const onChange = vi.fn();
    render(
      <TooltipProvider>
        <BoardInspector board={board} nest={{ ...nest, gap: 10 }} stock={[]} bit={6} onChange={onChange} />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review board setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Widen for tabs' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ margin: 12, gap: 16 }));
  });
});
