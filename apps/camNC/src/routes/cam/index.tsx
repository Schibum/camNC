import { PageHeader } from '@/components/page-header';
import { camKeys, useCamJobs } from '@/cam/camQueries';
import { deleteJob } from '@/cam/jobDb';
import { kModelFile } from '@/cam/jobDb';
import { createJobFromFile, pickModelFile, toastNotAModel } from '@/cam/openModelFile';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { toast } from '@wbcnc/ui/components/sonner';
import { Box, FileUp, Trash2, TriangleAlert } from 'lucide-react';

export const Route = createFileRoute('/cam/')({
  component: CamIndex,
});

const kWhen = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** CAM jobs: one per model file. Drop a STEP/STL anywhere (or pick one) to start a new one. */
function CamIndex() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: jobs } = useCamJobs();

  const open = async () => {
    const file = await pickModelFile();
    if (!file) return;
    if (!kModelFile.test(file.name)) return toastNotAModel(file.name);
    try {
      const job = await createJobFromFile(file);
      void queryClient.invalidateQueries({ queryKey: camKeys.jobs });
      void navigate({ to: '/cam/$jobId/model', params: { jobId: job.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string, name: string) => {
    await deleteJob(id);
    void queryClient.invalidateQueries({ queryKey: camKeys.jobs });
    toast(`Deleted ${name}`);
  };

  return (
    <div className="flex h-dvh w-full min-w-0 flex-col">
      <PageHeader title="CAM (beta)" />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 overflow-y-auto p-6">
        <button
          onClick={open}
          className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-10 text-center hover:bg-muted/50">
          <Box className="size-10 text-muted-foreground" />
          <span className="text-lg font-medium">Drop a STEP or STL file of your project</span>
          <span className="max-w-md text-sm text-muted-foreground">
            Boards and panels are found and laid flat automatically. Pockets, holes and outlines become G-code for your machine. Everything
            stays in this browser.
          </span>
          <span className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            <FileUp className="size-4" /> Open model…
          </span>
        </button>

        <p className="rounded-lg bg-violet-500/10 px-4 py-3 text-sm leading-relaxed">
          <span className="mr-2 rounded-full bg-violet-500/15 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300">
            Beta
          </span>
          Making G-code here is new: check every program in the top view and the simulation before you cut, and keep a hand near the stop
          button on the first run.
        </p>

        {!!jobs?.length && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">Recent jobs</h2>
            <ul className="divide-y rounded-lg border">
              {jobs.map(job => {
                const parts = job.parts.reduce((n, p) => n + (p.milled ? p.quantity : 0), 0);
                return (
                  <li key={job.id} className="flex items-center gap-3 px-4 py-3">
                    <Link to="/cam/$jobId/model" params={{ jobId: job.id }} className="flex min-w-0 grow flex-col hover:underline">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{job.name}</span>
                        {job.readError && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-2 py-px text-xs text-destructive">
                            <TriangleAlert className="size-3" /> Could not be read
                          </span>
                        )}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {job.fileName}
                        {job.parts.length > 0 && ` · ${parts} ${parts === 1 ? 'part' : 'parts'} to mill`} · {kWhen.format(job.updatedAt)}
                      </span>
                    </Link>
                    {job.readError ? (
                      <Button variant="outline" size="sm" aria-label={`Delete ${job.name}`} onClick={() => void remove(job.id, job.name)}>
                        <Trash2 /> Delete
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" aria-label={`Delete ${job.name}`} onClick={() => void remove(job.id, job.name)}>
                        <Trash2 />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
