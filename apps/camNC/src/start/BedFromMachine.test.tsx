import { signal } from '@preact/signals-react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BedFromMachine } from './BedFromMachine';

const api = vi.hoisted(() => ({
  isConnected: null as unknown as { value: boolean },
  state: null as unknown as { value: string | null },
  readMachineBounds: vi.fn(),
}));

const store = vi.hoisted(() => ({ setMachineBounds: vi.fn() }));

vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => api }));
vi.mock('@/store/store', () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
}));
vi.mock('@/setup/MachineBoundsForm', () => ({
  MachineBoundsForm: ({ initial, submitLabel, onConfirmed }: { initial?: object; submitLabel: string; onConfirmed: () => void }) => (
    <button type="button" data-initial={JSON.stringify(initial ?? null)} onClick={onConfirmed}>
      {submitLabel}
    </button>
  ),
}));

function setup(state: string | null, connected = true) {
  api.isConnected = signal(connected);
  api.state = signal(state);
}

afterEach(() => {
  cleanup();
  api.readMachineBounds.mockReset();
  store.setMachineBounds.mockReset();
});

describe('BedFromMachine', () => {
  it('shows nothing until connected', () => {
    setup(null, false);
    const { container } = render(<BedFromMachine onConfirmed={() => {}} />);
    expect(container.textContent).toBe('');
    expect(api.readMachineBounds).not.toHaveBeenCalled();
  });

  it('reads the bed from the controller once idle and offers it to confirm', async () => {
    setup('Idle');
    api.readMachineBounds.mockResolvedValue({ xmin: 3, xmax: 1223, ymin: 3, ymax: 2443, zmin: -297, zmax: 3 });
    const onConfirmed = vi.fn();
    render(<BedFromMachine onConfirmed={onConfirmed} />);
    await screen.findByTestId('bed-read');
    expect(screen.getByTestId('bed-read').textContent).toContain('X 3 to 1223 mm, Y 3 to 2443 mm (1220 × 2440 mm)');
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(store.setMachineBounds).toHaveBeenCalledWith(3, 3, 1223, 2443);
    expect(onConfirmed).toHaveBeenCalled();
    expect(api.readMachineBounds).toHaveBeenCalledTimes(1);
  });

  it('lets the user adjust the bounds read from the controller', async () => {
    setup('Idle');
    api.readMachineBounds.mockResolvedValue({ xmin: 3, xmax: 1223, ymin: 3, ymax: 2443, zmin: -297, zmax: 3 });
    render(<BedFromMachine onConfirmed={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust' }));
    const form = screen.getByRole('button', { name: 'Open workspace' });
    expect(JSON.parse(form.dataset.initial!)).toEqual({ xmin: 3, xmax: 1223, ymin: 3, ymax: 2443 });
  });

  it('waits while the machine runs or holds', () => {
    setup('Hold:0');
    render(<BedFromMachine onConfirmed={() => {}} />);
    expect(screen.getByTestId('bed-reading').textContent).toContain('Waiting for the machine to be idle');
    expect(api.readMachineBounds).not.toHaveBeenCalled();
  });

  it('falls back to entering the size by hand, with a retry', async () => {
    setup('Alarm');
    api.readMachineBounds.mockRejectedValueOnce(new Error('The controller did not report the axis travel'));
    render(<BedFromMachine onConfirmed={() => {}} />);
    await screen.findByText('Could not read the bed size');
    expect(JSON.parse(screen.getByRole('button', { name: 'Open workspace' }).dataset.initial!)).toBeNull();
    api.readMachineBounds.mockResolvedValue({ xmin: 0, xmax: 600, ymin: 0, ymax: 400, zmin: -100, zmax: 0 });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'try again' })));
    await waitFor(() => expect(screen.getByTestId('bed-read')).toBeTruthy());
  });
});
