import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoundsInfo } from './BoundsInfo';
import { getTimeAgoLocale } from './timeAgoLocale';

const pnpResult = vi.hoisted(() => ({ lastPnPTime: Date.now() - 120_000, lastReprojectionError: 0.2 }));

vi.mock('@/store/store', () => ({
  useStore: (selector: (state: { toolpath: undefined }) => unknown) => selector({ toolpath: undefined }),
  usePnPResult: () => pnpResult,
}));
vi.mock('@tanstack/react-router', () => ({
  ClientOnly: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./RecomputePnpButton', () => ({ RecomputePnpButton: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('relative-time locale', () => {
  it.each(['en-US@posix', 'en_US', ''])('falls back to English for invalid locale %s', language => {
    expect(getTimeAgoLocale(language)).toBe('en');
  });

  it('falls back to English when no browser locale is available', () => {
    expect(getTimeAgoLocale(undefined)).toBe('en');
  });

  it('preserves and canonicalizes valid non-English locales', () => {
    expect(getTimeAgoLocale('de-at')).toBe('de-AT');
  });
});

describe('BoundsInfo relative time', () => {
  it.each([
    { language: 'en-US@posix', expectedLocale: 'en' },
    { language: 'de-AT', expectedLocale: 'de-AT' },
  ])('renders real TimeAgo with browser locale $language', ({ language, expectedLocale }) => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(language);
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue([language]);
    pnpResult.lastPnPTime = Date.now() - 120_000;

    const { container } = render(<BoundsInfo />);

    expect(container.querySelector('time')?.textContent).toBe(
      new Intl.RelativeTimeFormat(expectedLocale, { numeric: 'auto', style: 'long' }).format(-2, 'minute')
    );
  });
});
