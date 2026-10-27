import { useStore } from '../../store/store';
import { CncApi } from './cnc-api';
import { hostBlockedReason, machineSupport } from './machine-support';

let cncApi: CncApi | null = null;
let simulated: { WebSocket: typeof WebSocket; fetch: typeof fetch } | null = null;

/** Demo mode: connect to a simulated controller living in the page instead of a real one. Call before {@link getCncApi}. */
export function setSimulatedMachine(transport: { WebSocket: typeof WebSocket; fetch: typeof fetch }) {
  simulated = transport;
}

/**
 * The app-wide machine connection. It follows the configured host in the store: connects when one is set
 * (and the browser can reach the LAN), disconnects when it is cleared.
 */
export function getCncApi() {
  if (cncApi) return cncApi;
  const api = new CncApi(simulated?.WebSocket, simulated?.fetch, !!simulated);
  cncApi = api;
  api.onVariantDetected = variant => {
    if (useStore.getState().machine?.variant !== variant) useStore.getState().setMachineVariant(variant);
  };
  if (typeof window !== 'undefined' && machineSupport().supported) {
    const follow = (machine: ReturnType<typeof useStore.getState>['machine']) => {
      // A host Chrome would block as mixed content would only retry forever; the form explains it instead.
      if (machine?.host && !hostBlockedReason(machine.host)) api.connect(machine.host, machine.variant);
      else api.disconnect();
    };
    follow(useStore.getState().machine);
    useStore.subscribe(
      s => s.machine?.host,
      () => follow(useStore.getState().machine)
    );
  }
  return api;
}

// In development, a hot reload of this module would otherwise leave the old connection (and its Web Lock) open.
import.meta.hot?.dispose(() => {
  cncApi?.disconnect();
  cncApi = null;
});
