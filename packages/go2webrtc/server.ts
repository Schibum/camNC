import { cipher } from "./cipher";

export type ServerStatus =
  | "preparing"
  | "connecting_tracker"
  | "waiting_offer"
  | "received_offer"
  | "creating_peer_connection"
  | "creating_answer"
  | "sending_answer"
  | "connected";

export interface SendOptions {
  share: string;
  pwd: string;
  tracker?: string;
  onStatusUpdate?: (status: ServerStatus) => void;
}

/**
 * Sends a MediaStream over WebRTC, acting as a sender compatible with client.ts.
 * It connects to the tracker and waits for an incoming offer, processes it,
 * and sends back an answer encrypted using the provided share and pwd.
 * @param stream The MediaStream to send.
 * @param options Options including share, pwd, tracker URL, and a status update callback.
 */
export async function send(
  stream: MediaStream,
  options: SendOptions
): Promise<void> {
  const {
    share,
    pwd,
    tracker = "wss://tracker.openwebtorrent.com/",
    onStatusUpdate,
  } = options;
  const info_hash = await infoHash(share);
  const peer_id = Math.random().toString(36).substring(2);

  onStatusUpdate && onStatusUpdate("preparing");

  const ws = new WebSocket(tracker);

  ws.addEventListener("open", () => {
    onStatusUpdate && onStatusUpdate("connecting_tracker");
    const announcement = {
      action: "announce",
      info_hash,
      peer_id,
      offers: [],
      numwant: 10,
    };
    ws.send(JSON.stringify(announcement));
    onStatusUpdate && onStatusUpdate("waiting_offer");
  });

  ws.addEventListener("message", async (event) => {
    try {
      const msg = JSON.parse(event.data);
      // Process only messages that contain an offer
      if (!msg.offer || !msg.offer_id || !msg.peer_id) {
        return;
      }
      onStatusUpdate && onStatusUpdate("received_offer");

      // Create a crypto helper using the offer_id as the nonce, assuming cipher supports an optional third parameter.
      const cryptoHelper = await cipher(share, pwd, msg.offer_id);

      // Decrypt the incoming offer SDP
      const offerSdp = await cryptoHelper.decrypt(msg.offer.sdp);

      onStatusUpdate && onStatusUpdate("creating_peer_connection");
      // Create an answer SDP using the provided MediaStream and the decrypted offer
      const answerSdp = await exchangeOffer(stream, offerSdp);
      onStatusUpdate && onStatusUpdate("creating_answer");

      // Encrypt the answer SDP
      const encryptedAnswer = await cryptoHelper.encrypt(answerSdp);
      onStatusUpdate && onStatusUpdate("sending_answer");

      const response = {
        action: "announce",
        info_hash,
        peer_id,
        offer_id: msg.offer_id,
        answer: { type: "answer", sdp: encryptedAnswer },
        to_peer_id: msg.peer_id,
      };

      ws.send(JSON.stringify(response));
      onStatusUpdate && onStatusUpdate("connected");
      ws.close();
    } catch (error) {
      console.error("Error processing incoming offer:", error);
      ws.close();
    }
  });

  ws.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);
    ws.close();
  });
}

/**
 * Creates an RTCPeerConnection, adds the provided MediaStream's tracks,
 * sets the remote description from the given offer SDP, and generates an answer SDP.
 * @param stream The MediaStream whose tracks will be sent.
 * @param offerSdp The SDP offer received from the client.
 * @returns A Promise that resolves to the answer SDP string.
 */
async function exchangeOffer(
  stream: MediaStream,
  offerSdp: string
): Promise<string> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  // Add each track from the stream to the peer connection
  stream.getTracks().forEach((track) => {
    pc.addTrack(track, stream);
  });

  // Set the remote description using the received offer SDP
  await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });

  // Create an answer SDP
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // Wait for ICE gathering to complete or timeout after 5 seconds
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve(pc.localDescription!.sdp);
    } else {
      const checkState = () => {
        if (pc.iceGatheringState === "complete") {
          pc.removeEventListener("icegatheringstatechange", checkState);
          resolve(pc.localDescription!.sdp);
        }
      };
      pc.addEventListener("icegatheringstatechange", checkState);
      setTimeout(() => {
        resolve(pc.localDescription!.sdp);
      }, 5000);
    }
  });
}

/**
 * Computes the info hash for the given share string using SHA-256 and Base64 encoding.
 * This hash is used to identify the shared media stream.
 * @param share The share string.
 * @returns A Promise that resolves to the computed info hash.
 */
async function infoHash(share: string): Promise<string> {
  // Prioritize browser crypto API if available
  if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(share);
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashString = hashArray.map((b) => String.fromCharCode(b)).join("");
    return btoa(hashString);
  } else {
    throw new Error("No available crypto API for hashing.");
  }
}
