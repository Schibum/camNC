import { PageHeader } from '@/components/page-header';
import { useEffect, type ReactNode } from 'react';
import { CamJobBar } from '../CamJobBar';
import { useCamJob } from '../camQueries';
import { cutsToRecord, useCamMachine } from './camMachine';
import { useMachineQueue } from './useMachineQueue';

/** Over the camera image: dark like the page, and it takes the pointer where the page around it lets it through. */
const kOverCamera = 'dark pointer-events-auto text-foreground';

/**
 * The machine view's top bar. While a CAM job is at the machine it's the job's bar, as in the prepare steps, to go back
 * to the board shown here (Plan opens on it) and change something. Without a job, one row with just the view's tools.
 */
export function CamMachineHeader({ title, tools, actions }: { title: string; tools: ReactNode; actions: ReactNode }) {
  const jobId = useCamMachine(s => s.jobId);
  if (jobId) return <JobHeader jobId={jobId} tools={tools} actions={actions} />;
  return (
    <PageHeader title={title} className={`${kOverCamera} h-auto flex-wrap p-1 pr-2`} hideDemoMark>
      <div className="pl-2">{tools}</div>
      {actions}
    </PageHeader>
  );
}

function JobHeader({ jobId, tools, actions }: { jobId: string; tools: ReactNode; actions: ReactNode }) {
  const active = useCamMachine(s => s.active);
  const { data: job } = useCamJob(jobId);
  // Entry keys start with their board's id (see `machineQueue`).
  const board = active ? job?.boards?.find(b => active.startsWith(`${b.id}:`)) : undefined;
  return (
    <>
      <RecordCuts />
      <CamJobBar job={job} board={board?.name} tools={tools} actions={actions} hideDemoMark className={kOverCamera} />
    </>
  );
}

/**
 * What's cut, kept with the job: a program marked done here is recorded on its board (`BoardV1.cut`), so Boards and
 * Plan show it and keep the board as it was cut, also after leaving the job here.
 */
function RecordCuts() {
  const { queue, done, patchBoards } = useMachineQueue();
  const cuts = cutsToRecord(queue, done);
  const key = cuts && JSON.stringify(Object.entries(cuts).map(([id, c]) => [id, c.keys, c.all]));
  useEffect(() => {
    if (cuts) patchBoards(Object.fromEntries(Object.entries(cuts).map(([id, cut]) => [id, { cut }])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
