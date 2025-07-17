import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider } from '@wbcnc/ui/components/sidebar';
import { Toaster } from '@wbcnc/ui/components/sonner';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';

import { useClerkFirebaseAuthSync } from '@/hooks/useClerkFirebaseAuthSync';
import { ClerkProvider } from '@clerk/clerk-react';
import { HeroUIProvider } from '@heroui/react';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import appCss from '../style.css?url';

// Import your Publishable Key
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error('Add your Clerk Publishable Key to the .env file');
}

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
});

function FbAuthSync() {
  useClerkFirebaseAuthSync();
  return null;
}

function RootComponent() {
  return (
    <RootDocument>
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
      </ClerkProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html>
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
