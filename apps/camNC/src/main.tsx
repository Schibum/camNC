import { DemoGate } from '@/lib/demo/DemoGate';
import { getRehearsalId, exitDemo, isDemoMode } from '@/lib/demo/demo-mode';
import { initDesktopApp, isDesktopApp } from '@/lib/desktop/desktop';
import { SettingsSyncGate } from '@/lib/settings-sync/SettingsSyncGate';
import { ClerkProvider } from '@clerk/clerk-react';
import { RouterProvider } from '@tanstack/react-router';
import { setKeepAliveTime } from '@wbcnc/go2webrtc/use-video-source';
import { createRoot } from 'react-dom/client';
import { getCncApi } from './lib/fluidnc/machine';
import { createRouter } from './router';
import './style.css';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Desktop and simulated sessions work locally without loading account services.
if (!PUBLISHABLE_KEY && !isDesktopApp() && !isDemoMode()) {
  throw new Error('Add your Clerk Publishable Key to the .env file');
}

setKeepAliveTime(60_000);
initDesktopApp();

// The demo's simulated machine and preset are loaded before anything renders or connects.
let ready = true;
if (isDemoMode()) {
  (await import('./lib/demo/demo-machine')).startDemo();
  if (getRehearsalId()) {
    try {
      await (await import('./lib/rehearsal/rehearsal')).prepareRehearsal();
    } catch {
      exitDemo('/cam?notice=rehearsal-expired');
      // Do not render or connect while the replacement page is loading.
      ready = false;
    }
  }
}

if (!isDemoMode()) {
  void import('./lib/rehearsal/snapshots').then(m => m.cleanExpiredSnapshots()).catch(() => {});
}

if (ready) {
  const router = createRouter();
  const Gate = isDemoMode() || isDesktopApp() ? DemoGate : SettingsSyncGate;

  const app = (
    // Connect to the configured machine once the synced settings (incl. the machine host) are loaded.
    <Gate onReady={getCncApi}>
      <RouterProvider router={router} />
    </Gate>
  );

  createRoot(document.getElementById('app')!).render(
    isDesktopApp() || isDemoMode() ? (
      app
    ) : (
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
        {app}
      </ClerkProvider>
    )
  );
}
