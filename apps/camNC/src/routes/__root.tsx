import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider } from '@wbcnc/ui/components/sidebar';
import { Toaster } from '@wbcnc/ui/components/sonner';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';

import { DefaultLoadingOverlay } from '@/components/DefaultLoadingOverlay';
import { loadUserSettings } from '@/db/functions';
import { ClerkProvider } from '@clerk/tanstack-react-start';
import { HeroUIProvider } from '@heroui/react';
import { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import { initFbApp } from '@wbcnc/public-config/firebase';
import { stringify as devalueStringify } from 'devalue';
import type { ReactNode } from 'react';
import appCss from '../style.css?url';

// Import your Publishable Key
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error('Add your Clerk Publishable Key to the .env file');
}

// Currently used for webrtc-signalling
initFbApp();

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'camNC – Live Camera + CNC Toolpath Overlay',
      },
      {
        name: 'description',
        content: 'camNC aligns CNC toolpaths with a live camera feed so you can verify jobs before cutting.',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  ssr: true,
  staleTime: Infinity,
  scripts: ctx => {
    const userSettings = (ctx.loaderData as any)?.userSettings;
    if (userSettings) {
      return [{ id: '__APP_STATE__', type: 'application/json', children: devalueStringify(userSettings) }];
    }
    return [];
  },
  pendingComponent: function () {
    return (
      <RootDocument>
        <DefaultLoadingOverlay />
      </RootDocument>
    );
  },
  loader: async () => {
    const settings = await loadUserSettings();
    return {
      userSettings: settings,
    };
  },
  component: RootComponent,
});

function RootComponent() {
  return (
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
      <RootDocument>
        <HeroUIProvider>
          <TooltipProvider>
            <SidebarProvider defaultOpen={false} forceMobile={true}>
              <Toaster />
              <AppSidebar />
              <Outlet />
            </SidebarProvider>
          </TooltipProvider>
        </HeroUIProvider>
      </RootDocument>
    </ClerkProvider>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
