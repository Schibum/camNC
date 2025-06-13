import { Outlet, createRootRoute } from "@tanstack/react-router";
import { Toaster } from "@wbcnc/ui/components/sonner";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      <Toaster />
      <Outlet />
    </>
  );
}
