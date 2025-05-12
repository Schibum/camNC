import { beforeAll, describe, expect, it, vi } from "vitest";
import { RoleMessaging } from "./role-messaging";
import { initTestFbApp } from "./test-fb-config";
describe("RoleMessaging", () => {
  beforeAll(() => {
    initTestFbApp();
  });

  it("send message to target role peers", async () => {
    let roomId = crypto.randomUUID();
    const serverMessaging = new RoleMessaging(roomId, "server", "client");
    await serverMessaging.join();
    const client1Messaging = new RoleMessaging(roomId, "client", "server");
    await client1Messaging.join();
    const client2Messaging = new RoleMessaging(roomId, "client", "server");
    await client2Messaging.join();

    let serverMsgSpy = vi.fn();
    let client1MsgSpy = vi.fn();
    let client2MsgSpy = vi.fn();

    serverMessaging.on("message", serverMsgSpy);
    client1Messaging.on("message", client1MsgSpy);
    client2Messaging.on("message", client2MsgSpy);
    serverMessaging.sendMessage("hi from server");
    client1Messaging.sendMessage("hi from client1");
    client2Messaging.sendMessage("hi from client2");

    await vi.waitFor(() => {
      expect(serverMsgSpy).toHaveBeenCalledWith("hi from client1");
      expect(serverMsgSpy).toHaveBeenCalledWith("hi from client2");
      expect(client1MsgSpy).toHaveBeenCalledWith("hi from server");
      expect(client2MsgSpy).toHaveBeenCalledWith("hi from server");
    });
    expect(client1MsgSpy).toHaveBeenCalledTimes(1);
    expect(client2MsgSpy).toHaveBeenCalledTimes(1);
    expect(serverMsgSpy).toHaveBeenCalledTimes(2);
  });
});
