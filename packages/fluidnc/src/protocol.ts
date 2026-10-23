import mitt from 'mitt';
import { describeAlarm, describeError } from './parsers/errors';
import {
  BuildInfo,
  isResetBanner,
  parseAlarmLine,
  parseBuildInfo,
  parseErrorLine,
  parseFluidNCLine,
  parseFluidNCModalLine,
  parseFluidNCOffsetLine,
  parseMessageLine,
  parseProbeLine,
  ParsedModals,
  ParsedOffset,
  ParsedStatus,
  Position,
  ProbeResult,
} from './parsers/stream-parser';
import { FirmwareVariant, FluidncSocket } from './socket';

/** Single-byte realtime commands. They bypass the command queue. */
export const Realtime = {
  statusQuery: 0x3f, // '?'
  feedHold: 0x21, // '!'
  cycleStart: 0x7e, // '~'
  reset: 0x18,
  jogCancel: 0x85,
  feedOvrReset: 0x90,
  feedOvrPlus10: 0x91,
  feedOvrMinus10: 0x92,
  feedOvrPlus1: 0x93,
  feedOvrMinus1: 0x94,
  rapidOvr100: 0x95,
  rapidOvr50: 0x96,
  rapidOvr25: 0x97,
  spindleOvrReset: 0x99,
  spindleOvrPlus10: 0x9a,
  spindleOvrMinus10: 0x9b,
  spindleOvrPlus1: 0x9c,
  spindleOvrMinus1: 0x9d,
} as const;

export class FluidncError extends Error {
  constructor(
    public readonly code: number,
    public readonly command: string
  ) {
    super(`error:${code} ${describeError(code)} (${command})`);
    this.name = 'FluidncError';
  }
}

/** A command was dropped without an answer: disconnect, alarm or reset. */
export class FluidncAbortError extends Error {
  constructor(
    reason: string,
    public readonly command: string
  ) {
    super(`${command}: ${reason}`);
    this.name = 'FluidncAbortError';
  }
}

/** Status with sticky fields (WCO, Ov, …) merged in and WPos/MPos completed. */
export interface MachineStatus extends ParsedStatus {
  mpos: Position;
  wpos: Position;
  wco: Position;
}

export type ConsoleLineKind = 'sent' | 'ok' | 'error' | 'alarm' | 'msg' | 'reset' | 'data';
export interface ConsoleLine {
  kind: ConsoleLineKind;
  text: string;
  /** Readable explanation for `error:` and `ALARM:` lines. */
  detail?: string;
  time: number;
}

export type ProtocolEvents = {
  connected: { variant: FirmwareVariant; buildInfo: BuildInfo | null };
  disconnected: { wasOpen: boolean; reason: string };
  status: MachineStatus;
  modals: ParsedModals;
  offset: ParsedOffset;
  probe: ProbeResult;
  message: string;
  alarm: { code: number; message: string };
  reset: string;
  console: ConsoleLine;
};

interface PendingCommand {
  line: string;
  lines: string[];
  timeoutMs: number;
  timer?: ReturnType<typeof setTimeout>;
  resolve: (lines: string[]) => void;
  reject: (err: Error) => void;
}

export interface SendOptions {
  /** Reject when no `ok`/`error` arrives in time. 0 disables the timeout (homing, probing). */
  timeoutMs?: number;
}

const kZero: Position = { x: 0, y: 0, z: 0 };

