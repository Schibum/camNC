import { useStore } from '@/store/store';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setDemoModeForTest } from './demo-mode';
import { TryDemoCard } from './TryDemoCard';

afterEach(() => {
  cleanup();
  setDemoModeForTest(false);
  useStore.setState({ camSources: {}, activeCamId: null });
});

describe('TryDemoCard', () => {
  it('offers the demo to visitors without a camera, as a full page load', () => {
    render(<TryDemoCard />);
    expect(screen.getByRole('link', { name: /open the demo/i }).getAttribute('href')).toBe('/demo');
  });

  it('stays out of the way once a camera exists or inside the demo', () => {
    useStore.setState({ camSources: { a: { name: 'Cam', url: 'https://x/y.mp4', maxResolution: [1, 1] } } });
    const { container } = render(<TryDemoCard />);
    expect(container.textContent).toBe('');
    cleanup();
    useStore.setState({ camSources: {} });
    setDemoModeForTest(true);
    expect(render(<TryDemoCard />).container.textContent).toBe('');
  });
});
