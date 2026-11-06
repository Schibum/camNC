import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDepthView } from '../depthViewStore';
import { parseGCode } from '../gcodeParsing';
import { getJobTimeline } from './jobTimeline';
import { SimTimeline } from './SimTimeline';

const api = vi.hoisted(() => ({
  jobProgress: { value: null as { file: string; percent: number } | null },
  machinePos: { value: null as { x: number; y: number; z: number } | null },
  status: { value: { wco: { x: 0, y: 0, z: 0 } } },
  jobStartedAt: { value: null as number | null },
}));
vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => api }));
vi.mock('@/lib/machine/jobs', () => ({ isJobOfToolpath: (file: string) => file.endsWith('/camnc.gcode') }));

const toolpath = parseGCode('G0 X0 Y0 Z5\nG1 Z-1 F60\nG1 X40 F600\nG0 Z5\n');

afterEach(() => {
  cleanup();
  useDepthView.setState({ simTime: null, simPlaying: false, simFollowJob: false, followedJob: null });
  api.jobProgress.value = null;
  api.jobStartedAt.value = null;
  api.machinePos.value = null;
});

function runJob() {
  // Past the plunge in the file; the tool is further back, halfway along the cut.
  api.jobProgress.value = { file: '/sd/camnc.gcode', percent: 80 };
  api.jobStartedAt.value = 1;
  api.machinePos.value = { x: 20, y: 0, z: -1 };
}

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

  it('follows a running job by default, at the tool rather than the read position', () => {
    runJob();
    render(<SimTimeline toolpath={toolpath} />);
    expect(useDepthView.getState().simFollowJob).toBe(true);
    expect(screen.getByRole('button', { name: 'Following job' })).toBeTruthy();
    const { times } = getJobTimeline(toolpath);
    const cut = toolpath.pathPoints.findIndex(p => p.x === 40);
    expect(useDepthView.getState().simTime).toBeCloseTo((times[cut - 1] + times[cut]) / 2);
  });

  it('plays freely after scrubbing, showing the job position, until back to live', () => {
    runJob();
    render(<SimTimeline toolpath={toolpath} />);
    const { times } = getJobTimeline(toolpath);
    const live = useDepthView.getState().simTime;
    fireEvent.change(screen.getByRole('slider', { name: 'Job time' }), { target: { value: String(times[1]) } });
    expect(useDepthView.getState().simFollowJob).toBe(false);
    expect(useDepthView.getState().simTime).toBeCloseTo(times[1]);
    expect(screen.getByTestId('job-done').style.width).not.toBe('0%');
    fireEvent.click(screen.getByRole('button', { name: 'Back to live' }));
    expect(useDepthView.getState().simFollowJob).toBe(true);
    expect(useDepthView.getState().simTime).toBeCloseTo(live!);
  });

  it('stays in free playback when coming back to the view during the same job, not for the next job', () => {
    runJob();
    const { unmount } = render(<SimTimeline toolpath={toolpath} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Job time' }), { target: { value: '0' } });
    unmount();
    const { unmount: unmountAgain } = render(<SimTimeline toolpath={toolpath} />);
    expect(useDepthView.getState().simFollowJob).toBe(false);
    unmountAgain();
    api.jobStartedAt.value = 2;
    render(<SimTimeline toolpath={toolpath} />);
    expect(useDepthView.getState().simFollowJob).toBe(true);
  });
});