function subtract(a: Position, b: Position): Position {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function add(a: Position, b: Position): Position {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/**
 * The G-code/`$` protocol on top of a {@link FluidncSocket}.
 *
 * - One line in flight; each command resolves with the lines received before its `ok`.
 * - `error:N` rejects that command. Socket close, `ALARM:N`, a reset banner or a soft reset reject everything pending.
 * - Nothing is ever re-sent after a reconnect.
 */
export class FluidncProtocol {
  private readonly events = mitt<ProtocolEvents>();
  public readonly on = this.events.on;
  public readonly off = this.events.off;

  public status: MachineStatus | null = null;
  public buildInfo: BuildInfo | null = null;
  public ready = false;

  private queue: PendingCommand[] = [];
  private inFlight: PendingCommand | null = null;
  private lastStatusAt = 0;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  /** When set, raw bytes go here instead of the line parser (XMODEM). */
  private rawHandler: ((bytes: Uint8Array) => void) | null = null;
  private generation = 0;

  constructor(
    public readonly socket: FluidncSocket,
    private readonly options: { reportIntervalMs?: number; defaultTimeoutMs?: number; statusPollMs?: number } = {}
  ) {
    socket.on('open', ({ variant }) => void this.onOpen(variant));
    socket.on('close', ({ wasOpen, reason }) => this.onClose(wasOpen, reason));
    socket.on('line', line => this.onLine(line));
    socket.on('data', bytes => this.rawHandler?.(bytes));
  }

  start() {
    this.socket.start();
  }

  stop() {
    this.socket.stop();
    this.onClose(true, 'stopped');
  }

  isConnected() {
    return this.socket.isOpen();
  }

  get variant() {
    return this.socket.variant;
  }

  /** Queue one line (no newlines). Fails immediately while disconnected. */
  send(line: string, options: SendOptions = {}): Promise<string[]> {
    line = line.trim();
    if (!line) return Promise.resolve([]);
    if (line.includes('\n')) return Promise.reject(new Error('send() takes a single line, use sendLines()'));
    if (!this.isConnected()) return Promise.reject(new FluidncAbortError('not connected', line));
    return new Promise((resolve, reject) => {
      this.queue.push({ line, lines: [], timeoutMs: options.timeoutMs ?? this.options.defaultTimeoutMs ?? 30_000, resolve, reject });
      this.pump();
    });
  }

  /** Send several lines one after another, stopping at the first error. */
  async sendLines(text: string, options: SendOptions = {}): Promise<string[]> {
    const out: string[] = [];
    for (const raw of text.split('\n')) {
      const line = raw.replace(/;.*$/, '').trim();
      if (!line) continue;
      out.push(...(await this.send(line, options)));
    }
    return out;
  }

  /** Send a realtime byte, outside the queue. */
  realtime(byte: number) {
    if (!this.isConnected()) throw new FluidncAbortError('not connected', `0x${byte.toString(16)}`);
    this.socket.send(new Uint8Array([byte]));
    if (byte === Realtime.reset) this.rejectAll('soft reset');
  }

  feedHold() {
    this.realtime(Realtime.feedHold);
  }
  cycleStart() {
    this.realtime(Realtime.cycleStart);
  }
  softReset() {
    this.realtime(Realtime.reset);
  }
  jogCancel() {
    this.realtime(Realtime.jogCancel);
  }

  /** Send raw bytes (XMODEM). */
  sendRaw(bytes: Uint8Array) {
    this.socket.send(bytes);
  }

  /**
   * Send a line and hand the raw byte stream to `fn` until it returns (XMODEM receive).
   * The command stays in flight until its own `ok`, so nothing else is interleaved.
   */
  async sendAndTakeStream<T>(line: string, fn: (subscribe: (handler: (bytes: Uint8Array) => void) => void) => Promise<T>) {
    await this.drain();
    if (!this.isConnected()) throw new FluidncAbortError('not connected', line);
    let handler: ((bytes: Uint8Array) => void) | null = null;
    const done = new Promise<string[]>((resolve, reject) => {
      this.inFlight = { line, lines: [], timeoutMs: 0, resolve, reject };
    });
    done.catch(() => {});
    this.rawHandler = bytes => handler?.(bytes);
    this.emitConsole('sent', line);
    this.socket.send(line + '\n');
    let result: T;
    try {
      result = await fn(h => {
        handler = h;
      });
    } catch (err) {
      this.rawHandler = null;
      this.socket.resetLineBuffer();
      // The receiver gives up on its own after a timeout and answers with an error.
      this.finish(cmd => cmd.reject(err as Error));
      throw err;
    }
    this.rawHandler = null;
    this.socket.resetLineBuffer();
    await done;
    return result;
  }

  /** Resolve once nothing is queued or in flight. */
  async drain() {
    while (this.inFlight || this.queue.length) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  private pump() {
    if (this.inFlight || !this.queue.length || this.rawHandler) return;
    if (!this.isConnected()) {
      this.rejectAll('not connected');
      return;
    }
    const cmd = this.queue.shift()!;
    this.inFlight = cmd;
    if (cmd.timeoutMs > 0) {
      cmd.timer = setTimeout(() => {
        if (this.inFlight !== cmd) return;
        this.inFlight = null;
        cmd.reject(new FluidncAbortError('timed out', cmd.line));
        this.pump();
      }, cmd.timeoutMs);
    }
    this.emitConsole('sent', cmd.line);
    this.socket.send(cmd.line + '\n');
  }

  private finish(fn: (cmd: PendingCommand) => void) {
    const cmd = this.inFlight;
    if (!cmd) return;
    clearTimeout(cmd.timer);
    this.inFlight = null;
    fn(cmd);
    this.pump();
  }

  private rejectAll(reason: string) {
    const pending = [...(this.inFlight ? [this.inFlight] : []), ...this.queue];
    this.inFlight = null;
    this.queue = [];
    for (const cmd of pending) {
      clearTimeout(cmd.timer);
      cmd.reject(new FluidncAbortError(reason, cmd.line));
    }
  }

  private emitConsole(kind: ConsoleLineKind, text: string, detail?: string) {
    this.events.emit('console', { kind, text, detail, time: Date.now() });
  }

  private async onOpen(variant: FirmwareVariant) {
    const generation = ++this.generation;
    this.ready = false;
    this.status = null;
    this.lastStatusAt = 0;
    clearInterval(this.pollTimer);
    // Auto-reports only fire on changes while idle, so poll `?` whenever reports go quiet.
    // This doubles as keepalive traffic for 3.9.9, which has no PING.
    this.pollTimer = setInterval(() => {
      if (this.isConnected() && !this.rawHandler && Date.now() - this.lastStatusAt > (this.options.statusPollMs ?? 1500)) {
        this.socket.send(new Uint8Array([Realtime.statusQuery]));
      }
    }, 500);
    // Each step may fail on its own: in Hold, for example, FluidNC defers `$` commands until resume.
    const step = (line: string) => this.send(line, { timeoutMs: 5000 }).catch(() => [] as string[]);
    await step(`$Report/Interval=${this.options.reportIntervalMs ?? 200}`);
    this.buildInfo = parseBuildInfo(await step('$I'));
    await step('$G');
    await step('$#');
    if (generation !== this.generation || !this.isConnected()) return;
    this.ready = true;
    this.events.emit('connected', { variant, buildInfo: this.buildInfo });
  }

  private onClose(wasOpen: boolean, reason: string) {
    this.generation++;
    clearInterval(this.pollTimer);
    this.rejectAll(reason);
    const wasReady = this.ready;
    this.ready = false;
    if (wasOpen || wasReady) this.status = null;
    this.events.emit('disconnected', { wasOpen, reason });
  }

  private onLine(line: string) {
    if (this.rawHandler) return;
    if (line.startsWith('<')) {
      const parsed = parseFluidNCLine(line);
      if (parsed) this.onStatus(parsed);
      return;
    }
    if (line === 'ok') {
      this.emitConsole('ok', line);
      this.finish(cmd => cmd.resolve(cmd.lines));
      return;
    }
    const error = parseErrorLine(line);
    if (error !== null) {
      this.emitConsole('error', line, describeError(error));
      this.finish(cmd => cmd.reject(new FluidncError(error, cmd.line)));
      return;
    }
    const alarm = parseAlarmLine(line);
    if (alarm !== null) {
      const message = describeAlarm(alarm);
      this.emitConsole('alarm', line, message);
      this.rejectAll(`ALARM:${alarm} ${message}`);
      this.events.emit('alarm', { code: alarm, message });
      return;
    }
    if (isResetBanner(line)) {
      this.emitConsole('reset', line);
      this.rejectAll('controller reset');
      this.events.emit('reset', line);
      // Modal state and offsets survive a reset only partially; re-read them.
      void this.send('$G').catch(() => {});
      void this.send('$#').catch(() => {});
      return;
    }

    this.inFlight?.lines.push(line);
    const message = parseMessageLine(line);
    this.emitConsole(message !== null ? 'msg' : 'data', line);
    if (message !== null) {
      this.events.emit('message', message);
      return;
    }
    const modals = parseFluidNCModalLine(line);
    if (modals) {
      this.events.emit('modals', modals);
      return;
    }
    const offset = parseFluidNCOffsetLine(line);
    if (offset) {
      this.events.emit('offset', offset);
      return;
    }
    const probe = parseProbeLine(line);
    if (probe) this.events.emit('probe', probe);
  }

  private onStatus(parsed: ParsedStatus) {
    this.lastStatusAt = Date.now();
    const prev = this.status;
    const wco = parsed.wco ?? prev?.wco ?? kZero;
    const mpos = parsed.mpos ?? (parsed.wpos ? add(parsed.wpos, wco) : (prev?.mpos ?? kZero));
    const wpos = parsed.wpos ?? subtract(mpos, wco);
    const status: MachineStatus = {
      ...parsed,
      mpos,
      wpos,
      wco,
      overrides: parsed.overrides ?? prev?.overrides,
    };
    this.status = status;
    this.events.emit('status', status);
  }
}
