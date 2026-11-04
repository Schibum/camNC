import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CamJobV1 } from '@/cam/jobDb';
import { RehearsalButton } from './RehearsalButton';

const action = vi.hoisted(() => ({ launch: vi.fn(), blocked: null as string | null }));
vi.mock('@/cam/machine/useMachineBusy', () => ({ useMachineBusy: () => !!action.blocked }));
vi.mock('./rehearsal', () => ({ launchRehearsal: action.launch, rehearsalBlockedReason: () => action.blocked }));
const job: CamJobV1 = { v: 1, id: 'job', name: 'Pocket tray', fileName: 'tray.stl', parts: [], createdAt: 1, updatedAt: 1 };

afterEach(() => {
  cleanup();
  action.launch.mockReset();
  action.blocked = null;
});

describe('rehearsal entry', () => {
  it('requires a current valid plan and explains disabled states', () => {
    const view = render(<RehearsalButton job={job} boards={[]} ready={false} />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Try on demo machine' }).disabled).toBe(true);
    expect(screen.getByText(/every board to pass/)).toBeTruthy();
    action.blocked = 'busy';
    view.rerender(<RehearsalButton job={job} boards={[]} ready />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Try on demo machine' }).disabled).toBe(true);
    expect(screen.getByText(/real machine job first/)).toBeTruthy();
  });

  it('opens a named modal, allows cancellation and launches only from the confirmation', async () => {
    render(<RehearsalButton job={job} boards={[]} ready />);
    const trigger = screen.getByRole('button', { name: 'Try on demo machine' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Try this job on a demo machine?' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(action.launch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    action.launch.mockRejectedValueOnce(new Error('Storage is unavailable.'));
    fireEvent.click(screen.getByRole('button', { name: 'Start rehearsal' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Storage is unavailable.'));
    expect(action.launch).toHaveBeenCalledWith(job, [], expect.any(AbortSignal));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start rehearsal' }).disabled).toBe(false);
  });
});
