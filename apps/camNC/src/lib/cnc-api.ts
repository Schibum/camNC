import { FluidncClient } from '@wbcnc/fluidnc-api/fluidnc-client';

export class CncApi {
  constructor(public readonly nc: FluidncClient) {
    console.log('CncApi constructor', nc);
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
