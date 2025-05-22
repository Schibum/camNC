import { FluidncClient } from '@wbcnc/fluidnc-api/fluidnc-client';
import { useStore } from '../../store';
import { CncApi } from './cnc-api';

// Returns the FluidncClient instance, will create and connect if it doesn't exist yet.
let client: FluidncClient | null = null;
export function getFluidNcClient() {
  if (client) {
    return client;
  }
  const token = useStore.getState().fluidncToken;
  client = new FluidncClient(token);
  client.start();
  return client;
}

let cncApi: CncApi | null = null;
export function getCncApi() {
  if (cncApi) {
    return cncApi;
  }
  cncApi = new CncApi(getFluidNcClient());
  return cncApi;
}
