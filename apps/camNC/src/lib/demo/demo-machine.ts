import { setSimulatedMachine } from '@/lib/fluidnc/machine';
import { DemoFluidnc } from '@wbcnc/fluidnc/demo';
import { isDemoWithoutCamera } from './demo-mode';
import { applyDemoPreset } from './demo-preset';

let demo: DemoFluidnc | null = null;

/** The simulated controller of this page, once {@link startDemo} ran. */
export function getDemoMachine() {
  return demo;
}

/**
 * Prepare demo mode: the simulated controller, and the preset camera, toolpath and machine in the store.
 * Loaded on demand so that the simulator is not part of the app for everyone else.
 */
export function startDemo() {
  if (demo) return;
  demo = new DemoFluidnc();
  setSimulatedMachine({ WebSocket: demo.WebSocket, fetch: demo.fetch });
  applyDemoPreset(location.origin, { camera: !isDemoWithoutCamera() });
}
