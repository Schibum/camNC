import { connect as connectTorrent } from "./client";
import { createClient } from "./trystero";
import {
  RtcConnectionParams,
  UrlConnectionParams,
  WebcamConnectionParams,
  WebrtcConnectionParams,
  WebtorrentConnectionParams,
  parseConnectionString,
} from "./url-helpers";

export interface VideoDimensions {
  width: number;
  height: number;
}

export interface ConnectedInfo {
  maxResolution?: VideoDimensions;
  src: string | MediaStream;
}

export interface VideoSource {
  // type: RtcConnectionParams["type"];
  params: RtcConnectionParams;
  // Max dimensions of the video source. Actual resolution may be dynamically
  // lower with webrtc depending on the connection and browser.
  connectedPromise: Promise<ConnectedInfo>;
  // Dispose of the video source. Close the stream or connection.
  dispose: () => Promise<void>;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
): Promise<T> {
  return Promise.race<T>([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), timeout),
    ),
  ]);
}

function webtorrentVideoSource(
  params: WebtorrentConnectionParams,
): VideoSource {
  let connectPromise = connectTorrent({
    share: params.share,
    pwd: params.pwd,
    onStatusUpdate(status) {
      console.debug("webtorrentVideoSource status", status);
    },
    onCodecInfo(codec) {
      console.debug("webtorrentVideoSource codec", codec);
    },
  });

  async function dispose() {
    try {
      const { stream, pc } = await connectPromise;
      stream.getTracks().forEach((track) => track.stop());
      pc.close();
    } catch (error) {}
  }

  return {
    connectedPromise: connectPromise.then(({ stream }) => ({
      src: stream,
    })),
    params,
    dispose,
  };
}

function webrtcVideoSource(params: WebrtcConnectionParams): VideoSource {
  const client = createClient({
    share: params.share,
    pwd: params.pwd,
    onStateChange: (state) => {
      console.debug("webrtcVideoSource state", state);
    },
  });

  let streamPromise = client.connect();

  return {
    connectedPromise: streamPromise.then(({ stream, maxResolution }) => ({
      src: stream,
      maxResolution,
    })),
    params,
    dispose: async () => {
      await client.disconnect();
    },
  };
}

function urlVideoSource(params: UrlConnectionParams): VideoSource {
  return {
    connectedPromise: Promise.resolve({ src: params.url }),
    params,
    dispose: async () => {},
  };
}

function webcamVideoSource(params: WebcamConnectionParams): VideoSource {
  async function connect() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: params.deviceId,
        ...(params.idealWidth && { width: { ideal: params.idealWidth } }),
        ...(params.idealHeight && { height: { ideal: params.idealHeight } }),
      },
    });
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      throw new Error("No video track found");
    }
    let maxResolution: VideoDimensions | undefined;
    let width = videoTrack.getSettings().width;
    let height = videoTrack.getSettings().height;
    if (width && height) {
      maxResolution = { width, height };
    }
    return { src: stream, maxResolution };
  }

  let connectedPromise = connect();

  async function dispose() {
    try {
      const { src } = await connectedPromise;
      src.getTracks().forEach((track) => track.stop());
    } catch (error) {}
  }

  return {
    connectedPromise,
    params,
    dispose,
  };
}

// Proxy function to use the same webrtcVideoSource for both 'webrtc' and 'trystero' types
// This avoids needing to modify the RtcConnectionParams type in url-helpers.ts
export function videoSource(url: string): VideoSource {
  const rtcParams = parseConnectionString(url);
  switch (rtcParams.type) {
    case "webtorrent":
      return webtorrentVideoSource(rtcParams);
    case "webrtc":
      return webrtcVideoSource(rtcParams);
    case "url":
      return urlVideoSource(rtcParams);
    case "webcam":
      return webcamVideoSource(rtcParams);
    default:
      throw new Error("Unsupported protocol");
  }
}
