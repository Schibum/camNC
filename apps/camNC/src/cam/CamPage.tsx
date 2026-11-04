import { cn } from '@wbcnc/ui/lib/utils';
import { useLayoutEffect, type ReactNode } from 'react';

/** Where `ThemeProvider` (@wbcnc/ui) keeps a theme picked by hand: 'light', 'dark' or 'system'. */
const kThemeKey = 'wbcnc-ui-theme';

function storedTheme(): string | null {
  try {
    return localStorage.getItem(kThemeKey);
  } catch {
    return null;
  }
}

/**
 * The CAM pages follow the system's light or dark scheme (or a theme picked with `ThemeProvider`): while one is open,
 * the `dark` class sits on the root element like `ThemeProvider` puts it, so every `dark:` variant, the theme tokens
 * and the portaled menus and tooltips turn dark too. Leaving the CAM pages puts the root back as it was.
 */
function useCamColorScheme() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const before = root.classList.contains('dark');
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = storedTheme();
      root.classList.toggle('dark', theme === 'dark' || (theme !== 'light' && media.matches));
    };
    apply();
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
      root.classList.toggle('dark', before);
    };
  }, []);
}

/**
 * A CAM page: full height, in the system's color scheme, with the CAM contrast tweaks (`.cam-page` in style.css:
 * a darker violet under white text, darker grey meta text on light backgrounds).
 */
export function CamPage({ className, children }: { className?: string; children: ReactNode }) {
  useCamColorScheme();
  return <div className={cn('cam-page flex w-full min-w-0 flex-col bg-background text-foreground', className)}>{children}</div>;
}
