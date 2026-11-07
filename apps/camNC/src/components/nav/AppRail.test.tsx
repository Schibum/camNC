import { setDemoModeForTest } from '@/lib/demo/demo-mode';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SidebarProvider } from '@wbcnc/ui/components/sidebar';
import type { ReactNode } from 'react';
// The app's styles: these tests measure real boxes.
import '@/style.css';
import { page } from '@vitest/browser/context';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCamMachine } from '@/cam/machine/camMachine';
import { PageHeader } from '@/components/page-header';
import { AppRail } from './AppRail';
import { useAppRail } from './appRailStore';

const route = vi.hoisted(() => ({ path: '/', board: undefined as string | undefined, navigate: vi.fn(), open: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useLocation: ({ select }: { select: (l: { pathname: string }) => string }) => select({ pathname: route.path }),
  useSearch: () => ({ board: route.board }),
  useNavigate: () => route.navigate,
  useRouter: () => ({ preloadRoute: () => undefined }),
  Link: ({
    children,
    to,
    params,
    search,
    className,
  }: {
    children: ReactNode;
    to: string;
    params?: { jobId: string };
    search?: { board?: string };
    className?: string;
  }) => (
    <a href={`${to.replace('$jobId', params?.jobId ?? '')}${search?.board ? `?board=${search.board}` : ''}`} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('@/cam/machine/openAtMachine', () => ({ openAtMachine: route.open }));
vi.mock('@/components/app-sidebar', () => ({ AppSidebar: () => <aside>The full panel</aside> }));

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SidebarProvider forceMobile>
        <AppRail />
      </SidebarProvider>
    </QueryClientProvider>
  );
const panel = () => within(screen.getByRole('navigation', { name: 'Steps and app menu' }));

beforeAll(() => setDemoModeForTest(true));
afterAll(() => setDemoModeForTest(false));
beforeEach(async () => {
  await page.viewport(1100, 800);
  route.path = '/cam/job/plan';
  route.board = undefined;
  useAppRail.setState({ rail: 'icons' });
  useCamMachine.setState({ jobId: null, active: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the left panel', () => {
  it('starts as icons, with the steps in the same place in every view', () => {
    const seen = ['/cam/job/model', '/cam/job/boards', '/cam/job/plan', '/visualize/2DView', '/cam', '/settings/bits'].map(path => {
      route.path = path;
      const view = show();
      const where = ['Model', 'Boards', 'Plan', 'Machine'].map(name => {
        const { left, top, width, height } = panel().getByText(name).getBoundingClientRect();
        return { left, top, width, height };
      });
      view.unmount();
      return where;
    });
    for (const where of seen) expect(where).toEqual(seen[0]);
  });

  it('marks the current step, and links the job’s others', () => {
    show();
    expect(panel().getByText('Plan').getAttribute('aria-current')).toBe('step');
    expect(panel().getByText('Boards').getAttribute('href')).toBe('/cam/job/boards');
  });

  it('without a job, leaves only the machine to go to', () => {
    route.path = '/settings/bits';
    show();
    expect(panel().getByText<HTMLButtonElement>('Model').disabled).toBe(true);
    expect(panel().getByText<HTMLButtonElement>('Plan').disabled).toBe(true);
    expect(panel().getByText('Machine').getAttribute('href')).toBe('/visualize/2DView');
    expect(panel().getByText('CAM/CAD').getAttribute('href')).toBe('/cam');
  });

  it('takes the board shown to the machine, and Plan back to the board at the machine', () => {
    route.board = 'a';
    route.open.mockReturnValue('/visualize/2DView');
    const view = show();
    fireEvent.click(panel().getByText('Machine'));
    expect(route.open).toHaveBeenCalledWith('job', 'a');
    expect(route.navigate).toHaveBeenCalledWith({ to: '/visualize/2DView' });
    view.unmount();

    route.path = '/visualize/2DView';
    useCamMachine.setState({ jobId: 'job', active: 'a:1' });
    show();
    expect(panel().getByText('Machine').getAttribute('aria-current')).toBe('step');
    expect(panel().getByText('Model').getAttribute('href')).toBe('/cam/job/model');
  });

  it('remembers Hide, and only stays open beside the page with room for it', async () => {
    const view = show();
    fireEvent.click(panel().getByText('Hide'));
    expect(useAppRail.getState().rail).toBe('hidden');
    expect(screen.queryByRole('navigation', { name: 'Steps and app menu' })).toBeNull();
    view.unmount();

    useAppRail.setState({ rail: 'full' });
    const narrow = show();
    expect(screen.queryByText('The full panel')).toBeNull();
    expect(panel().getByText('Plan')).toBeTruthy();
    narrow.unmount();

    await page.viewport(1440, 900);
    show();
    expect(screen.getByText('The full panel')).toBeTruthy();
  });

  it('once hidden, keeps the way back to the menu clear of the window edge in a page header', async () => {
    useAppRail.setState({ rail: 'hidden' });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SidebarProvider forceMobile>
          <PageHeader title="Get started" />
        </SidebarProvider>
      </QueryClientProvider>
    );
    const button = await screen.findByRole('button', { name: /^Open the menu/ });
    expect(button.getBoundingClientRect().left).toBeGreaterThanOrEqual(8);
  });

  it('is tabs at the bottom of a phone, whole and on screen', async () => {
    await page.viewport(375, 812);
    show();
    const tabs = screen.getByRole('navigation', { name: 'Steps' });
    expect(tabs.getBoundingClientRect().bottom).toBe(812);
    for (const name of ['Model', 'Boards', 'Plan', 'Machine', 'Menu']) {
      const { left, right } = within(tabs).getByText(name).getBoundingClientRect();
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(375);
    }
  });
});
