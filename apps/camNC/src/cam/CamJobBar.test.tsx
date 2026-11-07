import { setDemoModeForTest } from '@/lib/demo/demo-mode';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { SidebarProvider } from '@wbcnc/ui/components/sidebar';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';
import type { ReactNode } from 'react';
// The app's styles: these tests measure real boxes.
import '@/style.css';
import { page } from '@vitest/browser/context';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CamJobBar, type CamStep } from './CamJobBar';
import { createJob } from './jobDb';
import { useCamMachine } from './machine/camMachine';
import { CamMachineHeader } from './machine/CamMachineHeader';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => () => undefined,
  useSearch: () => ({}),
  Link: ({ children, search, className }: { children: ReactNode; search?: { board?: string }; className?: string }) => (
    <a href={search?.board ? `#${search.board}` : '#'} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('./machine/useMachineQueue', () => ({ useMachineQueue: () => ({ queue: [], done: new Set(), patchBoards: () => undefined }) }));

const job = { name: 'Standing shelf', fileName: 'Standing shelf.step' };
const board = { id: 'a', name: 'A' };
const wide = <span style={{ display: 'inline-block', width: 300 }}>Something wide</span>;
const next = <button>Next: Boards</button>;

/** What each view puts in the bar's slots, from none to more than its share. */
const kViews: [CamStep, ReactNode, ReactNode][] = [
  ['Model', undefined, next],
  ['Boards', undefined, wide],
  ['Plan', wide, wide],
  ['Machine', wide, undefined],
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

const box = (el: Element) => {
  const { left, top, width, height } = el.getBoundingClientRect();
  return { left, top, width, height };
};

/** Where the bar's shared controls and rows are. */
function layout() {
  const nav = screen.getByRole('navigation', { name: 'Steps' });
  return {
    sidebar: box(screen.getByRole('button', { name: 'Toggle Sidebar' })),
    steps: ['1 Model', '2 Boards', '3 Plan', 'At the machine'].map(name => box(within(nav).getByText(name))),
    tools: box(screen.getByRole('group', { name: "This step's tools" })),
  };
}

beforeAll(() => setDemoModeForTest(true));
afterAll(() => setDemoModeForTest(false));
afterEach(() => {
  cleanup();
  useCamMachine.setState({ jobId: null });
});

describe('the job top bar', () => {
  it('keeps the shared controls in the same place in every view on a desktop screen', async () => {
    await page.viewport(1440, 900);
    const seen = kViews.map(([step, tools, actions]) => {
      const view = render(wrap(<CamJobBar jobId="job" job={job} step={step} tools={tools} actions={actions} />));
      const where = layout();
      view.unmount();
      return where;
    });
    for (const where of seen) expect(where).toEqual(seen[0]);
  });

  it('keeps the steps in place whatever the name and board', async () => {
    await page.viewport(1440, 900);
    const short = render(wrap(<CamJobBar jobId="job" job={{ ...job, name: 'A' }} step="Plan" />));
    const before = layout();
    short.unmount();
    render(
      wrap(<CamJobBar jobId="job" job={{ ...job, name: 'A very long name for a job, longer than its slot' }} step="Plan" board={board} />)
    );
    expect(layout().steps).toEqual(before.steps);
    expect(screen.getByText('· Board A')).toBeTruthy();
  });

  it('clips nothing on a phone', async () => {
    await page.viewport(375, 812);
    for (const [step, tools, actions] of kViews) {
      const view = render(wrap(<CamJobBar jobId="job" job={job} step={step} tools={tools} actions={actions} board={board} />));
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
      for (const el of [...screen.getByRole('navigation', { name: 'Steps' }).children])
        expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(375);
      view.unmount();
    }
  });

  it('says where you are, the file on the name, and Plan opens on the board at the machine', () => {
    render(wrap(<CamJobBar jobId="job" job={{ ...job, origin: { kind: 'sample', id: 's', revision: 1 } }} step="Machine" board={board} />));
    expect(screen.getByText('At the machine').getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('3 Plan').getAttribute('href')).toBe('#a');
    expect(screen.getByText('2 Boards').getAttribute('href')).toBe('#');
    expect(screen.getByText('Standing shelf').closest('[title]')?.getAttribute('title')).toBe('Standing shelf.step');
    expect(screen.getByText('Temporary rehearsal copy')).toBeTruthy();
  });

  it('links to the steps and offers the machine from a prepare step', () => {
    render(wrap(<CamJobBar jobId="job" job={job} step="Boards" />));
    expect(screen.getByText('2 Boards').getAttribute('aria-current')).toBe('step');
    expect(screen.getByRole('button', { name: 'At the machine' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '3 Plan' })).toBeTruthy();
  });
});

describe('the machine view header', () => {
  it('is the job bar while a job is at the machine', async () => {
    await page.viewport(1440, 900);
    const { id } = await createJob(new File(['x'], 'tray.stl'));
    useCamMachine.setState({ jobId: id });
    render(wrap(<CamMachineHeader title="Top View" tools={<span>view switcher</span>} actions={<span>toolbar</span>} />));
    expect(await screen.findByText('tray')).toBeTruthy();
    const slots = within(screen.getByRole('group', { name: "This step's tools" }));
    expect(slots.getByText('view switcher')).toBeTruthy();
    expect(slots.getByText('toolbar')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Steps' })).toBeTruthy();
  });

  it('is one row with the view title and its tools without a job', () => {
    render(wrap(<CamMachineHeader title="Top View" tools={<span>view switcher</span>} actions={<span>toolbar</span>} />));
    expect(screen.getByText('Top View')).toBeTruthy();
    expect(screen.getByText('view switcher').closest('header')).toBe(screen.getByText('toolbar').closest('header'));
    expect(screen.queryByRole('navigation', { name: 'Steps' })).toBeNull();
  });
});
