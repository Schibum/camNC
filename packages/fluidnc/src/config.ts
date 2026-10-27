import { parse as parseYaml } from 'yaml';
import { computeAxisBounds, FluidAxisConfig } from './parsers/axis-bounds';
import { FluidncError, type FluidncProtocol } from './protocol';

export interface MachineBounds {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  zmin: number;
  zmax: number;
}

/**
 * Read the running configuration as YAML text (`$Config/Dump`, aka `$CD`). Slow on 3.9.x and has been seen to coincide
 * with controller resets, so only use it on explicit request; {@link readAxisTravel} reads single items instead.
 */
export async function readConfigText(protocol: FluidncProtocol): Promise<string> {
  const lines = await protocol.send('$Config/Dump', { timeoutMs: 20_000 });
  return lines.filter(line => !line.startsWith('[MSG:')).join('\n');
}

/**
 * Read one config item by path, e.g. `axes/x/max_rate_mm_per_min`. FluidNC answers `$/axes/x/max_rate_mm_per_min=9000.000`.
 * Returns `null` when the controller does not report it.
 */
export async function readConfigItem(protocol: FluidncProtocol, path: string): Promise<string | null> {
  const prefix = `$/${path}=`;
  // Items the config does not contain (e.g. no homing section) answer with an error.
  const lines = await protocol.send(`$/${path}`).catch(err => {
    if (err instanceof FluidncError) return [] as string[];
    throw err;
  });
  const line = lines.find(l => l.toLowerCase().startsWith(prefix.toLowerCase()));
  return line ? line.slice(prefix.length).trim() : null;
}

/** Top XY speed in mm/min: the lower of the X and Y `max_rate_mm_per_min`, or `null` if unknown. */
export async function readMaxRateXY(protocol: FluidncProtocol): Promise<number | null> {
  const rates: number[] = [];
  for (const axis of ['x', 'y']) {
    const rate = Number(await readConfigItem(protocol, `axes/${axis}/max_rate_mm_per_min`));
    if (!(rate > 0)) return null;
    rates.push(rate);
  }
  return Math.min(...rates);
}

export function parseConfig(text: string): Record<string, unknown> {
  return (parseYaml(text) ?? {}) as Record<string, unknown>;
}

/** 4.x dumps axis keys as `X:`, 3.9.9 as `x:`. */
function axis(config: Record<string, unknown>, name: string): FluidAxisConfig {
  const axes = (config.axes ?? {}) as Record<string, FluidAxisConfig | undefined>;
  return axes[name.toLowerCase()] ?? axes[name.toUpperCase()] ?? {};
}

export function computeMachineBounds(config: Record<string, unknown>): MachineBounds {
  const x = computeAxisBounds(axis(config, 'x'));
  const y = computeAxisBounds(axis(config, 'y'));
  const z = computeAxisBounds(axis(config, 'z'));
  return { xmin: x.min, xmax: x.max, ymin: y.min, ymax: y.max, zmin: z.min, zmax: z.max };
}

/** Travel of one axis in machine coordinates, and whether soft limits enforce it. */
export interface AxisTravel {
  min: number;
  max: number;
  softLimits: boolean;
}

export type MachineTravel = Record<'x' | 'y' | 'z', AxisTravel | null>;

const toBool = (value: string | null) => (value === null ? undefined : /^(true|1|on|yes)$/i.test(value));
const toNumber = (value: string | null) => (value === null || value === '' || Number.isNaN(Number(value)) ? undefined : Number(value));

/**
 * Read each axis' travel with single config item queries (`$/axes/x/max_travel_mm`, …), like FluidNC computes its soft
 * limits. An axis is `null` when the controller does not report its `max_travel_mm`: then nothing is known, and
 * guessing FluidNC's defaults could raise false warnings.
 */
export async function readAxisTravel(protocol: FluidncProtocol): Promise<MachineTravel> {
  const read = async (name: 'x' | 'y' | 'z'): Promise<AxisTravel | null> => {
    const item = (path: string) => readConfigItem(protocol, `axes/${name}/${path}`);
    const maxTravel = toNumber(await item('max_travel_mm'));
    if (maxTravel === undefined) return null;
    const mpos = toNumber(await item('homing/mpos_mm'));
    const positive = toBool(await item('homing/positive_direction'));
    const softLimits = toBool(await item('soft_limits')) ?? false;
    const homing = mpos === undefined && positive === undefined ? undefined : { mpos_mm: mpos, positive_direction: positive };
    return { ...computeAxisBounds({ max_travel_mm: maxTravel, homing }), softLimits };
  };
  return { x: await read('x'), y: await read('y'), z: await read('z') };
}

/** Machine travel from single config items (see {@link readAxisTravel}). Throws if any axis is not reported. */
export async function readMachineBounds(protocol: FluidncProtocol): Promise<MachineBounds> {
  const { x, y, z } = await readAxisTravel(protocol);
  if (!x || !y || !z) throw new Error('The controller did not report the axis travel (axes/*/max_travel_mm)');
  return { xmin: x.min, xmax: x.max, ymin: y.min, ymax: y.max, zmin: z.min, zmax: z.max };
}
