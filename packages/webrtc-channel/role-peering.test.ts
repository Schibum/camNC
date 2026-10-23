import { describe, expect, it, vi } from 'vitest';
import { RolePeering } from './role-peering';
import { LocalSignalHub } from './test-utils/local-signal-hub';

// Real RTCPeerConnections in Chromium, signalling through an in-memory hub.
describe('RolePeering', () => {
  it('send message to target role peers', async () => {
    const hub = new LocalSignalHub();
    const roomId = crypto.randomUUID();
    const serverPeering = new RolePeering(roomId, 'server', 'client', { createSignaller: hub.create });
    await serverPeering.join();
    const client1Peering = new RolePeering(roomId, 'client', 'server', { createSignaller: hub.create });
    await client1Peering.join();
    const client2Peering = new RolePeering(roomId, 'client', 'server', { createSignaller: hub.create });
    await client2Peering.join();

    const serverMsgSpy = vi.fn();
    const client1MsgSpy = vi.fn();
    const client2MsgSpy = vi.fn();

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

    await Promise.all([serverPeering.destroy(), client1Peering.destroy(), client2Peering.destroy()]);
  });

  it('re-pairs after the p2p connection drops while both stay in the room', async () => {
    const hub = new LocalSignalHub();
    const roomId = crypto.randomUUID();
    const opts = { createSignaller: hub.create, retryDelayMs: 50 };
    const server = new RolePeering(roomId, 'server', 'client', opts);
    const client = new RolePeering(roomId, 'client', 'server', { ...opts, maxPeers: 1 });
    const connected = vi.fn();
    client.on('peerConnected', connected);
    await server.join();
    await client.join();
    await vi.waitFor(() => expect(connected).toHaveBeenCalledTimes(1));

    connected.mock.calls[0]![0].peer.destroy();

    await vi.waitFor(() => expect(connected).toHaveBeenCalledTimes(2), { timeout: 5000 });
    const received = vi.fn();
    client.on('message', received);
    await server.sendMessage('after reconnect');
    await vi.waitFor(() => expect(received).toHaveBeenCalledWith('after reconnect'));

    await Promise.all([server.destroy(), client.destroy()]);
  });
});
