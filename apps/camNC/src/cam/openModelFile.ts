import { toast } from '@wbcnc/ui/components/sonner';
import { createJob, kModelFile, type CamJobV1 } from './jobDb';

/** Let the user pick a STEP/STL file; resolves to the new job, or null if nothing was picked. */
export function pickModelFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.step,.stp,.stl';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export const kNotAModel = 'Not a STEP or STL file';

/** A file picked via "All files" (or dropped) that is no model: say so instead of doing nothing. */
export function toastNotAModel(fileName: string) {
  toast.error(kNotAModel, { description: `${fileName} can't be opened here. Open a .step, .stp or .stl file.` });
}

export async function createJobFromFile(file: File): Promise<CamJobV1> {
  if (!kModelFile.test(file.name)) throw new Error(`${kNotAModel}: ${file.name}`);
  return createJob(file);
}

/**
 * Why a model can't be used, for people: the CAD kernel's own errors ("occt failed to read STEP file") mean a broken
 * or incomplete file, and the fix is a fresh export.
 */
export function modelReadError(fileName: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Our own messages are already for people.
  if (/missing|no planar faces/.test(raw)) return raw;
  if (/\.stl$/i.test(fileName))
    return `${fileName} could not be read: the STL file may be damaged or incomplete. Export it again from your CAD program and open the new file.`;
  return `${fileName} could not be read: the STEP file may be damaged or incomplete. Export it again (in Fusion: File › Export › STEP) and open the new file.`;
}
