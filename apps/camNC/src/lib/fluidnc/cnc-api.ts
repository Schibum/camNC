import { computed, effect, signal } from '@preact/signals-react';
import { FluidncClient } from '@wbcnc/fluidnc-api/fluidnc-client';
import * as Comlink from 'comlink';
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

  constructor(public readonly nc: FluidncClient) {
    effect(() => {
      if (nc.isConnected.value) this.onConnected();
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
      this.coordinateOffsets.value.set(offset.code, offset.position);
      return;
    }
    const modals = parseFluidNCModalLine(line);
    if (modals) {
      console.log('parsed modals', modals);
      this.modals.value = new Set(modals.words);
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

  currentOffsetModal() {
    return kOffsetCodes.find(code => this.modals.value.has(code));
  }

  logCurrentModals() {
    return this.api.cmd('$G');
  }

  logCoordinateOffsets() {
    /**
 * TODO: handle $# command response in fluidnc-stream-parser:
 * [G54:351.331,148.328,-9.265]
[G55:0.000,0.000,0.000]
[G56:0.000,0.000,0.000]
[G57:0.000,0.000,0.000]
[G58:0.000,0.000,0.000]
[G59:0.000,0.000,0.000]
[G28:0.000,0.000,0.000]
[G30:0.000,0.000,0.000]
[G92:0.000,0.000,0.000]
[TLO:0.000]
 */
    return this.api.cmd('$#');
  }
  async getCurrentZero() {
    await this.logCoordinateOffsets();
    await this.logCurrentModals();
    const offset = this.currentOffsetModal();
    if (!offset) {
      console.warn('current machine offset modal not found');
      return null;
    }
    return this.coordinateOffsets.value.get(offset);
  }

  /**
   * Set the workspace XY zero point to given machine coordinates.
   */
  setWorkspaceXYZero(x: number, y: number) {
    return this.api.cmd(`G10 L2 P0 X${x} Y${y}`);
  }

  setWorkspaceXYZeroAndMove(x: number, y: number) {
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
}
