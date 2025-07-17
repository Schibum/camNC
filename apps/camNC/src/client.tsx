/* eslint-disable react-refresh/only-export-components */
import { StartClient } from '@tanstack/react-start';
import { setKeepAliveTime } from '@wbcnc/go2webrtc/use-video-source';
import { initFbApp } from '@wbcnc/public-config/firebase';
import { hydrateRoot } from 'react-dom/client';
import { useClerkFirebaseAuthSync } from './hooks/useClerkFirebaseAuthSync';
import { getCncApi } from './lib/fluidnc/fluidnc-singleton';
import { createRouter } from './router';

import './store/firebaseSync';

initFbApp();
// Create connection early
getCncApi();
setKeepAliveTime(60_000);

// Import your Publishable Key
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error('Add your Clerk Publishable Key to the .env file');
}

// // Set up a Router instance
// const router = createRouter({
//   routeTree,
//   defaultPreload: 'intent',
//   defaultPendingComponent: DefaultLoadingOverlay,
// });

// // Register things for typesafety
// declare module '@tanstack/react-router' {
//   interface Register {
//     router: typeof router;
//   }
// }

function FbAuthSync() {
  useClerkFirebaseAuthSync();
  return null;
}

const router = createRouter();

hydrateRoot(
  document,
  <>
    {/* <StrictMode> */}
    <StartClient router={router} />
    {/* </StrictMode> */}
  </>
);
