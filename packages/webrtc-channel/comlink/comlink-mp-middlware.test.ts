import { expose, proxy, wrap } from "comlink";
import { describe, expect, it } from "vitest";
import { comlinkMpMiddleware } from "./comlink-mp-middleware";

describe("Comlink MessagePort middleware", () => {
  it("round-trips a callback with zero MessagePort transfers", async () => {
    const { port1, port2 } = new MessageChannel();

    //   patch postMessage so test fails if transferables are attempted
    function guard(port: MessagePort) {
      const native = port.postMessage.bind(port);
      port.postMessage = (msg: any, xfer: any = []) => {
        expect(xfer.length, "postMessage MUST NOT use the transfer list").toBe(
          0,
        );
        native(msg);
      };
      return port;
    }
    guard(port1);
    guard(port2);

    /* sender / receiver endpoints that only understand JSON */
    const jsonEpA = comlinkMpMiddleware(port1);
    const jsonEpB = comlinkMpMiddleware(port2);

    /* remote API that lives on side B ------------------------- */
    const remoteImpl = {
      async someFn(cb: (n: number) => void) {
        cb(42);
        return "done";
      },
    };
    expose(remoteImpl, jsonEpB);

    /* client on side A --------------------------------------- */
    const remoteApi = wrap<typeof remoteImpl>(jsonEpA);

    let received = 0;
    const result = await remoteApi.someFn(
      proxy((x: number) => {
        received = x;
      }),
    );

    expect(result).toBe("done");
    expect(received).toBe(42);
  });
});
