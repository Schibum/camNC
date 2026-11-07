import { Link } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { Boxes } from 'lucide-react';
import { useCamJob } from './camQueries';

/** Boards and Plan with every part unticked: say why the step is empty, and the way back to the Model step. */
export function NoPartsToMill({ jobId }: { jobId: string }) {
  const { data: job } = useCamJob(jobId);
  const native = !!job?.design;
  return (
    <div role="status" className="m-8 flex max-w-xl flex-col items-start gap-3 rounded-lg border border-dashed p-5">
      <Boxes className="size-6 text-muted-foreground" aria-hidden />
      <p className="font-medium">No part to mill</p>
      <p className="text-sm text-muted-foreground">
        {native
          ? 'Finish a closed sketch in Design to prepare its flat parts for cutting.'
          : 'Every part of the model is unticked. Tick the parts you want to cut in the Model step and they go on boards here.'}
      </p>
      <Button size="sm" variant="outline" asChild>
        <Link to={native ? '/cam/$jobId/design' : '/cam/$jobId/model'} params={{ jobId }}>
          {native ? 'Back to Design' : 'Back to the Model step'}
        </Link>
      </Button>
    </div>
  );
}
