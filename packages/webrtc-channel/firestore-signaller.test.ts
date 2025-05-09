import { describe, expect, it, vi } from "vitest";
import { FirestoreSignaller } from "./firestore-signaller";
import { initTestFbApp } from "./test-fb-config";
describe.skip("FirestoreSignaller", () => {
  it("signal something", async () => {
    let roomId = crypto.randomUUID();
    const signaller = new FirestoreSignaller({
      firebaseApp: initTestFbApp(),
    });
    const signaller2 = new FirestoreSignaller({
      firebaseApp: initTestFbApp(),
    });
    let onJoined1 = vi.fn();
    signaller2.on("peer-joined", onJoined1);
    signaller2.on("peer-joined", (event) => {
      expect(event).toEqual({
        peerId: signaller.peerId,
        role: "role1",
      });
    });
    signaller.on("peer-joined", (event) => {
      expect(event).toEqual({
        peerId: signaller2.peerId,
        role: "role2",
      });
    });

    await signaller.join(roomId, "role1");
    await signaller2.join(roomId, "role2");
    // Wait for the joinedFn to be called
    await vi.waitFor(() => {
      expect(onJoined1).toHaveBeenCalledTimes(1);
    });
    let signalPromise = new Promise((resolve) => {
      signaller2.on("signal", (event) => {
        // console.log("from", from);
        expect(event).toEqual({
          from: signaller.peerId,
          data: { type: "offer", payload: "test-payload" },
        });
        resolve(true);
      });
    });
    await signaller.sendMessage(signaller2.peerId, {
      type: "offer",
      payload: "test-payload",
    });
    await signalPromise;
  });
});
