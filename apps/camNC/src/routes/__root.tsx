import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider } from '@wbcnc/ui/components/sidebar';
import { Toaster } from '@wbcnc/ui/components/sonner';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';

import { ClerkProvider } from '@clerk/tanstack-react-start';
import { HeroUIProvider } from '@heroui/react';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import type { ReactNode } from 'react';
import appCss from '../style.css?url';

// Import your Publishable Key
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error('Add your Clerk Publishable Key to the .env file');
}

const loadUserSettings = createServerFn({ method: 'GET' }).handler(async () => {
  console.log('server fn called');
  return { foo: 'bar' };
});

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Route = createRootRouteWithContext<{
  // queryClient: QueryClient;
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
        title: 'camNC',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  loader: async () => {
    return {
      userSettings: await loadUserSettings(),
    };
  },
  component: RootComponent,
  ssr: true,
});

function RootComponent() {
  const { userSettings } = Route.useLoaderData();
  console.log('userSettings', userSettings);
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
