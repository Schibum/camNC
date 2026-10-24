import { kErrorMessages } from '../parsers/errors';
import { FirmwareVariant, socketUrl } from '../socket';
import v3Transcript from './transcripts/v3.9.9-jackpot2.json';
import v4Transcript from './transcripts/v4.1.1-sim.json';

export interface Transcript {
  variant: FirmwareVariant;
  control: string[];
  responses: Record<string, string[]>;
}

export const transcripts = {
  'v3.9.9': v3Transcript as Transcript,
  'v4.1.1': v4Transcript as Transcript,
};

function errorCode(message: string) {
  return Number(Object.entries(kErrorMessages).find(([, m]) => m === message)![0]);
}

type Vec = { x: number; y: number; z: number };
const fmt = (p: Vec) => [p.x, p.y, p.z].map(n => n.toFixed(3)).join(',');

/**
 * A scripted FluidNC for unit tests. It speaks the transport of either firmware (hello frames,
 * one frame per line on 3.9.9, coalesced and arbitrarily split frames on 4.x), replays recorded
 * transcripts for read-only commands and simulates just enough state for jogging, zeroing,
 * probing, SD jobs and alarms.
 *
 * Inject it with `new FluidncSocket({ host: fake.host, WebSocketImpl: fake.WebSocket })`.
 */
export class FakeFluidnc {
  readonly host = '192.168.1.20';
  reachable = true;
  /** Every line received, in order. */
  readonly received: string[] = [];
  /** Realtime bytes received, in order. */
  readonly realtime: number[] = [];
  /** Lines to answer instead of the built-in behaviour; return `undefined` to fall through. */
  respond: ((line: string) => string[] | undefined) | undefined;

  state = 'Idle';
  mpos: Vec = { x: 3, y: 3, z: 3 };
  wco: Vec = { x: 0, y: 0, z: 0 };
  ov = { feed: 100, rapid: 100, spindle: 100 };
  job: { file: string; percent: number } | null = null;
  files = new Map<string, Uint8Array>();
  /** Z (machine) where the probe makes contact. `null` makes `G38.2` fail with ALARM:5. */
  probeContactZ: number | null = -20;
  /** Upload requests seen by {@link fetch}. */
  readonly uploads: { url: string; name: string; size: number }[] = [];

  readonly sockets = new Set<FakeSocket>();
  private relative = false;
  private jobAckPending = false;
  private xmodem: { path: string; data: number[]; buffer: number[] } | null = null;
  readonly transcript: Transcript;

  constructor(readonly variant: FirmwareVariant = 'v3-81') {
    this.transcript = variant === 'v4' ? transcripts['v4.1.1'] : transcripts['v3.9.9'];
  }

  get WebSocket(): typeof WebSocket {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const fake = this;
    return class extends FakeSocket {
      constructor(url: string) {
        super(fake, url);
      }
    } as unknown as typeof WebSocket;
  }

