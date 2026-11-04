import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent } from '@wbcnc/ui/components/card';
import { ArrowRight, Box } from 'lucide-react';
import { camKeys } from '../camQueries';
import { createSampleJob } from './createSampleJob';
import { exitDemo, isDemoMode } from '@/lib/demo/demo-mode';

export function SampleProjectCard({ autoOpen = false }: { autoOpen?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opening = useRef(false);
  const autoStarted = useRef(false);
  const open = useCallback(async () => {
    if (isDemoMode()) return exitDemo('/cam?sample=standing-shelf');
    if (opening.current) return;
    opening.current = true;
    setPending(true);
    setError(null);
    try {
      const job = await createSampleJob();
      await queryClient.invalidateQueries({ queryKey: camKeys.jobs });
      await navigate({ to: '/cam/$jobId/model', params: { jobId: job.id } });
    } catch (e) {
      setError(
        e instanceof DOMException
          ? 'The sample could not be saved in this browser. Check storage and browser permissions, then try again.'
          : e instanceof Error
            ? e.message
            : 'The sample could not be saved. Try again.'
      );
    } finally {
      setPending(false);
      opening.current = false;
    }
  }, [navigate, queryClient]);
  useEffect(() => {
    if (autoOpen && !autoStarted.current) {
      autoStarted.current = true;
      void open();
    }
  }, [autoOpen, open]);
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-5 p-5">
        <div className="flex size-20 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Box className="size-9" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
          <span className="text-xs font-medium text-primary">Start with an example</span>
          <h2 className="text-lg font-medium">Standing shelf</h2>
          <p className="text-sm text-muted-foreground">
            An assembled STEP shelf with multiple parts. Lay them flat, arrange boards and plan the cuts without a machine.
          </p>
          <Button variant="outline" disabled={pending} onClick={() => void open()}>
            {pending ? 'Opening sample…' : error ? 'Retry sample project' : 'Open sample project'} <ArrowRight aria-hidden />
          </Button>
          <p className="text-xs text-muted-foreground">Creates an editable copy saved in this browser.</p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
