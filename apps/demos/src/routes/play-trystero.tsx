import { createFileRoute } from "@tanstack/react-router";
import { useTrysteroClient } from "@wbcnc/go2webrtc/trystero";
import { LoadingSpinner } from "@wbcnc/ui/components/loading-spinner";
import { useCallback, useRef } from "react";

export const Route = createFileRoute("/play-trystero")({
  component: RouteComponent,
});

function RouteComponent() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onStream = useCallback((stream: MediaStream) => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play();
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
  }, []);
  const { serverPeerId, clientState } = useTrysteroClient(onStream, {
    share: "test",
    pwd: "test",
  });

  const isConnecting = clientState === "connecting";

  return (
    <div className="relative min-h-screen overflow-hidden">
      <video ref={videoRef} controls autoPlay muted />
      {isConnecting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <LoadingSpinner size={48} className="text-white" />
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <p>Server peer ID: {serverPeerId}</p>
        <p>Client state: {clientState}</p>
      </div>
    </div>
  );
}
