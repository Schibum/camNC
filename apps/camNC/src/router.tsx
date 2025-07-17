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
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPendingComponent: DefaultLoadingOverlay,
    defaultNotFoundComponent: () => <div>Not Found</div>,
    // defaultSsr: false,
  });

  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
