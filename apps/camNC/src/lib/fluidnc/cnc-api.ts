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

  /** Interval IDs for polling – cleared automatically on disconnect */
  private statusPollInterval: ReturnType<typeof setInterval> | null = null;
  private zeroPollInterval: ReturnType<typeof setInterval> | null = null;

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
    console.log('fluidnc onStream', line);
    const parsed = parseFluidNCLine(line);
    if (parsed) {
      this.status.value = {
        ...parsed,
        wco: parsed.wco ?? this.status.value?.wco,
        wpos: parsed.wpos ?? this.status.value?.wpos,
      };
      console.log('parsed status', this.status.value.mpos);
      return;
    }

    const offset = parseFluidNCOffsetLine(line);
    if (offset) {
      this.coordinateOffsets.value.set(offset.code, offset.position);
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
    this.api.cmd('$G\n$#');
  }

  async getCurrentZero() {
    await this.logCurrentModalsAndOffsets();

    const offset = await waitForSignal(() => this.currentOffsetModal.value);
    await waitForSignal(() => this.coordinateOffsets.value.get(offset));
    return this.coordinateOffsets.value.get(offset) ?? null;
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

  /** Start polling machine status ('?') and current zero (via $G/$#) */
  private startPolling() {
    // Poll overall machine status every ~3 s – triggers a `<…|MPos:…>` frame
    if (!this.statusPollInterval) {
      this.statusPollInterval = setInterval(() => {
        // Only poll while the machine is idle (or we don't know the state yet).
        const isIdle = !this.status.value || this.status.value.state === 'Idle';
        if (!isIdle) return;

        // Sending `?` causes FluidNC to emit a status frame on the stream.
        try {
          this.api.cmd('?');
        } catch {
          // Silently ignore when not connected – will be retried after reconnect.
        }
      }, 3000);
    }

    // Poll workspace offset / modal every ~3 s to keep zero in sync
    if (!this.zeroPollInterval) {
      this.zeroPollInterval = setInterval(async () => {
        // Only poll while the machine is idle (or we don't know the state yet).
        const isIdle = !this.status.value || this.status.value.state === 'Idle';
        if (!isIdle) return;

        try {
          this.logCurrentModalsAndOffsets();
        } catch {
          /* ignore – will retry on next interval */
        }
      }, 3000);
    }
  }

  /** Stop all polling timers */
  private stopPolling() {
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval);
      this.statusPollInterval = null;
    }
    if (this.zeroPollInterval) {
      clearInterval(this.zeroPollInterval);
      this.zeroPollInterval = null;
    }
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
