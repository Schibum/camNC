import { computed, effect, signal } from '@preact/signals-react';
import { FluidncClient } from '@wbcnc/fluidnc-api/fluidnc-client';
import * as Comlink from 'comlink';
import { waitForSignal } from '../signals-helper';
import {
  kOffsetCodes,
  ParsedStatus,
  parseFluidNCLine,
  parseFluidNCModalLine,
  parseFluidNCOffsetLine,
  Position,
} from './fluidnc-stream-parser';

export class CncApi {
  // FluidNC status parsed from stream lines
  public readonly status = signal<ParsedStatus | null>(null);
  public readonly machinePos = computed(() => this.status.value?.mpos);
  public readonly coordinateOffsets = signal<Map<string, Position>>(new Map());
  public readonly modals = signal<Set<string>>(new Set());
  public readonly currentOffsetModal = computed(() => kOffsetCodes.find(code => this.modals.value.has(code)));
  public readonly currentZero = signal<Position | null>(null);

  /** Incremented on every start/stop so that stale polling loops exit. */
  private pollGeneration = 0;
  private isPolling = false;
  private readonly pollIntervalMs = 3000;
  private readonly zeroTimeoutMs = 5000;

  constructor(public readonly nc: FluidncClient) {
    effect(() => {
      if (nc.isConnected.value) {
        this.onConnected();
        this.startPolling();
      } else {
        this.stopPolling();
      }
    });
  }

  private onConnected() {
    const proxy = Comlink.proxy((message: { content: string }) => {
      this.onStream(message.content);
    });
    this.nc.api?.onStream(proxy);
  }

  private onStream(line: string) {
    line = line.trim();
    // console.log('fluidnc onStream', line);
    const parsed = parseFluidNCLine(line);
    if (parsed) {
      this.status.value = {
        ...parsed,
        wco: parsed.wco ?? this.status.value?.wco,
        wpos: parsed.wpos ?? this.status.value?.wpos,
      };
      return;
    }

    const offset = parseFluidNCOffsetLine(line);
    if (offset) {
      // Assign a new Map so that subscribers (e.g. waitForSignal) are notified.
      this.coordinateOffsets.value = new Map(this.coordinateOffsets.value).set(offset.code, offset.position);
      this.refreshCurrentZero();
      return;
    }
    const modals = parseFluidNCModalLine(line);
    if (modals) {
      console.log('parsed modals', modals);
      this.modals.value = new Set(modals.words);
      this.refreshCurrentZero();
      return;
    }
  }

  isConnected() {
    return this.nc.isConnected.value;
  }

  private get api() {
    if (!this.nc.api) {
      throw new Error('FluidNC API not connected');
    }
    return this.nc.api;
  }

  jogToMachineCoordinates(x: number, y: number) {
    return this.api.cmd(`G53 G0 X${x} Y${y}`);
  }

  async logCurrentModalsAndOffsets() {
    return this.api.cmd('$G\n$#');
  }

  async getCurrentZero() {
    await this.logCurrentModalsAndOffsets();

    const offset = await waitForSignal(() => this.currentOffsetModal.value, this.zeroTimeoutMs);
    return waitForSignal(() => this.coordinateOffsets.value.get(offset), this.zeroTimeoutMs);
  }

  /**
   * Set the workspace XY zero point to given machine coordinates.
   */
  setWorkspaceXYZero(x: number, y: number) {
    this.currentZero.value = { x, y, z: this.currentZero.value?.z ?? 0 };
    return this.api.cmd(`G10 L2 P0 X${x} Y${y}`);
  }

  setWorkspaceXYZeroAndMove(x: number, y: number) {
    this.currentZero.value = { x, y, z: this.currentZero.value?.z ?? 0 };
    return this.api.cmd(`G10 L2 P0 X${x} Y${y}\n G0 X0 Y0`);
  }

  async uploadGcode(content: string, filename: string) {
    await this.api.upload(content, '/', filename);
  }

  async runFile(filename: string) {
    await this.api.cmd(`$SD/Run=/${filename}`);
  }

  readConfigFile() {
    return this.api.download('/config.yaml');
  }

  private isIdle() {
    return !this.status.value || this.status.value.state === 'Idle';
  }

  /** Start polling machine status ('?') and current zero (via $G/$#) */
  private startPolling() {
    if (this.isPolling) return;
    this.isPolling = true;
    const generation = ++this.pollGeneration;
    this.runPolling(generation, () => this.api.cmd('?'));
    this.runPolling(generation, () => this.logCurrentModalsAndOffsets());
  }

  /** Periodically run `poll` while idle until polling is stopped or restarted. */
  private async runPolling(generation: number, poll: () => Promise<unknown>) {
    let lastSentAt = 0;
    while (generation === this.pollGeneration) {
      if (this.isIdle()) {
        const since = Date.now() - lastSentAt;
        if (since >= this.pollIntervalMs) {
          // `poll` may throw synchronously if the API got disconnected meanwhile.
          await Promise.resolve()
            .then(poll)
            .catch(() => {});
          lastSentAt = Date.now();
        } else {
          await this.delay(this.pollIntervalMs - since);
        }
      } else {
        await this.delay(250);
      }
    }
  }

  private delay(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
  }

  /** Stop all polling loops */
  private stopPolling() {
    this.isPolling = false;
    this.pollGeneration++;
  }

  /** Update `currentZero` based on current modal & offset tables */
  private refreshCurrentZero() {
    const code = this.currentOffsetModal.value;
    if (code) {
      const pos = this.coordinateOffsets.value.get(code) || null;
      this.currentZero.value = pos ?? null;
    } else {
      this.currentZero.value = null;
    }
  }
}
