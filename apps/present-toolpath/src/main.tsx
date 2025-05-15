import { RouterProvider, createRouter } from '@tanstack/react-router';
import { setKeepAliveTime } from '@wbcnc/go2webrtc/use-video-source';
import { initFbApp } from '@wbcnc/public-config/firebase';
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { getCncApi } from './fluidnc-hooks';
import { routeTree } from './routeTree.gen';
import './style.css';

initFbApp();
// Create connection early
getCncApi();
setKeepAliveTime(60_000);

// Set up a Router instance
const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingComponent: () => <div>Loading...</div>,
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
