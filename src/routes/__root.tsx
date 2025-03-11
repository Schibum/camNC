import * as React from 'react';
import { Link, Outlet, createRootRoute } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      <div className="p-2 flex gap-2 text-lg">
        <Link
          to="/"
          activeProps={{
            className: 'font-bold',
          }}
          activeOptions={{ exact: true }}
        >
          Home
        </Link>{' '}
        <Link
          to="/about"
          activeProps={{
            className: 'font-bold',
          }}
        >
          About
        </Link>{' '}
        <Link
          to="/setup"
          activeProps={{
            className: 'font-bold',
          }}
        >
          Setup
        </Link>{' '}
        <Link
          to="/visualize"
          activeProps={{
            className: 'font-bold',
          }}
        >
          Visualize
        </Link>
        <Link
          to="/undistort2"
          activeProps={{
            className: 'font-bold',
          }}
        >
          Undistort
        </Link>
      </div>
      <hr />
      <Outlet />
      {/* <TanStackRouterDevtools position="bottom-right" /> */}
    </>
  );
}
