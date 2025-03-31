import * as React from 'react';
import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HomeComponent,
});

function HomeComponent() {
  return <Navigate to="/visualize/2DView" />;
}
