import { useStore } from '@/store/store';
import { toast } from '@wbcnc/ui/components/sonner';
import { useEffect } from 'react';
import { isDemoMode } from '@/lib/demo/demo-mode';
import { kStepFile } from '@/cam/openStepFile';
import { useCamJob } from '@/cam/camJobStore';
import { useNavigate } from '@tanstack/react-router';

const kGcodeFile = /\.(gcode|nc|ngc|tap|txt)$/i;

/** Load a G-code file dropped anywhere on the page as the toolpath, entirely in the browser. STEP files go to the CAM
 * page. */
export function GcodeDropZone() {
  const navigate = useNavigate();
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      if (kStepFile.test(file.name)) {
        void useCamJob.getState().openStep(file);
        void navigate({ to: '/cam' });
        return;
      }
      if (!kGcodeFile.test(file.name)) {
        toast.error('Drop a G-code (.gcode, .nc) or STEP (.step) file.');
        return;
      }
      useStore.getState().updateToolpath(await file.text(), file.name);
      toast.success(isDemoMode() ? `Loaded ${file.name}. It stays in your browser.` : `Loaded ${file.name}`);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [navigate]);
  return null;
}
