import { AppRoot } from '@/components/app-root';
import { SidebarProvider } from '@wbcnc/ui/components/sidebar';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';
import { Outlet, createRootRouteWithContext, useRouterState } from '@tanstack/react-router';

interface IRouteContext {
  customSidebar: boolean;
}

export const Route = createRootRouteWithContext<IRouteContext>()({
  component: RootComponent,
});

function RootComponent() {
  const customSidebar = useRouterState({ select: s => s.matches }).some(m => m.context.customSidebar);
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={false}>
        {customSidebar && <Outlet />}
        {!customSidebar && <AppRoot>{<Outlet />}</AppRoot>}
      </SidebarProvider>
    </TooltipProvider>
  );
}
