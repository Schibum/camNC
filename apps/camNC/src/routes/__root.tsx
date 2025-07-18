import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider } from '@wbcnc/ui/components/sidebar';
import { Toaster } from '@wbcnc/ui/components/sonner';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';

import { getDbClient } from '@/db';
import { useClerkFirebaseAuthSync } from '@/hooks/useClerkFirebaseAuthSync';
import { ClerkProvider } from '@clerk/clerk-react';
import { getAuth } from '@clerk/tanstack-react-start/server';
import { HeroUIProvider } from '@heroui/react';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getWebRequest } from '@tanstack/react-start/server';
import type { ReactNode } from 'react';
import appCss from '../style.css?url';

// Import your Publishable Key
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error('Add your Clerk Publishable Key to the .env file');
}

const getUserSettings = createServerFn().handler(async () => {
  const request = getWebRequest();
  if (!request) throw new Error('No request found');
  const { userId } = await getAuth(request).catch(err => {
    console.warn('Error getting auth', err);
    return { userId: null };
  });
  console.log('userId', userId);
  // Return the current time
  const dbRes = (await getDbClient().query('SELECT * FROM settings where user_id = $1', [userId])) as Array<{ settings_json: string }>;
  return dbRes[0];
});

export const Route = createRootRoute({
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
        title: 'camNC',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
  loader: async () => {
    return {
      settings: (await getUserSettings())?.settings_json,
    };
  },
  ssr: true,
});

function FbAuthSync() {
  useClerkFirebaseAuthSync();
  return null;
}

function RootComponent() {
  const data = Route.useLoaderData();
  console.log('data from loader', data.settings);
  return (
    <RootDocument>
      <FbAuthSync />
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
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
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
      <html>
        <head>
          <HeadContent />
        </head>
        <body>
          {children}
          <Scripts />
        </body>
      </html>
    </ClerkProvider>
  );
}
