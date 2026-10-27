import { parse as parseYaml } from 'yaml';
import { computeAxisBounds, FluidAxisConfig } from './parsers/axis-bounds';
import type { FluidncProtocol } from './protocol';

export interface MachineBounds {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  zmin: number;
  zmax: number;
}

/** Read the running configuration as YAML text (`$Config/Dump`, aka `$CD`). */
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
  const lines = await protocol.send(`$/${path}`);
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

export async function readMachineBounds(protocol: FluidncProtocol): Promise<MachineBounds> {
  return computeMachineBounds(parseConfig(await readConfigText(protocol)));
}
