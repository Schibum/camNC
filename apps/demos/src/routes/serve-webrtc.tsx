import { createFileRoute } from "@tanstack/react-router";
import { PersistentWebRTCServer, ServerStatus } from "@wbcnc/go2webrtc/server";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/serve-webrtc")({
  component: RouteComponent,
});

function useWebRTCServer(
  onStatusUpdate: (status: ServerStatus, details?: string) => void
) {
  useEffect(() => {
    let server: PersistentWebRTCServer | null = null;

    async function start() {
      try {
        const streamFactory = async () => {
          console.log("Stream factory called, requesting user media...");
          const createdStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 4032 },
              height: { ideal: 2268 },
              facingMode: "environment",
            },
            audio: false,
          });
          console.log("User media stream obtained.");
          return createdStream;
        };

        server = new PersistentWebRTCServer({
          share: "test",
          pwd: "test",
          streamFactory: streamFactory,
          onStatusUpdate: onStatusUpdate,
        });
        await server.start();
        console.log("WebRTC Server started");
      } catch (error) {
        console.error("Error starting WebRTC server:", error);
        // Handle error appropriately, maybe set an error state
      }
    }

    start();

    // Cleanup function
    return () => {
      console.log("Cleaning up WebRTC server...");

      if (server) {
        server.stop();
        console.log("WebRTC Server stopped.");
      }
      server = null;
    };
  }, []); // Empty dependency array ensures this runs only once on mount and cleanup on unmount
}

function useWakeLock() {
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    navigator.wakeLock.request("screen").then((wl) => {
      console.log("got wake lock");
      wakeLock = wl;
      wakeLock.addEventListener("release", () => {
        console.log("Screen Wake Lock was released.");
        wakeLock = null; // Reset wakeLock variable when released
      });
    });
    return () => {
      if (wakeLock) {
        wakeLock.release();
      }
    };
  }, []);
}

function RouteComponent() {
  const [status, setStatus] = useState<ServerStatus>("idle");
  useWebRTCServer(setStatus); // Use the custom hook
  useWakeLock();
  return <div>Hello {status}</div>;
}
