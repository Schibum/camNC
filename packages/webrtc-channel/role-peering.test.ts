import { initFbApp } from '@wbcnc/public-config/firebase';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { RolePeering } from './role-peering';
// log.setDefaultLevel(log.levels.DEBUG);
describe('RolePeering', () => {
  beforeAll(() => {
    initFbApp();
  });

  it('send message to target role peers', async () => {
    let roomId = crypto.randomUUID();
    const serverPeering = new RolePeering(roomId, 'server', 'client');
    await serverPeering.join();
    const client1Peering = new RolePeering(roomId, 'client', 'server');
    await client1Peering.join();
    const client2Peering = new RolePeering(roomId, 'client', 'server');
    await client2Peering.join();

    let serverMsgSpy = vi.fn();
    let client1MsgSpy = vi.fn();
    let client2MsgSpy = vi.fn();

    serverPeering.on('message', serverMsgSpy);
    client1Peering.on('message', client1MsgSpy);
    client2Peering.on('message', client2MsgSpy);
    serverPeering.sendMessage('hi from server');
    client1Peering.sendMessage('hi from client1');
    client2Peering.sendMessage('hi from client2');

    await vi.waitFor(() => {
      expect(serverMsgSpy).toHaveBeenCalledWith('hi from client1');
      expect(serverMsgSpy).toHaveBeenCalledWith('hi from client2');
      expect(client1MsgSpy).toHaveBeenCalledWith('hi from server');
      expect(client2MsgSpy).toHaveBeenCalledWith('hi from server');
    });
    expect(client1MsgSpy).toHaveBeenCalledTimes(1);
    expect(client2MsgSpy).toHaveBeenCalledTimes(1);
    expect(serverMsgSpy).toHaveBeenCalledTimes(2);
  });
});
