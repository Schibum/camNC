import { AppSidebar } from '@/components/app-sidebar';
import { AppRail } from '@/components/nav/AppRail';
import { GcodeDropZone } from '@/visualize/GcodeDropZone';
import { SidebarProvider } from '@wbcnc/ui/components/sidebar';
import { Toaster } from '@wbcnc/ui/components/sonner';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';

import { HeroUIProvider } from '@heroui/react';
import { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

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
          <AppRail />
          <div className="flex min-w-0 flex-1 max-md:pb-14">
            <Outlet />
          </div>
          <GcodeDropZone />
        </SidebarProvider>
      </TooltipProvider>
    </HeroUIProvider>
  );
}
