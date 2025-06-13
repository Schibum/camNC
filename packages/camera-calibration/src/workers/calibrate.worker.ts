import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import * as Comlink from 'comlink';
import { calibrateCamera } from '../lib/calibrationCore';

export const api = {
  init: async () => {
    await ensureOpenCvIsLoaded();
  },
  calibrate: calibrateCamera,
};
Comlink.expose(api);
