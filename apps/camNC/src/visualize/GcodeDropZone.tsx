import { isManufacturingLocked } from '@/cam/machine/camMachine';
import { useStore } from '@/store/store';
import { toast } from '@wbcnc/ui/components/sonner';
import { useEffect } from 'react';
import { isDemoMode } from '@/lib/demo/demo-mode';
import { camKeys } from '@/cam/camQueries';
import { kModelFile } from '@/cam/jobDb';
import { createJobFromFile } from '@/cam/openModelFile';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { wrongFileMessage } from './dropMessages';

const kGcodeFile = /\.(gcode|nc|ngc|tap|txt)$/i;

/**
 * Load a G-code file dropped anywhere on the page as the toolpath, entirely in the browser. A STEP/STL file starts a
 * new CAM job.
 */
export function GcodeDropZone() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (isManufacturingLocked()) {
        toast.info('Review or dismiss the original machine job before loading another file.');
        return;
      }
      const file = e.dataTransfer?.files[0];
      if (!file) return;
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
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [navigate, queryClient]);
  return null;
}
