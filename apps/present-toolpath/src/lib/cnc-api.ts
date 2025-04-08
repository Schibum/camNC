import { FluidncApi } from './fluidnc-api';

const fluidncApi = new FluidncApi();

/**
 * Set the workspace XY zero point to given machine coordinates.
 */
export function setWorkspaceXYZero(x: number, y: number) {
  return fluidncApi.cmd(`G10 L2 P0 X${x} Y${y}\n G0 X0 Y0`);
}
