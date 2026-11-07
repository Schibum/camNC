import { camKeys } from '@/cam/camQueries';
import { kModelFile } from '@/cam/jobDb';
import { isManufacturingLocked } from '@/cam/machine/camMachine';
import { createJobFromFile } from '@/cam/openModelFile';
import { isDemoMode } from '@/lib/demo/demo-mode';
import { useStore } from '@/store/store';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from '@wbcnc/ui/components/sonner';
import { useCallback } from 'react';
import { wrongFileMessage } from './dropMessages';

const kGcodeFile = /\.(gcode|nc|ngc|tap|txt)$/i;

/** Let the user pick any file `useOpenFile` can open; resolves to null if nothing was picked. */
export function pickFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gcode,.nc,.ngc,.tap,.txt,.step,.stp,.stl';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Opens a file by its type: G-code becomes the toolpath, entirely in the browser, and a STEP/STL file starts a new CAM job. */
export function useOpenFile() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useCallback(
    async (file: File) => {
      if (isManufacturingLocked()) {
        toast.info('Review or dismiss the original machine job before loading another file.');
        return;
      }
      if (kModelFile.test(file.name)) {
        const job = await createJobFromFile(file);
        void queryClient.invalidateQueries({ queryKey: camKeys.jobs });
        void navigate({ to: '/cam/$jobId/model', params: { jobId: job.id } });
        return;
      }
      if (!kGcodeFile.test(file.name)) {
        toast.error(wrongFileMessage(window.location.pathname));
        return;
      }
      const gcode = await file.text();
      if (isManufacturingLocked()) return;
      useStore.getState().updateToolpath(gcode, file.name);
      toast.success(isDemoMode() ? `Loaded ${file.name}. It stays in your browser.` : `Loaded ${file.name}`);
    },
    [navigate, queryClient]
  );
}
