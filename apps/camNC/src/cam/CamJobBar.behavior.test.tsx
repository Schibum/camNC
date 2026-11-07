import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CamJobBar } from './CamJobBar';
import type { CamJobV1 } from './jobDb';
import { kDefaultPlan } from './planSettings';
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
vi.mock('./camQueries', () => ({
  useCamJob: () => ({ data: state.job }),
  useSaveCamJob: () => ({ mutate: state.save, isPending: false }),
}));
vi.mock('./cadDesign', () => ({ hasDesignDraft: () => false }));
vi.mock('@/cam/machine/openAtMachine', () => ({ openAtMachine: () => '/visualize/2DView' }));
vi.mock('@/lib/demo/DemoHeaderMark', () => ({ DemoHeaderMark: () => null }));
vi.mock('@/lib/demo/demo-mode', () => ({ isDemoMode: () => false, getRehearsalId: () => null }));
vi.mock('@/components/nav/RailButtonSlot', () => ({ RailButtonSlot: () => null }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.job = {
    name: 'Plate',
    fileName: 'Plate',
    id: 'job',
    design: { draft: createCadDocument(), acceptedRevision: 0, partRevisions: {} },
    boards: [],
  };
});

it('explains orphaned hole settings and discards only their explicit source keys', () => {
  state.job.plan = { ...kDefaultPlan, holes: { part: { retained: 'leave', removed: 'clear' } } };
  state.job.design = { ...state.job.design!, holeChoiceIssues: [{ partId: 'part', holeId: 'removed', choice: 'clear' }] };
  render(<CamJobBar job={state.job as CamJobV1} />);
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
  render(<CamJobBar job={state.job as CamJobV1} />);
  expect(screen.getByRole('status').textContent).toContain('Excluded from CAM: Panel');
  fireEvent.click(screen.getByRole('button', { name: 'Include again' }));
  expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ plan: { ...kDefaultPlan, leaveOut: [] } }));
});
