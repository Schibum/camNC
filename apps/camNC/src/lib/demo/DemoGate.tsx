import type { ReactNode } from 'react';

let readyCalled = false;

/** Stands in for SettingsSyncGate in demo mode: nothing is loaded from or uploaded to an account. */
export function DemoGate({ children, onReady }: { children: ReactNode; onReady?: () => void }) {
  if (!readyCalled) {
    readyCalled = true;
    onReady?.();
  }
  return children;
}
