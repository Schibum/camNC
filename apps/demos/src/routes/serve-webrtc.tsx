import { createFileRoute } from "@tanstack/react-router";
import { PersistentWebRTCServer } from "@wbcnc/go2webrtc/server";
import { useEffect } from "react";

export const Route = createFileRoute("/serve-webrtc")({
  component: RouteComponent,
});

function useWebRTCServer() {
  useEffect(() => {
    let server: PersistentWebRTCServer | null = null;
    let stream: MediaStream | null = null;
    let isMounted = true; // Flag to track mounted state

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });

        // Check if component is still mounted after getting the stream
        if (!isMounted) {
          console.log(
            "Component unmounted after getUserMedia, stopping stream."
          );
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        server = new PersistentWebRTCServer(stream, {
          share: "test",
          pwd: "test",
          onStatusUpdate: (status) => {
            console.log("Server status:", status);
          },
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
      console.log("Cleaning up WebRTC server and stream...");
      isMounted = false; // Set flag to false on cleanup

      if (server) {
        server.stop();
        console.log("WebRTC Server stopped.");
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        console.log("Media stream stopped.");
      }
      server = null;
      stream = null;
    };
  }, []); // Empty dependency array ensures this runs only once on mount and cleanup on unmount
}

function RouteComponent() {
  useWebRTCServer(); // Use the custom hook

  return <div>Hello "/serve-webrtc"! Streaming...</div>;
}
