import { exitDemo, isDemoMode } from '@/lib/demo/demo-mode';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import { camKeys } from '../camQueries';
import { createSampleJob } from './createSampleJob';

/** Creates an editable copy of the sample project and opens it. */
export function useOpenSample() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opening = useRef(false);
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
  return { open, pending, error };
}
