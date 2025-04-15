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

export interface ConnectOptions {
  share: string;
  pwd: string;
  media?: string; // only "video" is expected
  tracker?: string;
  onStatusUpdate?: (status: ConnectionStatus) => void;
}

/**
 * Connect to a remote WebRTC source.
 * @param options Object containing share, pwd, an optional media string (only "video" supported), and tracker URL.
 * @returns A Promise that resolves with a MediaStream containing the received video.
 */
export async function connect(options: ConnectOptions): Promise<MediaStream> {
  const {
    share,
    pwd,
    media = "video",
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
    const { pc, stream } = await createPeerConnection(media);

    reportStatus("creating_offer");
    // Generate an offer (waiting for ICE gathering to complete or timing out).
    const offerSdp = await getOffer(pc, 5000);
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

/* -- Internal Helper Functions -- */

/**
 * Creates an RTCPeerConnection and builds a MediaStream from the received video track.
 * @param media A string that indicates what media to receive. Only "video" is supported.
 */
async function createPeerConnection(
  media: string
): Promise<{ pc: RTCPeerConnection; stream: MediaStream }> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  const localTracks: MediaStreamTrack[] = [];

  // Only add transceiver for receiving video.
  if (media.includes("video")) {
    const transceiver = pc.addTransceiver("video", { direction: "recvonly" });
    if (transceiver.receiver.track) {
      localTracks.push(transceiver.receiver.track);
    }
  }

  const stream = new MediaStream(localTracks);
  return { pc, stream };
}

/**
 * Creates an offer for the RTCPeerConnection and returns the SDP.
 * @param pc The RTCPeerConnection instance.
 * @param timeout Timeout (in ms) after which to resolve with the current offer.
 */
function getOffer(
  pc: RTCPeerConnection,
  timeout: number = 5000
): Promise<string> {
  return new Promise((resolve, reject) => {
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete" && pc.localDescription) {
        resolve(pc.localDescription.sdp);
      }
    });

    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch((err) => reject(new Error("Failed to create offer: " + err)));

    setTimeout(() => {
      if (pc.localDescription) {
        resolve(pc.localDescription.sdp);
      } else {
        reject(new Error("Failed to generate offer within timeout."));
      }
    }, timeout);
  });
}
