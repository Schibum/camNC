import { getCncApi } from '@/lib/fluidnc/machine';
import { errorText } from '@/lib/machine/jobs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@wbcnc/ui/components/alert-dialog';
import { Button } from '@wbcnc/ui/components/button';
import { toast } from '@wbcnc/ui/components/sonner';
import type { SdFile } from '@wbcnc/fluidnc';
import { FileUp, Play, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function FileManager() {
  'use no memo';
  const api = getCncApi();
  const connected = api.isConnected.value;
  const idle = api.state.value === 'Idle';
  const [files, setFiles] = useState<SdFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    try {
      setFiles((await api.listFiles()).files);
    } catch (err) {
      toast.error('Could not list SD files', { description: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (connected) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  function uploadLocalFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gcode,.nc,.ngc,.tap,.txt';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const promise = file.text().then(text => api.uploadGcode(text, file.name));
      toast.promise(promise, { loading: `Uploading ${file.name}…`, success: 'Uploaded', error: err => `Upload failed: ${errorText(err)}` });
      await promise.catch(() => {});
      void refresh();
    };
    input.click();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-row gap-2">
        <Button size="sm" variant="outline" disabled={!connected || busy} onClick={refresh}>
          <RefreshCw /> Refresh
        </Button>
        <Button size="sm" variant="outline" disabled={!connected} onClick={uploadLocalFile}>
          <FileUp /> Upload file…
        </Button>
      </div>
      <ul className="flex flex-col divide-y text-sm" data-testid="sd-files">
        {files?.length === 0 && <li className="text-muted-foreground py-2">SD card is empty</li>}
        {files?.map(file => (
          <li key={file.name} className="flex flex-row items-center gap-2 py-1">
            <span className="flex-1 truncate" title={file.name}>
              {file.name}
            </span>
            {!file.isDirectory && <span className="text-xs text-muted-foreground tabular-nums">{formatSize(file.size)}</span>}
            {!file.isDirectory && (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Run"
                  disabled={!idle}
                  onClick={() =>
                    api.runFile(file.name).catch(err => toast.error(`Could not run ${file.name}`, { description: errorText(err) }))
                  }>
                  <Play />
                </Button>
                <Button size="icon" variant="ghost" title="Delete" disabled={!idle} onClick={() => setToDelete(file.name)}>
                  <Trash2 />
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <AlertDialog open={toDelete !== null} onOpenChange={open => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {toDelete}?</AlertDialogTitle>
            <AlertDialogDescription>The file is removed from the SD card.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                api
                  .deleteFile(toDelete!)
                  .then(refresh)
                  .catch(err => toast.error('Delete failed', { description: errorText(err) }))
              }>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
