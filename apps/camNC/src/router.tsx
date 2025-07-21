// src/router.tsx
import { ConvexQueryClient } from '@convex-dev/react-query';
import { QueryClient } from '@tanstack/react-query';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { routerWithQueryClient } from '@tanstack/react-router-with-query';
import { routeTree } from './routeTree.gen';

import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { ConvexProvider, ConvexReactClient } from 'convex/react';

function DefaultLoadingOverlay() {
  return (
    <div className="w-full h-dvh flex items-center justify-center">
      <div className="flex flex-col items-center justify-center gap-4">
        <LoadingSpinner className="size-10" />
        <div className="text-gray-500 text-xl">Loading...</div>
      </div>
    </div>
  );
}

export function createRouter() {
  const CONVEX_URL = (import.meta as any).env.VITE_CONVEX_URL!;
  if (!CONVEX_URL) {
    throw new Error('missing VITE_CONVEX_URL envar');
  }
  const convex = new ConvexReactClient(CONVEX_URL, {
    unsavedChangesWarning: false,
  });
  const convexQueryClient = new ConvexQueryClient(convex);

  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
        gcTime: 5000,
      },
    },
  });
  convexQueryClient.connect(queryClient);

  // @snippet start example
  const router = routerWithQueryClient(
    createTanStackRouter({
      routeTree,
      defaultPreload: 'intent',
      scrollRestoration: true,
      defaultPreloadStaleTime: 0, // Let React Query handle all caching
      defaultPendingComponent: DefaultLoadingOverlay,
      defaultErrorComponent: err => <p>{err.error.stack}</p>,
      defaultNotFoundComponent: () => <p>not found</p>,
      context: { queryClient, convexClient: convex, convexQueryClient },
      Wrap: ({ children }) => <ConvexProvider client={convexQueryClient.convexClient}>{children}</ConvexProvider>,
    }),
    queryClient
  );
  // @snippet end example

  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
