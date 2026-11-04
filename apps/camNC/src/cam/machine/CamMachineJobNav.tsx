import { Link } from '@tanstack/react-router';
import { cn } from '@wbcnc/ui/lib/utils';
import { useCamJob } from '../camQueries';
import { useCamMachine } from './camMachine';

const kSteps = [
  { label: 'Model', to: '/cam/$jobId/model' },
  { label: 'Boards', to: '/cam/$jobId/boards' },
  { label: 'Plan', to: '/cam/$jobId/plan' },
] as const;

/**
 * In the machine view's header while a CAM job is at the machine: its name and its steps, to go back to the board
 * shown here (Plan opens on it) and change something. "At the machine" is where you are.
 */
export function CamMachineJobNav() {
  const jobId = useCamMachine(s => s.jobId);
  const active = useCamMachine(s => s.active);
  const { data: job } = useCamJob(jobId ?? '');
  if (!jobId) return null;
  // Entry keys start with their board's id (see `machineQueue`).
  const board = active ? job?.boards?.find(b => active.startsWith(`${b.id}:`)) : undefined;
  return (
    <nav aria-label="CAM job steps" className="flex flex-wrap items-center gap-1 text-sm">
      <span className="max-w-40 truncate px-1 text-muted-foreground" title={job?.name}>
        {job?.name ?? 'CAM job'}
        {board && <span className="text-foreground"> · Board {board.name}</span>}
      </span>
      {kSteps.map(s => (
        <Link
          key={s.label}
          to={s.to}
          params={{ jobId }}
          search={s.label === 'Plan' && board ? { board: board.id } : undefined}
          className="whitespace-nowrap rounded-md px-2.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          {s.label}
        </Link>
      ))}
      <span aria-current="step" className={cn('whitespace-nowrap rounded-md bg-primary px-2.5 py-1 text-primary-foreground')}>
        At the machine
      </span>
    </nav>
  );
}
