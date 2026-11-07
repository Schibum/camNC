import { Hint } from '@/cam/Hint';
import { useMachineBusy } from '@/cam/machine/useMachineBusy';
import { useId, useRef, useState } from 'react';
import type { BoardV1 } from '@/cam/boards';
import type { CamJobV1 } from '@/cam/jobDb';
import { isDemoMode } from '../demo/demo-mode';
import { Button } from '@wbcnc/ui/components/button';
import { FlaskConical } from 'lucide-react';
import { launchRehearsal } from './rehearsal';

export function RehearsalButton({
  job,
  boards,
  ready,
  boardId,
  inBar = false,
}: {
  job: CamJobV1;
  boards: BoardV1[];
  ready: boolean;
  boardId?: string;
  /** In a job's top bar: small, and why it's off is a hint, as a second line would change the bar's height. */
  inBar?: boolean;
}) {
  const busy = useMachineBusy(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController | null>(null);
  const title = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (isDemoMode()) return null;
  const reason = busy
    ? 'Finish or stop the real machine job first.'
    : !ready
      ? 'Wait for every board to pass the planning checks.'
      : undefined;
  const start = async () => {
    if (pending || !ready || busy) return;
    abort.current = new AbortController();
    setPending(true);
    setError(null);
    try {
      await launchRehearsal(job, boards, abort.current.signal, boardId);
    } catch (e) {
      if (!abort.current?.signal.aborted) setError(e instanceof Error ? e.message : 'The rehearsal could not be saved. Try again.');
      setPending(false);
    }
  };
  const button = (
    <Button
      size={inBar ? 'sm' : undefined}
      variant="outline"
      disabled={!ready || !!busy}
      onClick={() => {
        setError(null);
        dialog.current?.showModal();
      }}>
      <FlaskConical /> Try on demo machine
    </Button>
  );
  return (
    <>
      {!inBar ? (
        <span className="flex flex-col items-start gap-1">
          {button}
          {reason && <span className="text-xs text-muted-foreground">{reason}</span>}
        </span>
      ) : reason ? (
        <Hint wrap text={reason}>
          {button}
        </Hint>
      ) : (
        button
      )}
      <dialog
        ref={dialog}
        onCancel={() => abort.current?.abort()}
        aria-labelledby={title}
        className="m-auto w-[calc(100%-2rem)] max-w-md overscroll-contain rounded-xl border bg-background p-6 text-foreground shadow-lg backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-black/50">
        <h2 id={title} className="text-lg font-medium">
          Try this job on a demo machine?
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Practice positioning the board, homing, probing and running with a simulated FluidNC. No real machine is used.
        </p>
        <div className="my-4 rounded-lg bg-muted p-3 text-sm">
          <p className="font-medium">
            {job.name} · {boards.length} {boards.length === 1 ? 'board' : 'boards'}
          </p>
          <p className="mt-1">Temporary copy. Your saved project and cut history stay unchanged.</p>
        </div>
        {error && (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              abort.current?.abort();
              dialog.current?.close();
            }}>
            Cancel
          </Button>
          <Button disabled={pending || !ready || !!busy} onClick={() => void start()}>
            {pending ? 'Preparing rehearsal…' : 'Start rehearsal'}
          </Button>
        </div>
      </dialog>
    </>
  );
}
