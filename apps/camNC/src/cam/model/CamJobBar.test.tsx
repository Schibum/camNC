import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CamJobBar, type CamStageDestination } from './CamJobBar';
import type { CamJobV1 } from '../jobDb';
import { kDefaultPlan } from '../planSettings';
import { createCadDocument } from '@wbcnc/cad';

const state = vi.hoisted(() => ({ navigate: vi.fn(), save: vi.fn(), job: {} as Partial<CamJobV1> }));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({ board: 'board-b' }),
  useNavigate: () => state.navigate,
  Link: ({
    to,
    params,
    search,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
    params: { jobId: string };
    search?: unknown;
  }) => <a {...props} href={`${to.replace('$jobId', params.jobId)}${search ? '?board=board-b' : ''}`} />,
}));
vi.mock('../camQueries', () => ({
  useCamJob: () => ({ data: state.job }),
  useSaveCamJob: () => ({ mutate: state.save, isPending: false }),
}));
vi.mock('../cadDesign', () => ({ hasDesignDraft: () => false }));
vi.mock('@/cam/machine/openAtMachine', () => ({ openAtMachine: () => '/visualize/2DView' }));
vi.mock('@/lib/demo/demo-mode', () => ({ isDemoMode: () => false }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.job = { id: 'job', design: { draft: createCadDocument(), acceptedRevision: 0, partRevisions: {} }, boards: [] };
});

it('keeps stage links and routes normal, modifier, and middle activations through Design acceptance', () => {
  const navigate = vi.fn<(destination: CamStageDestination) => void>();
  render(<CamJobBar jobId="job" fileName="Plate" step="Design" onStageNavigate={navigate} />);
  const boards = screen.getByRole('link', { name: '2 Boards' });
  expect(boards.getAttribute('href')).toBe('/cam/job/boards?board=board-b');
  expect(fireEvent.click(boards)).toBe(false);
  expect(navigate).toHaveBeenLastCalledWith({ stage: 'boards', board: 'board-b', newTab: false });
  expect(fireEvent.click(boards, { ctrlKey: true })).toBe(false);
  expect(navigate).toHaveBeenLastCalledWith({ stage: 'boards', board: 'board-b', newTab: true });
  expect(fireEvent(boards, new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))).toBe(false);
  expect(navigate).toHaveBeenLastCalledWith({ stage: 'boards', board: 'board-b', newTab: true });
  fireEvent.click(screen.getByRole('link', { name: '3 Plan' }));
  expect(navigate).toHaveBeenLastCalledWith({ stage: 'plan', board: 'board-b', newTab: false });
  fireEvent.click(screen.getByRole('button', { name: 'At the machine' }));
  expect(navigate).toHaveBeenLastCalledWith({ stage: 'machine', board: 'board-b', newTab: false });
  expect(state.navigate).not.toHaveBeenCalled();
});

it('blocks repeat stage activations while acceptance is pending', () => {
  const navigate = vi.fn();
  render(<CamJobBar jobId="job" fileName="Plate" step="Design" onStageNavigate={navigate} navigationPending />);
  const plan = screen.getByRole('link', { name: '3 Plan' });
  expect(plan.getAttribute('aria-disabled')).toBe('true');
  expect(fireEvent.click(plan)).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'At the machine' }));
  expect(navigate).not.toHaveBeenCalled();
});

it('leaves ordinary links and machine navigation intact outside Design', () => {
  render(<CamJobBar jobId="job" fileName="Plate" step="Plan" />);
  expect(screen.getByRole('link', { name: '2 Boards' }).getAttribute('href')).toBe('/cam/job/boards?board=board-b');
  fireEvent.click(screen.getByRole('button', { name: 'At the machine' }));
  expect(state.navigate).toHaveBeenCalledWith({ to: '/visualize/2DView' });
});

it('explains orphaned hole settings and discards only their explicit source keys', () => {
  state.job.plan = { ...kDefaultPlan, holes: { part: { retained: 'leave', removed: 'clear' } } };
  state.job.design = { ...state.job.design!, holeChoiceIssues: [{ partId: 'part', holeId: 'removed', choice: 'clear' }] };
  render(<CamJobBar jobId="job" fileName="Plate" step="Boards" />);
  expect(screen.getByRole('alert').textContent).toContain('not applied to another hole');
  fireEvent.click(screen.getByRole('button', { name: 'Discard removed hole settings' }));
  expect(state.save).toHaveBeenCalledWith(
    expect.objectContaining({
      plan: expect.objectContaining({ holes: { part: { retained: 'leave' } } }),
      design: expect.objectContaining({ holeChoiceIssues: undefined }),
    })
  );
});

it('keeps deliberate CAM exclusions visible on Boards until Include again is chosen', () => {
  state.job.parts = [{ id: 'part', name: 'Panel', quantity: 1, milled: true }];
  state.job.plan = { ...kDefaultPlan, leaveOut: ['part#0'] };
  render(<CamJobBar jobId="job" fileName="Plate" step="Boards" />);
  expect(screen.getByRole('status').textContent).toContain('Excluded from CAM: Panel');
  fireEvent.click(screen.getByRole('button', { name: 'Include again' }));
  expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ plan: { ...kDefaultPlan, leaveOut: [] } }));
});
