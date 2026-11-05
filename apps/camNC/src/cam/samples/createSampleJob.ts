import { createJob } from '../jobDb';
import { defaultCutting } from '../cuttingData';
import { kDefaultBit, kDefaultPlan } from '../planSettings';
import modelUrl from './kinderregal-standing.step?url';

/** Real assembled shelf: imported and laid flat by the same pipeline as the user's models. Dimensions in millimetres. */
export const sampleProject = { id: 'standing-shelf', revision: 1, name: 'Standing shelf', modelUrl } as const;

/** Uses the ordinary importer, planner and job storage. No machine settings or global cutting data are changed. */
export async function createSampleJob() {
  const response = await fetch(sampleProject.modelUrl);
  if (!response.ok) throw new Error('The sample model could not be loaded. Try again.');
  const file = new File([await response.arrayBuffer()], 'Standing shelf.step');
  return createJob(file, {
    name: sampleProject.name,
    origin: { kind: 'sample', id: sampleProject.id, revision: sampleProject.revision },
    // Fit one board per thickness instead of constraining a furniture project to the old tray's small stock.
    plan: { ...kDefaultPlan, material: 'plywood', tabs: true, cutting: defaultCutting(kDefaultBit.diameter, 'plywood') },
  });
}
