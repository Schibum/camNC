import log from 'loglevel';
import { parse as parseYaml } from 'yaml';
import { computeAxisBounds } from './fluidnc-axis-bounds';
import { getCncApi } from './fluidnc-singleton';

export async function getFluidSettings() {
  const cncClient = getCncApi();
  const settings = await cncClient.readConfigFile();
  return parseYaml(settings);
}

export async function getFluidSettingsBounds() {
  try {
    const settings = await getFluidSettings();
    const { min: xmin, max: xmax } = computeAxisBounds(settings.axes.x);
    const { min: ymin, max: ymax } = computeAxisBounds(settings.axes.y);
    return { xmin, xmax, ymin, ymax };
  } catch (err) {
    log.error('could not get/parse FluidNc bounds ' + err);
    return null;
  }
}
