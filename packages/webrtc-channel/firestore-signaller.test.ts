import { describe, expect, it } from "vitest";
import { FirestoreSignaller } from "./firestore-signaller";
describe("FirestoreSignaller", () => {
  it("signal something", async () => {
    const signaller = new FirestoreSignaller("test");
    await signaller.send({ type: "offer", payload: "test-payload" });
    const signaller2 = new FirestoreSignaller("test");
    await new Promise((resolve) => {
      signaller2.onSignal((from, payload) => {
        // console.log("from", from);
        expect(payload).toEqual({ type: "offer", payload: "test-payload" });
        resolve(true);
      });
    });
  });
});
