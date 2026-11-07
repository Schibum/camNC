import { useEffect, useRef } from 'react';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent } from '@wbcnc/ui/components/card';
import { ArrowRight, Box } from 'lucide-react';
import { useOpenSample } from './useOpenSample';

export function SampleProjectCard({ autoOpen = false }: { autoOpen?: boolean }) {
  const { open, pending, error } = useOpenSample();
  const autoStarted = useRef(false);
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
