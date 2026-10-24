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
