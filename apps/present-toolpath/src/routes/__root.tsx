import { AppSidebar } from '@/components/app-sidebar';
import { Outlet, createRootRoute } from '@tanstack/react-router';
import { SidebarProvider } from '@wbcnc/ui/components/sidebar';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={false}>
        <AppSidebar />
        <Outlet />
      </SidebarProvider>
    </TooltipProvider>
  );
}
