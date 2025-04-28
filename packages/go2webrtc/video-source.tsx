import { connect as connectTorrent } from "./client";
import { createClient } from "./trystero";
import {
  parseConnectionString,
  RtcConnectionParams,
  UrlConnectionParams,
  WebcastConnectionParams,
  WebrtcConnectionParams,
  WebtorrentConnectionParams,
} from "./url-helpers";

export interface VideoDimensions {
  width: number;
  height: number;
}

export interface VideoSource {
  // type: RtcConnectionParams["type"];
  params: RtcConnectionParams;
  // Max dimensions of the video source. Actual resolution may be dynamically
  // lower with webrtc depending on the connection and browser.
  maxResolution?: VideoDimensions;
  // The source of the video. This is a string URL for url sources or a MediaStream.
  src: string | MediaStream;
  // Dispose of the video source. Close the stream or connection.
  dispose: () => Promise<void>;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number
): Promise<T> {
  return Promise.race<T>([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), timeout)
    ),
  ]);
}

async function webtorrentVideoSource(
  params: WebtorrentConnectionParams
): Promise<VideoSource> {
  const { stream, pc } = await connectTorrent({
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
    stream.getTracks().forEach((track) => track.stop());
    pc.close();
  }

  return {
    src: stream,
    params,
    dispose,
  };
}

async function webrtcVideoSource(
  params: WebrtcConnectionParams
): Promise<VideoSource> {
  const client = createClient({
    share: params.share,
    pwd: params.pwd,
    onStateChange: (state) => {
      console.debug("webrtcVideoSource state", state);
    },
  });

  try {
    const stream = await client.connect();

    return {
      src: stream,
      params,
      dispose: async () => {
        stream.getTracks().forEach((track) => track.stop());
        await client.disconnect();
      },
    };
  } catch (error) {
    await client.disconnect();
    throw error;
  }
}

function urlVideoSource(params: UrlConnectionParams) {
  return {
    src: params.url,
    params,
    dispose: async () => {},
  };
}

async function webcamVideoSource(
  params: WebcastConnectionParams
): Promise<VideoSource> {
  // TODO: implement
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: params.deviceId,
      ...(params.idealWidth && { width: { ideal: params.idealWidth } }),
      ...(params.idealHeight && { height: { ideal: params.idealHeight } }),
    },
  });
  const videoTrack = stream.getVideoTracks()[0];
  let maxResolution: VideoDimensions | undefined;
  let width = videoTrack.getSettings().width;
  let height = videoTrack.getSettings().height;
  if (width && height) {
    maxResolution = { width, height };
  }
  async function dispose() {
    stream.getTracks().forEach((track) => track.stop());
  }

  return {
    src: stream,
    params,
    maxResolution,
    dispose,
  };
}

// Proxy function to use the same webrtcVideoSource for both 'webrtc' and 'trystero' types
// This avoids needing to modify the RtcConnectionParams type in url-helpers.ts
export async function videoSource(url: string): Promise<VideoSource> {
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
