import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initTestFbApp } from "../webrtc-channel/test-fb-config";
import { FluidncApi } from "./fluidnc-api";
import { FluidncClient } from "./fluidnc-client";
import { FluidncServer } from "./fluidnc-server";

// log.setDefaultLevel(log.levels.TRACE);

let apiMock = { cmd: vi.fn() };
vi.mock("./fluidnc-api", () => {
  return {
    FluidncApi: vi.fn(() => apiMock),
  };
});

describe("FluidNcClient ↔ FluidNcServer integration", () => {
  beforeAll(() => {
    initTestFbApp();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("will route client.cmd(...) through Comlink to Server.fluidApi.cmd", async () => {
    // pick up the mock constructor
    const MockedApi = vi.mocked(FluidncApi);

    // roomId must be the same for client+server
    const roomId = crypto.randomUUID();
    const client = new FluidncClient(roomId);
    const server = new FluidncServer(roomId);

    // join both
    await server.start();
    await client.start();
    // TODO: fix race (transaction in signaller?) when both start at the same time
    // await Promise.all([client.start(), server.start()]);
    // wait until they see each other
    await vi.waitUntil(() => server.numConnected.value === 1);
    await vi.waitUntil(() => client.api);
    console.log("got client api");

    await client.api!.cmd("cmd1");
    expect(apiMock.cmd).toHaveBeenCalledWith("cmd1");
    await client.api!.cmd("cmd2");
    expect(apiMock.cmd).toHaveBeenCalledWith("cmd2");
    expect(apiMock.cmd).toHaveBeenCalledTimes(2);
  });
});
