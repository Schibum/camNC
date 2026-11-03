import { cleanup, render, screen } from '@testing-library/react';
// The app's styles: the CAM contrast tokens are what this is about.
import '@/style.css';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CamPage } from './CamPage';

/** prefers-color-scheme: dark (or not), with a way to flip it. */
function mockScheme(dark: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    get matches() {
      return dark;
    },
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
  return (next: boolean) => {
    dark = next;
    listeners.forEach(l => l());
  };
}

/** WCAG contrast of two computed colours (rgb() or any colour canvas understands). */
function contrast(fg: string, bg: string) {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const rgb = (c: string) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  };
  const lum = (c: number[]) =>
    c
      .map(v => v / 255)
      .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const [a, b] = [lum(rgb(fg)), lum(rgb(bg))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.classList.remove('dark');
  localStorage.removeItem('wbcnc-ui-theme');
});

describe('CAM pages', () => {
  it('follow the system dark scheme while open, and put the root back after', () => {
    const flip = mockScheme(true);
    const { unmount } = render(<CamPage>page</CamPage>);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    flip(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    flip(true);
    unmount();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('take a theme picked by hand over the system one', () => {
    mockScheme(true);
    localStorage.setItem('wbcnc-ui-theme', 'light');
    render(<CamPage>page</CamPage>);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('white on violet is at least 4.5:1, grey meta text on the muted cards too, in light and dark', () => {
    for (const dark of [false, true]) {
      mockScheme(dark);
      render(
        <CamPage>
          <span className="bg-primary text-primary-foreground">Next: Boards</span>
          <span className="bg-muted text-muted-foreground">600 × 300</span>
          <span className="text-muted-foreground/75">4 Check</span>
        </CamPage>
      );
      const style = (text: string) => getComputedStyle(screen.getByText(text));
      const next = style('Next: Boards');
      expect(contrast(next.color, next.backgroundColor)).toBeGreaterThanOrEqual(4.5);
      const meta = style('600 × 300');
      expect(contrast(meta.color, meta.backgroundColor)).toBeGreaterThanOrEqual(4.5);
      // A step that's not there yet: lighter, but 3:1 on the page.
      const page = getComputedStyle(screen.getByText('4 Check').parentElement!).backgroundColor;
      expect(contrast(style('4 Check').color, page)).toBeGreaterThanOrEqual(3);
      cleanup();
      vi.restoreAllMocks();
    }
  });
});
