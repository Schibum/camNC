import { AppRoot } from '@/components/app-root';
import { SidebarProvider } from '@/components/ui/sidebar';
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
    <SidebarProvider defaultOpen={false}>
      {customSidebar && <Outlet />}
      {!customSidebar && <AppRoot>{<Outlet />}</AppRoot>}
    </SidebarProvider>
  );
}
