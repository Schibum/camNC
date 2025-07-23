// src/router.tsx
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

import { dehydrate, hydrate, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DefaultLoadingOverlay } from './components/DefaultLoadingOverlay';

/**
 * Hack for hydrating zustand, prefer using it from the context elsewhere.
 * @deprecated
 **/
export function getQueryClientStatic() {
  return new QueryClient();
}

export function createRouter() {
  //  const router = routerWithQueryClient(
  const queryClient = new QueryClient();
  const router = createTanStackRouter({
    routeTree,
    // defaultPreload: 'intent',
    scrollRestoration: true,
    defaultPreloadStaleTime: 0, // Let React Query handle all caching, see https://tanstack.com/router/latest/docs/framework/react/guide/data-loading
    defaultPendingComponent: DefaultLoadingOverlay,
    defaultErrorComponent: err => <p>{err.error.stack}</p>,
    defaultNotFoundComponent: () => <p>not found</p>,
    context: { queryClient },
    defaultSsr: false,
    dehydrate: () => {
      return {
        queryClientState: dehydrate(queryClient),
      };
    },
    // On the client, hydrate the loader client with the data
    // we dehydrated on the server
    hydrate: dehydrated => {
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
