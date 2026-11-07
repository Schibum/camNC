import { signal } from '@preact/signals-react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useStore } from '@/store/store';
import { RunningView } from './RunningView';
const h = vi.hoisted(() => ({ api: null as unknown as import('@/lib/fluidnc/cnc-api').CncApi, hint: vi.fn() }));
vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.api, getExistingCncApi: () => h.api }));
vi.mock('@/lib/machine/jobs', () => ({
  isCamncJobFile: () => true,
  isJobOfToolpath: () => false,
  runningJobTitle: () => 'Old SD file',
  stopJob: vi.fn(),
  errorText: String,
}));
vi.mock('@/lib/machine/pauseHints', () => ({ pauseHint: h.hint }));
vi.mock('./controls', () => ({ PositionLine: () => null, OverridesPanel: () => null }));
vi.mock('./AlarmCard', () => ({ AlarmCard: () => null }));
vi.mock('./PauseSteps', () => ({ PauseSteps: () => <p>Wrong loaded program guidance</p> }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('P6 does not show loaded-program pause guidance for another camNC SD execution', () => {
  useStore.setState(useStore.getInitialState(), true);
  useStore.getState().updateToolpath('G21\nM0 (MSG Take out new part)\nG1 X2 F300', 'Different loaded program');
  h.api = {
    status: signal({ state: 'Hold', subState: 0 }),
    state: signal('Hold'),
    jobProgress: signal({ file: '/sd/camnc-11111111-1111-1111-1111-111111111111.gcode', percent: 20 }),
    jobStartedAt: signal(1),
    lastMessage: signal(null),
    overrides: signal({ feed: 100, rapid: 100, spindle: 100 }),
  } as unknown as typeof h.api;
  h.hint.mockReturnValue({ marker: {}, reason: 'Take out new part' });
  render(<RunningView />);
  expect(h.hint).not.toHaveBeenCalled();
  expect(screen.queryByText('Wrong loaded program guidance')).toBeNull();
  expect(screen.getByText(/Paused. Resume continues/)).toBeTruthy();
});
