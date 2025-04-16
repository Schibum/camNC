// go2webrtc.ts

import { cipher } from "./cipher";

export type ConnectionStatus =
  | "preparing"
  | "creating_peer_connection"
  | "creating_offer"
  | "connecting_tracker"
  | "sending_offer"
  | "waiting_answer"
  | "decrypting_answer"
  | "setting_remote_description"
  | "connected";

export interface StatusUpdate {
  status: ConnectionStatus;
}

export type CodecName = "H264" | "VP8" | "VP9" | "AV1";

export interface ConnectOptions {
  share: string;
  pwd: string;
  media?: string; // only "video" is expected
  tracker?: string;
  preferredCodec?: CodecName;
  onStatusUpdate?: (status: ConnectionStatus) => void;
  onCodecInfo?: (codec: string) => void;
}

// The order of preference for codecs mime types.
const kPreferredCodecs = ["video/H264", "video/VP8", "video/VP9", "video/AV1"];
// const kPreferredCodecs = ["video/AV1", "video/VP8", "video/H264"];

/**
 * Connect to a remote WebRTC source.
 * @param options Object containing share, pwd, an optional media string (only "video" supported), and tracker URL.
 * @returns A Promise that resolves with a MediaStream containing the received video.
 */
export async function connect(options: ConnectOptions): Promise<MediaStream> {
  const {
    share,
    pwd,
    tracker = "wss://tracker.openwebtorrent.com/",
    onStatusUpdate,
  } = options;

  // Helper to report status if callback is provided
  const reportStatus = (status: ConnectionStatus) => {
    if (onStatusUpdate) {
      onStatusUpdate(status);
    }
  };

  try {
    reportStatus("preparing");
    // Prepare the crypto helper using the share and password.
    const cryptoHelper = await cipher(share, pwd);

    reportStatus("creating_peer_connection");
    // Create an RTCPeerConnection and set up a MediaStream from its received tracks.
    const { pc, stream } = await createPeerConnection();
    if (options.preferredCodec) {
      setCodecPreferences(pc, `video/${options.preferredCodec}`);
    }
    reportStatus("creating_offer");
    // Generate an offer (waiting for ICE gathering to complete or timing out).
    const offerSdp = await getOffer(pc);
    const encryptedOffer = await cryptoHelper.encrypt(offerSdp);

    reportStatus("connecting_tracker");
    // Open a websocket to the tracker.
    const ws = new WebSocket(tracker);

    // Wrap the remaining handshake in a Promise.
    return new Promise((resolve, reject) => {
      ws.addEventListener("open", () => {
        reportStatus("sending_offer");
        const offerData = {
          action: "announce",
          info_hash: cryptoHelper.hash,
          peer_id: Math.random().toString(36).substring(2),
          offers: [
            {
              offer_id: cryptoHelper.nonce,
              offer: { type: "offer", sdp: encryptedOffer },
            },
          ],
          numwant: 1,
        };
        ws.send(JSON.stringify(offerData));
        reportStatus("waiting_answer");
      });

      ws.addEventListener("message", async (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (!msg.answer) return;

          reportStatus("decrypting_answer");
          // Decrypt the answer and set it as the remote description.
          const decryptedAnswer = await cryptoHelper.decrypt(msg.answer.sdp);

          reportStatus("setting_remote_description");
          await pc.setRemoteDescription({
            type: "answer",
            sdp: decryptedAnswer,
          });

          ws.close();
          reportStatus("connected");
          pollCodecInfo(pc).then((info) => {
            if (options.onCodecInfo && info) options.onCodecInfo(info);
          });
          resolve(stream);
        } catch (error) {
          const errorMessage =
            "Error during WebSocket message processing: " +
            (error instanceof Error ? error.message : String(error));
          reject(new Error(errorMessage));
        }
      });

      ws.addEventListener("error", (event) => {
        // The error event itself doesn't provide much detail, unfortunately.
        const errorMessage = "WebSocket error occurred.";
        reject(new Error(errorMessage));
      });
    });
  } catch (error) {
    const errorMessage =
      "Error during connection setup: " +
      (error instanceof Error ? error.message : String(error));
    throw new Error(errorMessage); // Re-throw after reporting status
  }
}

/** Quick and dirty debug print of codec info used by the peer connection. */
async function pollCodecInfo(pc: RTCPeerConnection): Promise<string | null> {
  function getCodec(stats: RTCStatsReport) {
    for (let val of stats.values()) {
      if (val.type === "codec") return val;
    }
    return null;
  }
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const stats = await pc.getStats();
    const codec = getCodec(stats);
    if (codec) {
      console.log("codec used", codec);
      return codec.mimeType;
    }
  }
  return null;
}

/* -- Internal Helper Functions -- */

/**
 * Creates an RTCPeerConnection and builds a MediaStream from the received video track.
 * @param media A string that indicates what media to receive. Only "video" is supported.
 */
async function createPeerConnection(): Promise<{
  pc: RTCPeerConnection;
  stream: MediaStream;
}> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  const localTracks: MediaStreamTrack[] = [];

  const transceiver = pc.addTransceiver("video", { direction: "recvonly" });
  if (transceiver.receiver.track) {
    localTracks.push(transceiver.receiver.track);
  }
  const stream = new MediaStream(localTracks);
  return { pc, stream };
}

