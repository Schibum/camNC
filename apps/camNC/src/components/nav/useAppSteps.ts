import { useCamJob } from '@/cam/camQueries';
import { useCamMachine } from '@/cam/machine/camMachine';
import { openAtMachine } from '@/cam/machine/openAtMachine';
import { useLocation, useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { Box, Factory, LayoutGrid, ListOrdered, type LucideIcon } from 'lucide-react';

export interface AppStep {
  key: 'model' | 'boards' | 'plan' | 'machine';
  label: string;
  icon: LucideIcon;
  current: boolean;
  /** No job to go to this step of. */
  disabled: boolean;
  /** A route to link to, or something to do first. */
  link?: {
    to: '/cam/$jobId/model' | '/cam/$jobId/boards' | '/cam/$jobId/plan' | '/visualize/2DView';
    params?: { jobId: string };
    search?: { board?: string };
  };
  onClick?: () => void;
  onPreload?: () => void;
}

const kPrepareRoute = /^\/cam\/([^/]+)\/(model|boards|plan)/;
const kMachineRoute = '/visualize/2DView';

/** The job in view (or at the machine) and its steps, from preparing it to the machine, which works without a job too. */
export function useAppSteps() {
  const pathname = useLocation({ select: l => l.pathname });
  const { board: shownBoard } = useSearch({ strict: false }) as { board?: string };
  const navigate = useNavigate();
  const router = useRouter();
  const machineJob = useCamMachine(s => s.jobId);
  const active = useCamMachine(s => s.active);
  const prepare = pathname.match(kPrepareRoute);
  const atMachine = pathname === kMachineRoute;
  const jobId = prepare?.[1] ?? machineJob ?? undefined;
  const { data: job } = useCamJob(jobId ?? '');
  // Entry keys start with their board's id (see `machineQueue`): Plan opens on the board at the machine.
  const machineBoard = atMachine && active ? job?.boards?.find(b => active.startsWith(`${b.id}:`))?.id : undefined;

  const prepareStep = (key: 'model' | 'boards' | 'plan', label: string, icon: LucideIcon): AppStep => ({
    key,
    label,
    icon,
    current: prepare?.[2] === key,
    disabled: !jobId,
    link: jobId
      ? {
          to: `/cam/$jobId/${key}`,
          params: { jobId },
          search: key === 'plan' && machineBoard ? { board: machineBoard } : undefined,
        }
      : undefined,
  });
  const steps: AppStep[] = [
    prepareStep('model', 'Model', Box),
    prepareStep('boards', 'Boards', LayoutGrid),
    prepareStep('plan', 'Plan', ListOrdered),
    {
      key: 'machine',
      label: 'Machine',
      icon: Factory,
      current: atMachine,
      disabled: false,
      ...(jobId && !atMachine
        ? {
            // The job on the bed, the board shown here selected: place, clamp, zero and cut it, and come back.
            onClick: () => {
              const to = openAtMachine(jobId, shownBoard);
              void navigate(to === '/start' ? { to, search: { for: 'cam', job: jobId, board: shownBoard } } : { to });
            },
            onPreload: () => void router.preloadRoute({ to: kMachineRoute }),
          }
        : { link: { to: kMachineRoute } }),
    },
  ];
  return { steps, jobName: jobId ? (job?.name ?? 'CAM job') : 'No job', current: steps.find(s => s.current) };
}
