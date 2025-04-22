import { useState } from "react";

import { useEffect } from "react";

export const streamFactory = async () => {
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

export function useCameraName() {
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
