import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { Button } from "@wbcnc/ui/components/button";
import { RoleMessaging } from "@wbcnc/webrtc-channel/role-messaging";
import { initTestFbApp } from "@wbcnc/webrtc-channel/test-fb-config";
import { useEffect, useState } from "react";
import { z } from "zod";

initTestFbApp();

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
  const [ready, setReady] = useState(false);
  console.log("selfRole", selfRole, "otherRole", otherRole);
  const [messaging] = useState(
    () => new RoleMessaging(roomId, selfRole, otherRole)
  );
  useEffect(() => {
    messaging.join();
    messaging.on("ready", () => {
      setReady(true);
    });
    return () => {
      messaging.disconnect();
    };
  }, [messaging, roomId]);
  return { messaging, ready };
}

function RouteComponent() {
  const { room } = Route.useParams();
  const { messaging, ready } = useRoom(room);

  useEffect(() => {
    messaging.on("message", (event) => {
      console.log("message from other peere", event);
    });
  }, [messaging]);

  function sendMessage() {
    messaging.sendMessage("Hello from channel 1");
  }
  return (
    <div>
      <div>
        <Button onClick={sendMessage}>Send Message</Button>
      </div>
      <div>
        <p>Ready: {ready ? "true" : "false"}</p>
      </div>
    </div>
  );
}
