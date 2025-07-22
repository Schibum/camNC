import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider } from '@wbcnc/ui/components/sidebar';
import { Toaster } from '@wbcnc/ui/components/sonner';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';

import { getDb } from '@/db/db';
import { users } from '@/db/schema';
import { ClerkProvider } from '@clerk/tanstack-react-start';
import { clerkClient, getAuth } from '@clerk/tanstack-react-start/server';
import { HeroUIProvider } from '@heroui/react';
import { QueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getWebRequest } from '@tanstack/react-start/server';
import { initFbApp } from '@wbcnc/public-config/firebase';
import { eq } from 'drizzle-orm';
import type { ReactNode } from 'react';
import z from 'zod';
import appCss from '../style.css?url';

// Import your Publishable Key
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error('Add your Clerk Publishable Key to the .env file');
}

// Currently used for webrtc-signalling
initFbApp();

async function getSafeAuth() {
  try {
    return await getAuth(getWebRequest());
  } catch {
    return null;
  }
}

const loadUserSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await getSafeAuth();
  if (!auth?.userId) return null;
  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.id, auth.userId),
  });
  console.log('server fn called', user?.settings, getWebRequest().url);
  return { user };
});

const updateUser = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      settings: z.record(z.any()),
    })
  )
  .handler(async ({ data }) => {
    const auth = await getSafeAuth();
    if (!auth?.userId) return null;
    const fullUser = await clerkClient().users.getUser(auth.userId);

    const db = getDb();
    const userData: typeof users.$inferInsert = {
      id: auth.userId,
      ...data,
      name: fullUser.fullName ?? '',
      email: fullUser.primaryEmailAddress?.emailAddress ?? '',
    };
    await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: [users.id],
        set: userData,
      });
    return { message: 'User updated' };
  });

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
        title: 'camNC',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  beforeLoad: async () => {
    console.log('beforeLoad');
  },
  staleTime: 60000,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      queryKey: ['userSettings'],
      queryFn: () => loadUserSettings(),
    });
    // await updateUser({
    //   data: {
    //     settings: {
    //       foo: 'my new setting',
    //     },
    //   },
    // });
    return {
      foo: 'bar',
      // userSettings: await loadUserSettings(),
    };
  },
  component: RootComponent,
  ssr: true,
});

function RootComponent() {
  const data = Route.useLoaderData();
  console.log('loader  data', data);
  const userSettings = useSuspenseQuery({
    queryKey: ['userSettings'],
    queryFn: () => loadUserSettings(),
    staleTime: Infinity,
  });
  console.log('userSettings form suspend query', userSettings.data?.user?.settings);
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
