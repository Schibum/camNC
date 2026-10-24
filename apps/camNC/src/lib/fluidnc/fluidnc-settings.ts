import log from 'loglevel';
import { getCncApi } from './machine';

/** Usable XY area in machine coordinates, from the controller's running config (`$Config/Dump`). */
export async function getFluidSettingsBounds() {
  try {
    const { xmin, xmax, ymin, ymax } = await getCncApi().readMachineBounds();
    return { xmin, xmax, ymin, ymax };
  } catch (err) {
    log.error('could not get/parse FluidNC bounds ' + err);
    return null;
  }
}
