// src/router.tsx
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';

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

  // @snippet start example
  //  const router = routerWithQueryClient(
  const router = createTanStackRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultPreloadStaleTime: 0, // Let React Query handle all caching
    defaultPendingComponent: DefaultLoadingOverlay,
    defaultErrorComponent: err => <p>{err.error.stack}</p>,
    defaultNotFoundComponent: () => <p>not found</p>,
    // context: {},
  });
  //   queryClient
  // );
  // @snippet end example

  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