  /** A `fetch` that accepts `no-cors` uploads like FluidNC's `/upload` handler. */
  fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (!this.reachable || !url.startsWith(`http://${this.host}`)) throw new TypeError('Failed to fetch');
    const form = init?.body as FormData;
    for (const [, value] of form.entries()) {
      if (typeof value === 'string') continue;
      const bytes = new Uint8Array(await value.arrayBuffer());
      const name = (value as File).name.replace(/^\/+/, '');
      this.files.set(name, bytes);
      this.uploads.push({ url, name, size: bytes.length });
    }
    return new Response(null, { status: 0 }) as Response;
  };

  get openSockets() {
    return [...this.sockets].filter(s => s.readyState === 1);
  }

  accepts(url: string) {
    return this.reachable && url === socketUrl(this.host, this.variant);
  }

  /** Drop every connection, like a Wi-Fi outage or a controller reboot. */
  kill() {
    for (const socket of this.sockets) socket.serverClose();
  }

  status(): string {
    const parts = [
      `${this.state}`,
      `MPos:${fmt(this.mpos)}`,
      'FS:0,0',
      `WCO:${fmt(this.wco)}`,
      `Ov:${this.ov.feed},${this.ov.rapid},${this.ov.spindle}`,
    ];
    if (this.job) parts.push(`SD:${this.job.percent.toFixed(2)},${this.job.file}`);
    return `<${parts.join('|')}>`;
  }

  /** Send lines to every client, framed like the firmware does. */
  emit(lines: string[]) {
    for (const socket of this.openSockets) socket.deliver(lines);
  }

  pushStatus() {
    this.emit([this.status()]);
  }

  // --- input handling -------------------------------------------------------------------------

  private lineBuffer = '';

  onBytes(bytes: Uint8Array) {
    if (this.xmodem) {
      this.onXmodemBytes(bytes);
      return;
    }
    for (const byte of bytes) {
      if (byte === 0x3f || byte === 0x21 || byte === 0x7e || byte === 0x18 || byte >= 0x80) {
        this.onRealtime(byte);
        continue;
      }
      if (byte === 0x0a) {
        const line = this.lineBuffer.replace(/\r$/, '');
        this.lineBuffer = '';
        if (line) this.onLine(line);
        continue;
      }
      this.lineBuffer += String.fromCharCode(byte);
    }
  }

  private onRealtime(byte: number) {
    this.realtime.push(byte);
    switch (byte) {
      case 0x3f:
        this.pushStatus();
        break;
      case 0x21:
        if (this.state === 'Run' || this.state === 'Jog') this.state = 'Hold:0';
        break;
      case 0x7e:
        if (this.state.startsWith('Hold')) this.state = this.job ? 'Run' : 'Idle';
        break;
      case 0x18:
        this.job = null;
        this.state = this.state === 'Run' ? 'Alarm' : 'Idle';
        this.emit([
          this.variant === 'v4' ? "Grbl 4.1 [FluidNC v4.1.1 (fake) '$' for help]" : "Grbl 3.9 [FluidNC v3.9.9 (wifi) '$' for help]",
        ]);
        break;
      case 0x85:
        if (this.state === 'Jog') this.state = 'Idle';
        break;
      case 0x90:
        this.ov.feed = 100;
        break;
      case 0x91:
        this.ov.feed += 10;
        break;
      case 0x92:
        this.ov.feed -= 10;
        break;
      case 0x93:
        this.ov.feed += 1;
        break;
      case 0x94:
        this.ov.feed -= 1;
        break;
      case 0x99:
        this.ov.spindle = 100;
        break;
      case 0x9a:
        this.ov.spindle += 10;
        break;
      case 0x9b:
        this.ov.spindle -= 10;
        break;
    }
  }

  private ok(lines: string[] = []) {
    this.emit([...lines, 'ok']);
  }

  private error(message: string) {
    this.emit([`error:${errorCode(message)}`]);
  }

  private onLine(line: string) {
    this.received.push(line);
    const custom = this.respond?.(line);
    if (custom) {
      this.emit(custom);
      return;
    }
    const recorded = this.transcript.responses[line] ?? (line === '$CD' ? this.transcript.responses['$Config/Dump'] : undefined);
    if (recorded && line !== '$SD/ListJSON') {
      this.emit(recorded);
      return;
    }
    const assign = line.match(/^\$([\w/]+)=(.*)$/);
    if (line === '$SD/ListJSON') return this.ok([this.listJson()]);
    if (assign?.[1] === 'Report/Interval') return this.ok([`[MSG:INFO: websocket auto report interval set to ${assign[2]} ms]`]);
    if (assign?.[1] === 'SD/Run') return this.runFile(assign[2]!);
    if (assign?.[1] === 'SD/Delete') {
      this.files.delete(assign[2]!.replace(/^\/+/, ''));
      return this.ok();
    }
    if (assign?.[1] === 'Xmodem/Receive') {
      this.xmodem = { path: assign[2]!, data: [], buffer: [] };
      this.emitRaw([0x43]);
      return;
    }
    if (line === '$X') {
      this.state = 'Idle';
      return this.ok(['[MSG:Caution: Unlocked]']);
    }
    if (line === '$H') {
      if (this.state !== 'Idle' && this.state !== 'Alarm') return this.error('Command requires idle state');
      this.mpos = { x: 3, y: 3, z: 3 };
      this.state = 'Idle';
      return this.ok();
    }
    if (line.startsWith('$J=')) return this.jog(line.slice(3));
    if (line.startsWith('$')) return this.ok();
    return this.gcode(line);
  }

  private listJson() {
    const files = [...this.files].map(([name, data]) => ({ name, shortname: name, size: String(data.length), datetime: '' }));
    return JSON.stringify({ files, path: '/', total: '7.40 GB', used: '64.00 KB', occupation: '1' });
  }

  private runFile(path: string) {
    const name = path.replace(/^\/+/, '');
    if (!this.files.has(name)) return this.error('File not found');
    if (this.state !== 'Idle') return this.error('Command requires idle state');
    this.job = { file: `/sd/${name}`, percent: 0 };
    this.state = 'Run';
    // 4.x acknowledges $SD/Run only when the file has finished; 3.9.9 right away.
    if (this.variant === 'v4') this.jobAckPending = true;
    else this.ok();
    this.pushStatus();
  }

  /** Advance the running job; finishes it at 100 %. */
  progressJob(percent: number) {
    if (!this.job) return;
    if (percent >= 100) {
      this.job = null;
      this.state = 'Idle';
      if (this.jobAckPending) {
        this.jobAckPending = false;
        this.emit(['ok']);
      }
    } else {
      this.job.percent = percent;
    }
    this.pushStatus();
  }

  private words(line: string) {
    const words: Record<string, number> = {};
    for (const match of line.toUpperCase().matchAll(/([A-Z])\s*(-?[\d.]+)/g)) words[match[1]!] = Number(match[2]);
    return words;
  }

  private move(words: Record<string, number>, relative: boolean, machine = false) {
    for (const axis of ['x', 'y', 'z'] as const) {
      const value = words[axis.toUpperCase()];
      if (value === undefined) continue;
      this.mpos[axis] = relative ? this.mpos[axis] + value : value + (machine ? 0 : this.wco[axis]);
    }
  }

  private jog(body: string) {
    if (this.state !== 'Idle' && this.state !== 'Jog') return this.error('Command requires idle state');
    const words = this.words(body);
    if (words.F === undefined) return this.error('Invalid jog command');
    this.move(words, /G91/.test(body) || (this.relative && !/G90/.test(body)), /G53/.test(body));
    this.ok();
  }

  private gcode(line: string) {
    const upper = line.toUpperCase();
    if (this.state === 'Alarm') return this.error('GCode cannot be executed in lock or alarm state');
    const words = this.words(upper);
    if (/G91(?!\.)/.test(upper)) this.relative = true;
    if (/G90(?!\.)/.test(upper)) this.relative = false;
    if (/G10/.test(upper)) {
      const l20 = words.L === 20;
      for (const axis of ['x', 'y', 'z'] as const) {
        const value = words[axis.toUpperCase()];
        if (value === undefined) continue;
        this.wco[axis] = l20 ? this.mpos[axis] - value : value;
      }
      this.ok();
      this.emit([`[G54:${fmt(this.wco)}]`]);
      return;
    }
    if (/G38\.2/.test(upper)) {
      if (this.probeContactZ === null) {
        this.state = 'Alarm';
        this.emit(['ALARM:5']);
        return;
      }
      this.mpos.z = this.probeContactZ;
      this.emit([`[PRB:${fmt(this.mpos)}:1]`]);
      return this.ok();
    }
    if (/G0?[01](?![\d.])/.test(upper) || /G53/.test(upper)) this.move(words, this.relative && !/G53/.test(upper), /G53/.test(upper));
    this.ok();
  }

  // --- XMODEM receiver ------------------------------------------------------------------------

  private emitRaw(bytes: number[]) {
    for (const socket of this.openSockets) socket.deliverBytes(new Uint8Array(bytes));
  }

  private onXmodemBytes(bytes: Uint8Array) {
    const x = this.xmodem!;
    x.buffer.push(...bytes);
    for (;;) {
      const head = x.buffer[0];
      if (head === undefined) return;
      if (head === 0x04) {
        x.buffer.shift();
        let end = x.data.length;
        while (end > 0 && x.data[end - 1] === 0x1a) end--;
        const name = x.path.replace(/^\/sd\//, '');
        this.files.set(name, new Uint8Array(x.data.slice(0, end)));
        this.xmodem = null;
        this.emitRaw([0x06]);
        this.ok([`[MSG:INFO: Received ${end} bytes to file ${x.path}]`]);
        return;
      }
      const size = head === 0x02 ? 1024 : 128;
      if (x.buffer.length < size + 5) return;
      const block = x.buffer.splice(0, size + 5);
      x.data.push(...block.slice(3, 3 + size));
      this.emitRaw([0x06]);
    }
  }
}

