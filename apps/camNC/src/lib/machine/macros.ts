/** Where a macro's content goes, mirroring the macro targets of the FluidNC WebUI. */
export type MacroKind = 'gcode' | 'sd' | 'localfs';

export interface Macro {
  id: string;
  name: string;
  kind: MacroKind;
  /** G-code lines for `gcode`, otherwise a file path such as `/park.nc`. */
  content: string;
}

/**
 * Starter macros for the LowRider V4 (Jackpot2, JP2_LR config): Z homes up to MPos 3, so G53 Z-5 is a safe
 * height just below the Z switches when the machine is homed.
 */
export const kDefaultMacros: Macro[] = [
  { id: 'lift-z', name: 'Lift Z 10 mm', kind: 'gcode', content: 'G91\nG0 Z10\nG90' },
  { id: 'retract-xy0', name: 'Retract & go to XY zero', kind: 'gcode', content: 'G53 G0 Z-5\nG90 G0 X0 Y0' },
  { id: 'z0', name: 'Go to Z zero', kind: 'gcode', content: 'G90 G0 Z0' },
  { id: 'park-front', name: 'Park (retract, front left)', kind: 'gcode', content: 'G53 G0 Z-5\nG53 G0 X10 Y10' },
];

/** The `$` command or lines that run a macro. */
export function macroCommands(macro: Macro): string {
  const path = macro.content.trim().startsWith('/') ? macro.content.trim() : `/${macro.content.trim()}`;
  switch (macro.kind) {
    case 'sd':
      return `$SD/Run=${path}`;
    case 'localfs':
      return `$LocalFS/Run=${path}`;
    default:
      return macro.content;
  }
}

interface WebUiMacro {
  name?: unknown;
  action?: unknown;
  type?: unknown;
  target?: unknown;
}

function findMacroArrays(value: unknown, out: WebUiMacro[][] = []): WebUiMacro[][] {
  if (Array.isArray(value)) {
    if (value.length && value.every(v => v && typeof v === 'object' && 'name' in v && ('action' in v || 'cmd' in v))) {
      out.push(value as WebUiMacro[]);
    }
    value.forEach(v => findMacroArrays(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(v => findMacroArrays(v, out));
  }
  return out;
}

/**
 * Import macros from the WebUI's `preferences.json` (WebUI v3 stores them as `{ name, action, type }`
 * with type `cmd`, `sd`, `fs` or `uri`). URI macros are skipped.
 */
export function parseWebUiMacros(json: string): Macro[] {
  const data = JSON.parse(json) as unknown;
  const macros: Macro[] = [];
  for (const list of findMacroArrays(data)) {
    for (const entry of list) {
      const raw = entry as Record<string, unknown>;
      const name = String(raw.name ?? '').trim();
      const action = String(raw.action ?? raw.cmd ?? '').trim();
      const type = String(raw.type ?? raw.target ?? 'cmd').toLowerCase();
      if (!name || !action) continue;
      const kind: MacroKind | null = type === 'sd' ? 'sd' : type === 'fs' || type === 'flash' ? 'localfs' : type === 'cmd' ? 'gcode' : null;
      if (!kind) continue;
      macros.push({ id: crypto.randomUUID(), name, kind, content: kind === 'gcode' ? action.replace(/;/g, '\n') : action });
    }
  }
  return macros;
}