function setCodecPreferences(
  pc: RTCPeerConnection,
  preferredCodecMime?: string
) {
  function sortByMimeTypes(codecs: RTCRtpCodec[], preferredOrder: string[]) {
    return codecs.sort((a, b) => {
      const indexA = preferredOrder.indexOf(a.mimeType);
      const indexB = preferredOrder.indexOf(b.mimeType);
      const orderA = indexA >= 0 ? indexA : Number.MAX_VALUE;
      const orderB = indexB >= 0 ? indexB : Number.MAX_VALUE;
      return orderA - orderB;
    });
  }
  const supportedCodecs = RTCRtpReceiver.getCapabilities("video")?.codecs;
  if (!supportedCodecs) return;
  let order = kPreferredCodecs;
  if (preferredCodecMime) {
    order = [
      preferredCodecMime,
      ...kPreferredCodecs.filter((c) => c !== preferredCodecMime),
    ];
  }
  const sortedCodecs = sortByMimeTypes(supportedCodecs, order);
  const transceiver = pc.getTransceivers()[0];
  if (!transceiver) return;
  transceiver.setCodecPreferences(sortedCodecs);
}

/**
 * Creates an offer for the RTCPeerConnection and returns the SDP.
 * @param pc The RTCPeerConnection instance.
 * @param timeoutMs Timeout (in ms) after which to resolve with the current offer.
 */
async function getOffer(
  pc: RTCPeerConnection,
  timeoutMs: number = 5000,
  debounceMs = 500
): Promise<string> {
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log("Local description set, waiting for ICE...");

    // Wait for ICE using the updated helper function
    // Hack, just wait for 500ms in a debounced way to speed up the process.
    await waitForDebouncedIce(pc, debounceMs, timeoutMs); // 500ms debounce on *any* candidate

    console.log("ICE gathering finished or debounced.");

    if (pc.localDescription) {
      return pc.localDescription.sdp;
    } else {
      throw new Error(
        "Failed to generate offer: No local description found after ICE process."
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error in getOffer:", message);
    throw new Error(`Failed to get offer: ${message}`);
  }
}

/**
 * Waits for ICE gathering to stabilize or complete, applying a debounce.
 * Resolves when either ICE gathering is complete, or 500ms have passed
 * since the *last* non-null ICE candidate was received.
 * Rejects on overall timeout or errors during gathering.
 *
 * @param pc The RTCPeerConnection instance.
 * @param debounceMs The debounce time in milliseconds.
 * @param overallTimeoutMs The maximum time to wait for ICE gathering.
 * @returns A promise that resolves when conditions are met, or rejects on timeout/error.
 */
function waitForDebouncedIce(
  pc: RTCPeerConnection,
  debounceMs: number,
  overallTimeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;
    let overallTimeout: ReturnType<typeof setTimeout> | null = null;
    let hasSeenSrflxOrRelay = false; // Track if we've seen the first relevant candidate

    const cleanup = () => {
      pc.removeEventListener("icecandidate", handleIceCandidate);
      pc.removeEventListener(
        "icegatheringstatechange",
        handleIceGatheringStateChange
      );
      if (debounceTimeout) clearTimeout(debounceTimeout);
      if (overallTimeout) clearTimeout(overallTimeout);
    };

    const handleIceCandidate = (e: RTCPeerConnectionIceEvent) => {
      console.log("icecandidate", e.candidate?.type, e.candidate?.address);
      // Note: The debounce logic is now handled conditionally below

      // Check if this is the first srflx or relay candidate
      if (
        !hasSeenSrflxOrRelay &&
        e.candidate &&
        typeof e.candidate.type === "string" &&
        ["srflx", "relay"].includes(e.candidate.type)
      ) {
        console.log(
          "First srflx/relay candidate seen. Starting debounce mechanism."
        );
        hasSeenSrflxOrRelay = true;
      }

      // Only run the debounce logic if we've seen the first relevant candidate AND the current candidate is non-null
      if (hasSeenSrflxOrRelay && e.candidate) {
        // Clear any existing debounce timer
        if (debounceTimeout) {
          clearTimeout(debounceTimeout);
        }
        // Start a new debounce timer
        debounceTimeout = setTimeout(() => {
          console.log(`ICE debounced after ${debounceMs}ms (helper).`);
          cleanup();
          resolve(); // Resolve after debounce period without new candidates
        }, debounceMs);
      } else if (!e.candidate) {
        // Null candidate signifies the end marker, but we rely on 'complete' state.
        console.log(
          "Null candidate received (helper), end of candidates marker."
        );
      }
    };

    const handleIceGatheringStateChange = () => {
      console.log("icegatheringstatechange (helper)", pc.iceGatheringState);
      if (pc.iceGatheringState === "complete") {
        if (debounceTimeout) {
          clearTimeout(debounceTimeout); // Don't need debounce if already complete
          debounceTimeout = null;
        }
        console.log("ICE gathering complete (helper).");
        cleanup();
        resolve(); // Resolve immediately on completion
      }
    };

    // Add the listeners
    pc.addEventListener("icecandidate", handleIceCandidate);
    pc.addEventListener(
      "icegatheringstatechange",
      handleIceGatheringStateChange
    );

    // Overall timeout
    overallTimeout = setTimeout(() => {
      console.warn("ICE gathering timed out (helper).");
      cleanup();
      // Resolve even on timeout, letting the caller (getOffer) check pc.localDescription.
      resolve();
    }, overallTimeoutMs);

    // Initial check in case gathering is already complete
    if (pc.iceGatheringState === "complete") {
      console.log("ICE already complete on helper start.");
      cleanup();
      resolve();
    }
  });
}
