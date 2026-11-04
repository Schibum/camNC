import { getCncApi } from '@/lib/fluidnc/machine';
import { useStore } from '@/store/store';
import { toast } from '@wbcnc/ui/components/sonner';
import { useState } from 'react';

/** Probe Z with the touch plate settings, with a toast for how it went. */
export function useProbeZ() {
  'use no memo';
  const api = getCncApi();
  const prefs = useStore(s => s.machinePrefs);
  const [busy, setBusy] = useState(false);
  const idle = api.state.value === 'Idle';
  async function probe() {
    setBusy(true);
    const promise = api.probeZ({ plateThickness: prefs.probePlateThickness, maxTravel: prefs.probeMaxTravel, feed: prefs.probeFeed });
    toast.promise(promise, {
      loading: 'Probing Z…',
      success: `Z zero set (plate ${prefs.probePlateThickness} mm)`,
      error: err => `Probe failed: ${err instanceof Error ? err.message : err}`,
    });
    await promise.catch(() => {});
    setBusy(false);
  }
  return { probe, disabled: !idle || busy, prefs };
}
