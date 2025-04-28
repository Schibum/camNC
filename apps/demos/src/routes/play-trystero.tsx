import { createFileRoute } from "@tanstack/react-router";
import { ClientState, useTrysteroClient } from "@wbcnc/go2webrtc/trystero";
import { LoadingSpinner } from "@wbcnc/ui/components/loading-spinner";
import { useEffect, useRef } from "react";

export const Route = createFileRoute("/play-trystero")({
  component: RouteComponent,
});

function RouteComponent() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { clientState, stream } = useTrysteroClient({
    share: "test",
    pwd: "test",
  });

  // Connect the stream to the video element when it's available
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current
        .play()
        .catch((err) => console.error("Failed to play video:", err));

      // Set up event listeners for debugging
      stream.addEventListener("removetrack", () => {
        console.log("track removed");
      });
      stream.getTracks().forEach((track) => {
        track.addEventListener("mute", () => {
          console.log("track muted");
        });
        track.addEventListener("ended", () => {
          console.log("track ended");
        });
      });
    }
  }, [stream]);

  const isConnecting = clientState === ClientState.CONNECTING;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <video ref={videoRef} controls autoPlay muted />
      {isConnecting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <LoadingSpinner size={48} className="text-white" />
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <p>Client state: {clientState}</p>
      </div>
    </div>
  );
}
