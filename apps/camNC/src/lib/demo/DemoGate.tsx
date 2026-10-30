import type { ReactNode } from 'react';

let readyCalled = false;

/**
 * Stands in for SettingsSyncGate in demo mode and in the desktop app: nothing is loaded from or uploaded to an
 * account, the settings on this device are used as they are.
 */
export function DemoGate({ children, onReady }: { children: ReactNode; onReady?: () => void }) {
  if (!readyCalled) {
    readyCalled = true;
    onReady?.();
  }
  return children;
}
