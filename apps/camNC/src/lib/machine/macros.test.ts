import { describe, expect, it } from 'vitest';
import { macroCommands, parseWebUiMacros } from './macros';

describe('macros', () => {
  it('maps file macros to the matching $ command', () => {
    expect(macroCommands({ id: '1', name: 'p', kind: 'sd', content: 'park.nc' })).toBe('$SD/Run=/park.nc');
    expect(macroCommands({ id: '1', name: 'p', kind: 'localfs', content: '/park.nc' })).toBe('$LocalFS/Run=/park.nc');
    expect(macroCommands({ id: '1', name: 'p', kind: 'gcode', content: 'G0 X0' })).toBe('G0 X0');
  });

  it('imports WebUI v3 macros from preferences.json', () => {
    const prefs = JSON.stringify({
      macros: [
        { id: 'a', name: 'Home', icon: 'Home', action: '$H', type: 'cmd' },
        { id: 'b', name: 'Probe', icon: 'Target', action: '/probe.nc', type: 'fs' },
        { id: 'c', name: 'Docs', icon: 'Link', action: 'https://example.com', type: 'uri' },
        { id: 'd', name: 'Multi', icon: 'X', action: 'G91;G0 Z5;G90', type: 'cmd' },
      ],
    });
    const macros = parseWebUiMacros(prefs);
    expect(macros.map(m => [m.name, m.kind, m.content])).toEqual([
      ['Home', 'gcode', '$H'],
      ['Probe', 'localfs', '/probe.nc'],
      ['Multi', 'gcode', 'G91\nG0 Z5\nG90'],
    ]);
  });
});
