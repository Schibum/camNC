import { cipher, CryptoHelper } from "./cipher";

export interface ServerOptions {
  share: string;
  pwd: string;
  streamFactory: () => Promise<MediaStream>;
  tracker?: string;
  onStatusUpdate?: (status: string) => void;
  iceServers?: RTCIceServer[];
  iceGatheringTimeout?: number;
  trackerReconnectMinDelay?: number;
  trackerReconnectMaxDelay?: number;
  trackerAnnounceInterval?: number;
}

interface TrackerMessageBase {
  action: string;
  info_hash: string;
  peer_id: string;
}

interface TrackerAnnounceRequest extends TrackerMessageBase {
  action: "announce";
  numwant: number;
  uploaded?: number;
  downloaded?: number;
  left?: number;
  event?: "started" | "stopped" | "completed";
}

interface TrackerAnnounceResponse extends TrackerMessageBase {
  action: "announce";
  interval?: number;
  complete?: number;
  incomplete?: number;
  offer?: TrackerOfferDetails;
  offer_id?: string;
  peer_id: string;
}

interface TrackerOfferMessage {
  action?: string;
  info_hash: string;
  offer: TrackerOfferDetails;
  offer_id: string;
  peer_id: string;
}

interface TrackerAnswerMessage extends TrackerMessageBase {
  action: "announce";
  to_peer_id: string;
  offer_id: string;
  answer: {
    type: "answer";
    sdp: string;
  };
}

interface TrackerOfferDetails {
  type: "offer";
  sdp: string;
}

async function calculateInfoHash(share: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(share);
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashString = hashArray.map((b) => String.fromCharCode(b)).join("");
  return btoa(hashString);
}

export class PersistentWebRTCServer {
  private stream: MediaStream | null = null;
  private options: Required<ServerOptions>;
  private trackerWs: WebSocket | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private infoHash: string = "";
  private peerId: string = "";
  private trackerReconnectTimerId: any = null;
  private trackerAnnounceTimerId: any = null;
  private currentReconnectDelay: number;
  private isRunning: boolean = false;

