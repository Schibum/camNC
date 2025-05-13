import { createFileRoute, notFound } from "@tanstack/react-router";
import log from "loglevel";
import { ServerCard } from "../server-card";
import { useFluidncServer } from "../useFluidncServer";
log.setDefaultLevel(log.levels.DEBUG);

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
  const { roomId } = Route.useParams();
  const server = useFluidncServer(roomId);
  if (!server) {
    return null;
  }

  return (
    <div>
      <ServerCard
        status={`${server.numConnected.value} connected`}
        roomId={roomId}
      />
    </div>
  );
}
