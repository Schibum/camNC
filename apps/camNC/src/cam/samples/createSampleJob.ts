import { DEFAULT_TABS } from '@wbcnc/cam/settings';
import { createJob } from '../jobDb';
import { defaultCutting } from '../cuttingData';
import { kDefaultBit, kDefaultPlan } from '../planSettings';
import modelUrl from './pocket-tray.stl?url';

/** Original camNC example, under the repository's Apache-2.0 license. Millimetres; 6 mm deep pockets in 12 mm stock. */
export const pocketTray = { id: 'pocket-tray', revision: 1, name: 'Pocket tray', modelUrl } as const;

/** Uses the ordinary importer, planner and job storage. No machine settings or global cutting data are changed. */
export async function createSampleJob() {
  const response = await fetch(pocketTray.modelUrl);
  if (!response.ok) throw new Error('The sample model could not be loaded. Try again.');
  const file = new File([await response.arrayBuffer()], 'Pocket tray.stl', { type: 'model/stl' });
  return createJob(file, {
    name: pocketTray.name,
    origin: { kind: 'sample', id: pocketTray.id, revision: pocketTray.revision },
    // Keep this example reproducible even when the viewer has saved cutting data for the built-in bit.
    plan: { ...kDefaultPlan, material: 'plywood', tabs: true, cutting: defaultCutting(kDefaultBit.diameter, 'plywood') },
    stock: [{ id: 'sample-stock', thickness: 12, w: 400, h: 300 }],
    boards: [
      {
        id: 'sample-board',
        name: 'A',
        thickness: 12,
        material: 'plywood',
        size: { fit: false, w: 400, h: 300 },
        holdDown: 'tabs',
        tabs: DEFAULT_TABS,
        items: [],
      },
    ],
  });
}
