import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SidebarProvider, SidebarTrigger } from '@wbcnc/ui/components/sidebar';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../style.css';
import { AppSidebar } from './app-sidebar';

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => '/visualize/2DView',
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('./CamSourceSelector', () => ({ CamSourceSelector: () => <button>Camera source</button> }));
vi.mock('./sidebar-auth', () => ({ SidebarAuthStatus: () => null }));

afterEach(cleanup);

function expectDarkSidebar(sidebar: HTMLElement) {
  const style = getComputedStyle(sidebar);
  expect(style.getPropertyValue('--sidebar').trim()).toBe('oklch(0.21 0.006 285.885)');
  expect(style.color).toBe('oklch(0.985 0 0)');
  expect(style.colorScheme).toBe('dark');
}

describe('app sidebar theme', () => {
  it('keeps the portaled drawer dark on a light page and preserves caller classes', () => {
    render(
      <SidebarProvider forceMobile>
        <SidebarTrigger />
        <AppSidebar className="sidebar-test" />
      </SidebarProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    const drawer = screen.getByRole('dialog');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(drawer.classList.contains('sidebar-test')).toBe(true);
    expectDarkSidebar(drawer);
    expect(getComputedStyle(drawer).backgroundColor).toBe('oklch(0.21 0.006 285.885)');
  });

  it('uses dark colors for the persistent sidebar too', () => {
    const { container } = render(
      <SidebarProvider>
        <AppSidebar collapsible="none" />
      </SidebarProvider>
    );
    const sidebar = container.querySelector<HTMLElement>('[data-slot="sidebar"]')!;
    expectDarkSidebar(sidebar);
    expect(getComputedStyle(sidebar).backgroundColor).toBe('oklch(0.21 0.006 285.885)');
  });
});
