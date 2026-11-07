import { useEffect } from 'react';
import { useOpenFile } from './useOpenFile';

/** Opens a file dropped anywhere on the page: G-code as the toolpath, a STEP/STL file as a new CAM job. */
export function GcodeDropZone() {
  const openFile = useOpenFile();
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file) await openFile(file);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [openFile]);
  return null;
}
