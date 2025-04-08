import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/visualize/VisualizeCommands')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/visualize/VisualizeCommands"!</div>
}
