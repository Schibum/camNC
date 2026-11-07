import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createPlateDocument, updateDimension, type CadDocument } from '@wbcnc/cad';
import { useImperativeHandle, useRef, type ComponentType, type Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesignJob, getJob, type CamJobV1 } from '@/cam/jobDb';
import { acknowledgeCadSession, cadSession, commitCadSession } from '@/cad/session';
import type { CadEditorController } from '@/cad/CadEditor';
import type { CamStageDestination } from '@/cam/CamJobBar';
import { Route } from './$jobId.design';

const state = vi.hoisted(() => ({
  job: null as CamJobV1 | null,
  search: {} as { returnTo?: 'boards' | 'plan' | 'machine'; board?: string; part?: string },
  navigate: vi.fn(),
  openAtMachine: vi.fn<(jobId: string, boardId?: string) => string>(() => '/visualize/2DView'),
  save: vi.fn(),
  accept: vi.fn(),
  editorBlocked: false,
  finishRequests: vi.fn(),
  prepared: undefined as CadDocument | null | undefined,
  blockedReason: undefined as string | undefined,
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => ({ jobId: 'design-job' }),
  useSearch: () => state.search,
  useNavigate: () => state.navigate,
  Navigate: () => null,
}));
vi.mock('@/cam/camQueries', () => ({
  useCamJob: () => ({ data: state.job, isPending: false }),
  camKeys: { job: (id: string) => ['job', id], jobs: ['jobs'] },
}));
vi.mock('@/cam/cadDesign', () => ({
  saveDesignDraft: (...args: unknown[]) => state.save(...args),
  acceptDesign: (...args: unknown[]) => state.accept(...args),
}));
vi.mock('@/cam/machine/openAtMachine', () => ({ openAtMachine: (jobId: string, boardId?: string) => state.openAtMachine(jobId, boardId) }));
vi.mock('@/cam/CamJobBar', () => ({
  CamJobBar: ({
    onStageNavigate,
    navigationPending,
  }: {
    onStageNavigate: (destination: CamStageDestination) => void;
    navigationPending: boolean;
  }) => (
    <nav>
      {(['boards', 'plan', 'machine'] as const).map(stage => (
        <button key={stage} disabled={navigationPending} onClick={() => onStageNavigate({ stage, board: 'board-c' })}>
          Go {stage}
        </button>
      ))}
      <button onClick={() => onStageNavigate({ stage: 'boards', newTab: true })}>Open Boards in another tab</button>
    </nav>
  ),
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('@/cad/CadEditor', () => ({
  CadEditor: (props: {
    document: CadDocument;
    preferredPartId?: string;
    onDraftChange: (d: CadDocument) => void;
    onFinish: (d: CadDocument) => Promise<void>;
    onCancel: () => Promise<void>;
    onFinishBlocked?: (reason: string) => void;
    controller?: Ref<CadEditorController>;
    notice?: string | null;
  }) => {
    const current = useRef(cadSession(props.document).document);
    useImperativeHandle(props.controller, () => ({
      prepareDocument: () => (state.prepared === undefined ? current.current : state.prepared),
      finish: async () => {
        state.finishRequests();
        if (state.editorBlocked) {
          if (state.blockedReason) props.onFinishBlocked?.(state.blockedReason);
          return false;
        }
        try {
          await props.onFinish(current.current);
          return true;
        } catch {
          return false;
        }
      },
    }));
    return (
      <>
        {props.notice && <p role="alert">{props.notice}</p>}
        <output data-testid="editor-document">{JSON.stringify(current.current)}</output>
        <output data-testid="preferred-part">{props.preferredPartId}</output>
        <button onClick={() => void props.onFinish(current.current)}>Finish sketch</button>
        <button
          onClick={() => {
            current.current = { ...current.current, revision: current.current.revision + 1 };
            props.onDraftChange(current.current);
          }}>
          Edit draft
        </button>
        <button
          onClick={() => {
            props.onDraftChange(props.document);
            void props.onCancel();
          }}>
          Cancel sketch
        </button>
      </>
    );
  },
}));

const Design = (Route as unknown as { options: { component: ComponentType } }).options.component;
beforeEach(() => {
  vi.clearAllMocks();
  const document = createPlateDocument();
  state.job = {
    v: 1,
    id: 'design-job',
    name: 'Plate',
    fileName: 'Plate',
    createdAt: 0,
    updatedAt: 0,
    parts: [],
    design: { draft: document, accepted: document, acceptedRevision: 1, partRevisions: {} },
  };
  state.search = {};
  state.editorBlocked = false;
  state.prepared = undefined;
  state.blockedReason = undefined;
  state.openAtMachine.mockReturnValue('/visualize/2DView');
  state.save.mockImplementation(async (job: CamJobV1, document: CadDocument) => ({ ...job, design: { ...job.design!, draft: document } }));
  state.accept.mockImplementation(async (job: CamJobV1) => job);
});
afterEach(cleanup);
const open = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Design />
    </QueryClientProvider>
  );

describe('returning from a design edit', () => {
  it.each(['boards', 'plan', 'machine'] as const)('Finish and Cancel preserve the %s context and board', async returnTo => {
    state.search = { returnTo, board: 'board-b', part: state.job!.design!.draft.parts[0].id };
    open();
    expect(screen.getByTestId('preferred-part').textContent).toBe(state.search.part);
    fireEvent.click(screen.getByRole('button', { name: 'Finish sketch' }));
    const destination =
      returnTo === 'machine'
        ? { to: '/visualize/2DView' }
        : { to: `/cam/$jobId/${returnTo}`, params: { jobId: 'design-job' }, search: { board: 'board-b' } };
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith(destination));
    expect(state.accept).toHaveBeenCalledTimes(1);
    state.navigate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel sketch' }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith(destination));
    expect(state.accept).toHaveBeenCalledTimes(1);
    if (returnTo === 'machine') expect(state.openAtMachine).toHaveBeenCalledWith('design-job', 'board-b');
  });

  it('defaults a newly finished design to Boards', async () => {
    state.job!.design!.accepted = undefined;
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Finish sketch' }));
    await waitFor(() =>
      expect(state.navigate).toHaveBeenCalledWith({ to: '/cam/$jobId/boards', params: { jobId: 'design-job' }, search: undefined })
    );
  });

  it('carries the machine context through bed setup when no machine work area exists yet', async () => {
    state.search = { returnTo: 'machine', board: 'board-b' };
    state.openAtMachine.mockReturnValue('/start');
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Finish sketch' }));
    await waitFor(() =>
      expect(state.navigate).toHaveBeenCalledWith({ to: '/start', search: { for: 'cam', job: 'design-job', board: 'board-b' } })
    );
  });

  it.each(['boards', 'plan', 'machine'] as const)('accepts through the editor before navigating directly to %s', async stage => {
    state.search = { returnTo: 'plan', board: 'board-b' };
    open();
    fireEvent.click(screen.getByRole('button', { name: `Go ${stage}` }));
    const destination =
      stage === 'machine'
        ? { to: '/visualize/2DView' }
        : { to: `/cam/$jobId/${stage}`, params: { jobId: 'design-job' }, search: { board: 'board-c' } };
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith(destination));
    expect(state.finishRequests).toHaveBeenCalledTimes(1);
    expect(state.accept).toHaveBeenCalledTimes(1);
    if (stage === 'machine') expect(state.openAtMachine).toHaveBeenCalledWith('design-job', 'board-c');
  });

  it('keeps an invalid draft in Design and resets the destination for a later ordinary Finish', async () => {
    state.search = { returnTo: 'plan', board: 'board-b' };
    state.accept.mockRejectedValueOnce(new Error('Open profile. Close the outline before cutting.'));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Go boards' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Draft kept: open profile.'));
    expect(state.navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Go boards' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Finish sketch' }));
    await waitFor(() =>
      expect(state.navigate).toHaveBeenCalledWith({
        to: '/cam/$jobId/plan',
        params: { jobId: 'design-job' },
        search: { board: 'board-b' },
      })
    );
  });

  it('honors editor validation and explains guarded new-tab activation without accepting or navigating', async () => {
    state.editorBlocked = true;
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Go boards' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('complete the current sketch command'));
    expect(state.accept).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open Boards in another tab' }));
    expect(screen.getByRole('alert').textContent).toContain('Finish the sketch before opening CAM in another tab');
    expect(state.finishRequests).toHaveBeenCalledTimes(1);
  });

  it('waits for the queued draft write before accepting a stage transition', async () => {
    let release!: (job: CamJobV1) => void;
    state.save.mockImplementationOnce(
      () =>
        new Promise<CamJobV1>(resolve => {
          release = resolve;
        })
    );
    const edited = { ...state.job!.design!.draft, revision: state.job!.design!.draft.revision + 1 };
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Go boards' }));
    expect(state.accept).not.toHaveBeenCalled();
    release({ ...state.job!, design: { ...state.job!.design!, draft: edited } });
    await waitFor(() => expect(state.accept).toHaveBeenCalled());
    expect(state.accept.mock.calls[0]![1]).toEqual(edited);
    expect(state.save).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(state.navigate).toHaveBeenCalled());
  });

  it('keeps a precise input reason instead of replacing it with the generic stage fallback', async () => {
    state.editorBlocked = true;
    state.blockedReason = 'Enter a valid Width before finishing the sketch.';
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Go boards' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Draft kept: enter a valid Width before finishing the sketch.'));
    expect(state.accept).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });
});

