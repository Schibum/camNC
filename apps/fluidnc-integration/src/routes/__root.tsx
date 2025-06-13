import { Outlet, createRootRoute } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <div className="flex h-screen w-screen flex-col p-2">
      <Outlet />
    </div>
  );
}
