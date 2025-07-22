// src/router.tsx
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

import { dehydrate, hydrate, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';

// eslint-disable-next-line react-refresh/only-export-components
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
  // @snippet start example
  const queryClient = new QueryClient();

  //  const router = routerWithQueryClient(
  const router = createTanStackRouter({
    routeTree,
    // defaultPreload: 'intent',
    scrollRestoration: true,
    defaultPreloadStaleTime: 0, // Let React Query handle all caching, see https://tanstack.com/router/latest/docs/framework/react/guide/data-loading
    defaultPendingComponent: DefaultLoadingOverlay,
    defaultErrorComponent: err => <p>{err.error.stack}</p>,
    defaultNotFoundComponent: () => <p>not found</p>,
    context: { queryClient },
    dehydrate: () => {
      return {
        queryClientState: dehydrate(queryClient),
      };
    },
    // On the client, hydrate the loader client with the data
    // we dehydrated on the server
    hydrate: dehydrated => {
      console.log('hydrate', dehydrated);
      hydrate(queryClient, dehydrated.queryClientState);
    },
    // Optionally, we can use `Wrap` to wrap our router in the loader client provider
    Wrap: ({ children }) => {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    },
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
