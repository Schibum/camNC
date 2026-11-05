import { useBoardPlans, useCamJob, useCamModel } from '@/cam/camQueries';
import { layoutBlock, planBlock } from '@/cam/boardBlock';
import { kDefaultPlan } from '@/cam/planSettings';
import { missingParts, useJobBoards } from '@/cam/useJobBoards';
import { freezeRehearsalBoard } from '@/lib/rehearsal/boardSnapshot';
import { RehearsalButton } from '@/lib/rehearsal/RehearsalButton';
import { Link } from '@tanstack/react-router';

/** The setup detour keeps the explicit source job, even when another job is in the machine queue. */
export function CamJobRehearsal({ jobId, boardId }: { jobId: string; boardId?: string }) {
  const { data: job, isPending } = useCamJob(jobId);
  const model = useCamModel(job);
  const { boards, instances } = useJobBoards(job, model.data);
  const active = boards.filter(b => b.request.parts.length);
  const plans = useBoardPlans(
    job,
    active.map(b => ({ request: b.request, material: b.board.material })),
    !!model.data
  );
  const settings = job?.plan ?? kDefaultPlan;
  const missing = missingParts(boards, instances).filter(m => !settings.leaveOut?.includes(m.id));
  const ready =
    active.length > 0 &&
    !boards.some(b => layoutBlock(b, { bit: settings.bit.diameter, missing })) &&
    plans.every(p => p.data && !p.isPlaceholderData && !planBlock(p.data));
  if (isPending) return <p role="status">Loading your CAM project…</p>;
  if (!job)
    return (
      <p role="alert">
        This CAM project is no longer available.{' '}
        <Link to="/cam" className="underline">
          Open CAM
        </Link>
      </p>
    );
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm">{job.name} · Rehearse the whole job with a simulated controller. Your saved project stays unchanged.</p>
      {model.isError && (
        <p role="alert" className="text-sm text-destructive">
          {model.error.message}
        </p>
      )}
      <RehearsalButton job={job} boards={boards.map(b => freezeRehearsalBoard(b.board, b.nest))} ready={ready} boardId={boardId} />
      <Link to="/cam/$jobId/plan" params={{ jobId }} search={{ board: boardId }} className="text-sm underline">
        ← Back to Plan
      </Link>
    </div>
  );
}
