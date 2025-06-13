export interface Go2RtcWsOptions {
  /**
   * Hostname or full URL of the go2rtc instance. May include a protocol such
   * as "wss://" to connect via TLS.
   */
  host: string;
  src: string;
}

export async function connectGo2RtcWs(options: Go2RtcWsOptions): Promise<{
  stream: MediaStream;
  pc: RTCPeerConnection;
  maxResolution?: { width: number; height: number };
}> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  const transceiver = pc.addTransceiver("video", { direction: "recvonly" });
  const stream = new MediaStream(
    transceiver.receiver.track ? [transceiver.receiver.track] : []
  );
  let maxResolution: { width: number; height: number } | undefined;
  const updateResolution = () => {
    const settings = transceiver.receiver.track.getSettings();
    if (settings.width && settings.height) {
      maxResolution = { width: settings.width, height: settings.height };
    }
  };

  transceiver.receiver.track.addEventListener("unmute", updateResolution);

  let base = options.host;
  if (!/^wss?:\/\//.test(base)) {
    if (base.startsWith("https://")) {
      base = "wss://" + base.slice("https://".length);
    } else if (base.startsWith("http://")) {
      base = "ws://" + base.slice("http://".length);
    } else {
      base = "ws://" + base;
    }
  }
  const ws = new WebSocket(
    `${base.replace(/\/$/, "")}/api/ws?src=${encodeURIComponent(options.src)}`
  );

  return new Promise((resolve, reject) => {
    ws.addEventListener("open", async () => {
      pc.addEventListener("icecandidate", (ev) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const candidate = ev.candidate ? ev.candidate.candidate : "";
        ws.send(JSON.stringify({ type: "webrtc/candidate", value: candidate }));
      });
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: "webrtc/offer", value: offer.sdp }));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    ws.addEventListener("message", async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "webrtc/answer") {
        await pc.setRemoteDescription({ type: "answer", sdp: msg.value });
      } else if (msg.type === "webrtc/candidate" && msg.value) {
        try {
          await pc.addIceCandidate({ candidate: msg.value, sdpMid: "0" });
        } catch (e) {
          console.warn(e);
        }
      }
    });

    ws.addEventListener("error", () => {
      reject(new Error("WebSocket error"));
    });

    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "connected") {
        updateResolution();
        resolve({ stream, pc, maxResolution });
      } else if (pc.connectionState === "failed") {
        reject(new Error("WebRTC connection failed"));
      }
    });
  });
}
