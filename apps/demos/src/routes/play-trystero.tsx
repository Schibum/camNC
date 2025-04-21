import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useTrysteroClient } from "../../../../packages/go2webrtc/trystero-client";
export const Route = createFileRoute("/play-trystero")({
  component: RouteComponent,
});

function RouteComponent() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { connect } = useTrysteroClient();
  useEffect(() => {
    connect(
      {
        share: "test",
        pwd: "test",
      },
      (stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }
    );
  }, []);
  return (
    <div className="relative min-h-screen overflow-hidden">
      <video ref={videoRef} controls autoPlay muted />
    </div>
  );
}
