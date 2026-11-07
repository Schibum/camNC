import { setDemoModeForTest } from '@/lib/demo/demo-mode';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { SidebarProvider } from '@wbcnc/ui/components/sidebar';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';
import type { ReactNode } from 'react';
// The app's styles: these tests measure real boxes.
import '@/style.css';
import { page } from '@vitest/browser/context';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CamJobBar } from './CamJobBar';
import { createJob } from './jobDb';
import { useCamMachine } from './machine/camMachine';
import { CamMachineHeader } from './machine/CamMachineHeader';

vi.mock('./machine/useMachineQueue', () => ({
  useMachineQueue: () => ({ recordQueue: [], done: new Set(), patchBoards: () => undefined }),
}));

const job = { name: 'Standing shelf', fileName: 'Standing shelf.step' };
const wide = <span style={{ display: 'inline-block', width: 300 }}>Something wide</span>;
const next = <button>Next: Boards</button>;

/** What each view puts in the bar's slots, from none to more than its share on a phone. */
const kViews: [ReactNode, ReactNode][] = [
  [undefined, next],
  [undefined, wide],
  [wide, wide],
  [wide, undefined],
];

const wrap = (children: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <TooltipProvider>
      <SidebarProvider defaultOpen={false}>
        <div style={{ width: '100%' }}>{children}</div>
      </SidebarProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

beforeAll(() => setDemoModeForTest(true));
afterAll(() => setDemoModeForTest(false));
afterEach(() => {
  cleanup();
  useCamMachine.setState({ jobId: null });
});

describe('the job top bar', () => {
  it('is the same height and starts the tools at the same place in every view', async () => {
    await page.viewport(1440, 900);
    const seen = kViews.map(([tools, actions]) => {
      const view = render(wrap(<CamJobBar job={job} tools={<span data-testid="tools">{tools}</span>} actions={actions} />));
      const where = {
        height: screen.getByRole('banner').getBoundingClientRect().height,
        tools: screen.getByTestId('tools').getBoundingClientRect().left,
      };
      view.unmount();
      return where;
    });
    for (const where of seen) expect(where).toEqual(seen[0]);
    expect(seen[0].height).toBe(44);
  });

  it('keeps the tools in place whatever the name, board and sample note', async () => {
    await page.viewport(1440, 900);
    const short = render(wrap(<CamJobBar job={{ ...job, name: 'A' }} tools={<span data-testid="tools" />} />));
    const before = screen.getByTestId('tools').getBoundingClientRect().left;
    short.unmount();
    const long = {
      ...job,
      name: 'A very long name for a job, longer than its slot',
      origin: { kind: 'sample', id: 's', revision: 1 } as const,
    };
    render(wrap(<CamJobBar job={long} board="A" tools={<span data-testid="tools" />} />));
    expect(screen.getByTestId('tools').getBoundingClientRect().left).toBe(before);
    expect(screen.getByRole('banner').getBoundingClientRect().height).toBe(44);
    expect(screen.getByText('· Board A')).toBeTruthy();
    expect(screen.getByText('Temporary rehearsal copy')).toBeTruthy();
  });

  it('clips nothing on a phone', async () => {
    await page.viewport(375, 812);
    for (const [tools, actions] of kViews) {
      const view = render(wrap(<CamJobBar job={job} tools={tools} actions={actions} board="A" />));
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
      view.unmount();
    }
  });

  it('has the file name on the job’s name', () => {
    render(wrap(<CamJobBar job={job} />));
    expect(screen.getByText('Standing shelf').closest('[title]')?.getAttribute('title')).toBe('Standing shelf.step');
  });
});

describe('the machine view header', () => {
  it('is the job bar while a job is at the machine', async () => {
    await page.viewport(1440, 900);
    const { id } = await createJob(new File(['x'], 'tray.stl'));
    useCamMachine.setState({ jobId: id });
    render(wrap(<CamMachineHeader title="Top View" tools={<span>view switcher</span>} actions={<span>toolbar</span>} />));
    expect(await screen.findByText('tray')).toBeTruthy();
    expect(screen.queryByText('Top View')).toBeNull();
    expect(screen.getByText('view switcher').closest('header')).toBe(screen.getByText('toolbar').closest('header'));
  });

  it('is the view’s title and its tools without a job', () => {
    render(wrap(<CamMachineHeader title="Top View" tools={<span>view switcher</span>} actions={<span>toolbar</span>} />));
    expect(screen.getByText('Top View')).toBeTruthy();
    expect(screen.getByText('view switcher').closest('header')).toBe(screen.getByText('toolbar').closest('header'));
  });
});