async function conflictingView() {
  const actual = await vi.importActual<typeof import('@/cam/cadDesign')>('@/cam/cadDesign');
  const empty = await createDesignJob('Two-view sketch');
  const document = { ...createPlateDocument(), id: empty.design!.draft.id };
  const savedA = await actual.saveDesignDraft(empty, document);
  const session = cadSession(document);
  acknowledgeCadSession(session, document);
  const width = document.parts[0].sketch.constraints.find(c => c.label === 'Width')!;
  const local = commitCadSession(session, updateDimension(document, width.id, 170));
  const other = updateDimension(document, width.id, 180);
  const savedB = await actual.saveDesignDraft(savedA, other);
  state.job = savedB;
  state.save.mockImplementation(actual.saveDesignDraft);
  return { actual, savedB, local, width, session };
}

describe('recovering a conflicting editor source', () => {
  it('rejects its first local edit despite refreshed route data, without replacing either sketch', async () => {
    const f = await conflictingView();
    open();
    expect(screen.getByRole('alert').textContent).toContain('changed in another view');
    expect(JSON.parse(screen.getByTestId('editor-document').textContent!)).toEqual(f.local);
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    await waitFor(() => expect(state.save).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('changed in another view'));
    expect((await getJob(f.savedB.id))!.design!.draft).toEqual(f.savedB.design!.draft);
    expect(f.session.document).toEqual(f.local);
    expect(state.accept).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('creates an editable sketch copy from prepared pending values without cloning manufacturing state', async () => {
    const f = await conflictingView();
    state.prepared = updateDimension(f.local, f.width.id, 185);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Save sketch copy' }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalled());
    const destination = state.navigate.mock.calls.at(-1)![0] as { to: string; params: { jobId: string } };
    expect(destination.to).toBe('/cam/$jobId/design');
    expect(destination.params.jobId).not.toBe(f.savedB.id);
    const copy = (await getJob(destination.params.jobId))!;
    expect(copy.design!.draft.parts).toEqual(state.prepared.parts);
    expect(copy.design!.draft.id).not.toBe(f.savedB.design!.draft.id);
    expect(copy.design!.draft.name).toMatch(/recovered copy/);
    expect(copy.design!.accepted).toBeUndefined();
    expect(copy.boards).toBeUndefined();
    expect((await getJob(f.savedB.id))!.design!.draft).toEqual(f.savedB.design!.draft);
    expect(f.session.document).toEqual(f.local);
  });

  it('leaves both sketches untouched when pending input cannot be prepared for recovery', async () => {
    const f = await conflictingView();
    state.prepared = null;
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Save sketch copy' }));
    expect(state.save).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    expect((await getJob(f.savedB.id))!.design!.draft).toEqual(f.savedB.design!.draft);
    expect(f.session.document).toEqual(f.local);
  });

  it('explicitly reloads the freshest saved sketch and removes the old session history', async () => {
    const f = await conflictingView();
    open();
    const newest = updateDimension(f.savedB.design!.draft, f.width.id, 190);
    const saved = await f.actual.saveDesignDraft(f.savedB, newest);
    fireEvent.click(screen.getByRole('button', { name: 'Use saved sketch' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(JSON.parse(screen.getByTestId('editor-document').textContent!)).toEqual(saved.design!.draft);
    expect(cadSession(saved.design!.draft).past).toHaveLength(0);
    expect((await getJob(f.savedB.id))!.design!.draft).toEqual(saved.design!.draft);
    expect(f.session.document).toEqual(f.local);
  });
});
