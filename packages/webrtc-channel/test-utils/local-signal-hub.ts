import mitt, { Emitter } from 'mitt';
import { generatePeerId, type Signaller, type SignallerEvents } from '../signaller';

/** In-memory stand-in for the signal worker, with the same ordering guarantees. */
export class LocalSignalHub {
  readonly rooms = new Map<string, Map<string, LocalSignaller>>();

  create = (): LocalSignaller => new LocalSignaller(this);
}

export class LocalSignaller implements Signaller {
  readonly peerId = generatePeerId();
  readonly on: Emitter<SignallerEvents>['on'];
  readonly off: Emitter<SignallerEvents>['off'];
  readonly emit: Emitter<SignallerEvents>['emit'];
  role?: string;
  sent: { to: string; data: unknown }[] = [];
  private room?: Map<string, LocalSignaller>;

  constructor(private readonly hub: LocalSignalHub) {
    const bus = mitt<SignallerEvents>();
    this.on = bus.on;
    this.off = bus.off;
    this.emit = bus.emit;
  }

  async join(roomId: string, role: string) {
    this.role = role;
    this.room = this.hub.rooms.get(roomId) ?? new Map();
    this.hub.rooms.set(roomId, this.room);
    const others = [...this.room.values()];
    this.room.set(this.peerId, this);
    await tick();
    for (const other of others) {
      this.emit('peer-joined', { peerId: other.peerId, role: other.role! });
      other.emit('peer-joined', { peerId: this.peerId, role });
    }
  }

  async sendMessage(to: string, data: unknown) {
    this.sent.push({ to, data });
    const target = this.room?.get(to);
    await tick();
    target?.emit('signal', { from: this.peerId, data });
  }

  async disconnect() {
    if (!this.room?.delete(this.peerId)) return;
    for (const other of this.room.values()) other.emit('peer-left', { peerId: this.peerId });
  }
}

const tick = () => Promise.resolve();
