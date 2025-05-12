import { createFileRoute, notFound } from "@tanstack/react-router";
import { ServerCard } from "../server-card";
import { useFluidncServer } from "../useFluidncServer";

import { useSignals } from "@preact/signals-react/runtime";
export const Route = createFileRoute("/$roomId")({
  component: RouteComponent,
  loader: async ({ params }) => {
    const { roomId } = params;
    if (roomId.length < 10) {
      throw notFound();
    }
  },
});

function RouteComponent() {
  useSignals();
  const { roomId } = Route.useParams();
  const server = useFluidncServer(roomId);
  if (!server) {
    return null;
  }
  server.numConnected.subscribe(() => {
    console.log("numConnected", server.numConnected.value);
  });

  return (
    <div>
      <ServerCard status={`${server.numConnected.value} connected`} />
    </div>
  );
}
