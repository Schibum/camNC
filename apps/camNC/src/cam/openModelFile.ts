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

export async function createJobFromFile(file: File): Promise<CamJobV1> {
  if (!kModelFile.test(file.name)) throw new Error('Open a STEP (.step, .stp) or STL file.');
  return createJob(file);
}
