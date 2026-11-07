import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { type ComponentType } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CamJobV1 } from '@/cam/jobDb';
import type { CamStageDestination } from '@/cam/CamJobBar';
import { Route } from '@/routes/cam/$jobId.design';
import { endCadSession } from './session';

const state = vi.hoisted(() => ({ job: null as CamJobV1 | null, navigate: vi.fn(), accept: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => ({ jobId: 'notice-job' }),
  useSearch: () => ({}),
  useNavigate: () => state.navigate,
  Navigate: () => null,
}));
vi.mock('@/cam/camQueries', () => ({
  useCamJob: () => ({ data: state.job, isPending: false }),
  camKeys: { job: (id: string) => ['job', id], jobs: ['jobs'] },
}));
vi.mock('@/cam/cadDesign', () => ({
  saveDesignDraft: async (job: CamJobV1, document: CadDocument) => ({ ...job, design: { ...job.design!, draft: document } }),
  acceptDesign: (...args: unknown[]) => state.accept(...args),
}));
vi.mock('@/cam/CamJobBar', () => ({
  CamJobBar: ({ onStageNavigate }: { onStageNavigate: (destination: CamStageDestination) => void }) => (
    <nav style={{ height: 40, flexShrink: 0 }}>
      <button onClick={() => onStageNavigate({ stage: 'boards' })}>Go Boards</button>
    </nav>
  ),
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => <header style={{ height: 40, flexShrink: 0 }}>Design</header> }));

const Design = (Route as unknown as { options: { component: ComponentType } }).options.component;
beforeEach(() => {
  vi.clearAllMocks();
  const document = createPlateDocument();
  state.job = {
    v: 1,
    id: 'notice-job',
    name: 'Notice plate',
    fileName: 'Notice plate',
    createdAt: 0,
    updatedAt: 0,
    parts: [],
    design: { draft: document, accepted: structuredClone(document), acceptedRevision: 1, partRevisions: {} },
  };
  state.accept.mockRejectedValue(new Error('Close every cut contour before preparing CAM.'));
});
afterEach(() => {
  cleanup();
  endCadSession(state.job!.design!.draft.id);
});

it('keeps the canvas bounds fixed and displays the acceptance failure once over the drawing', async () => {
  const accepted = structuredClone(state.job!.design!.accepted);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Design />
    </QueryClientProvider>
  );
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  const canvas = screen.getByTestId('cad-canvas');
  const before = canvas.getBoundingClientRect().toJSON();
  fireEvent.click(screen.getByRole('button', { name: 'Go Boards' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/close every cut contour/i));
  expect(canvas.getBoundingClientRect().toJSON()).toEqual(before);
  expect(screen.getByRole('alert').textContent).toBe('Draft kept: close every cut contour before preparing CAM.');
  expect(screen.getAllByText(/close every cut contour/i)).toHaveLength(1);
  expect(screen.getByRole('alert').closest('.cad-drawing')).not.toBeNull();
  expect(state.navigate).not.toHaveBeenCalled();
  expect(state.job!.design!.accepted).toEqual(accepted);
  expect(state.job!.design!.acceptedRevision).toBe(1);
});
