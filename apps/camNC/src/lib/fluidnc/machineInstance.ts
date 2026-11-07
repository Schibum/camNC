import type { CncApi } from './cnc-api';

// Only the current connection, importing nothing at runtime, so the machine state and job recovery can read it without
// importing machine.ts, which starts job recovery.
let cncApi: CncApi | null = null;
/** Inspect an existing connection without starting one (e.g. while offering a hardware-free rehearsal). */
export const getExistingCncApi = () => cncApi;
export const setExistingCncApi = (api: CncApi | null) => {
  cncApi = api;
};
