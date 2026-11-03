import { PageHeader } from '@/components/page-header';
import { CamPage } from '@/cam/CamPage';
import { camKeys, useCamJob, useCamModel, useSaveCamJob } from '@/cam/camQueries';
import { deleteJob, replaceModel } from '@/cam/jobDb';
import { CamJobBar } from '@/cam/model/CamJobBar';
import { Hint } from '@/cam/Hint';
import { ModelViewport, type ModelView } from '@/cam/model/ModelViewport';
import { PartInspector } from '@/cam/model/PartInspector';
import { PartList } from '@/cam/model/PartList';
import { pickModelFile, toastNotAModel } from '@/cam/openModelFile';
import { kModelFile } from '@/cam/jobDb';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate, useParams } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { toast } from '@wbcnc/ui/components/sonner';
import { cn } from '@wbcnc/ui/lib/utils';
import { useState } from 'react';

export const Route = createFileRoute('/cam/$jobId/model')({
  component: ModelStep,
});

/** Step 1 of a CAM job: which bodies of the model become boards, how each lies, what was detected on it. */
function ModelStep() {
  const { jobId } = useParams({ from: '/cam/$jobId/model' });
  const { data: job, isPending: jobPending } = useCamJob(jobId);
  const model = useCamModel(job);
  const save = useSaveCamJob();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<ModelView>('flat');

  if (jobPending) return <Shell />;
  if (!job) return <Shell message="This job doesn't exist (any more)." />;

  const replace = async () => {
    const file = await pickModelFile();
    if (!file) return;
    if (!kModelFile.test(file.name)) return toastNotAModel(file.name);
    queryClient.setQueryData(camKeys.job(job.id), await replaceModel(job, file));
  };
  const remove = async () => {
    await deleteJob(job.id);
    void queryClient.invalidateQueries({ queryKey: camKeys.jobs });
    toast(`Deleted ${job.name}`);
    void navigate({ to: '/cam' });
  };
  const milledById = new Map(job.parts.map(p => [p.id, p.milled]));
  const milled = (id: string) => milledById.get(id) ?? true;
  // Nothing to arrange: the model can't be read, or every part is unticked.
  const nextBlocked = model.isError
    ? 'The model could not be read: there are no parts to arrange.'
    : model.data && !model.data.parts.some(p => milled(p.id))
      ? 'No part is milled: tick at least one part to arrange it on boards.'
      : null;
  const bar = (
    <CamJobBar
      jobId={job.id}
      fileName={job.fileName}
      step="Model"
      actions={
        <>
          <Hint text="Open a new version of the model (STEP or STL). The job keeps its boards and settings.">
            <Button size="sm" variant="outline" onClick={() => void replace()}>
              Replace model…
            </Button>
          </Hint>
          {nextBlocked ? (
            <Hint text={nextBlocked} wrap>
              <Button size="sm" disabled>
                Next: Boards
              </Button>
            </Hint>
          ) : (
            <Button size="sm" asChild>
              <Link to="/cam/$jobId/boards" params={{ jobId: job.id }}>
                Next: Boards
              </Link>
            </Button>
          )}
        </>
      }
    />
  );

  if (model.isError)
    return (
      <Shell bar={bar}>
        <div role="alert" className="m-8 flex max-w-xl flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="font-medium">This model could not be read</p>
          <p className="text-sm text-muted-foreground">{model.error.message}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void replace()}>
              Open another file…
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void remove()}>
              Delete job
            </Button>
          </div>
        </div>
      </Shell>
    );
  if (!model.data)
    return (
      <Shell bar={bar}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <LoadingSpinner />
          <p>Reading {job.fileName}…</p>
          <p className="text-xs">The first model loads the CAD kernel (2.3 MB).</p>
        </div>
      </Shell>
    );

  const { parts, meshes } = model.data;
  const part = parts.find(p => p.id === selected) ?? parts.find(p => milled(p.id)) ?? parts[0];
  const setMilled = (id: string, value: boolean) =>
    save.mutate({ ...job, parts: job.parts.map(p => (p.id === id ? { ...p, milled: value } : p)) });
  // From the inspector and the part list alike: empty goes back to the model's name.
  const rename = (id: string, name: string) =>
    save.mutate({
      ...job,
      parts: job.parts.map(p => (p.id === id ? { ...p, name: name || (parts.find(x => x.id === id)?.modelName ?? p.name) } : p)),
    });

  return (
    <Shell bar={bar}>
      <div className="grid flex-1 grid-cols-1 md:min-h-0 md:grid-cols-[320px_1fr_300px]">
        <PartList
          parts={parts}
          selectedId={part?.id ?? null}
          milled={milled}
          onSelect={setSelected}
          onMilledChange={setMilled}
          onRename={rename}
        />
        <main className="relative flex min-h-[320px] flex-col bg-muted/30">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <div role="group" aria-label="View" className="flex shrink-0 overflow-hidden rounded-md border">
              {(['assembled', 'flat'] as ModelView[]).map(v => (
                <Hint key={v} text={kViewHints[v]} side="bottom">
                  <button
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={cn('h-8 whitespace-nowrap px-3 text-sm', view === v ? 'bg-muted font-medium' : 'text-muted-foreground')}>
                    {v === 'assembled' ? 'As modeled' : 'Laid flat'}
                  </button>
                </Hint>
              ))}
            </div>
            <span className="grow" />
            <span className="text-xs text-muted-foreground">
              {view === 'flat' ? 'Each part is turned so its machined side faces up. ' : ''}Drag to orbit.
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <ModelViewport meshes={meshes} parts={parts} view={view} selectedId={part?.id ?? null} milled={milled} onSelect={setSelected} />
          </div>
        </main>
        {part && (
          <PartInspector
            part={part}
            milled={milled(part.id)}
            onMilledChange={v => setMilled(part.id, v)}
            onRename={name => rename(part.id, name)}
          />
        )}
      </div>
    </Shell>
  );
}

const kViewHints: Record<ModelView, string> = {
  assembled: 'The parts where they sit in your model.',
  flat: 'Each part turned so its machined side faces up, the way it lies on the board.',
};

function Shell({ bar, message, children }: { bar?: React.ReactNode; message?: string; children?: React.ReactNode }) {
  return (
    <CamPage className="min-h-dvh md:h-dvh">
      <PageHeader title="CAM (beta)" />
      {bar}
      {message && <p className="m-8 text-muted-foreground">{message}</p>}
      {children}
    </CamPage>
  );
}
