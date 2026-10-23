import type { Emitter } from 'mitt';
import type { PeerInfo } from './signal-protocol';

export type { PeerInfo };

export type SignallerEvents = {
  'peer-joined': PeerInfo;
  'peer-left': { peerId: string };
  signal: { from: string; data: unknown };
};

/** Finds peers in a room and relays signalling messages to them. */
export interface Signaller {
  readonly peerId: string;
  /** Resolves once in the room, or once the first attempt failed while reconnects continue. */
  join(roomId: string, role: string): Promise<void>;
  sendMessage(targetPeerId: string, data: unknown): Promise<void>;
  disconnect(): Promise<void>;
  readonly on: Emitter<SignallerEvents>['on'];
  readonly off: Emitter<SignallerEvents>['off'];
}

/** Generate a cryptographically strong random ID. */
export function generatePeerId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
