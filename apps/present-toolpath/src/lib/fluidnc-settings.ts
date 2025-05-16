import log from 'loglevel';
import { parse as parseYaml } from 'yaml';
import { getCncApi } from './fluidnc-singleton';

export async function getFluidSettings() {
  const cncClient = getCncApi();
  const settings = await cncClient.readConfigFile();
  return parseYaml(settings);
}

// Compute the bounds of an axis based on the homing position and the max travel like here:
// https://github.com/bdring/FluidNC/blob/7de6a5de3bed8bb1f5fe2fd9cdd5a1bf392c02b6/FluidNC/src/Limits.cpp#L101
function computeAxisBounds(axis: any) {
  const origin = axis.homing.mpos_mm;
  const min = axis.positive_direction ? origin - axis.max_travel_mm : origin;
  const max = axis.positive_direction ? origin : origin + axis.max_travel_mm;
  return { min, max };
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
