import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider } from '@wbcnc/ui/components/sidebar';
import { Toaster } from '@wbcnc/ui/components/sonner';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';

import { HeroUIProvider } from '@heroui/react';
import { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { initFbApp } from '@wbcnc/public-config/firebase';

// Currently used for webrtc-signalling
initFbApp();

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  staleTime: Infinity,
  component: RootComponent,
});

function RootComponent() {
  return (
    <HeroUIProvider>
      <TooltipProvider>
        <SidebarProvider defaultOpen={false} forceMobile={true}>
          <Toaster />
          <AppSidebar />
          <Outlet />
        </SidebarProvider>
      </TooltipProvider>
    </HeroUIProvider>
  );
}
