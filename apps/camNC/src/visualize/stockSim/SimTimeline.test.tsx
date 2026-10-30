import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDepthView } from '../depthViewStore';
import { parseGCode } from '../gcodeParsing';
import { getJobTimeline } from './jobTimeline';
import { SimTimeline } from './SimTimeline';

vi.mock('@/lib/fluidnc/machine', async () => {
  const { signal } = await import('@preact/signals-react');
  return { getCncApi: () => ({ jobProgress: signal(null) }) };
});
vi.mock('@/lib/machine/jobs', () => ({ isCamncJobFile: (file: string) => file.endsWith('/camnc.gcode') }));

const toolpath = parseGCode('G0 X0 Y0 Z5\nG1 Z-1 F60\nG1 X40 F600\nG0 Z5\n');

afterEach(() => {
  cleanup();
  useDepthView.setState({ simTime: null, simPlaying: false, simFollowJob: false });
});

describe('SimTimeline', () => {
  it('starts at the end of the job and shows the line there', () => {
    render(<SimTimeline toolpath={toolpath} />);
    const { total } = getJobTimeline(toolpath);
    expect(Number((screen.getByRole('slider', { name: 'Job time' }) as HTMLInputElement).value)).toBeCloseTo(total);
    expect(screen.getByText('4: G0 Z5')).toBeTruthy();
  });

  it('scrubs, steps with the keyboard and plays', () => {
    render(<SimTimeline toolpath={toolpath} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Job time' }), { target: { value: '0' } });
    expect(useDepthView.getState().simTime).toBe(0);
    act(() => void fireEvent.keyDown(window, { key: 'ArrowRight' }));
    expect(useDepthView.getState().simTime).toBeCloseTo(getJobTimeline(toolpath).times[1]);
    act(() => void fireEvent.keyDown(window, { key: 'End' }));
    expect(useDepthView.getState().simTime).toBeCloseTo(getJobTimeline(toolpath).total);
    // Playing from the end starts over.
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(useDepthView.getState().simPlaying).toBe(true);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });
});
