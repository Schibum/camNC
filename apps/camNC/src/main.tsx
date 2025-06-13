/* eslint-disable react-refresh/only-export-components */
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { setKeepAliveTime } from '@wbcnc/go2webrtc/use-video-source';
import { initFbApp } from '@wbcnc/public-config/firebase';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { getCncApi } from './lib/fluidnc/fluidnc-singleton';
import { routeTree } from './routeTree.gen';
import './style.css';

initFbApp();
// Create connection early
getCncApi();
setKeepAliveTime(60_000);

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

// Set up a Router instance
const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingComponent: DefaultLoadingOverlay,
});

// Register things for typesafety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById('app')!;

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}
