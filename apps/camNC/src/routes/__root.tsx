import { AppSidebar } from '@/components/app-sidebar';
import { Outlet, createRootRoute } from '@tanstack/react-router';
import { SidebarProvider } from '@wbcnc/ui/components/sidebar';
import { Toaster } from '@wbcnc/ui/components/sonner';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';

export const Route = createRootRoute({
  component: RootComponent,
  // errorComponent: ErrorComponent,
});

function RootComponent() {
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={false} forceMobile={true}>
        <Toaster />
        <AppSidebar />
        <Outlet />
      </SidebarProvider>
    </TooltipProvider>
  );
}
