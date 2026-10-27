import { batch, computed, signal } from '@preact/signals-react';
import {
  BuildInfo,
  ConsoleLine,
  deleteSdFile,
  FirmwareVariant,
  FluidncProtocol,
  FluidncSocket,
  kOffsetCodes,
  listSdFiles,
  MachineStatus,
  normalizeHost,
  ParsedOffset,
  Position,
  readConfigText,
  readMachineBounds,
  readMaxRateXY,
  Realtime,
  runSdFile,
  uploadSdFile,
  UploadOptions,
} from '@wbcnc/fluidnc';
import { Macro, macroCommands } from '../machine/macros';
import { waitForSignal } from '../signals-helper';
import { localNetworkPermission } from './machine-support';

export type ConnectionState =
  /** No host configured, or disconnected on purpose */
  | 'disconnected'
  | 'connecting'
  | 'connected'
  /** Chrome's local network access permission was denied */
  | 'permission-denied'
  /** Nothing answered: wrong IP, controller off, or another network */
  | 'unreachable'
  /** Another camNC tab holds the machine */
  | 'other-tab';

const kLockName = 'camnc-machine';
const kMaxConsoleLines = 500;
/** Click-to-jog feed when the controller does not report its max rate. */
const kFallbackJogFeed = 3000;

/** Jogs only start from these states. */
export function canJog(state: string | undefined | null) {
  return state === 'Idle' || state === 'Jog';
}

/**
 * The machine connection used throughout camNC. Wraps {@link FluidncProtocol} in Preact signals.
 *
 * Safety rules: commands fail immediately while disconnected, nothing is re-sent after a reconnect,
 * feed hold/resume/reset are realtime bytes outside the queue, and only one tab can hold the connection.
 */
export class CncApi {
  public readonly connection = signal<ConnectionState>('disconnected');
  public readonly host = signal<string | null>(null);
  public readonly variant = signal<FirmwareVariant | null>(null);
  public readonly firmware = signal<BuildInfo | null>(null);
  public readonly status = signal<MachineStatus | null>(null);
  public readonly alarm = signal<{ code: number; message: string } | null>(null);
  public readonly lastMessage = signal<string | null>(null);
  public readonly consoleLines = signal<ConsoleLine[]>([]);
  public readonly coordinateOffsets = signal<Map<string, Position>>(new Map());
  public readonly modals = signal<Set<string>>(new Set());

  public readonly machinePos = computed(() => this.status.value?.mpos);
  public readonly workPos = computed(() => this.status.value?.wpos);
  public readonly state = computed(() => this.status.value?.state ?? null);
  public readonly overrides = computed(() => this.status.value?.overrides ?? { feed: 100, rapid: 100, spindle: 100 });
  public readonly jobProgress = computed(() => this.status.value?.job ?? null);
  public readonly currentOffsetModal = computed(() => kOffsetCodes.find(code => this.modals.value.has(code)));
  /** Work zero (offset of the active WCS) in machine coordinates. */
  public readonly currentZero = signal<Position | null>(null);
  /** `$H` completed since connecting (FluidNC does not report it). Cleared by alarms and resets. */
  public readonly homed = signal(false);
  /** When Z zero was last set from camNC (probe or "Zero Z"), for the pre-job checklist. */
  public readonly zZeroedAt = signal<number | null>(null);
  /** When the current SD job was first seen running, for the time estimate. */
  public readonly jobStartedAt = signal<number | null>(null);
  public readonly isConnected = computed(() => this.connection.value === 'connected');
  public readonly canJog = computed(() => this.isConnected.value && canJog(this.state.value));

  /** Notified when the controller reports a detected transport, so callers can persist it. */
  public onVariantDetected: ((variant: FirmwareVariant) => void) | null = null;

  private protocol: FluidncProtocol | null = null;
  private releaseLock: (() => void) | null = null;
  private lockAbort: AbortController | null = null;
  private readonly zeroTimeoutMs = 5000;
  /** XY max rate of the connected controller, read on the first click-to-jog. */
  private maxRateXY: Promise<number> | null = null;

