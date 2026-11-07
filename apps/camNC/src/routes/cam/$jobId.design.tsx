import { useRef, useState } from 'react';
import type { CadDocument } from '@wbcnc/cad';
import { createFileRoute, Navigate, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@wbcnc/ui/components/button';
import { PageHeader } from '@/components/page-header';
import { CamPage } from '@/cam/CamPage';
import { CamJobBar, type CamStageDestination } from '@/cam/model/CamJobBar';
import { camKeys, useCamJob } from '@/cam/camQueries';
import { acceptDesign, saveDesignDraft } from '@/cam/cadDesign';
import { createDesignJob, getJob, type CamJobV1 } from '@/cam/jobDb';
import { CadEditor, type CadEditorController } from '@/cad/CadEditor';
import { acknowledgeCadSession, cadSession, endCadSession } from '@/cad/session';
import { openAtMachine } from '@/cam/machine/openAtMachine';

const designContextSchema = z.object({
  returnTo: z.enum(['boards', 'plan', 'machine']).optional(),
  board: z.string().min(1).optional(),
  part: z.string().min(1).optional(),
});
type DesignContext = z.infer<typeof designContextSchema>;
const draftConflictMessage = 'This design changed in another view. Your local sketch is kept; save a copy or use the saved sketch.';
const draftKeptNotice = (message: string) => {
  const reason = message.trim().split(/(?<=[.!?])\s+/u)[0];
  return `Draft kept: ${reason.charAt(0).toLowerCase()}${reason.slice(1).replace(/[.!?]$/, '')}.`;
};

export const Route = createFileRoute('/cam/$jobId/design')({
  component: DesignStep,
  validateSearch: zodValidator(designContextSchema),
});

function DesignStep() {
  const { jobId } = useParams({ from: '/cam/$jobId/design' });
  const context = useSearch({ from: '/cam/$jobId/design' });
  const { data: job, isPending } = useCamJob(jobId);
  if (isPending)
    return (
      <CamPage className="h-dvh">
        <PageHeader title="Design" />
        <p className="p-6">Opening design…</p>
      </CamPage>
    );
  if (!job)
    return (
      <CamPage className="h-dvh">
        <PageHeader title="Design" />
        <p className="p-6">This design no longer exists.</p>
      </CamPage>
    );
  if (!job.design) return <Navigate to="/cam/$jobId/model" params={{ jobId }} replace />;
  return <DesignSession key={job.id} initialJob={job} context={context} />;
}

/** Serialize draft writes and acceptance so a late autosave can never replace newer geometry. */
function DesignSession({ initialJob, context }: { initialJob: CamJobV1; context: DesignContext }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [session, setSession] = useState(() => cadSession(initialJob.design!.draft));
  const [editorDocument, setEditorDocument] = useState(initialJob.design!.draft);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [conflicted, setConflicted] = useState(!!session.conflict);
  const [recovering, setRecovering] = useState(false);
  const activeSession = useRef(session);
  const recoveryInProgress = useRef(false);
  const persisted = useRef(initialJob);
  const queue = useRef(Promise.resolve());
  const failure = useRef<Error | null>(session.conflict ? new Error(draftConflictMessage) : null);
  const editor = useRef<CadEditorController>(null);
  const stageDestination = useRef<CamStageDestination | null>(null);
  const [navigationPending, setNavigationPending] = useState(false);
  const [status, setStatus] = useState('Draft saved');
  const [error, setError] = useState<string | null>(session.conflict ? draftConflictMessage : null);
  const returnToContext = async (jobId: string, destination = context) => {
    if (destination.returnTo === 'machine') {
      const to = openAtMachine(jobId, destination.board);
      await navigate(to === '/start' ? { to, search: { for: 'cam', job: jobId, board: destination.board } } : { to });
    } else {
      await navigate({
        to: destination.returnTo === 'plan' ? '/cam/$jobId/plan' : '/cam/$jobId/boards',
        params: { jobId },
        search: destination.board ? { board: destination.board } : undefined,
      });
    }
  };
  const show = (job: CamJobV1) => {
    persisted.current = job;
    acknowledgeCadSession(session, job.design!.draft);
    queryClient.setQueryData(camKeys.job(job.id), job);
    void queryClient.invalidateQueries({ queryKey: camKeys.jobs });
  };
  const draft = (document: CadDocument) => {
    if (recoveryInProgress.current || activeSession.current !== session) return;
    setStatus('Saving draft…');
    queue.current = queue.current
      .then(async () => {
        if (activeSession.current !== session) return;
        const source = JSON.stringify(persisted.current.design!.draft);
        if (source !== JSON.stringify(document) || source !== JSON.stringify(session.saved))
          show(await saveDesignDraft(persisted.current, document, session.saved));
        failure.current = null;
        setError(null);
        setStatus('Draft saved');
      })
      .catch((cause: unknown) => {
        if (activeSession.current !== session) return;
        const problem = cause instanceof Error ? cause : new Error(String(cause));
        if (problem.name === 'CadDraftConflict') setConflicted(true);
        failure.current = problem;
        setError(problem.message);
        setStatus('Draft could not be saved');
      });
  };
  const finish = async (document: CadDocument) => {
    draft(document);
    await queue.current;
    if (failure.current) throw failure.current;
    setStatus('Finishing sketch…');
    try {
      const saved = await acceptDesign(persisted.current, document);
      show(saved);
      const destination = stageDestination.current;
      await returnToContext(saved.id, destination ? { returnTo: destination.stage, board: destination.board } : context);
    } catch (cause) {
      setStatus('Draft saved');
      setError(draftKeptNotice(cause instanceof Error ? cause.message : String(cause)));
      throw cause;
    }
  };
  const cancel = async () => {
    // CadEditor first restores its entry checkpoint through onDraftChange.
    await queue.current;
    if (failure.current) throw failure.current;
    if (!context.returnTo && !persisted.current.design?.accepted) await navigate({ to: '/cam' });
    else await returnToContext(initialJob.id);
  };
  const recoverCopy = async () => {
    const document = editor.current?.prepareDocument();
    if (!document || recoveryInProgress.current) return;
    recoveryInProgress.current = true;
    setRecovering(true);
    try {
      // Preparation applies valid pending values through the same guarded draft queue.
      // A rejected original write does not prevent preserving the local source in a new job.
      await queue.current;
      const name = `${document.name} (recovered copy)`;
      const empty = await createDesignJob(name);
      const copy = { ...structuredClone(document), id: empty.design!.draft.id, name };
      const saved = await saveDesignDraft(empty, copy);
      queryClient.setQueryData(camKeys.job(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: camKeys.jobs });
      await navigate({ to: '/cam/$jobId/design', params: { jobId: saved.id } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      recoveryInProgress.current = false;
      setRecovering(false);
    }
  };
  const restoreSaved = async () => {
    if (recoveryInProgress.current) return;
    recoveryInProgress.current = true;
    setRecovering(true);
    try {
      await queue.current;
      const current = await getJob(initialJob.id);
      if (!current?.design) throw new Error('This design no longer exists. Save your local sketch as a copy.');
      endCadSession(session.document.id);
      const nextSession = cadSession(current.design.draft);
      activeSession.current = nextSession;
      persisted.current = current;
      failure.current = null;
      setSession(nextSession);
      setEditorDocument(current.design.draft);
      setEditorEpoch(epoch => epoch + 1);
      setConflicted(false);
      setError(null);
      setStatus('Draft saved');
      queryClient.setQueryData(camKeys.job(current.id), current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      recoveryInProgress.current = false;
      setRecovering(false);
    }
  };
  const navigateStage = async (destination: CamStageDestination) => {
    if (destination.newTab) {
      setError('Finish the sketch before opening CAM in another tab.');
      return;
    }
    if (stageDestination.current || !editor.current) return;
    stageDestination.current = destination;
    setNavigationPending(true);
    setError(null);
    try {
      if (!(await editor.current.finish()))
        setError(
          previous => previous ?? 'Draft kept: complete the current sketch command or resolve the sketch issue before continuing to CAM.'
        );
    } finally {
      stageDestination.current = null;
      setNavigationPending(false);
    }
  };
  return (
    <CamPage className="h-dvh">
      <PageHeader title="Design" />
      <CamJobBar
        jobId={initialJob.id}
        fileName={initialJob.name}
        step="Design"
        onStageNavigate={destination => void navigateStage(destination)}
        navigationPending={navigationPending}
      />
      <div className="relative min-h-0 flex-1">
        {conflicted && (
          <div
            role="alert"
            className="absolute left-4 right-4 top-12 z-50 flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-background p-3 shadow-md">
            <p className="flex-1 text-sm">{error ?? draftConflictMessage}</p>
            <Button size="sm" disabled={recovering} onClick={() => void recoverCopy()}>
              Save sketch copy
            </Button>
            <Button size="sm" variant="outline" disabled={recovering} onClick={() => void restoreSaved()}>
              Use saved sketch
            </Button>
          </div>
        )}
        <CadEditor
          key={editorEpoch}
          document={editorDocument}
          preferredPartId={context.part}
          onDraftChange={draft}
          onFinish={finish}
          onCancel={cancel}
          onFinishBlocked={reason => setError(draftKeptNotice(reason))}
          saveStatus={status}
          notice={conflicted ? null : error}
          controller={editor}
        />
      </div>
    </CamPage>
  );
}
