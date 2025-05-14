import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { Button } from "@wbcnc/ui/components/button";
import { RolePeering } from "@wbcnc/webrtc-channel/role-peering";
import log from "loglevel";
import { useEffect, useState } from "react";
import { z } from "zod";

log.setDefaultLevel(log.levels.DEBUG);

export const Route = createFileRoute("/webrtc-channel/$room")({
  component: RouteComponent,
  validateSearch: zodValidator(
    z.object({
      server: z.boolean().optional(),
    })
  ),
});

function useRoles() {
  const { server } = Route.useSearch();
  if (server) {
    return ["server", "client"] as const;
  }
  return ["client", "server"] as const;
}

function useRoom(roomId: string) {
  const [selfRole, otherRole] = useRoles();
  console.log("selfRole", selfRole, "otherRole", otherRole);
  const [messaging] = useState(
    () =>
      new RolePeering(roomId, selfRole, otherRole, {
        maxPeers: selfRole == "client" ? 1 : Infinity,
      })
  );
  useEffect(() => {
    messaging.join();
    return () => {
      messaging.destroy();
    };
  }, [messaging, roomId]);
  return { messaging };
}

function RouteComponent() {
  const { room } = Route.useParams();
  const { messaging } = useRoom(room);
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    messaging.on("message", (event) => {
      console.log("message from other peer", event);
      setMessages((prev) => [...prev, event]);
    });
  }, [messaging]);

  function sendMessage() {
    messaging.sendMessage(`Hello it's me ${new Date().toISOString()}`);
  }
  return (
    <div>
      <div>
        <Button onClick={sendMessage}>Send Message</Button>
      </div>
      <div>
        <p>{messages.length} Messages</p>
        {messages.map((message, index) => (
          <p key={index}>{message}</p>
        ))}
      </div>
    </div>
  );
}