  private static readonly DEFAULT_TRACKER = "wss://tracker.openwebtorrent.com/";
  private static readonly DEFAULT_ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
  ];
  private static readonly DEFAULT_ICE_GATHERING_TIMEOUT = 3000;
  private static readonly DEFAULT_TRACKER_RECONNECT_MIN_DELAY = 1000;
  private static readonly DEFAULT_TRACKER_RECONNECT_MAX_DELAY = 30000;
  private static readonly DEFAULT_TRACKER_ANNOUNCE_INTERVAL = 60000;

  constructor(options: ServerOptions) {
    this.options = {
      tracker: options.tracker ?? PersistentWebRTCServer.DEFAULT_TRACKER,
      onStatusUpdate: options.onStatusUpdate ?? (() => {}),
      iceServers:
        options.iceServers ?? PersistentWebRTCServer.DEFAULT_ICE_SERVERS,
      iceGatheringTimeout:
        options.iceGatheringTimeout ??
        PersistentWebRTCServer.DEFAULT_ICE_GATHERING_TIMEOUT,
      trackerReconnectMinDelay:
        options.trackerReconnectMinDelay ??
        PersistentWebRTCServer.DEFAULT_TRACKER_RECONNECT_MIN_DELAY,
      trackerReconnectMaxDelay:
        options.trackerReconnectMaxDelay ??
        PersistentWebRTCServer.DEFAULT_TRACKER_RECONNECT_MAX_DELAY,
      trackerAnnounceInterval:
        options.trackerAnnounceInterval ??
        PersistentWebRTCServer.DEFAULT_TRACKER_ANNOUNCE_INTERVAL,
      ...options,
    };
    this.peerId = this._generatePeerId();
    this.currentReconnectDelay = this.options.trackerReconnectMinDelay;
    this._setStatus("idle");
  }

  private _setStatus(status: string, details?: string) {
    this.options.onStatusUpdate(status + (details ? `: ${details}` : ""));
  }

  private _generatePeerId(): string {
    return "-TS0001-" + Math.random().toString(36).substring(2, 15);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn("Server is already running.");
      return;
    }
    this.isRunning = true;
    this._setStatus("preparing");
    console.log("Starting WebRTC server...");

    try {
      this.infoHash = await calculateInfoHash(this.options.share);
      console.log(
        `Calculated infoHash: ${this.infoHash} for share: ${this.options.share}`
      );
      this.connectToTracker();
    } catch (error) {
      console.error("Failed to calculate infoHash:", error);
      this._setStatus("error", "Failed to calculate infoHash");
      this.isRunning = false;
    }
  }

  stop(): void {
    if (!this.isRunning) {
      console.warn("Server is not running.");
      return;
    }
    console.log("Stopping WebRTC server...");
    this.isRunning = false;

    clearTimeout(this.trackerReconnectTimerId);
    clearInterval(this.trackerAnnounceTimerId);
    this.trackerReconnectTimerId = null;
    this.trackerAnnounceTimerId = null;

    if (this.trackerWs) {
      this.trackerWs.onopen = null;
      this.trackerWs.onmessage = null;
      this.trackerWs.onerror = null;
      this.trackerWs.onclose = null;
      if (this.trackerWs.readyState !== WebSocket.CLOSED) {
        this.trackerWs.close();
      }
      this.trackerWs = null;
    }

    this.peerConnections.forEach((pc, peerId) => {
      this._cleanupPeerConnection(peerId);
    });
    this.peerConnections.clear();
    console.log("All peer connections closed.");

    if (this.stream) {
      console.log("Stopping media stream tracks...");
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
      console.log("Media stream tracks stopped.");
    }

    this._setStatus("idle");
  }

  private connectToTracker(): void {
    if (!this.isRunning) return;

    if (this.trackerWs && this.trackerWs.readyState === WebSocket.CONNECTING) {
      console.log("Tracker connection attempt already in progress.");
      return;
    }
    if (this.trackerWs) {
      this.trackerWs.onopen = null;
      this.trackerWs.onmessage = null;
      this.trackerWs.onerror = null;
      this.trackerWs.onclose = null;
      if (this.trackerWs.readyState !== WebSocket.CLOSED) {
        this.trackerWs.close();
      }
      this.trackerWs = null;
    }

    this._setStatus(
      "connecting_tracker",
      `Attempting connection to ${this.options.tracker}`
    );
    console.log(`Connecting to tracker: ${this.options.tracker}`);

    try {
      this.trackerWs = new WebSocket(this.options.tracker);
      this.trackerWs.onopen = this.handleTrackerOpen.bind(this);
      this.trackerWs.onmessage = this.handleTrackerMessage.bind(this);
      this.trackerWs.onerror = this.handleTrackerError.bind(this);
      this.trackerWs.onclose = this.handleTrackerClose.bind(this);
    } catch (error) {
      console.error("Failed to create WebSocket:", error);
      this._setStatus("error", "Failed to create WebSocket");
      this.scheduleTrackerReconnect();
    }
  }

  private handleTrackerOpen(): void {
    console.log("Connected to tracker.");
    this._setStatus("connected_tracker");
    this.currentReconnectDelay = this.options.trackerReconnectMinDelay;

    this.announceToTracker({ event: "started" });

    clearInterval(this.trackerAnnounceTimerId);
    this.trackerAnnounceTimerId = setInterval(
      () => this.announceToTracker(),
      this.options.trackerAnnounceInterval
    );

    this._setStatus("waiting_offer");
  }

  private announceToTracker(
    extraParams: Partial<TrackerAnnounceRequest> = {}
  ): void {
    if (!this.trackerWs || this.trackerWs.readyState !== WebSocket.OPEN) {
      console.warn("Cannot announce, tracker WebSocket not open.");
      return;
    }

    const announcement: TrackerAnnounceRequest = {
      action: "announce",
      info_hash: this.infoHash,
      peer_id: this.peerId,
      numwant: 10,
      uploaded: 0,
      downloaded: 0,
      left: 0,
      ...extraParams,
    };

    try {
      this.trackerWs.send(JSON.stringify(announcement));
    } catch (error) {
      console.error("Failed to send announce message:", error);
      if (this.trackerWs && this.trackerWs.readyState === WebSocket.OPEN) {
        this.trackerWs.close();
      }
    }
  }

  private handleTrackerMessage(event: MessageEvent): void {
    try {
      const msg = JSON.parse(event.data);
      if (
        msg.info_hash === this.infoHash &&
        msg.offer &&
        msg.offer_id &&
        msg.peer_id
      ) {
        const offerMsg = msg as TrackerOfferMessage;
        if (offerMsg.peer_id === this.peerId) {
          return;
        }
        console.log(
          `Received offer from peer ${offerMsg.peer_id} with offer_id ${offerMsg.offer_id}`
        );
        this._setStatus("received_offer", `From peer ${offerMsg.peer_id}`);
        this.processOffer(offerMsg);
      } else if (msg.interval) {
        const interval = parseInt(msg.interval, 10);
        if (!isNaN(interval) && interval > 0) {
          const newIntervalMs = interval * 1000;
          if (newIntervalMs !== this.options.trackerAnnounceInterval) {
            console.log(
              `Tracker suggested announce interval: ${interval}s. Adjusting periodic announce.`
            );
            this.options.trackerAnnounceInterval = newIntervalMs;
            clearInterval(this.trackerAnnounceTimerId);
            this.trackerAnnounceTimerId = setInterval(
              () => this.announceToTracker(),
              this.options.trackerAnnounceInterval
            );
          }
        }
      }
    } catch (error) {
      console.error(
        "Error processing tracker message:",
        error,
        "Data:",
        event.data
      );
      this._setStatus("error", "Failed to parse tracker message");
    }
  }

  private handleTrackerError(event: Event): void {
    console.error("Tracker WebSocket error:", event);
    this._setStatus("error", "Tracker WebSocket error");
    if (this.trackerWs && this.trackerWs.readyState !== WebSocket.CLOSED) {
      this.trackerWs.close();
    }
  }

  private handleTrackerClose(event: CloseEvent): void {
    console.log(
      `Tracker WebSocket closed. Code: ${event.code}, Reason: ${event.reason || "No reason given"}`
    );
    this.trackerWs = null;
    clearInterval(this.trackerAnnounceTimerId);
    this.trackerAnnounceTimerId = null;

    if (this.isRunning) {
      this._setStatus(
        "connecting_tracker",
        "Connection lost, attempting reconnect..."
      );
      this.scheduleTrackerReconnect();
    } else {
      console.log("Tracker WebSocket closed during server shutdown.");
      this._setStatus("idle");
    }
  }

  private scheduleTrackerReconnect(): void {
    if (!this.isRunning) return;

    clearTimeout(this.trackerReconnectTimerId);

    const delay = this.currentReconnectDelay;
    console.log(
      `Scheduling tracker reconnection attempt in ${delay / 1000} seconds...`
    );

    this.trackerReconnectTimerId = setTimeout(() => {
      this.currentReconnectDelay = Math.min(
        this.currentReconnectDelay * 2,
        this.options.trackerReconnectMaxDelay
      );
      this.connectToTracker();
    }, delay);
  }

  private async processOffer(msg: TrackerOfferMessage): Promise<void> {
    const { offer, offer_id, peer_id: remotePeerId } = msg;

    if (!this.stream) {
      try {
        this._setStatus("creating_media_stream");
        console.log("First peer connection attempt, creating media stream...");
        this.stream = await this.options.streamFactory();
        console.log("Media stream created successfully.");
      } catch (error) {
        console.error("Failed to create media stream:", error);
        this._setStatus("error", "Failed to create media stream");
        return;
      }
    }

    if (this.peerConnections.has(remotePeerId)) {
      console.log(
        `Cleaning up existing connection for reconnecting peer ${remotePeerId}`
      );
      this._cleanupPeerConnection(remotePeerId);
    }

    let pc: RTCPeerConnection | null = null;
    let cryptoHelper: CryptoHelper;

    try {
      this._setStatus(
        "creating_peer_connection",
        `Processing offer from ${remotePeerId}`
      );
      cryptoHelper = await cipher(
        this.options.share,
        this.options.pwd,
        offer_id
      );

      const offerSdp = await cryptoHelper.decrypt(offer.sdp);

      pc = new RTCPeerConnection({ iceServers: this.options.iceServers });

      this._setupPeerConnectionListeners(pc, remotePeerId);

      const currentStream = this.stream!;
      currentStream.getTracks().forEach((track) => {
        if (pc) {
          pc.addTrack(track, currentStream);
        }
      });

      await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });

      this._setStatus("creating_answer", `For peer ${remotePeerId}`);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.peerConnections.set(remotePeerId, pc);
      console.log(
        `Peer connection created for ${remotePeerId}, waiting for ICE.`
      );

      const answerSdp = await this._waitForIceGathering(pc, remotePeerId);
      console.log(`ICE gathering complete for ${remotePeerId}.`);

      this._setStatus("sending_answer", `To peer ${remotePeerId}`);
      const encryptedAnswer = await cryptoHelper.encrypt(answerSdp);

      const response: TrackerAnswerMessage = {
        action: "announce",
        info_hash: this.infoHash,
        peer_id: this.peerId,
        to_peer_id: remotePeerId,
        offer_id: offer_id,
        answer: { type: "answer", sdp: encryptedAnswer },
      };

      if (this.trackerWs && this.trackerWs.readyState === WebSocket.OPEN) {
        this.trackerWs.send(JSON.stringify(response));
        console.log(`Answer sent to tracker for peer ${remotePeerId}`);
      } else {
        console.warn(
          `Could not send answer to ${remotePeerId}, tracker disconnected.`
        );
        throw new Error("Tracker disconnected before answer could be sent.");
      }
    } catch (error) {
      console.error(`Error processing offer from ${remotePeerId}:`, error);
      this._setStatus("error", `Failed to process offer from ${remotePeerId}`);
      if (pc || this.peerConnections.has(remotePeerId)) {
        this._cleanupPeerConnection(remotePeerId);
      }
      if (this.trackerWs?.readyState === WebSocket.OPEN) {
        this._setStatus("waiting_offer");
      }
    }
  }

  private _setupPeerConnectionListeners(
    pc: RTCPeerConnection,
    remotePeerId: string
  ): void {
    pc.onicecandidate = () => {};

    pc.onicegatheringstatechange = () => {};

    pc.onconnectionstatechange = () => {
      if (!this.peerConnections.has(remotePeerId)) return;

      const state = pc.connectionState;
      console.log(`Peer ${remotePeerId} connection state changed: ${state}`);
      switch (state) {
        case "connected":
          this._setStatus("peer_connected", `Peer ${remotePeerId} connected`);
          break;
        case "disconnected":
          this._setStatus(
            "peer_disconnected",
            `Peer ${remotePeerId} disconnected`
          );
          console.warn(
            `Peer ${remotePeerId} disconnected. Waiting for potential recovery or failure.`
          );
          break;
        case "failed":
          console.error(`Peer ${remotePeerId} connection failed.`);
          this._setStatus(
            "peer_failed",
            `Peer ${remotePeerId} connection failed`
          );
          this._cleanupPeerConnection(remotePeerId);
          if (this.trackerWs?.readyState === WebSocket.OPEN) {
            this._setStatus("waiting_offer");
          }
          break;
        case "closed":
          console.log(`Peer ${remotePeerId} connection closed.`);
          this._cleanupPeerConnection(remotePeerId);
          if (
            this.peerConnections.size === 0 &&
            this.trackerWs?.readyState === WebSocket.OPEN
          ) {
            this._setStatus("waiting_offer");
          }
          break;
        case "new":
        case "connecting":
          break;
      }
    };
  }

  private _cleanupPeerConnection(remotePeerId: string): void {
    const pc = this.peerConnections.get(remotePeerId);
    if (pc) {
      console.log(`Cleaning up connection for peer ${remotePeerId}`);
      pc.onicecandidate = null;
      pc.onicegatheringstatechange = null;
      pc.onconnectionstatechange = null;
      pc.ontrack = null;

      pc.getSenders().forEach((sender) => {
        try {
          pc.removeTrack(sender);
        } catch (e) {
          console.warn(`Error removing track for peer ${remotePeerId}:`, e);
        }
      });

      if (pc.connectionState !== "closed") {
        pc.close();
      }

      this.peerConnections.delete(remotePeerId);
      console.log(`Connection for peer ${remotePeerId} removed.`);

      if (this.peerConnections.size === 0 && this.stream && this.isRunning) {
        console.log(
          "Last peer disconnected, stopping and disposing media stream..."
        );
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
        console.log("Media stream disposed.");
      }

      if (
        this.peerConnections.size === 0 &&
        this.isRunning &&
        this.trackerWs?.readyState === WebSocket.OPEN
      ) {
        this._setStatus("waiting_offer", "Last peer disconnected");
      }
    }
  }

  private async _waitForIceGathering(
    pc: RTCPeerConnection,
    remotePeerId: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!pc.localDescription) {
        return reject(
          new Error(
            `Local description not set before ICE gathering for peer ${remotePeerId}.`
          )
        );
      }
      if (pc.iceGatheringState === "complete") {
        resolve(pc.localDescription.sdp);
        return;
      }

      const timeoutDuration = this.options.iceGatheringTimeout;
      let timeoutHandle: any = null;

      const onIceGatheringChange = () => {
        if (pc.iceGatheringState === "complete") {
          cleanup();
          resolve(pc.localDescription!.sdp);
        }
      };

      const onTimeout = () => {
        console.warn(
          `ICE gathering timed out after ${timeoutDuration}ms for peer ${remotePeerId}. Using potentially incomplete SDP.`
        );
        cleanup();
        resolve(pc.localDescription!.sdp);
      };

      const onConnectionStateChange = () => {
        if (pc.connectionState === "failed") {
          cleanup();
          reject(
            new Error(
              `Peer connection failed during ICE gathering for ${remotePeerId}.`
            )
          );
        } else if (pc.connectionState === "closed") {
          cleanup();
          reject(
            new Error(
              `Peer connection closed during ICE gathering for ${remotePeerId}.`
            )
          );
        }
      };

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        pc.removeEventListener("icegatheringstatechange", onIceGatheringChange);
        pc.removeEventListener(
          "connectionstatechange",
          onConnectionStateChange
        );
      };

      pc.addEventListener("icegatheringstatechange", onIceGatheringChange);
      pc.addEventListener("connectionstatechange", onConnectionStateChange);
      timeoutHandle = setTimeout(onTimeout, timeoutDuration);
    });
  }
}
