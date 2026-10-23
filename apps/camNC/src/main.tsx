import { SettingsSyncGate } from '@/lib/settings-sync/SettingsSyncGate';
import { ClerkProvider } from '@clerk/clerk-react';
import { RouterProvider } from '@tanstack/react-router';
import { setKeepAliveTime } from '@wbcnc/go2webrtc/use-video-source';
import { createRoot } from 'react-dom/client';
import { getCncApi } from './lib/fluidnc/fluidnc-singleton';
import { createRouter } from './router';
import './style.css';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error('Add your Clerk Publishable Key to the .env file');
}

// Create connection early
getCncApi();
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
    <SettingsSyncGate>
      <RouterProvider router={router} />
    </SettingsSyncGate>
  </ClerkProvider>
);
