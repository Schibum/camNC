import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { PersistentWebRTCServer, ServerOptions } from "@wbcnc/go2webrtc/server";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@wbcnc/ui/components/alert";
import { Button } from "@wbcnc/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@wbcnc/ui/components/card";
import { useWakeLock } from "@wbcnc/ui/hooks/use-wakelook";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

import { z } from "zod";

const searchSchema = z.object({
  share: z.string().min(10).catch(""),
  pwd: z.string().min(10).catch(""),
});

export const Route = createFileRoute("/webtorrent")({
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

function useWebRTCServer(options: ServerOptions) {
  useEffect(() => {
    const server = new PersistentWebRTCServer(options);
    server.start();
    // Cleanup function
    return () => {
      server.stop();
      console.log("WebRTC Server stopped.");
    };
  }, []); // Empty dependency array ensures this runs only once on mount and cleanup on unmount
}

function useCameraName() {
  const [cameraName, setCameraName] = useState<string>("Requesting camera...");
  useEffect(() => {
    const getCameraName = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      setCameraName(track?.label ?? "");
      stream.getTracks().forEach((track) => track.stop());
    };
    getCameraName();
  }, []);
  return cameraName;
}

function RtcServer({ share, pwd }: { share: string; pwd: string }) {
  const [status, setStatus] = useState<string>("idle");
  const { wakeLock, requestWakeLock } = useWakeLock();
  useWebRTCServer({
    share,
    pwd,
    streamFactory: streamFactory,
    onStatusUpdate: (status) => setStatus(status),
  });
  const cameraName = useCameraName();

  return (
    <Card className="w-full max-w-md mx-auto mt-10">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-center">
          WebRTC Camera Stream
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>
          <span className="font-semibold">Camera:</span> {cameraName}
        </p>
        <p>
          <span className="font-semibold">Connection Status:</span> {status}
        </p>

        {!wakeLock ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Wake Lock Inactive</AlertTitle>
            <AlertDescription>
              To prevent the screen from turning off during streaming, please
              activate the wake lock.
              <Button onClick={requestWakeLock} className="mt-2">
                Request Wake Lock
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <p>
            <span className="font-semibold">Wake Lock:</span> Active
          </p>
        )}

        {/* <p>Share: {share}</p>
            <p>Pwd: {pwd}</p> */}
      </CardContent>
    </Card>
  );
}

function RouteComponent() {
  const { share, pwd } = Route.useSearch();
  if (!share || !pwd) {
    return <div>No share or pwd search params</div>;
  }
  return (
    <div>
      <RtcServer share={share} pwd={pwd} />
    </div>
  );
}
