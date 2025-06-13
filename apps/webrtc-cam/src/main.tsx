import { createRoot } from 'react-dom/client';
import './index.css';
// import "@wbcnc/ui/globals.css"

import { createRouter, ErrorComponent, RouterProvider } from '@tanstack/react-router';
import { initFbApp } from '@wbcnc/public-config/firebase';
import { ThemeProvider } from '@wbcnc/ui/components/theme-provider';
import { routeTree } from './routeTree.gen';

initFbApp();

// Set up a Router instance
const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingComponent: () => <div>Loading...</div>,
  defaultErrorComponent: ({ error }) => <ErrorComponent error={error} />,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  // <StrictMode>
  <ThemeProvider defaultTheme="dark">
    <RouterProvider router={router} />
  </ThemeProvider>
  // </StrictMode>
);
