import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HomeComponent,
  ssr: true,
});

function HomeComponent() {
  return <Navigate to="/visualize/2DView" replace />;
}
