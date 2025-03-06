import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HomeComponent,
})

function HomeComponent() {
  return (
    <div className="p-2">
      <h3>Welcome to the CNC Camera Tool</h3>
      <div className="mt-4 flex flex-col gap-4">
        <div>
          <h4 className="text-lg font-medium">Get Started</h4>
          <p className="mb-2 text-gray-600">Configure your camera and select calibration points</p>
          <Link
            to="/setup"
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Camera Setup
          </Link>
        </div>

        <div>
          <h4 className="text-lg font-medium">View Camera</h4>
          <p className="mb-2 text-gray-600">View the unskewed camera visualization</p>
          <Link
            to="/visualize"
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
          >
            Visualize Camera
          </Link>
        </div>
      </div>
    </div>
  )
}
