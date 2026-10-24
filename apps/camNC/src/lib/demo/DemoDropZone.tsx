import { useStore } from '@/store/store';
import { toast } from '@wbcnc/ui/components/sonner';
import { useEffect } from 'react';
import { isDemoMode } from './demo-mode';

const kGcodeFile = /\.(gcode|nc|ngc|tap|txt)$/i;

/** Demo mode: load a dropped G-code file as the toolpath, entirely in the browser. */
export function DemoDropZone() {
  useEffect(() => {
    if (!isDemoMode()) return;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      if (!kGcodeFile.test(file.name)) {
        toast.error('Drop a G-code file (.gcode or .nc).');
        return;
      }
      useStore.getState().updateToolpath(await file.text(), file.name);
      toast.success(`Loaded ${file.name}. It stays in your browser.`);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
  return null;
}
