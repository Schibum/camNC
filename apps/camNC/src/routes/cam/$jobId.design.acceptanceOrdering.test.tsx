import { StepControl } from '@/components/nav/StepControl';
import { useAppSteps } from '@/components/nav/useAppSteps';
import '@/style.css';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createPlateDocument, type CadDocument, type CadSolveResult } from '@wbcnc/cad';
import { userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentType, MouseEventHandler, ReactNode } from 'react';
import { camKeys } from '@/cam/camQueries';
import { createDesignJob, getJob } from '@/cam/jobDb';
import { endCadSession } from '@/cad/session';
import { Route } from './$jobId.design';

const h = vi.hoisted(() => ({
  jobId: '',
  navigate: vi.fn(),
  save: vi.fn<typeof import('@/cam/cadDesign').saveDesignDraft>(),
  accept: vi.fn<typeof import('@/cam/cadDesign').acceptDesign>(),
  solve: vi.fn<typeof import('@/cad/solveCad').solveCadDocument>(),
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => ({ jobId: h.jobId }),
  useLocation: ({ select }: { select: (l: { pathname: string }) => unknown }) => select({ pathname: `/cam/${h.jobId}/design` }),
  useRouter: () => ({ preloadRoute: () => undefined }),
  useSearch: () => ({}),
  useNavigate: () => h.navigate,
  Navigate: () => null,
  Link: ({ children, onClick }: { children: ReactNode; onClick?: MouseEventHandler<HTMLAnchorElement> }) => (
    <a href="#stage" onClick={onClick}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => <div>Design</div> }));
vi.mock('@/cam/cadDesign', async original => ({
  ...(await original<typeof import('@/cam/cadDesign')>()),
  saveDesignDraft: h.save,
  acceptDesign: h.accept,
}));
vi.mock('@/cad/solveCad', async original => ({
  ...(await original<typeof import('@/cad/solveCad')>()),
  solveCadDocument: h.solve,
}));

function StageControls() {
  const { steps } = useAppSteps();
  return (
    <nav aria-label="Steps">
      {steps.map(step => (
        <StepControl key={step.key} step={step}>
          {step.label}
        </StepControl>
      ))}
    </nav>
  );
}

const Design = (Route as unknown as { options: { component: ComponentType } }).options.component;
const releases: (() => void)[] = [];
const sessionIds: string[] = [];
afterEach(async () => {
  releases.splice(0).forEach(release => release());
  cleanup();
  sessionIds.splice(0).forEach(endCadSession);
  const actual = await vi.importActual<typeof import('@/cad/solveCad')>('@/cad/solveCad');
  actual.disposeCadSolver();
  vi.clearAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => {
    resolve = yes;
  });
  return { promise, resolve };
}
const widthOf = (document: CadDocument) => {
  const width = document.parts[0].sketch.constraints.find(c => c.label === 'Width');
  return width && 'value' in width ? width.value : undefined;
};
const maxX = (document: CadDocument) => Math.max(...document.parts[0].sketch.entities.filter(e => e.type === 'point').map(p => p.x));
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

it.each(['toolbar', 'Boards stage'] as const)(
  'AD accepts a valid open Width through %s while its own background normalization competes with the route save queue',
  async action => {
    const actualDesign = await vi.importActual<typeof import('@/cam/cadDesign')>('@/cam/cadDesign');
    const actualSolver = await vi.importActual<typeof import('@/cad/solveCad')>('@/cad/solveCad');
    h.navigate.mockReset();
    h.solve.mockImplementation(actualSolver.solveCadDocument);
    h.save.mockImplementation(actualDesign.saveDesignDraft);
    h.accept.mockImplementation(actualDesign.acceptDesign);
    const empty = await createDesignJob('Acceptance ordering');
    const source = { ...createPlateDocument(), id: empty.design!.draft.id };
    const job = await actualDesign.acceptDesign(await actualDesign.saveDesignDraft(empty, source), source);
    h.jobId = job.id;
    sessionIds.push(source.id);
    const firstSaveStarted = deferred<void>(),
      releaseFirstSave = deferred<void>();
    const backgroundDelivered = deferred<CadSolveResult>(),
      normalizedSaved = deferred<void>(),
      acceptanceSettled = deferred<void>();
    releases.push(
      () => releaseFirstSave.resolve(),
      () => normalizedSaved.resolve()
    );
    const trace: string[] = [];
    const acceptanceErrors: string[] = [];
    let heldFirst = false,
      backgroundScheduled = false,
      normalizedWasPublished = false;
    let preparedSource: CadDocument | undefined;
    h.save.mockImplementation(async (base, document, expected) => {
      const target = widthOf(document) === 140;
      if (target && !heldFirst) {
        heldFirst = true;
        preparedSource = structuredClone(document);
        trace.push('first 140 draft held');
        firstSaveStarted.resolve();
        await releaseFirstSave.promise;
      }
      const saved = await actualDesign.saveDesignDraft(base, document, expected);
      if (target && Math.abs(maxX(document) - 140) < 1e-6) {
        trace.push('normalized 140 draft durable');
        normalizedSaved.resolve();
      }
      return saved;
    });
    h.solve.mockImplementation(async (document, options) => {
      const target = widthOf(document) === 140;
      if (target && options?.classifyEntities) {
        backgroundScheduled = true;
        const result = await actualSolver.solveCadDocument(document, options);
        trace.push('background native 140 result delivered');
        backgroundDelivered.resolve(result);
        return result;
      }
      // Model the possible worker ordering after the route already captured its acceptance base.
      // Only an actually published background edit may delay acceptance behind its own queued save.
      if (target && normalizedWasPublished) {
        trace.push('acceptance waits for published normalization save');
        await normalizedSaved.promise;
      }
      return actualSolver.solveCadDocument(document, options);
    });
    h.accept.mockImplementation(async (base, document) => {
      trace.push('route acceptance called');
      try {
        return await actualDesign.acceptDesign(base, document);
      } catch (error) {
        acceptanceErrors.push(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        acceptanceSettled.resolve();
      }
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(camKeys.job(job.id), job);
    const app = () => (
      <QueryClientProvider client={client}>
        <StageControls />
        <Design />
      </QueryClientProvider>
    );
    const view = render(app());
    await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
    await userEvent.dblClick(screen.getByRole('button', { name: 'Edit Width: 120 mm' }));
    await userEvent.fill(screen.getByRole('textbox', { name: 'Width mm' }), '140');
    if (action === 'toolbar') await userEvent.click(screen.getByRole('button', { name: /Finish sketch/ }));
    else await userEvent.click(within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('link', { name: /Boards/ }));
    await act(async () => {
      await firstSaveStarted.promise;
      await nextFrame();
    });
    // A finish guard may intentionally suppress this background solve entirely.
    if (backgroundScheduled) {
      await act(async () => {
        await backgroundDelivered.promise;
        await nextFrame();
      });
      const point = job.design!.draft.parts[0].sketch.entities.find(e => e.type === 'point' && e.x === 120)!;
      const painted = screen.getByTestId('cad-canvas').querySelector(`circle.cad-point[data-entity-id="${point.id}"]`)!;
      normalizedWasPublished = Math.abs(Number(painted.getAttribute('cx')) - 140) < 1e-6;
      trace.push(`background normalization published: ${normalizedWasPublished}`);
    }
    expect(widthOf(preparedSource!)).toBe(140);
    expect(h.navigate).not.toHaveBeenCalled();
    await act(async () => {
      releaseFirstSave.resolve();
      await acceptanceSettled.promise;
      await nextFrame();
    });
    expect(acceptanceErrors, trace.join('\n')).toEqual([]);
    expect(h.navigate, trace.join('\n')).toHaveBeenCalledWith({
      to: '/cam/$jobId/boards',
      params: { jobId: job.id },
      search: undefined,
    });
    const saved = (await getJob(job.id))!;
    expect(widthOf(saved.design!.accepted!)).toBe(140);
    expect(maxX(saved.design!.accepted!)).toBeCloseTo(140, 7);
    expect(saved.design!.draft).toEqual(saved.design!.accepted);
    expect(screen.queryByRole('button', { name: 'Save sketch copy' })).toBeNull();
    // Finish/route reentry must acknowledge solved coordinates while keeping the real command's Undo.
    view.unmount();
    client.setQueryData(camKeys.job(job.id), saved);
    render(app());
    await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
    expect(screen.getByRole('button', { name: 'Edit Width: 140 mm' })).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
    await waitFor(async () => {
      const undone = (await getJob(job.id))!;
      expect(widthOf(undone.design!.draft)).toBe(120);
      expect(widthOf(undone.design!.accepted!)).toBe(140);
    });
  },
  30_000
);