  /** `WebSocketImpl` and `fetchImpl` can be swapped for a simulated controller (demo mode, tests). */
  constructor(
    private readonly WebSocketImpl?: typeof WebSocket,
    private readonly fetchImpl?: typeof fetch,
    /** A controller simulated in the page (demo mode). It never competes for the Web Lock that protects real hardware. */
    private readonly simulated = false
  ) {}

  /** Connect to `host`, replacing any previous connection. */
  connect(host: string, variant?: FirmwareVariant) {
    host = normalizeHost(host);
    if (!host) return this.disconnect();
    if (this.protocol && this.host.value === host) return;
    this.disconnect();
    this.homed.value = false;
    this.zZeroedAt.value = null;
    this.host.value = host;
    this.connection.value = 'connecting';
    this.acquireLockThen(() => this.open(host, variant));
  }

  disconnect() {
    this.lockAbort?.abort();
    this.lockAbort = null;
    this.protocol?.stop();
    this.protocol = null;
    this.releaseLock?.();
    this.releaseLock = null;
    batch(() => {
      this.connection.value = 'disconnected';
      this.status.value = null;
      this.host.value = null;
    });
  }

  /** Hold the Web Lock for as long as we are connected. Waits (as 'other-tab') while another tab has it. */
  private acquireLockThen(open: () => void) {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks || this.simulated) {
      open();
      return;
    }
    const abort = new AbortController();
    this.lockAbort = abort;
    const hold = () =>
      new Promise<void>(release => {
        this.releaseLock = release;
        open();
      });
    void locks
      .request(kLockName, { ifAvailable: true }, lock => (lock ? hold() : null))
      .then(result => {
        if (result !== null || abort.signal.aborted || this.releaseLock) return;
        this.connection.value = 'other-tab';
        return locks.request(kLockName, { signal: abort.signal }, () => hold());
      })
      .catch(() => {});
  }

  private open(host: string, variant?: FirmwareVariant) {
    this.maxRateXY = null;
    const socket = new FluidncSocket({ host, variant, WebSocketImpl: this.WebSocketImpl });
    const protocol = new FluidncProtocol(socket);
    this.protocol = protocol;

    protocol.on('connected', ({ variant, buildInfo }) => {
      if (this.protocol !== protocol) return;
      batch(() => {
        this.variant.value = variant;
        this.firmware.value = buildInfo;
        this.connection.value = 'connected';
      });
      this.onVariantDetected?.(variant);
    });
    protocol.on('disconnected', ({ wasOpen }) => {
      if (this.protocol !== protocol) return;
      this.status.value = null;
      if (wasOpen) {
        this.connection.value = 'connecting';
        return;
      }
      void localNetworkPermission(host).then(permission => {
        if (this.protocol !== protocol || protocol.isConnected()) return;
        this.connection.value = permission === 'denied' ? 'permission-denied' : 'unreachable';
      });
    });
    protocol.on('status', status => {
      batch(() => {
        // 4.x drops the SD field while in Hold, so only a finished job (not Hold) clears the start time.
        if (status.job && this.jobStartedAt.value === null) this.jobStartedAt.value = Date.now();
        if (!status.job && status.state !== 'Hold') this.jobStartedAt.value = null;
        this.status.value = status;
        if (status.state !== 'Alarm' && this.alarm.value) this.alarm.value = null;
      });
    });
    protocol.on('alarm', alarm => {
      this.alarm.value = alarm;
      this.homed.value = false;
    });
    protocol.on('reset', () => (this.homed.value = false));
    protocol.on('message', message => (this.lastMessage.value = message));
    protocol.on('modals', modals => {
      this.modals.value = new Set(modals.words);
      this.refreshCurrentZero();
    });
    protocol.on('offset', (offset: ParsedOffset) => {
      // Assign a new Map so that subscribers (e.g. waitForSignal) are notified.
      this.coordinateOffsets.value = new Map(this.coordinateOffsets.value).set(offset.code, offset.position);
      this.refreshCurrentZero();
    });
    protocol.on('console', line => {
      const lines = this.consoleLines.value;
      this.consoleLines.value = [...(lines.length >= kMaxConsoleLines ? lines.slice(-kMaxConsoleLines + 1) : lines), line];
    });
    protocol.start();
  }

  private get api() {
    if (!this.protocol || !this.isConnected.value) {
      throw new Error('Machine not connected');
    }
    return this.protocol;
  }

  // --- commands -----------------------------------------------------------------------------------

  send(line: string, timeoutMs?: number) {
    return this.api.send(line, { timeoutMs });
  }

  sendLines(text: string, timeoutMs?: number) {
    return this.api.sendLines(text, { timeoutMs });
  }

  /**
   * Move to machine coordinates as a (cancellable) jog. Without `feed` it runs at the machine's XY max rate,
   * the speed a `G0` rapid would use.
   */
  async jogToMachineCoordinates(x: number, y: number, feed?: number) {
    const api = this.api;
    feed ??= await this.getMaxRateXY(api);
    return api.send(`$J=G53 G21 X${x.toFixed(3)} Y${y.toFixed(3)} F${feed}`);
  }

  private getMaxRateXY(api: FluidncProtocol) {
    this.maxRateXY ??= readMaxRateXY(api)
      .catch(() => null)
      .then(rate => rate ?? kFallbackJogFeed);
    return this.maxRateXY;
  }

  jogRelative(delta: { x?: number; y?: number; z?: number }, feed: number) {
    const words = (['x', 'y', 'z'] as const)
      .filter(axis => delta[axis])
      .map(axis => `${axis.toUpperCase()}${delta[axis]!.toFixed(3)}`)
      .join(' ');
    if (!words) return Promise.resolve([]);
    return this.api.send(`$J=G91 G21 ${words} F${feed}`);
  }

  jogCancel() {
    this.api.jogCancel();
  }

  feedHold() {
    this.api.feedHold();
  }

  /** Cycle start. FluidNC ignores it while a hold is still decelerating, so wait for Hold:0 first. */
  async resume() {
    const api = this.api;
    const state = this.status.value;
    if (state?.state === 'Hold' && state.subState !== 0) {
      await waitForSignal(() => (this.status.value?.state === 'Hold' && this.status.value.subState === 0 ? true : null), 5000).catch(
        () => {}
      );
    }
    api.cycleStart();
  }

  softReset() {
    this.api.softReset();
  }

  unlock() {
    return this.api.send('$X');
  }

  async home() {
    const lines = await this.api.send('$H', { timeoutMs: 0 });
    this.homed.value = true;
    return lines;
  }

  /** Set feed/rapid/spindle override to `target` percent with the realtime override bytes. */
  setOverride(kind: 'feed' | 'spindle' | 'rapid', target: number) {
    const api = this.api;
    if (kind === 'rapid') {
      api.realtime(target >= 100 ? Realtime.rapidOvr100 : target >= 50 ? Realtime.rapidOvr50 : Realtime.rapidOvr25);
      return;
    }
    const bytes =
      kind === 'feed'
        ? {
            reset: Realtime.feedOvrReset,
            p10: Realtime.feedOvrPlus10,
            m10: Realtime.feedOvrMinus10,
            p1: Realtime.feedOvrPlus1,
            m1: Realtime.feedOvrMinus1,
          }
        : {
            reset: Realtime.spindleOvrReset,
            p10: Realtime.spindleOvrPlus10,
            m10: Realtime.spindleOvrMinus10,
            p1: Realtime.spindleOvrPlus1,
            m1: Realtime.spindleOvrMinus1,
          };
    for (const byte of overrideSteps(target, bytes)) api.realtime(byte);
  }

  async getCurrentZero() {
    await this.api.send('$G');
    await this.api.send('$#');
    const offset = await waitForSignal(() => this.currentOffsetModal.value, this.zeroTimeoutMs);
    return waitForSignal(() => this.coordinateOffsets.value.get(offset), this.zeroTimeoutMs);
  }

  /** Set the workspace XY zero point to given machine coordinates. */
  setWorkspaceXYZero(x: number, y: number) {
    this.currentZero.value = { x, y, z: this.currentZero.value?.z ?? 0 };
    return this.api.send(`G10 L2 P0 X${x} Y${y}`);
  }

  async setWorkspaceXYZeroAndMove(x: number, y: number) {
    await this.setWorkspaceXYZero(x, y);
    return this.api.send('G90 G0 X0 Y0');
  }

  /** Zero the given axes at the current position (G10 L20). */
  async zeroAxes(axes: ('x' | 'y' | 'z')[]) {
    const lines = await this.api.send(`G10 L20 P0 ${axes.map(a => `${a.toUpperCase()}0`).join(' ')}`);
    if (axes.includes('z')) this.zZeroedAt.value = Date.now();
    return lines;
  }

  /**
   * Probe Z down onto a touch plate and set Z zero to the plate thickness, then lift.
   * The probe failing raises ALARM:4/5, which rejects this promise.
   */
  async probeZ({ plateThickness, maxTravel, feed }: { plateThickness: number; maxTravel: number; feed: number }) {
    const api = this.api;
    await api.send('G21 G91');
    try {
      await api.send(`G38.2 Z-${Math.abs(maxTravel)} F${feed}`, { timeoutMs: 0 });
      await api.send(`G10 L20 P0 Z${plateThickness}`);
      this.zZeroedAt.value = Date.now();
      await api.send('G0 Z5');
    } finally {
      await api.send('G90').catch(() => {});
    }
  }

  async runMacro(macro: Macro) {
    const commands = macroCommands(macro);
    return this.api.sendLines(commands, { timeoutMs: 0 });
  }

  // --- files and config -----------------------------------------------------------------------------

  async uploadGcode(content: string, filename: string, options?: UploadOptions) {
    await uploadSdFile(this.api, this.host.value!, filename, content, { fetchImpl: this.fetchImpl, ...options });
  }

  runFile(filename: string) {
    return runSdFile(this.api, filename);
  }

  listFiles() {
    return listSdFiles(this.api);
  }

  deleteFile(filename: string) {
    return deleteSdFile(this.api, filename);
  }

  readConfigText() {
    return readConfigText(this.api);
  }

  readMachineBounds() {
    return readMachineBounds(this.api);
  }

  /** Read a file from the controller's flash, e.g. the WebUI's `/preferences.json`. */
  async readLocalFile(path: string) {
    const lines = await this.api.send(`$LocalFS/Show=${path}`, { timeoutMs: 15_000 });
    return lines.filter(line => !line.startsWith('[MSG:')).join('\n');
  }

  clearConsole() {
    this.consoleLines.value = [];
  }

  /** Update `currentZero` based on current modal & offset tables */
  private refreshCurrentZero() {
    const code = this.currentOffsetModal.value;
    this.currentZero.value = code ? (this.coordinateOffsets.value.get(code) ?? null) : null;
  }
}

/** Realtime bytes that move an override from 100 % (after reset) to `target`, in steps of 10 and 1. */
export function overrideSteps(target: number, bytes: { reset: number; p10: number; m10: number; p1: number; m1: number }) {
  // FluidNC clamps feed to 10–200 % and spindle to 10–200 %.
  const clamped = Math.round(Math.min(200, Math.max(10, target)));
  const out = [bytes.reset];
  let delta = clamped - 100;
  while (Math.abs(delta) >= 10) {
    out.push(delta > 0 ? bytes.p10 : bytes.m10);
    delta += delta > 0 ? -10 : 10;
  }
  while (delta !== 0) {
    out.push(delta > 0 ? bytes.p1 : bytes.m1);
    delta += delta > 0 ? -1 : 1;
  }
  return out;
}
