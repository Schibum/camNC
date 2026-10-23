import { SettingsSyncGate } from '@/lib/settings-sync/SettingsSyncGate';
import { ClerkProvider } from '@clerk/clerk-react';
import { RouterProvider } from '@tanstack/react-router';
import { setKeepAliveTime } from '@wbcnc/go2webrtc/use-video-source';
import { createRoot } from 'react-dom/client';
import { getCncApi } from './lib/fluidnc/fluidnc-singleton';
import { createRouter } from './router';
import './style.css';

/**
 * The Clerk key comes from the Worker, so the same build works in production and in previews (each
 * with its own Clerk instance). VITE_CLERK_PUBLISHABLE_KEY is the fallback for `pnpm dev` without `dev:api`.
 */
async function loadPublishableKey(): Promise<string | undefined> {
  try {
    const resp = await fetch('/api/config');
    if (resp.ok) {
      const { clerkPublishableKey } = (await resp.json()) as { clerkPublishableKey?: string };
      if (clerkPublishableKey) return clerkPublishableKey;
    }
  } catch {
    // Fall through to the build-time key.
  }
  return import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
}

const PUBLISHABLE_KEY = await loadPublishableKey();

if (!PUBLISHABLE_KEY) {
  throw new Error('No Clerk publishable key: set CLERK_PUBLISHABLE_KEY on the Worker or VITE_CLERK_PUBLISHABLE_KEY in .env.local');
}

setKeepAliveTime(60_000);
const router = createRouter();

createRoot(document.getElementById('app')!).render(
  <ClerkProvider
    publishableKey={PUBLISHABLE_KEY}
    appearance={{
      elements: {
        organizationSwitcherPopoverRootBox: {
          width: '100%',
          pointerEvents: 'auto',
        },
        userButtonPopoverRootBox: {
          width: '100%',
          pointerEvents: 'auto',
        },
      },
    }}>
    {/* Create the FluidNC connection once the synced settings (incl. fluidncToken) are loaded. */}
    <SettingsSyncGate onReady={getCncApi}>
      <RouterProvider router={router} />
    </SettingsSyncGate>
  </ClerkProvider>
);
