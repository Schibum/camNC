import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider } from '@wbcnc/ui/components/sidebar';
import { Toaster } from '@wbcnc/ui/components/sonner';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';

import { useClerkFirebaseAuthSync } from '@/hooks/useClerkFirebaseAuthSync';
import { ClerkProvider } from '@clerk/clerk-react';
import { useAuth } from '@clerk/tanstack-react-start';
import { getAuth } from '@clerk/tanstack-react-start/server';
import { ConvexQueryClient } from '@convex-dev/react-query';
import { HeroUIProvider } from '@heroui/react';
import { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts, useRouteContext } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getWebRequest } from '@tanstack/react-start/server';
import { ConvexReactClient } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import type { ReactNode } from 'react';
import appCss from '../style.css?url';

// Import your Publishable Key
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error('Add your Clerk Publishable Key to the .env file');
}

const fetchClerkAuth = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getWebRequest();
  if (!request) throw new Error('No request found');

  const auth = await getAuth(getWebRequest()).catch(e => {
    console.warn('Error getting auth', e);
    return null;
  });
  if (!auth) return { userId: null, token: null };
  const token = await auth.getToken({ template: 'convex' });

  return {
    userId: auth.userId,
    token,
  };
});

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  convexClient: ConvexReactClient;
  convexQueryClient: ConvexQueryClient;
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
  component: RootComponent,
  beforeLoad: async ctx => {
    const auth = await fetchClerkAuth();
    const { userId, token } = auth;
    // During SSR only (the only time serverHttpClient exists),
    // set the Clerk auth token to make HTTP queries with.
    if (token) {
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token);
    }

    return {
      userId,
      token,
    };
  },
  ssr: true,
});

function FbAuthSync() {
  useClerkFirebaseAuthSync();
  return null;
}

function RootComponent() {
  const context = useRouteContext({ from: Route.id });
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
      <ConvexProviderWithClerk client={context.convexClient} useAuth={useAuth}>
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
      </ConvexProviderWithClerk>
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
