import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { useWakeLock } from "@wbcnc/ui/hooks/use-wakelook";
import { z } from "zod";
import { useTrysteroServer } from "../../../../packages/go2webrtc/trystero-server";

const searchSchema = z.object({
  share: z.string().catch("test"),
  pwd: z.string().catch("test"),
});

export const Route = createFileRoute("/serve-trystero")({
  component: RouteComponent,
  validateSearch: zodValidator(searchSchema),
});

const streamFactory = async () => {
  console.log("Stream factory called, requesting user media...");
  const createdStream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      facingMode: "environment",
    },
    audio: false,
  });
  console.log("User media stream obtained.");
  // Prefer high-resolution over high-framerate
  const videoTrack = createdStream.getVideoTracks()[0];
  if (videoTrack && "contentHint" in videoTrack) {
    videoTrack.contentHint = "detail";
  }
  return createdStream;
};

function RouteComponent() {
  const { share, pwd } = Route.useSearch();
  console.log("share", share, "pwd", pwd);
  useTrysteroServer({
    share,
    pwd,
    streamFactory: streamFactory,
  });
  useWakeLock();
  return <div>Hello</div>;
}
