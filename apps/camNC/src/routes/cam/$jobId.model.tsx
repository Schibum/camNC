import { PageHeader } from '@/components/page-header';
import { camKeys, useCamJob, useCamModel, useSaveCamJob } from '@/cam/camQueries';
import { replaceModel } from '@/cam/jobDb';
import { CamJobBar } from '@/cam/model/CamJobBar';
import { ModelViewport, type ModelView } from '@/cam/model/ModelViewport';
import { PartInspector } from '@/cam/model/PartInspector';
import { PartList } from '@/cam/model/PartList';
import { pickModelFile } from '@/cam/openModelFile';
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
    if (!kModelFile.test(file.name)) return toast.error('Open a STEP (.step, .stp) or STL file.');
    queryClient.setQueryData(camKeys.job(job.id), await replaceModel(job, file));
  };
  const bar = (
    <CamJobBar
      jobId={job.id}
      fileName={job.fileName}
      step="Model"
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => void replace()}>
            Replace model…
          </Button>
          <Button size="sm" asChild>
            <Link to="/cam/$jobId/boards" params={{ jobId: job.id }}>
              Next: Boards
            </Link>
          </Button>
        </>
      }
    />
  );

  if (model.isError) return <Shell bar={bar} message={`Could not read ${job.fileName}: ${model.error.message}`} />;
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
  const milledById = new Map(job.parts.map(p => [p.id, p.milled]));
  const milled = (id: string) => milledById.get(id) ?? true;
  const part = parts.find(p => p.id === selected) ?? parts.find(p => milled(p.id)) ?? parts[0];
  const setMilled = (id: string, value: boolean) =>
    save.mutate({ ...job, parts: job.parts.map(p => (p.id === id ? { ...p, milled: value } : p)) });

  return (
    <Shell bar={bar}>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[320px_1fr_300px]">
        <PartList parts={parts} selectedId={part?.id ?? null} milled={milled} onSelect={setSelected} onMilledChange={setMilled} />
        <main className="relative flex min-h-[320px] flex-col bg-muted/30">
          <div className="flex items-center gap-2 px-4 py-3">
            <div role="group" aria-label="View" className="flex overflow-hidden rounded-md border">
              {(['assembled', 'flat'] as ModelView[]).map(v => (
                <button
                  key={v}
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={cn('h-8 px-3 text-sm', view === v ? 'bg-muted font-medium' : 'text-muted-foreground')}>
                  {v === 'assembled' ? 'As modeled' : 'Laid flat'}
                </button>
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
            onPlan={() => void navigate({ to: '/cam/$jobId/boards', params: { jobId: job.id } })}
          />
        )}
      </div>
    </Shell>
  );
}

function Shell({ bar, message, children }: { bar?: React.ReactNode; message?: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-dvh w-full min-w-0 flex-col">
      <PageHeader title="CAM (beta)" />
      {bar}
      {message && <p className="m-8 text-muted-foreground">{message}</p>}
      {children}
    </div>
  );
}
