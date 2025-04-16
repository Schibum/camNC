import { Outlet, createRootRoute } from "@tanstack/react-router";
import { Toaster } from "@wbcnc/ui/components/sonner";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <div className="flex h-screen w-screen flex-col p-2">
      <Toaster />
      <Outlet />
    </div>
  );
}
