import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './start';

const router = vi.hoisted(() => ({ navigate: vi.fn() }));
const store = vi.hoisted(() => ({ setMachineBounds: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => router.navigate,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('@/components/machine/MachineConnectionForm', () => ({ MachineConnectionForm: () => null }));
vi.mock('@/start/BedFromMachine', () => ({ BedFromMachine: () => null }));
vi.mock('@/lib/demo/TryDemoCard', () => ({ TryDemoCard: () => <p>Try the demo</p> }));
vi.mock('@/setup/MachineBoundsForm', () => ({ MachineBoundsForm: () => <p>Custom bounds form</p> }));
vi.mock('@/store/store', () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

const Start = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(() => {
  cleanup();
  router.navigate.mockReset();
  store.setMachineBounds.mockReset();
});

describe('getting started', () => {
  it('opens the workspace with a preset bed, no machine or camera needed', () => {
    render(<Start />);
    fireEvent.click(screen.getByRole('button', { name: /Full sheet/ }));
    expect(store.setMachineBounds).toHaveBeenCalledWith(0, 0, 1220, 2440);
    expect(router.navigate).toHaveBeenCalledWith({ to: '/visualize/2DView' });
  });

  it('offers a custom size, the demo and the camera setup', () => {
    render(<Start />);
    expect(screen.queryByText('Custom bounds form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Custom size…' }));
    expect(screen.getByText('Custom bounds form')).toBeTruthy();
    expect(screen.getByText('Try the demo')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set it up now' }).getAttribute('href')).toBe('/setup/url-entry');
  });
});