/** Node 22 has no global `CloseEvent`; FluidncSocket only reads `code`. */
class FakeCloseEvent extends Event {
  readonly code: number;
  readonly reason = '';
  readonly wasClean: boolean;
  constructor(type: string, init: { code: number }) {
    super(type);
    this.code = init.code;
    this.wasClean = init.code === 1000;
  }
}

class FakeSocket extends EventTarget {
  readyState = 0;
  binaryType = 'blob';

  constructor(
    private readonly fake: FakeFluidnc,
    readonly url: string
  ) {
    super();
    fake.sockets.add(this);
    setTimeout(() => {
      if (!fake.accepts(url)) {
        this.readyState = 3;
        this.dispatchEvent(new Event('error'));
        this.dispatchEvent(new FakeCloseEvent('close', { code: 1006 }));
        return;
      }
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
      for (const control of fake.transcript.control) {
        this.dispatchEvent(new MessageEvent('message', { data: control }));
      }
    }, 0);
  }

  send(data: string | ArrayBufferView | ArrayBuffer) {
    if (this.readyState !== 1) throw new Error('InvalidStateError');
    if (typeof data === 'string') {
      // 4.x answers PING: on text frames; 3.9.9 feeds text frames to the parser like any input.
      if (data.startsWith('PING:') && this.fake.variant === 'v4') {
        this.dispatchEvent(new MessageEvent('message', { data: 'PING:60000:60000' }));
        return;
      }
      this.fake.onBytes(new TextEncoder().encode(data));
      return;
    }
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.fake.onBytes(bytes.slice());
  }

  close() {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    setTimeout(() => this.dispatchEvent(new FakeCloseEvent('close', { code: 1000 })), 0);
  }

  serverClose() {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.dispatchEvent(new FakeCloseEvent('close', { code: 1006 }));
  }

  /** 3.9.9: one binary frame per line. 4.x: coalesced, and split at odd offsets to exercise line reassembly. */
  deliver(lines: string[]) {
    const encoder = new TextEncoder();
    if (this.fake.variant === 'v3-81') {
      for (const line of lines) this.deliverBytes(encoder.encode(line + '\n'));
      return;
    }
    const bytes = encoder.encode(lines.map(l => l + '\n').join(''));
    for (let i = 0; i < bytes.length; i += 37) this.deliverBytes(bytes.slice(i, i + 37));
  }

  deliverBytes(bytes: Uint8Array) {
    if (this.readyState !== 1) return;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    // Deliver asynchronously, like a real socket.
    setTimeout(() => {
      if (this.readyState === 1) this.dispatchEvent(new MessageEvent('message', { data: buffer }));
    }, 0);
  }
}
