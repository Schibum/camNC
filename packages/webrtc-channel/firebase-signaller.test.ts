import { initFbApp } from "@wbcnc/public-config/firebase";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FirebaseSignaller } from "./firebase-signaller";
describe("FirebaseSignaller", () => {
  beforeAll(() => {
    initFbApp();
  });

  it("signal something", async () => {
    let roomId = crypto.randomUUID();
    const signaller = new FirebaseSignaller();
    const signaller2 = new FirebaseSignaller();
    const joinedSpy2 = vi.fn();
    const joinedSpy1 = vi.fn();
    signaller2.on("peer-joined", joinedSpy2);
    signaller.on("peer-joined", joinedSpy1);

    await signaller.join(roomId, "role1");
    await signaller2.join(roomId, "role2");

    const signalSpy2 = vi.fn();
    signaller2.on("signal", signalSpy2);
    await signaller.sendMessage(signaller2.peerId, "test-payload");

    await vi.waitFor(() => {
      expect(joinedSpy1).toHaveBeenCalledWith({
        peerId: signaller2.peerId,
        role: "role2",
      });
      expect(joinedSpy2).toHaveBeenCalledWith({
        peerId: signaller.peerId,
        role: "role1",
      });
      expect(signalSpy2).toHaveBeenCalledWith({
        from: signaller.peerId,
        data: "test-payload",
      });
    });
    await signaller.disconnect();

    let joinedSpy3 = vi.fn();
    const signaller3 = new FirebaseSignaller();
    signaller3.on("peer-joined", joinedSpy3);
    await signaller3.join(roomId, "role3");
    await vi.waitFor(() => {
      expect(joinedSpy3).toHaveBeenCalledWith({
        peerId: signaller2.peerId,
        role: "role2",
      });
    });
  });
});
