import * as React from 'react'
import { Outlet, createFileRoute } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'

export const Route = createFileRoute('/setup/setup')({
  component: SetupComponent,
})

function SetupComponent() {
  return (
    <div className="p-2">
      <div className="camera-setup-wizard" style={{ userSelect: "none" }}>
        <div className="grid w-full grid-cols-2 mb-4 border-b">
          <Link
            to={'/setup/url-entry' as any}
            activeProps={{
              className: 'font-bold border-b-2 border-blue-500',
            }}
            className="p-2 text-center hover:bg-gray-50"
          >
            Camera URL
          </Link>
          <Link
            to={'/setup/point-selection' as any}
            activeProps={{
              className: 'font-bold border-b-2 border-blue-500',
            }}
            className="p-2 text-center hover:bg-gray-50"
          >
            Machine Bounds
          </Link>
        </div>
        <Outlet />
      </div>
    </div>
  )
}